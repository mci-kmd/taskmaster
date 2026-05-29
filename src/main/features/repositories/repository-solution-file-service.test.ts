import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveRepositorySolutionFilePath,
  validateRepositorySolutionFileAbsolutePath,
  validateRepositorySolutionFileInput
} from './repository-solution-file-service'

const tempDirs: string[] = []

function createTempRepo(): string {
  const directory = mkdtempSync(join(tmpdir(), 'taskmaster-solution-file-'))
  tempDirs.push(directory)
  return directory
}

function writeRepoFile(repoPath: string, relativePath: string): string {
  const fullPath = join(repoPath, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, '')
  return fullPath
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('repository solution file service', () => {
  it('accepts repository-relative .slnx files and normalizes the stored path', () => {
    const repoPath = createTempRepo()
    writeRepoFile(repoPath, 'src\\Taskmaster.slnx')

    expect(validateRepositorySolutionFileInput(repoPath, ' src\\Taskmaster.slnx ')).toEqual({
      ok: true,
      path: 'src\\Taskmaster.slnx'
    })
    expect(resolveRepositorySolutionFilePath(repoPath, 'src\\Taskmaster.slnx')).toBe(
      join(repoPath, 'src\\Taskmaster.slnx')
    )
  })

  it('rejects unsupported extensions and paths outside the repository', () => {
    const repoPath = createTempRepo()
    writeRepoFile(repoPath, 'src\\Taskmaster.txt')

    expect(validateRepositorySolutionFileInput(repoPath, 'src\\Taskmaster.txt')).toEqual({
      ok: false,
      error: 'Unsupported solution file. Use .sln or .slnx.'
    })
    expect(validateRepositorySolutionFileInput(repoPath, '..\\Taskmaster.sln')).toEqual({
      ok: false,
      error: 'Solution file must be inside the repository.'
    })
  })

  it('normalizes an absolute picked solution path to a repo-relative path', () => {
    const repoPath = createTempRepo()
    const solutionPath = writeRepoFile(repoPath, 'src\\Taskmaster.sln')

    expect(validateRepositorySolutionFileAbsolutePath(repoPath, solutionPath)).toEqual({
      ok: true,
      path: 'src\\Taskmaster.sln'
    })
  })
})
