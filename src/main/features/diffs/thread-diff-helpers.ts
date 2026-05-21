import type { DiffResultTextFile } from 'simple-git'
import { readdirSync } from 'fs'
import { extname, relative } from 'path'
import type {
  ThreadDiffFileStatus,
  ThreadDiffFileSummary,
  ThreadDiffRangeOption,
  RepositoryBackend
} from '../../../shared/app-types'
import { THREAD_DIFF_WORKTREE_REF } from '../../../shared/app-types'
import { tryGit, tryGitAsync } from '../../backends/git-client'
import {
  buildNativeCommand,
  createNativeBackend,
  getDirname,
  joinPath,
  normalizePath,
  resolvePath,
  spawnSyncBackendCommand,
  backendPathExists
} from '../../backends/repository-backend'
import { isPathInsideRepository } from '../repositories/repository-path-utils'

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

type DiffProjectInfo = {
  rootPath: string
}
type GitFileStatus = {
  path: string
  from?: string
  index: string
  working_dir: string
}
type GitStatus = {
  files: GitFileStatus[]
  renamed: Array<{ from: string; to: string }>
}
type ParsedCommitLine = {
  fullHash: string
  shortHash: string
  subject: string
}

export function hasHeadCommit(
  cwd: string,
  backend: RepositoryBackend = createNativeBackend()
): boolean {
  return tryGit(cwd, ['rev-parse', '--verify', 'HEAD'], backend).ok
}

export function getWorkingTreeDiffBase(
  cwd: string,
  backend: RepositoryBackend = createNativeBackend()
): string {
  return hasHeadCommit(cwd, backend) ? 'HEAD' : EMPTY_TREE_HASH
}

export function isWorkingTreeRef(ref: string | null | undefined): boolean {
  return (ref?.trim() ?? '') === THREAD_DIFF_WORKTREE_REF
}

export function parseCommitLines(stdout: string): ParsedCommitLine[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [fullHash = '', shortHash = '', subject = ''] = line.split('\u001f')
      return {
        fullHash,
        shortHash,
        subject
      }
    })
    .filter((commit) => commit.fullHash.length > 0)
}

export function buildCommitOption(
  commit: ParsedCommitLine,
  labelPrefix?: string
): ThreadDiffRangeOption {
  const subject = commit.subject || '(no subject)'
  return {
    value: commit.fullHash,
    label: labelPrefix
      ? `${labelPrefix}: ${subject} (${commit.shortHash})`
      : `${subject} (${commit.shortHash})`,
    description: commit.fullHash
  }
}

export async function readCommitOption(
  cwd: string,
  ref: string,
  backend: RepositoryBackend,
  labelPrefix?: string
): Promise<ThreadDiffRangeOption> {
  const result = await tryGitAsync(cwd, ['show', '-s', '--format=%H%x1f%h%x1f%s', ref], backend)
  if (!result.ok) {
    throw new Error(result.stderr || `Unable to read commit ${ref}.`)
  }

  const commit = parseCommitLines(result.stdout)[0]
  if (!commit) {
    throw new Error(`Unable to read commit ${ref}.`)
  }

  return buildCommitOption(commit, labelPrefix)
}

export function buildUntrackedDiffFiles(status: GitStatus): ThreadDiffFileSummary[] {
  return status.files
    .filter((file) => resolveWorkingTreeFileStatus(file, new Map()) === 'untracked')
    .map((file) => ({
      path: file.path,
      previousPath: null,
      projectRootPath: null,
      previousProjectRootPath: null,
      status: 'untracked' as const,
      additions: null,
      deletions: null,
      isBinary: false
    }))
}

function normalizeDiffStatPath(path: string): string {
  const braceRename = /^(.*)\{([^{}]+?) => ([^{}]+?)\}(.*)$/.exec(path)
  if (braceRename) {
    return `${braceRename[1]}${braceRename[3]}${braceRename[4]}`
  }

  const arrowIndex = path.lastIndexOf(' => ')
  return arrowIndex >= 0 ? path.slice(arrowIndex + 4) : path
}

export function buildDiffStatMap(files: DiffResultTextFile[]): Map<string, DiffResultTextFile> {
  const stats = new Map<string, DiffResultTextFile>()

  for (const file of files) {
    if (file.binary) {
      continue
    }

    stats.set(normalizeDiffStatPath(file.file), file)
  }

  return stats
}

