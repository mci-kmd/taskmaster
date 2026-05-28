import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedRepository, PersistedThread } from '../../../shared/app-types'
import { createNativeBackend } from '../../backends/repository-backend'
import { runGit } from '../../backends/git-client'
import { createThreadDiffService } from './thread-diff-service'

const tempDirs: string[] = []

function createTempRepo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-thread-diff-'))
  tempDirs.push(directory)
  runGit(directory, ['init'])
  runGit(directory, ['config', 'user.name', 'Taskmaster Tests'])
  runGit(directory, ['config', 'user.email', 'taskmaster@example.com'])
  return directory
}

function writeRepoFile(repo: string, relativePath: string, content: string | Buffer): void {
  const fullPath = join(repo, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content)
}

function commitAll(repo: string, message: string): string {
  runGit(repo, ['add', '.'])
  runGit(repo, ['commit', '-m', message])
  return runGit(repo, ['rev-parse', 'HEAD'])
}

function createHarness(repoPath: string): ReturnType<typeof createThreadDiffService> {
  const repository: PersistedRepository = {
    id: 'repo-1',
    name: 'Repo',
    path: repoPath,
    backend: createNativeBackend(),
    faviconPath: null,
    runCommand: null,
    newWorktreeSetupCommand: null,
    postWorktreeRemoveCommand: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    tasks: []
  }
  const thread: PersistedThread = {
    id: 'thread-1',
    repositoryId: repository.id,
    customTitle: null,
    latestCopilotTitle: null,
    lastUserMessage: null,
    mode: 'active-branch',
    branchName: 'main',
    worktreePath: null,
    sessionName: 'session-1',
    resumeSessionId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    hasLaunched: false
  }

  return createThreadDiffService({
    resolveThreadGitContext: () => ({
      ok: true,
      cwd: repoPath,
      repository,
      thread
    })
  })
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('thread diff service', () => {
  it('reads and saves working-tree files while preserving BOM and CRLF', async () => {
    const repo = createTempRepo()
    const service = createHarness(repo)
    const filePath = 'src\\example.ts'
    const bomCrLfContent = Buffer.from([
      0xef,
      0xbb,
      0xbf,
      ...Buffer.from('const value = 1\r\nconst next = 2\r\n', 'utf8')
    ])

    writeRepoFile(repo, filePath, bomCrLfContent)
    commitAll(repo, 'initial')

    writeRepoFile(
      repo,
      filePath,
      Buffer.from([
        0xef,
        0xbb,
        0xbf,
        ...Buffer.from('const value = 3\r\nconst next = 4\r\n', 'utf8')
      ])
    )

    const content = await service.getThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'working-tree',
      path: filePath,
      status: 'modified'
    })

    expect(content).toEqual({
      ok: true,
      content: 'const value = 3\nconst next = 4\n',
      revisionToken: expect.any(String)
    })

    const save = await service.saveThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'working-tree',
      path: filePath,
      status: 'modified',
      content: 'const value = 5\nconst next = 6\n',
      expectedRevisionToken: content.ok ? content.revisionToken : ''
    })

    expect(save).toEqual({ ok: true, revisionToken: expect.any(String) })
    expect(readFileSync(join(repo, filePath), 'utf8')).toBe(
      '\uFEFFconst value = 5\r\nconst next = 6\r\n'
    )
  })

  it('reads the head-side range snapshot instead of the working tree', async () => {
    const repo = createTempRepo()
    const service = createHarness(repo)
    const filePath = 'src\\range-example.ts'

    writeRepoFile(repo, filePath, 'export const value = 1;\n')
    const baseRef = commitAll(repo, 'base')
    writeRepoFile(repo, filePath, 'export const value = 2;\n')
    const headRef = commitAll(repo, 'head')
    writeRepoFile(repo, filePath, 'export const value = 3;\n')

    const content = await service.getThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'range',
      baseRef,
      headRef,
      path: filePath,
      status: 'modified'
    })

    expect(content).toEqual({
      ok: true,
      content: 'export const value = 2;\n',
      revisionToken: expect.any(String)
    })
  })

  it('rejects saving from range mode', async () => {
    const repo = createTempRepo()
    const service = createHarness(repo)
    const filePath = 'src\\range-save.ts'

    writeRepoFile(repo, filePath, 'export const value = 1;\n')
    const baseRef = commitAll(repo, 'base')
    writeRepoFile(repo, filePath, 'export const value = 2;\n')
    const headRef = commitAll(repo, 'head')

    const save = await service.saveThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'range',
      baseRef,
      headRef,
      path: filePath,
      status: 'modified',
      content: 'export const value = 3;\n',
      expectedRevisionToken: 'stale'
    })

    expect(save).toEqual({
      ok: false,
      error: 'Editing is only allowed in the uncommitted diff scope.'
    })
  })

  it('rejects stale saves after external changes', async () => {
    const repo = createTempRepo()
    const service = createHarness(repo)
    const filePath = 'src\\stale.ts'

    writeRepoFile(repo, filePath, 'export const value = 1;\n')
    commitAll(repo, 'initial')
    writeRepoFile(repo, filePath, 'export const value = 2;\n')

    const content = await service.getThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'working-tree',
      path: filePath,
      status: 'modified'
    })

    writeRepoFile(repo, filePath, 'export const value = 3;\n')

    const save = await service.saveThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'working-tree',
      path: filePath,
      status: 'modified',
      content: 'export const value = 4;\n',
      expectedRevisionToken: content.ok ? content.revisionToken : ''
    })

    expect(save).toEqual({
      ok: false,
      error: 'File changed on disk. Reload before saving.'
    })
  })

  it('returns a clear error for deleted files', async () => {
    const repo = createTempRepo()
    const service = createHarness(repo)
    const filePath = 'src\\deleted.ts'

    writeRepoFile(repo, filePath, 'export const value = 1;\n')
    commitAll(repo, 'initial')
    unlinkSync(join(repo, filePath))

    const content = await service.getThreadDiffFileContent({
      threadId: 'thread-1',
      mode: 'working-tree',
      path: filePath,
      status: 'deleted'
    })

    expect(content).toEqual({
      ok: false,
      error: 'Deleted files do not have current file content.'
    })
  })
})
