import type {
  RepositoryBackend,
  ThreadDiffFileSummary,
  ThreadDiffPatchRequest,
  ThreadDiffPatchResult,
  ThreadDiffQuery,
  ThreadDiffRangeOptionsResult,
  ThreadDiffSummaryResult
} from '../../../shared/app-types'
import { THREAD_DIFF_WORKTREE_REF } from '../../../shared/app-types'
import { tryGit, tryGitAsync } from '../../backends/git-client'
import { resolvePath } from '../../backends/repository-backend'
import { isPathInsideRepository } from '../repositories/repository-path-utils'
import type { ThreadGitContext } from '../threads/thread-git-context'
import {
  annotateDiffFilesWithProjects,
  buildCommitOption,
  buildDiffStatMap,
  buildUntrackedDiffFiles,
  buildWorkingTreeDiffFiles,
  getGitDiffStat,
  getGitStatus,
  getWorkingTreeDiffBase,
  hasHeadCommit,
  isWorkingTreeRef,
  parseCommitLines,
  parseNameStatusOutput,
  readCommitOption
} from './thread-diff-helpers'

async function buildUntrackedFilePatch(
  cwd: string,
  path: string,
  backend: RepositoryBackend
): Promise<ThreadDiffPatchResult> {
  const nullPath = backend.kind === 'wsl' || process.platform !== 'win32' ? '/dev/null' : 'NUL'
  const result = await tryGitAsync(
    cwd,
    ['diff', '--no-index', '--binary', '--', nullPath, path],
    backend
  )
  if (result.stdout.trim().length > 0) {
    return { ok: true, patch: result.stdout, isBinary: false }
  }

  return {
    ok: false,
    error: result.stderr || `Unable to build a patch for "${path}".`
  }
}

