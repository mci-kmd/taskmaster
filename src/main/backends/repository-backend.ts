import type { ChildProcess, SpawnOptions, SpawnSyncOptions } from 'child_process'
import type { RepositoryBackend } from '../../shared/app-types'
import { nativeRepositoryBackendImplementation } from './native-repository-backend'
import {
  linuxPathToWslUncPath,
  normalizeLinuxPath,
  windowsPathSuffixToLinuxPath,
  wslRepositoryBackendImplementation
} from './wsl-repository-backend'

export type BackendCommand = {
  file: string
  args: string[]
  displayCommand: string
}

export type BackendCommandResult = {
  ok: boolean
  stdout: string
  stderr: string
  status: number | null
  error?: Error
}

export type RepositoryBackendImplementation = {
  kind: RepositoryBackend['kind']
  getBasename: (backend: RepositoryBackend, path: string) => string
  getDirname: (backend: RepositoryBackend, path: string) => string
  joinPath: (backend: RepositoryBackend, ...parts: string[]) => string
  resolvePath: (backend: RepositoryBackend, base: string, path: string) => string
  relativePath: (backend: RepositoryBackend, from: string, to: string) => string
  normalizePath: (backend: RepositoryBackend, path: string) => string
  isAbsolutePath: (backend: RepositoryBackend, path: string) => boolean
  toUiPath: (backend: RepositoryBackend, executionPath: string) => string
  pathForDisplay: (backend: RepositoryBackend, path: string) => string
  buildCommand: (
    backend: RepositoryBackend,
    command: BackendCommand,
    cwd?: string
  ) => BackendCommand
  spawnSyncCommand: (
    backend: RepositoryBackend,
    command: BackendCommand,
    options?: SpawnSyncOptions & { cwd?: string }
  ) => BackendCommandResult
  spawnCommand: (
    backend: RepositoryBackend,
    command: BackendCommand,
    options?: SpawnOptions & { cwd?: string }
  ) => ChildProcess
  pathExists: (
    backend: RepositoryBackend,
    path: string,
    type?: 'any' | 'directory' | 'file'
  ) => boolean
  mkdir: (backend: RepositoryBackend, path: string) => void
}

const WSL_UNC_PATTERN = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i
const BACKEND_IMPLEMENTATIONS: Record<RepositoryBackend['kind'], RepositoryBackendImplementation> =
  {
    native: nativeRepositoryBackendImplementation,
    wsl: wslRepositoryBackendImplementation
  }

function getRepositoryBackendImplementation(
  backend: RepositoryBackend
): RepositoryBackendImplementation {
  return BACKEND_IMPLEMENTATIONS[backend.kind]
}

export function buildNativeCommand(
  file: string,
  args: string[] = [],
  displayCommand?: string
): BackendCommand {
  return {
    file,
    args,
    displayCommand: displayCommand ?? [file, ...args].join(' ')
  }
}

export function createNativeBackend(): RepositoryBackend {
  return { kind: 'native' }
}

export function normalizeRepositoryBackend(value: unknown): RepositoryBackend {
  if (!value || typeof value !== 'object') {
    return createNativeBackend()
  }

  const backend = value as Partial<RepositoryBackend>
  if (backend.kind !== 'wsl') {
    return createNativeBackend()
  }

  const distro = typeof backend.distro === 'string' ? backend.distro.trim() : ''
  const windowsPath = typeof backend.windowsPath === 'string' ? backend.windowsPath.trim() : ''
  const linuxPath =
    typeof backend.linuxPath === 'string' ? normalizeLinuxPath(backend.linuxPath) : ''

  return distro && windowsPath && linuxPath
    ? { kind: 'wsl', distro, windowsPath, linuxPath }
    : createNativeBackend()
}

export function parseWslUncPath(path: string): RepositoryBackend | null {
  const match = WSL_UNC_PATTERN.exec(path)
  if (!match) {
    return null
  }

  const distro = match[1]?.trim()
  if (!distro) {
    return null
  }

  const suffix = match[2] ?? ''
  return {
    kind: 'wsl',
    distro,
    windowsPath: path,
    linuxPath: windowsPathSuffixToLinuxPath(suffix)
  }
}

