import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit, tryGit } from '../../backends/git-client'
import { listRepositoryWorktrees } from '../repositories/repository-git'
import {
  cleanupFailedWorktree,
  createWorktree,
  createWorktreeForExistingBranch,
  removeWorktree
} from './thread-worktree-utils'

const tempRoots: string[] = []

function createCommittedRepository(): string {
  const root = mkdtempSync(join(tmpdir(), 'taskmaster-worktree-convert-'))
  const repositoryPath = join(root, 'repo')
  tempRoots.push(root)
  mkdirSync(repositoryPath)
  runGit(repositoryPath, ['init', '--initial-branch=feature/thread'])
  writeFileSync(join(repositoryPath, 'README.md'), 'latest commit')
  runGit(repositoryPath, ['add', 'README.md'])
  runGit(repositoryPath, [
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-m',
    'latest'
  ])
  return repositoryPath
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('thread worktree conversion helpers', () => {
  it('checks out the latest existing branch commit in the new worktree', () => {
    const repositoryPath = createCommittedRepository()
    const expectedCommit = runGit(repositoryPath, ['rev-parse', 'feature/thread'])
    runGit(repositoryPath, ['checkout', '--detach'])

    const worktreePath = createWorktreeForExistingBranch(repositoryPath, 'feature/thread')

    expect(runGit(worktreePath, ['rev-parse', 'HEAD'])).toBe(expectedCommit)
    expect(runGit(worktreePath, ['symbolic-ref', '--short', 'HEAD'])).toBe('feature/thread')
    expect(tryGit(repositoryPath, ['config', '--local', '--get', 'core.longpaths']).ok).toBe(false)

    removeWorktree(
      { branchName: 'feature/thread', worktreePath },
      repositoryPath,
      { kind: 'native' },
      false,
      false
    )
    expect(existsSync(worktreePath)).toBe(false)
    expect(tryGit(repositoryPath, ['config', '--local', '--get', 'core.longpaths']).ok).toBe(false)
  })

  it('checks out tracked paths beyond the traditional Windows path limit', () => {
    const repositoryPath = createCommittedRepository()
    const deepDirectory = Array.from(
      { length: 10 },
      (_, index) => `long-directory-${String(index).padStart(2, '0')}`
    )
    const relativePath = join('portal', ...deepDirectory, 'long-worktree-file.txt')
    const sourcePath = join(repositoryPath, relativePath)
    mkdirSync(join(sourcePath, '..'), { recursive: true })
    writeFileSync(sourcePath, 'long path')
    runGit(repositoryPath, ['-c', 'core.longpaths=true', 'add', '--', relativePath])
    runGit(repositoryPath, [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'long path'
    ])
    runGit(repositoryPath, ['checkout', '--detach'])

    const worktreePath = createWorktreeForExistingBranch(repositoryPath, 'feature/thread')

    expect(join(worktreePath, relativePath).length).toBeGreaterThan(260)
    expect(existsSync(join(worktreePath, relativePath))).toBe(true)
    expect(tryGit(repositoryPath, ['config', '--local', '--get', 'core.longpaths']).ok).toBe(false)
  })

  it('removes an unregistered partial directory and prunes metadata', () => {
    const repositoryPath = createCommittedRepository()
    const partialPath = join(repositoryPath, '..', 'repo.worktrees', 'partial')
    mkdirSync(partialPath, { recursive: true })
    writeFileSync(join(partialPath, '.git'), 'gitdir: missing')
    writeFileSync(join(partialPath, 'partial.txt'), 'partial')

    cleanupFailedWorktree(
      { branchName: 'missing-branch', worktreePath: partialPath },
      repositoryPath,
      { kind: 'native' },
      {
        deleteBranch: false,
        ownsWorktreePath: true
      }
    )

    expect(existsSync(partialPath)).toBe(false)
  })

  it('does not recursively delete an unrelated directory after cleanup failure', () => {
    const repositoryPath = createCommittedRepository()
    const unrelatedPath = join(repositoryPath, '..', 'repo.worktrees', 'unrelated')
    mkdirSync(unrelatedPath, { recursive: true })
    writeFileSync(join(unrelatedPath, 'keep.txt'), 'keep')

    expect(() =>
      cleanupFailedWorktree(
        { branchName: 'missing-branch', worktreePath: unrelatedPath },
        repositoryPath,
        { kind: 'native' },
        {
          deleteBranch: false,
          ownsWorktreePath: false
        }
      )
    ).toThrow('does not own that path')

    expect(existsSync(join(unrelatedPath, 'keep.txt'))).toBe(true)
  })

  it('removes locked metadata when the failed worktree directory is missing', () => {
    const repositoryPath = createCommittedRepository()
    runGit(repositoryPath, ['checkout', '--detach'])
    const worktreePath = createWorktreeForExistingBranch(repositoryPath, 'feature/thread')
    runGit(repositoryPath, ['worktree', 'lock', worktreePath])
    rmSync(worktreePath, { recursive: true, force: true })

    cleanupFailedWorktree(
      { branchName: 'feature/thread', worktreePath },
      repositoryPath,
      { kind: 'native' },
      {
        deleteBranch: false,
        ownsWorktreePath: true
      }
    )

    expect(
      listRepositoryWorktrees(repositoryPath).some(
        (worktree) => worktree.branchName === 'feature/thread'
      )
    ).toBe(false)
    expect(tryGit(repositoryPath, ['show-ref', '--verify', 'refs/heads/feature/thread']).ok).toBe(
      true
    )
  })

  it('deletes only branches created by the failed operation', () => {
    const repositoryPath = createCommittedRepository()
    runGit(repositoryPath, ['checkout', '--detach'])
    const worktreePath = createWorktree(repositoryPath, 'feature/new', 'HEAD')

    cleanupFailedWorktree(
      { branchName: 'feature/new', worktreePath },
      repositoryPath,
      { kind: 'native' },
      {
        deleteBranch: true,
        ownsWorktreePath: true
      }
    )

    expect(tryGit(repositoryPath, ['show-ref', '--verify', 'refs/heads/feature/new']).ok).toBe(
      false
    )
    expect(tryGit(repositoryPath, ['show-ref', '--verify', 'refs/heads/feature/thread']).ok).toBe(
      true
    )
  })
})
