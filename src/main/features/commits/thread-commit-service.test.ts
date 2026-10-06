import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { PersistedRepository, ThreadCommitPhase } from '../../../shared/app-types'
import { tryGitAsync } from '../../backends/git-client'
import {
  cleanCommitMessage,
  createThreadCommitService,
  type CommitMessageRequest
} from './thread-commit-service'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim()
}

function bareGit(gitDir: string, ...args: string[]): string {
  return execFileSync('git', ['--git-dir', gitDir, ...args], {
    encoding: 'utf8',
    stdio: 'pipe'
  }).trim()
}

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-commit-'))
  directories.push(directory)
  return directory
}

function createRepository(): string {
  const cwd = tempDirectory()
  git(cwd, 'init', '-q', '-b', 'main')
  git(cwd, 'config', 'user.email', 'test@example.com')
  git(cwd, 'config', 'user.name', 'Test')
  git(cwd, 'config', 'commit.gpgsign', 'false')
  // Keep the user's global hooks out of the test repository.
  git(cwd, 'config', 'core.hooksPath', '.git/hooks')
  writeFileSync(join(cwd, 'readme.md'), 'hello\n')
  git(cwd, 'add', '-A')
  git(cwd, 'commit', '-q', '-m', 'Initial commit')
  return cwd
}

function setup(
  cwd: string,
  options: {
    repository?: Partial<PersistedRepository>
    working?: string[]
    generate?: (request: CommitMessageRequest) => Promise<string>
  } = {}
): {
  service: ReturnType<typeof createThreadCommitService>
  phases: ThreadCommitPhase[]
  generateCommitMessage: Mock<(request: CommitMessageRequest) => Promise<string>>
  onFinished: Mock<(cwd: string) => void>
} {
  const phases: ThreadCommitPhase[] = []
  const generateCommitMessage = vi.fn<(request: CommitMessageRequest) => Promise<string>>(
    options.generate ?? (async () => 'Update readme')
  )
  const onFinished = vi.fn<(cwd: string) => void>()
  const repository = {
    id: 'repo',
    name: 'Repo',
    path: cwd,
    backend: { kind: 'native' },
    addedAt: '2026-01-01',
    tasks: [],
    ...options.repository
  } as PersistedRepository
  const service = createThreadCommitService({
    resolveThreadContext: (threadId) =>
      threadId === 'missing'
        ? { ok: false, error: 'Thread not found.' }
        : { ok: true, cwd, repository, thread: { id: threadId } as never },
    getThreadIdsSharingCwd: (threadId) => [threadId, 'sibling'],
    isThreadWorking: (threadId) => options.working?.includes(threadId) ?? false,
    generateCommitMessage,
    runGit: tryGitAsync,
    onProgress: (_threadId, phase) => phases.push(phase),
    onFinished
  })
  return { service, phases, generateCommitMessage, onFinished }
}

