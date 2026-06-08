import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../../backends/git-client'
import {
  getCurrentBranchLabel,
  getCurrentBranchLabelAsync,
  getCurrentBranchName,
  getPrimaryBranch,
  getProtectedBranchDeletionError
} from './repository-git'

const tempDirs: string[] = []

function createUnbornRepo(branchName: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-repository-git-'))
  tempDirs.push(directory)
  runGit(directory, ['init', `--initial-branch=${branchName}`])
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('repository git helpers', () => {
  it('reads the unborn branch name from a newly initialized repository', async () => {
    const repo = createUnbornRepo('master')

    expect(getCurrentBranchLabel(repo)).toBe('master')
    expect(getCurrentBranchName(repo)).toBe('master')
    await expect(getCurrentBranchLabelAsync(repo)).resolves.toBe('master')
  })

  it('does not infer a primary branch from a conventional branch name', () => {
    const repo = createUnbornRepo('main')

    expect(getPrimaryBranch(repo)).toBeNull()
    expect(getProtectedBranchDeletionError(repo, 'main')).toBeNull()
  })
})
