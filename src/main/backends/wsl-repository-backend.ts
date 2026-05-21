import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions
} from 'child_process'
import { posix } from 'path'
import type {
  BackendCommand,
  BackendCommandResult,
  RepositoryBackendImplementation
} from './repository-backend'

const WSL_SYSTEM_PATH = [
  '/usr/local/sbin',
  '/usr/local/bin',
  '/usr/sbin',
  '/usr/bin',
  '/sbin',
  '/bin'
]
const wslEnvPathCache = new Map<string, string>()

export function normalizeLinuxPath(path: string): string {
  const normalized = posix.normalize(path.replaceAll('\\', '/'))
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function linuxPathToWslUncPath(distro: string, linuxPath: string): string {
  const normalized = normalizeLinuxPath(linuxPath)
  const suffix = normalized === '/' ? '' : normalized.split('/').filter(Boolean).join('\\')
  return `\\\\wsl.localhost\\${distro}${suffix ? `\\${suffix}` : ''}`
}

export function windowsPathSuffixToLinuxPath(suffix: string): string {
  const linuxSuffix = suffix.replaceAll('\\', '/').replace(/^\/+/, '')
  return linuxSuffix ? `/${linuxSuffix}` : '/'
}

function getWslCommandPath(backend: { distro: string }): string {
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

function readWslHome(backend: { distro: string }): string | null {
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

function readWslNodeBinDirs(backend: { distro: string }, home: string): string[] {
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

function readWslCodexResourceDirs(backend: { distro: string }, home: string): string[] {
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

export const wslRepositoryBackendImplementation: RepositoryBackendImplementation = {
  kind: 'wsl',
  getBasename: (_backend, path) => posix.basename(path),
  getDirname: (_backend, path) => posix.dirname(path),
  joinPath: (_backend, ...parts) => posix.join(...parts),
  resolvePath: (_backend, base, path) => posix.resolve(base, path),
  relativePath: (_backend, from, to) => posix.relative(from, to),
  normalizePath: (_backend, path) => normalizeLinuxPath(path),
  isAbsolutePath: (_backend, path) => posix.isAbsolute(path),
  toUiPath: (backend, executionPath) =>
    linuxPathToWslUncPath(
      (backend as Extract<typeof backend, { kind: 'wsl' }>).distro,
      executionPath
    ),
  pathForDisplay: (backend, path) =>
    linuxPathToWslUncPath((backend as Extract<typeof backend, { kind: 'wsl' }>).distro, path),
  buildCommand: (backend, command, cwd) => {
    const wslBackend = backend as Extract<typeof backend, { kind: 'wsl' }>

    return {
      file: 'wsl.exe',
      args: [
        '-d',
        wslBackend.distro,
        ...(cwd ? ['--cd', cwd] : []),
        '--',
        '/usr/bin/env',
        `PATH=${getWslCommandPath(wslBackend)}`,
        command.file,
        ...command.args
      ],
      displayCommand: `wsl.exe -d ${wslBackend.distro} -- ${command.displayCommand}`
    }
  },
  spawnSyncCommand: (
    backend,
    command,
    options: SpawnSyncOptions & { cwd?: string } = {}
  ): BackendCommandResult => {
    const backendCommand = wslRepositoryBackendImplementation.buildCommand(
      backend,
      command,
      options.cwd
    )
    const result = spawnSync(backendCommand.file, backendCommand.args, {
      ...options,
      cwd: undefined,
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
  },
  spawnCommand: (
    backend,
    command: BackendCommand,
    options: SpawnOptions & { cwd?: string } = {}
  ): ChildProcess => {
    const backendCommand = wslRepositoryBackendImplementation.buildCommand(
      backend,
      command,
      options.cwd
    )
    return spawn(backendCommand.file, backendCommand.args, {
      ...options,
      cwd: undefined,
      windowsHide: true
    })
  },
  pathExists: (backend, path, type = 'any') => {
    const flag = type === 'directory' ? '-d' : type === 'file' ? '-f' : '-e'
    return wslRepositoryBackendImplementation.spawnSyncCommand(
      backend,
      {
        file: 'test',
        args: [flag, path],
        displayCommand: `test ${flag} <path>`
      },
      {}
    ).ok
  },
  mkdir: (backend, path) => {
    const result = wslRepositoryBackendImplementation.spawnSyncCommand(
      backend,
      {
        file: 'mkdir',
        args: ['-p', path],
        displayCommand: 'mkdir -p <path>'
      },
      {}
    )
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || `Failed to create directory: ${path}`)
    }
  }
}