describe('thread commit service', () => {
  it('stages everything and commits with the generated message', async () => {
    const cwd = createRepository()
    writeFileSync(join(cwd, 'readme.md'), 'hello world\n')
    writeFileSync(join(cwd, 'notes.txt'), 'new file\n')
    const { service, phases, generateCommitMessage, onFinished } = setup(cwd, {
      generate: async () => '```\nUpdate readme and add notes\n\nExplain why.\n```'
    })

    const result = await service.commitThreadChanges('thread')

    expect(result).toEqual({
      ok: true,
      committed: true,
      pushed: false,
      message: 'Update readme and add notes\n\nExplain why.'
    })
    expect(phases).toEqual(['generating', 'committing'])
    expect(onFinished).toHaveBeenCalledWith(cwd)
    const request = generateCommitMessage.mock.calls[0][0]
    expect(request).toMatchObject({ cwd, model: 'gpt-6-luna', reasoningEffort: 'medium' })
    expect(request.prompt).toContain('Branch: main')
    expect(request.prompt).toContain('- Initial commit')
    expect(request.prompt).toContain('notes.txt')
    expect(request.prompt).toContain('+hello world')
    expect(git(cwd, 'status', '--porcelain')).toBe('')
    expect(git(cwd, 'log', '-1', '--format=%B')).toBe('Update readme and add notes\n\nExplain why.')
  })

  it('uses the project commit model', async () => {
    const cwd = createRepository()
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const { service, generateCommitMessage } = setup(cwd, {
      repository: { commitMessageModel: { model: 'fast-model', reasoningEffort: null } }
    })

    expect((await service.commitThreadChanges('thread')).ok).toBe(true)
    expect(generateCommitMessage.mock.calls[0][0]).toMatchObject({
      model: 'fast-model',
      reasoningEffort: null
    })
  })

  it('reports the pre-commit hook phase and its failures', async () => {
    const cwd = createRepository()
    const hook = join(cwd, '.git', 'hooks', 'pre-commit')
    writeFileSync(hook, '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 })
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const { service, phases } = setup(cwd)

    const result = await service.commitThreadChanges('thread')

    expect(phases).toEqual(['generating', 'hook'])
    expect(result.ok).toBe(false)
    expect(result.committed).toBeUndefined()
    expect(result.error).toMatch(/^Commit failed: .*lint failed/s)
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('readme.md')
    expect(git(cwd, 'log', '-1', '--format=%s')).toBe('Initial commit')
  })

  it('refuses while a session in the checkout works or nothing changed', async () => {
    const cwd = createRepository()
    const idle = setup(cwd)
    expect(await idle.service.commitThreadChanges('thread')).toEqual({
      ok: false,
      error: 'There are no changes to commit.'
    })
    expect(await idle.service.commitThreadChanges('missing')).toEqual({
      ok: false,
      error: 'Thread not found.'
    })

    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const busy = setup(cwd, { working: ['sibling'] })
    expect(await busy.service.commitThreadChanges('thread')).toEqual({
      ok: false,
      error: 'Wait for Copilot to finish before committing.'
    })
    expect(busy.generateCommitMessage).not.toHaveBeenCalled()
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('')
  })

  it('rejects overlapping commits in the same checkout', async () => {
    const cwd = createRepository()
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    let release!: (message: string) => void
    const { service } = setup(cwd, {
      generate: () => new Promise((resolve) => (release = resolve))
    })

    const first = service.commitThreadChanges('thread')
    expect(await service.commitThreadChanges('sibling')).toEqual({
      ok: false,
      error: 'A commit is already in progress.'
    })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release('Change readme')
    expect((await first).ok).toBe(true)
  })

  it('keeps changes staged when the message cannot be written', async () => {
    const cwd = createRepository()
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const { service } = setup(cwd, {
      generate: async () => {
        throw new Error('model unavailable')
      }
    })

    expect(await service.commitThreadChanges('thread')).toEqual({
      ok: false,
      error: 'Could not write a commit message: model unavailable'
    })
    expect(git(cwd, 'diff', '--cached', '--name-only')).toBe('readme.md')
  })

  it('pushes after committing when enabled, setting the upstream when missing', async () => {
    const remote = tempDirectory()
    execFileSync('git', ['init', '-q', '--bare', remote], { stdio: 'pipe' })
    const cwd = createRepository()
    git(cwd, 'remote', 'add', 'origin', remote)
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const { service, phases } = setup(cwd, { repository: { autoPushAfterCommit: true } })

    const result = await service.commitThreadChanges('thread')

    expect(result).toMatchObject({ ok: true, committed: true, pushed: true })
    expect(phases).toEqual(['generating', 'committing', 'pushing'])
    expect(bareGit(remote, 'log', '-1', '--format=%s', 'main')).toBe('Update readme')
    expect(git(cwd, 'rev-parse', '--abbrev-ref', '@{u}')).toBe('origin/main')

    writeFileSync(join(cwd, 'readme.md'), 'changed again\n')
    expect(await service.commitThreadChanges('thread')).toMatchObject({ ok: true, pushed: true })
    expect(bareGit(remote, 'rev-parse', 'main')).toBe(git(cwd, 'rev-parse', 'HEAD'))
  })

  it('reports a push failure after a successful commit', async () => {
    const cwd = createRepository()
    writeFileSync(join(cwd, 'readme.md'), 'changed\n')
    const { service } = setup(cwd, { repository: { autoPushAfterCommit: true } })

    expect(await service.commitThreadChanges('thread')).toEqual({
      ok: false,
      committed: true,
      pushed: false,
      message: 'Update readme',
      error: 'Committed, but push failed: This repository has no remote.'
    })
    expect(git(cwd, 'log', '-1', '--format=%s')).toBe('Update readme')
  })
})

describe('cleanCommitMessage', () => {
  it('strips fences, trailing spaces, and extra blank lines', () => {
    expect(cleanCommitMessage('```text\nSubject  \n\n\n\nBody\n```')).toBe('Subject\n\nBody')
    expect(cleanCommitMessage('  Plain subject \n')).toBe('Plain subject')
  })
})
