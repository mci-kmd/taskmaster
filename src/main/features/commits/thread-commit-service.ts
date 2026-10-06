import { constants } from 'fs'
import { access, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { isAbsolute, join, resolve } from 'path'
import { randomUUID } from 'crypto'
import type {
  CopilotModelSelection,
  RepositoryBackend,
  ThreadCommitPhase,
  ThreadCommitResult
} from '../../../shared/app-types'
import { resolveCommitMessageModel } from '../../../shared/commit'
import type { GitCommandResult } from '../../backends/git-client'
import type { ThreadGitContext } from '../threads/thread-git-context'

export type CommitMessageRequest = CopilotModelSelection & {
  cwd: string
  systemMessage: string
  prompt: string
}

const MAX_DIFF_CHARS = 60_000

export const COMMIT_SYSTEM_MESSAGE = [
  'You write git commit messages.',
  'Reply with only the commit message: no preamble, quotes, or code fences.',
  'Use an imperative summary line of at most 72 characters.',
  'Add a blank line and a short body only when the change needs explanation.',
  "Match the style of the repository's recent commit subjects when they follow a convention."
].join(' ')

export function buildCommitMessagePrompt(input: {
  branch: string | null
  recentSubjects: string[]
  stat: string
  diff: string
}): string {
  const diff =
    input.diff.length > MAX_DIFF_CHARS
      ? `${input.diff.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)`
      : input.diff
  return [
    'Write a commit message for the staged changes below.',
    input.branch ? `Branch: ${input.branch}` : null,
    input.recentSubjects.length
      ? `Recent commit subjects:\n${input.recentSubjects.map((subject) => `- ${subject}`).join('\n')}`
      : null,
    `Changed files:\n${input.stat}`,
    `Diff:\n${diff}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function cleanCommitMessage(reply: string): string {
  let text = reply.trim()
  const fenced = /^```[\w-]*\r?\n([\s\S]*?)\r?\n?```$/u.exec(text)
  if (fenced) text = fenced[1].trim()
  return text
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim()
}

const gitError = (result: GitCommandResult, fallback: string): string =>
  result.stderr.trim() || result.stdout.trim() || fallback

export function createThreadCommitService(dependencies: {
  resolveThreadContext: (threadId: string) => ThreadGitContext
  /** Ids of every thread that runs in the same checkout, including the given one. */
  getThreadIdsSharingCwd: (threadId: string) => string[]
  isThreadWorking: (threadId: string) => boolean
  generateCommitMessage: (request: CommitMessageRequest) => Promise<string>
  runGit: (cwd: string, args: string[], backend: RepositoryBackend) => Promise<GitCommandResult>
  onProgress: (threadId: string, phase: ThreadCommitPhase) => void
  onFinished?: (cwd: string) => void
  platform?: NodeJS.Platform
}): {
  commitThreadChanges: (threadId: string) => Promise<ThreadCommitResult>
} {
  const committing = new Set<string>()
  const platform = dependencies.platform ?? process.platform

  const anyThreadWorking = (threadId: string): boolean =>
    dependencies.getThreadIdsSharingCwd(threadId).some(dependencies.isThreadWorking)

  const hasPreCommitHook = async (cwd: string, backend: RepositoryBackend): Promise<boolean> => {
    // --git-path honours core.hooksPath and linked worktrees.
    const result = await dependencies.runGit(
      cwd,
      ['rev-parse', '--git-path', 'hooks/pre-commit'],
      backend
    )
    const hookPath = result.stdout.trim()
    if (!result.ok || !hookPath) return false
    const path = isAbsolute(hookPath) ? hookPath : resolve(cwd, hookPath)
    try {
      await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return true
    } catch {
      return false
    }
  }

  const push = async (cwd: string, backend: RepositoryBackend): Promise<GitCommandResult> => {
    const upstream = await dependencies.runGit(
      cwd,
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      backend
    )
    if (upstream.ok) return dependencies.runGit(cwd, ['push'], backend)
    const remotes = (await dependencies.runGit(cwd, ['remote'], backend)).stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
    const remote = remotes.includes('origin') ? 'origin' : remotes[0]
    if (!remote) return { ok: false, stdout: '', stderr: 'This repository has no remote.' }
    return dependencies.runGit(cwd, ['push', '-u', remote, 'HEAD'], backend)
  }

  const commit = async (threadId: string): Promise<ThreadCommitResult> => {
    const context = dependencies.resolveThreadContext(threadId)
    if (!context.ok) return { ok: false, error: context.error }
    const { cwd, repository } = context
    const backend = repository.backend
    const key = cwd.toLowerCase()
    if (committing.has(key)) return { ok: false, error: 'A commit is already in progress.' }
    if (anyThreadWorking(threadId))
      return { ok: false, error: 'Wait for Copilot to finish before committing.' }

    committing.add(key)
    try {
      dependencies.onProgress(threadId, 'generating')
      const status = await dependencies.runGit(
        cwd,
        ['status', '--porcelain=v2', '--untracked-files=all'],
        backend
      )
      if (!status.ok) return { ok: false, error: gitError(status, 'Could not read git status.') }
      const entries = status.stdout.split(/\r?\n/u).filter(Boolean)
      if (!entries.length) return { ok: false, error: 'There are no changes to commit.' }
      // Staging a conflicted file would mark it resolved.
      if (entries.some((line) => line.startsWith('u ')))
        return { ok: false, error: 'Resolve merge conflicts before committing.' }

      const staged = await dependencies.runGit(cwd, ['add', '-A'], backend)
      if (!staged.ok) return { ok: false, error: gitError(staged, 'Could not stage changes.') }

      const [stat, diff, log, branch] = await Promise.all([
        dependencies.runGit(cwd, ['diff', '--cached', '--stat', '--no-color'], backend),
        dependencies.runGit(
          cwd,
          ['diff', '--cached', '--no-color', '--no-ext-diff', '--find-renames'],
          backend
        ),
        dependencies.runGit(cwd, ['log', '-n', '10', '--format=%s'], backend),
        dependencies.runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
      ])
      if (!stat.ok || !stat.stdout.trim())
        return { ok: false, error: 'There are no changes to commit.' }

      let message: string
      try {
        message = cleanCommitMessage(
          await dependencies.generateCommitMessage({
            ...resolveCommitMessageModel(repository),
            cwd,
            systemMessage: COMMIT_SYSTEM_MESSAGE,
            prompt: buildCommitMessagePrompt({
              branch: branch.ok && branch.stdout.trim() !== 'HEAD' ? branch.stdout.trim() : null,
              recentSubjects: log.ok ? log.stdout.split(/\r?\n/u).filter(Boolean) : [],
              stat: stat.stdout.trim(),
              diff: diff.stdout
            })
          })
        )
      } catch (error) {
        return {
          ok: false,
          error: `Could not write a commit message: ${error instanceof Error ? error.message : String(error)}`
        }
      }
      if (!message) return { ok: false, error: 'Copilot returned an empty commit message.' }
      if (anyThreadWorking(threadId))
        return { ok: false, error: 'Copilot started working. Commit again when it finishes.' }

      dependencies.onProgress(
        threadId,
        (await hasPreCommitHook(cwd, backend)) ? 'hook' : 'committing'
      )
      const messageFile = join(tmpdir(), `taskmaster-commit-${randomUUID()}.txt`)
      await writeFile(messageFile, `${message}\n`, 'utf8')
      let committed: GitCommandResult
      try {
        committed = await dependencies.runGit(cwd, ['commit', '-F', messageFile], backend)
      } finally {
        await rm(messageFile, { force: true })
      }
      if (!committed.ok)
        return { ok: false, error: `Commit failed: ${gitError(committed, 'git commit failed.')}` }

      if (!repository.autoPushAfterCommit)
        return { ok: true, committed: true, pushed: false, message }

      dependencies.onProgress(threadId, 'pushing')
      const pushed = await push(cwd, backend)
      if (!pushed.ok)
        return {
          ok: false,
          committed: true,
          pushed: false,
          message,
          error: `Committed, but push failed: ${gitError(pushed, 'git push failed.')}`
        }
      return { ok: true, committed: true, pushed: true, message }
    } finally {
      committing.delete(key)
      dependencies.onFinished?.(cwd)
    }
  }

  return { commitThreadChanges: commit }
}