function mapStatusTokenToDiffStatus(token: string): ThreadDiffFileStatus {
  switch (token[0]) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'conflicted'
    case 'T':
      return 'typechange'
    default:
      return 'modified'
  }
}

export function parseNameStatusOutput(
  stdout: string,
  stats: Map<string, DiffResultTextFile>
): ThreadDiffFileSummary[] {
  const files: ThreadDiffFileSummary[] = []
  const tokens = stdout.split('\0')

  for (let index = 0; index < tokens.length; ) {
    const statusToken = tokens[index++]
    if (!statusToken) {
      continue
    }

    const status = mapStatusTokenToDiffStatus(statusToken)
    if (status === 'renamed' || status === 'copied') {
      const previousPath = tokens[index++] ?? ''
      const path = tokens[index++] ?? ''
      if (!path) {
        continue
      }

      const stat = stats.get(path) ?? null
      files.push({
        path,
        previousPath: previousPath || null,
        projectRootPath: null,
        previousProjectRootPath: null,
        status,
        additions: stat?.insertions ?? null,
        deletions: stat?.deletions ?? null,
        isBinary: false
      })
      continue
    }

    const path = tokens[index++] ?? ''
    if (!path) {
      continue
    }

    const stat = stats.get(path) ?? null
    files.push({
      path,
      previousPath: null,
      projectRootPath: null,
      previousProjectRootPath: null,
      status,
      additions: stat?.insertions ?? null,
      deletions: stat?.deletions ?? null,
      isBinary: false
    })
  }

  return files.sort((left, right) =>
    left.path.localeCompare(right.path, undefined, { sensitivity: 'base' })
  )
}

function parseGitStatus(stdout: string): GitStatus {
  const files: GitFileStatus[] = []
  const renamed: Array<{ from: string; to: string }> = []
  const tokens = stdout.split('\0')

  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index]
    if (!entry) {
      continue
    }

    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (!path) {
      continue
    }

    const file: GitFileStatus = {
      path,
      index: status[0] ?? ' ',
      working_dir: status[1] ?? ' '
    }

    if (file.index === 'R' || file.index === 'C') {
      const from = tokens[++index] ?? ''
      if (from) {
        file.from = from
        renamed.push({ from, to: path })
      }
    }

    files.push(file)
  }

  return { files, renamed }
}

function parseDiffNumstat(stdout: string): DiffResultTextFile[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [insertions = '', deletions = '', file = ''] = line.split('\t')
      return {
        file,
        insertions: Number.isFinite(Number(insertions)) ? Number(insertions) : 0,
        deletions: Number.isFinite(Number(deletions)) ? Number(deletions) : 0,
        binary: insertions === '-' || deletions === '-'
      } as DiffResultTextFile
    })
}

export async function getGitStatus(
  cwd: string,
  backend: RepositoryBackend = createNativeBackend()
): Promise<GitStatus> {
  const result = await tryGitAsync(
    cwd,
    ['status', '--porcelain', '-z', '--untracked-files=all'],
    backend
  )
  if (!result.ok) {
    throw new Error(result.stderr || 'Unable to read git status.')
  }

  return parseGitStatus(result.stdout)
}

export async function getGitDiffStat(
  cwd: string,
  args: string[],
  backend: RepositoryBackend = createNativeBackend()
): Promise<DiffResultTextFile[]> {
  const result = await tryGitAsync(cwd, ['diff', '--numstat', '--find-renames', ...args], backend)
  if (!result.ok) {
    throw new Error(result.stderr || 'Unable to read git diff summary.')
  }

  return parseDiffNumstat(result.stdout)
}

function resolveWorkingTreeFileStatus(
  file: GitFileStatus,
  renamedByPath: Map<string, string>
): ThreadDiffFileStatus {
  if (file.index === 'U' || file.working_dir === 'U') {
    return 'conflicted'
  }

  if (file.index === '?' || file.working_dir === '?') {
    return 'untracked'
  }

  if (file.index === 'T' || file.working_dir === 'T') {
    return 'typechange'
  }

  if (file.index === 'D' || file.working_dir === 'D') {
    return 'deleted'
  }

  if (file.index === 'A' || file.working_dir === 'A') {
    return 'added'
  }

  if (file.index === 'C' || file.working_dir === 'C') {
    return 'copied'
  }

  if (file.index === 'R' || file.working_dir === 'R' || renamedByPath.has(file.path)) {
    return 'renamed'
  }

  return 'modified'
}

