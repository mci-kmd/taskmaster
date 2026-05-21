import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit, tryGit, tryGitAsync } from './git-client'

const tempDirs: string[] = []

function createTempRepo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-git-client-'))
  tempDirs.push(directory)
  runGit(directory, ['init'])
  return directory
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('git client', () => {
  it('runs git commands in a repository', () => {
    const repo = createTempRepo()
    expect(runGit(repo, ['rev-parse', '--is-inside-work-tree'])).toBe('true')
  })

  it('returns failure results without throwing for tryGit', () => {
    const repo = createTempRepo()
    const result = tryGit(repo, ['rev-parse', '--verify', 'missing-ref'])
    expect(result.ok).toBe(false)
    expect(result.stderr).not.toBe('')
  })

  it('supports async git commands', async () => {
    const repo = createTempRepo()
    await expect(tryGitAsync(repo, ['rev-parse', '--is-inside-work-tree'])).resolves.toMatchObject({
      ok: true,
      stdout: 'true\n',
      stderr: ''
    })
  })
})