export function createThreadDiffService(dependencies: {
  resolveThreadGitContext: (threadId: string) => ThreadGitContext
}): {
  getThreadDiffRangeOptions: (threadId: string) => Promise<ThreadDiffRangeOptionsResult>
  getThreadDiffSummary: (input: ThreadDiffQuery) => Promise<ThreadDiffSummaryResult>
  getThreadDiffPatch: (input: ThreadDiffPatchRequest) => Promise<ThreadDiffPatchResult>
} {
  const getThreadDiffRangeOptions = async (
    threadId: string
  ): Promise<ThreadDiffRangeOptionsResult> => {
    const context = dependencies.resolveThreadGitContext(threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository
    if (!hasHeadCommit(cwd, backend)) {
      return { ok: false, error: 'No commits exist on this branch yet.' }
    }

    try {
      const currentBranch = tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], backend)
      const branchName =
        currentBranch.ok && currentBranch.stdout !== 'HEAD' ? currentBranch.stdout : null
      let defaultBaseRef = ''

      if (branchName) {
        const primaryBranch = tryGit(
          cwd,
          ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
          backend
        )
        const primaryName =
          primaryBranch.ok && primaryBranch.stdout
            ? primaryBranch.stdout.replace(/^origin\//, '')
            : (['main', 'master'].find(
                (candidate) =>
                  tryGit(
                    cwd,
                    ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
                    backend
                  ).ok
              ) ?? null)
        if (primaryName && branchName !== primaryName) {
          const mergeBase = tryGit(cwd, ['merge-base', primaryName, 'HEAD'], backend)
          if (mergeBase.ok && mergeBase.stdout) {
            defaultBaseRef = mergeBase.stdout
          }
        }
      }

      if (!defaultBaseRef) {
        const rootCommit = tryGit(cwd, ['rev-list', '--max-parents=0', 'HEAD'], backend)
        defaultBaseRef = rootCommit.stdout.split(/\r?\n/)[0] ?? ''
      }

      if (!defaultBaseRef) {
        return { ok: false, error: 'Unable to determine a branch base commit.' }
      }

      const baseOption = await readCommitOption(cwd, defaultBaseRef, backend, 'Branch base')
      const history = await tryGitAsync(
        cwd,
        ['log', '--reverse', '--format=%H%x1f%h%x1f%s', `${defaultBaseRef}..HEAD`],
        backend
      )
      if (!history.ok) {
        return { ok: false, error: history.stderr || 'Unable to read current branch history.' }
      }

      const commitOptions = [
        baseOption,
        ...parseCommitLines(history.stdout).map((commit) => buildCommitOption(commit))
      ]

      return {
        ok: true,
        options: {
          baseOptions: commitOptions,
          headOptions: [
            ...commitOptions,
            {
              value: THREAD_DIFF_WORKTREE_REF,
              label: 'Current changes',
              description: 'Working tree state on top of HEAD'
            }
          ],
          defaultBaseRef,
          defaultHeadRef: THREAD_DIFF_WORKTREE_REF
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const getRangeToWorkingTreeDiffFiles = async (
    cwd: string,
    backend: RepositoryBackend,
    baseRef: string
  ): Promise<ThreadDiffFileSummary[]> => {
    const [nameStatus, diffSummary, status] = await Promise.all([
      tryGitAsync(cwd, ['diff', '--name-status', '-z', '--find-renames', baseRef], backend),
      getGitDiffStat(cwd, [baseRef], backend),
      getGitStatus(cwd, backend)
    ])
    if (!nameStatus.ok) {
      throw new Error(nameStatus.stderr || 'Unable to read git diff.')
    }

    const trackedFiles = parseNameStatusOutput(nameStatus.stdout, buildDiffStatMap(diffSummary))
    const trackedByPath = new Set(trackedFiles.map((file) => file.path))
    const untrackedFiles = buildUntrackedDiffFiles(status).filter(
      (file) => !trackedByPath.has(file.path)
    )

    return [...trackedFiles, ...untrackedFiles].sort((left, right) =>
      left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
    )
  }

  const getThreadDiffSummary = async (input: ThreadDiffQuery): Promise<ThreadDiffSummaryResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository

    try {
      if (input.mode === 'range') {
        const baseRef = input.baseRef?.trim() ?? ''
        const headRef = input.headRef?.trim() ?? ''
        if (!baseRef || !headRef) {
          return { ok: false, error: 'Both range refs are required.' }
        }

        if (isWorkingTreeRef(baseRef)) {
          return { ok: false, error: 'Base ref must be a commit.' }
        }

        if (isWorkingTreeRef(headRef)) {
          return {
            ok: true,
            summary: {
              mode: input.mode,
              baseRef,
              headRef,
              files: annotateDiffFilesWithProjects(
                cwd,
                backend,
                await getRangeToWorkingTreeDiffFiles(cwd, backend, baseRef)
              )
            }
          }
        }

        const [nameStatus, diffSummary] = await Promise.all([
          tryGitAsync(
            cwd,
            ['diff', '--name-status', '-z', '--find-renames', baseRef, headRef],
            backend
          ),
          getGitDiffStat(cwd, [baseRef, headRef], backend)
        ])
        if (!nameStatus.ok) {
          throw new Error(nameStatus.stderr || 'Unable to read git diff.')
        }

        return {
          ok: true,
          summary: {
            mode: input.mode,
            baseRef,
            headRef,
            files: annotateDiffFilesWithProjects(
              cwd,
              backend,
              parseNameStatusOutput(nameStatus.stdout, buildDiffStatMap(diffSummary))
            )
          }
        }
      }

      const diffBase = getWorkingTreeDiffBase(cwd, backend)
      const [status, diffSummary] = await Promise.all([
        getGitStatus(cwd, backend),
        getGitDiffStat(cwd, [diffBase], backend)
      ])

      return {
        ok: true,
        summary: {
          mode: input.mode,
          baseRef: null,
          headRef: null,
          files: annotateDiffFilesWithProjects(
            cwd,
            backend,
            buildWorkingTreeDiffFiles(status, buildDiffStatMap(diffSummary))
          )
        }
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  const getThreadDiffPatch = async (
    input: ThreadDiffPatchRequest
  ): Promise<ThreadDiffPatchResult> => {
    const context = dependencies.resolveThreadGitContext(input.threadId)
    if (!context.ok) {
      return { ok: false, error: context.error }
    }

    const { cwd } = context
    const { backend } = context.repository
    const trimmedPath = input.path.trim()
    if (!trimmedPath) {
      return { ok: false, error: 'Diff path is required.' }
    }

    const resolvedPath = resolvePath(backend, cwd, trimmedPath)
    if (!isPathInsideRepository(cwd, resolvedPath, backend)) {
      return { ok: false, error: 'Diff path must stay inside the thread working directory.' }
    }

    if (input.status === 'untracked') {
      return buildUntrackedFilePatch(cwd, trimmedPath, backend)
    }

    const previousPath = input.previousPath?.trim() ?? ''
    const pathspec =
      previousPath && previousPath !== trimmedPath ? [previousPath, trimmedPath] : [trimmedPath]

    try {
      const baseRef = input.baseRef?.trim() ?? ''
      const headRef = input.headRef?.trim() ?? ''
      if (input.mode === 'range' && (!baseRef || !headRef)) {
        return { ok: false, error: 'Both range refs are required.' }
      }
      if (input.mode === 'range' && isWorkingTreeRef(baseRef)) {
        return { ok: false, error: 'Base ref must be a commit.' }
      }

      const patch =
        input.mode === 'range'
          ? isWorkingTreeRef(headRef)
            ? await tryGitAsync(
                cwd,
                ['diff', '--patch', '--binary', '--find-renames', baseRef, '--', ...pathspec],
                backend
              )
            : await tryGitAsync(
                cwd,
                [
                  'diff',
                  '--patch',
                  '--binary',
                  '--find-renames',
                  baseRef,
                  headRef,
                  '--',
                  ...pathspec
                ],
                backend
              )
          : await tryGitAsync(
              cwd,
              [
                'diff',
                '--patch',
                '--binary',
                '--find-renames',
                getWorkingTreeDiffBase(cwd, backend),
                '--',
                ...pathspec
              ],
              backend
            )

      if (!patch.ok) {
        return { ok: false, error: patch.stderr || 'Unable to build diff patch.' }
      }

      return {
        ok: true,
        patch: patch.stdout,
        isBinary: patch.stdout.includes('GIT binary patch') || patch.stdout.includes('Binary files')
      }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  return {
    getThreadDiffRangeOptions,
    getThreadDiffSummary,
    getThreadDiffPatch
  }
}
