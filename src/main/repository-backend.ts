import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions
} from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, posix } from 'path'
import type { RepositoryBackend } from '../shared/app-types'

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

const WSL_UNC_PATTERN = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(?:\\(.*))?$/i
const WSL_SYSTEM_PATH = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin'
]
const wslEnvPathCache = new Map<string, string>()

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
  return backend.kind === 'wsl' ? posix.basename(path) : basename(path)
}

export function getDirname(path: string, backend: RepositoryBackend): string {
  return backend.kind === 'wsl' ? posix.dirname(path) : dirname(path)
}

export function joinPath(backend: RepositoryBackend, ...parts: string[]): string {
  return backend.kind === 'wsl' ? posix.join(...parts) : join(...parts)
}

export function resolvePath(backend: RepositoryBackend, base: string, path: string): string {
  return backend.kind === 'wsl' ? posix.resolve(base, path) : resolve(base, path)
}

export function relativePath(backend: RepositoryBackend, from: string, to: string): string {
  return backend.kind === 'wsl' ? posix.relative(from, to) : relative(from, to)
}

export function normalizePath(backend: RepositoryBackend, path: string): string {
  return backend.kind === 'wsl' ? normalizeLinuxPath(path) : normalize(path)
}

export function isAbsolutePath(backend: RepositoryBackend, path: string): boolean {
  return backend.kind === 'wsl' ? posix.isAbsolute(path) : isAbsolute(path)
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
  if (backend.kind !== 'wsl') {
    return executionPath
  }

  return linuxPathToWslUncPath(backend.distro, executionPath)
}

export function pathForDisplay(path: string, backend: RepositoryBackend): string {
  return backend.kind === 'wsl' ? toUiPath(backend, path) : path
}

export function linuxPathToWslUncPath(distro: string, linuxPath: string): string {
  const normalized = normalizeLinuxPath(linuxPath)
  const suffix = normalized === '/' ? '' : normalized.split('/').filter(Boolean).join('\\')
  return `\\\\wsl.localhost\\${distro}${suffix ? `\\${suffix}` : ''}`
}

export function buildBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  cwd?: string
): BackendCommand {
  if (backend.kind !== 'wsl') {
    return command
  }

  return {
    file: 'wsl.exe',
    args: [
      '-d',
      backend.distro,
      ...(cwd ? ['--cd', cwd] : []),
      '--',
      '/usr/bin/env',
      `PATH=${getWslCommandPath(backend)}`,
      command.file,
      ...command.args
    ],
    displayCommand: `wsl.exe -d ${backend.distro} -- ${command.displayCommand}`
  }
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

export function spawnSyncBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  options: SpawnSyncOptions & { cwd?: string } = {}
): BackendCommandResult {
  const backendCommand = buildBackendCommand(backend, command, options.cwd)
  const result = spawnSync(backendCommand.file, backendCommand.args, {
    ...options,
    cwd: backend.kind === 'wsl' ? undefined : options.cwd,
    encoding: 'utf8',
    windowsHide: true
  })

  return {
    ok: result.status === 0,
    stdout: typeof result.stdout === 'string' ? result.stdout.trim() : '',
    stderr: typeof result.stderr === 'string' ? result.stderr.trim() : '',
    status: result.status,
    error: result.error
  }
}

export function spawnBackendCommand(
  backend: RepositoryBackend,
  command: BackendCommand,
  options: SpawnOptions & { cwd?: string } = {}
): ChildProcess {
  const backendCommand = buildBackendCommand(backend, command, options.cwd)
  return spawn(backendCommand.file, backendCommand.args, {
    ...options,
    cwd: backend.kind === 'wsl' ? undefined : options.cwd,
    windowsHide: true
  })
}

export function backendPathExists(
  backend: RepositoryBackend,
  path: string,
  type: 'any' | 'directory' | 'file' = 'any'
): boolean {
  if (backend.kind !== 'wsl') {
    try {
      if (!existsSync(path)) {
        return false
      }
      if (type === 'directory') {
        return statSync(path).isDirectory()
      }
      if (type === 'file') {
        return statSync(path).isFile()
      }
      return true
    } catch {
      return false
    }
  }

  const flag = type === 'directory' ? '-d' : type === 'file' ? '-f' : '-e'
  return spawnSyncBackendCommand(
    backend,
    buildNativeCommand('test', [flag, path], `test ${flag} <path>`)
  ).ok
}

export function mkdirBackend(backend: RepositoryBackend, path: string): void {
  if (backend.kind !== 'wsl') {
    mkdirSync(path, { recursive: true })
    return
  }

  const result = spawnSyncBackendCommand(
    backend,
    buildNativeCommand('mkdir', ['-p', path], 'mkdir -p <path>')
  )
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `Failed to create directory: ${path}`)
  }
}

export function normalizeLinuxPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll('\\', '/'))
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function windowsPathSuffixToLinuxPath(suffix: string): string {
  const linuxSuffix = suffix.replaceAll('\\', '/').replace(/^\/+/, '')
  return linuxSuffix ? `/${linuxSuffix}` : '/'
}

function getWslCommandPath(backend: Extract<RepositoryBackend, { kind: 'wsl' }>): string {
  const cached = wslEnvPathCache.get(backend.distro)
  if (cached) {
    return cached
  }

  const home = readWslHome(backend)
  const nodeBinDirs = home ? readWslNodeBinDirs(backend, home) : []
  const codexResourceDirs = home ? readWslCodexResourceDirs(backend, home) : []
  const entries = [
    ...(home ? [`${home}/.local/bin`, `${home}/.bun/bin`] : []),
    ...nodeBinDirs,
    ...codexResourceDirs,
    ...WSL_SYSTEM_PATH
  ]
  const path = [...new Set(entries.filter(Boolean))].join(':')
  wslEnvPathCache.set(backend.distro, path)
  return path
}

function readWslHome(backend: Extract<RepositoryBackend, { kind: 'wsl' }>): string | null {
  const result = spawnSync(
    'wsl.exe',
    ['-d', backend.distro, '--', '/bin/sh', '-c', 'printf %s $HOME'],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  )
  const home = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  return result.status === 0 && home.startsWith('/') ? home : null
}

function readWslNodeBinDirs(
  backend: Extract<RepositoryBackend, { kind: 'wsl' }>,
  home: string
): string[] {
  const result = spawnSync(
    'wsl.exe',
    [
      '-d',
      backend.distro,
      '--',
      '/usr/bin/find',
      `${home}/.nvm/versions/node`,
      '-mindepth',
      '2',
      '-maxdepth',
      '2',
      '-type',
      'd',
      '-name',
      'bin'
    ],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  )
  return result.status === 0 && typeof result.stdout === 'string'
    ? result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('/'))
        .sort()
    : []
}

function readWslCodexResourceDirs(
  backend: Extract<RepositoryBackend, { kind: 'wsl' }>,
  home: string
): string[] {
  const roots = [`${home}/.bun/install/global/node_modules`, `${home}/.nvm/versions/node`]
  const result = spawnSync(
    'wsl.exe',
    [
      '-d',
      backend.distro,
      '--',
      '/usr/bin/find',
      ...roots,
      '-path',
      '*/@openai/codex-linux-*/vendor/*/codex-resources',
      '-type',
      'd'
    ],
    {
      encoding: 'utf8',
      windowsHide: true
    }
  )
  return result.status === 0 && typeof result.stdout === 'string'
    ? result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('/'))
        .sort()
    : []
}
