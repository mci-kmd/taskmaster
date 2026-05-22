import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions
} from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import path from 'path'
import type {
  BackendCommand,
  BackendCommandResult,
  RepositoryBackendImplementation
} from './repository-backend'

function isWindowsLikePath(value: string): boolean {
  return /^[a-z]:[\\/]/iu.test(value) || value.startsWith('\\\\')
}

function pathModuleFor(...values: string[]): typeof path {
  return values.some(isWindowsLikePath) ? path.win32 : path
}

export const nativeRepositoryBackendImplementation: RepositoryBackendImplementation = {
  kind: 'native',
  getBasename: (_backend, pathValue) => pathModuleFor(pathValue).basename(pathValue),
  getDirname: (_backend, pathValue) => pathModuleFor(pathValue).dirname(pathValue),
  joinPath: (_backend, ...parts) => pathModuleFor(...parts).join(...parts),
  resolvePath: (_backend, base, pathValue) =>
    pathModuleFor(base, pathValue).resolve(base, pathValue),
  relativePath: (_backend, from, to) => pathModuleFor(from, to).relative(from, to),
  normalizePath: (_backend, pathValue) => pathModuleFor(pathValue).normalize(pathValue),
  isAbsolutePath: (_backend, pathValue) => pathModuleFor(pathValue).isAbsolute(pathValue),
  toUiPath: (_backend, executionPath) => executionPath,
  pathForDisplay: (_backend, path) => path,
  buildCommand: (_backend, command) => command,
  spawnSyncCommand: (
    _backend,
    command,
    options: SpawnSyncOptions & { cwd?: string } = {}
  ): BackendCommandResult => {
    const result = spawnSync(command.file, command.args, {
      ...options,
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
    _backend,
    command: BackendCommand,
    options: SpawnOptions & { cwd?: string } = {}
  ): ChildProcess =>
    spawn(command.file, command.args, {
      ...options,
      windowsHide: true
    }),
  pathExists: (_backend, path, type = 'any') => {
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
  },
  mkdir: (_backend, path) => {
    mkdirSync(path, { recursive: true })
  }
}