export function isSameRepositoryPath(
  leftPath: string,
  leftBackend: RepositoryBackend,
  rightPath: string,
  rightBackend: RepositoryBackend
): boolean {
  if (leftBackend.kind !== rightBackend.kind) {
    return false
  }

  if (leftBackend.kind === 'wsl' && rightBackend.kind === 'wsl') {
    return (
      leftBackend.distro.toLowerCase() === rightBackend.distro.toLowerCase() &&
      normalizeLinuxPath(leftBackend.linuxPath) === normalizeLinuxPath(rightBackend.linuxPath)
    )
  }

  return process.platform === 'win32'
    ? leftPath.toLowerCase() === rightPath.toLowerCase()
    : leftPath === rightPath
}

export function getRepositoryExecutionPath(repository: {
  path: string
  backend: RepositoryBackend
}): string {
  return repository.backend.kind === 'wsl' ? repository.backend.linuxPath : repository.path
}

export function getBasename(path: string, backend: RepositoryBackend): string {
  return getRepositoryBackendImplementation(backend).getBasename(backend, path)
}

export function getDirname(path: string, backend: RepositoryBackend): string {
  return getRepositoryBackendImplementation(backend).getDirname(backend, path)
}

export function joinPath(backend: RepositoryBackend, ...parts: string[]): string {
  return getRepositoryBackendImplementation(backend).joinPath(backend, ...parts)
}

export function resolvePath(backend: RepositoryBackend, base: string, path: string): string {
  return getRepositoryBackendImplementation(backend).resolvePath(backend, base, path)
}

export function relativePath(backend: RepositoryBackend, from: string, to: string): string {
  return getRepositoryBackendImplementation(backend).relativePath(backend, from, to)
}

export function normalizePath(backend: RepositoryBackend, path: string): string {
  return getRepositoryBackendImplementation(backend).normalizePath(backend, path)
}

export function isAbsolutePath(backend: RepositoryBackend, path: string): boolean {
  return getRepositoryBackendImplementation(backend).isAbsolutePath(backend, path)
}

export function isPathInsideRoot(
  backend: RepositoryBackend,
  rootPath: string,
  candidatePath: string
): boolean {
  const relativeCandidatePath = relativePath(backend, rootPath, candidatePath)
  return (
    relativeCandidatePath === '' ||
    (!relativeCandidatePath.startsWith('..') && !isAbsolutePath(backend, relativeCandidatePath))
  )
}

export function toUiPath(backend: RepositoryBackend, executionPath: string): string {
  return getRepositoryBackendImplementation(backend).toUiPath(backend, executionPath)
}

export function pathForDisplay(path: string, backend: RepositoryBackend): string {
  return getRepositoryBackendImplementation(backend).pathForDisplay(backend, path)
}

export { linuxPathToWslUncPath, normalizeLinuxPath }

export function buildBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  cwd?: string
): BackendCommand {
  return getRepositoryBackendImplementation(backend).buildCommand(backend, command, cwd)
}

export function spawnSyncBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  options: SpawnSyncOptions & { cwd?: string } = {}
): BackendCommandResult {
  return getRepositoryBackendImplementation(backend).spawnSyncCommand(backend, command, options)
}

export function spawnBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  options: SpawnOptions & { cwd?: string } = {}
): ChildProcess {
  return getRepositoryBackendImplementation(backend).spawnCommand(backend, command, options)
}

export function backendPathExists(
  backend: RepositoryBackend,
  path: string,
  type: 'any' | 'directory' | 'file' = 'any'
): boolean {
  return getRepositoryBackendImplementation(backend).pathExists(backend, path, type)
}

export function mkdirBackend(backend: RepositoryBackend, path: string): void {
  getRepositoryBackendImplementation(backend).mkdir(backend, path)
}
