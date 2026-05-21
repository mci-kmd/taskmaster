import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
  type SpawnSyncOptions
} from 'child_process'
import { existsSync, mkdirSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'path'
import type {
  BackendCommand,
  BackendCommandResult,
  RepositoryBackendImplementation
} from './repository-backend'

export const nativeRepositoryBackendImplementation: RepositoryBackendImplementation = {
  kind: 'native',
  getBasename: (_backend, path) => basename(path),
  getDirname: (_backend, path) => dirname(path),
  joinPath: (_backend, ...parts) => join(...parts),
  resolvePath: (_backend, base, path) => resolve(base, path),
  relativePath: (_backend, from, to) => relative(from, to),
  normalizePath: (_backend, path) => normalize(path),
  isAbsolutePath: (_backend, path) => isAbsolute(path),
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