export function buildWorkingTreeDiffFiles(
  status: GitStatus,
  stats: Map<string, DiffResultTextFile>
): ThreadDiffFileSummary[] {
  const renamedByPath = new Map(status.renamed.map((entry) => [entry.to, entry.from]))

  return status.files
    .map((file) => {
      const stat = stats.get(file.path) ?? null
      const diffStatus = resolveWorkingTreeFileStatus(file, renamedByPath)
      return {
        path: file.path,
        previousPath: file.from ?? renamedByPath.get(file.path) ?? null,
        projectRootPath: null,
        previousProjectRootPath: null,
        status: diffStatus,
        additions: stat?.insertions ?? null,
        deletions: stat?.deletions ?? null,
        isBinary: false
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }))
}

function normalizeDiffProjectPath(path: string): string {
  return path.replaceAll('\\', '/')
}

function directoryContainsProjectMarker(path: string, backend: RepositoryBackend): boolean {
  if (!backendPathExists(backend, path, 'directory')) {
    return false
  }

  if (backendPathExists(backend, joinPath(backend, path, 'package.json'), 'file')) {
    return true
  }

  if (backend.kind === 'wsl') {
    const result = spawnSyncBackendCommand(
      backend,
      buildNativeCommand('find', [
        path,
        '-maxdepth',
        '1',
        '-type',
        'f',
        '-name',
        '*.csproj',
        '-print',
        '-quit'
      ])
    )
    return result.ok && result.stdout.length > 0
  }

  return readdirSync(path, { withFileTypes: true }).some(
    (entry) => entry.isFile() && extname(entry.name).toLowerCase() === '.csproj'
  )
}

function findDiffProjectForPath(
  cwd: string,
  fileRelativePath: string,
  backend: RepositoryBackend,
  cache: Map<string, DiffProjectInfo | null>
): DiffProjectInfo | null {
  const normalizedCwd = normalizePath(backend, cwd)
  let currentDirectory = getDirname(resolvePath(backend, cwd, fileRelativePath), backend)
  const visitedDirectories: string[] = []

  while (true) {
    const normalizedDirectory = normalizePath(backend, currentDirectory)
    if (
      normalizedDirectory !== normalizedCwd &&
      !isPathInsideRepository(cwd, normalizedDirectory, backend)
    ) {
      break
    }

    const cached = cache.get(normalizedDirectory)
    if (cached !== undefined) {
      for (const directory of visitedDirectories) {
        cache.set(directory, cached)
      }
      return cached
    }

    visitedDirectories.push(normalizedDirectory)
    if (directoryContainsProjectMarker(normalizedDirectory, backend)) {
      const projectRootPath =
        normalizedDirectory === normalizedCwd
          ? ''
          : backend.kind === 'wsl'
            ? normalizedDirectory.slice(normalizedCwd.length + 1)
            : relative(cwd, normalizedDirectory)
      const project = {
        rootPath: normalizeDiffProjectPath(projectRootPath)
      }
      for (const directory of visitedDirectories) {
        cache.set(directory, project)
      }
      return project
    }

    if (normalizedDirectory === normalizedCwd) {
      break
    }

    const parentDirectory = getDirname(normalizedDirectory, backend)
    if (parentDirectory === normalizedDirectory) {
      break
    }

    currentDirectory = parentDirectory
  }

  for (const directory of visitedDirectories) {
    cache.set(directory, null)
  }

  return null
}

export function annotateDiffFilesWithProjects(
  cwd: string,
  backend: RepositoryBackend,
  files: ThreadDiffFileSummary[]
): ThreadDiffFileSummary[] {
  const projectCache = new Map<string, DiffProjectInfo | null>()

  return files.map((file) => {
    const project = findDiffProjectForPath(cwd, file.path, backend, projectCache)
    const previousProject =
      file.previousPath === null
        ? null
        : findDiffProjectForPath(cwd, file.previousPath, backend, projectCache)

    return {
      ...file,
      projectRootPath: project?.rootPath ?? null,
      previousProjectRootPath: previousProject?.rootPath ?? null
    }
  })
}
