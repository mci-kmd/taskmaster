import { describe, expect, it } from 'vitest'
import type { RepositoryBackend } from '../../shared/app-types'
import {
  buildBackendCommand,
  buildNativeCommand,
  getBasename,
  getRepositoryExecutionPath,
  isAbsolutePath,
  isPathInsideRoot,
  joinPath,
  normalizePath,
  pathForDisplay,
  relativePath,
  resolvePath,
  toUiPath
} from './repository-backend'

type RepositoryBackendContractOptions = {
  name: string
  backend: RepositoryBackend
  repositoryPath: string
  expectedExecutionPath: string
  rootPath: string
  childPath: string
  outsidePath: string
  relativeChildPath: string
  joinedPath: string
  resolvedPath: string
  displayPath: string
  wrappedCommandFile: string
  wrappedCommandArgsPrefix: string[]
  wrappedCommandArgsContains: string[]
}

export function defineRepositoryBackendContractSuite(
  options: RepositoryBackendContractOptions
): void {
  describe(options.name, () => {
    it('uses backend-specific path operations consistently', () => {
      expect(joinPath(options.backend, options.rootPath, 'src')).toBe(options.joinedPath)
      expect(resolvePath(options.backend, options.rootPath, '../shared')).toBe(options.resolvedPath)
      expect(relativePath(options.backend, options.rootPath, options.childPath)).toBe(
        options.relativeChildPath
      )
      expect(normalizePath(options.backend, options.childPath)).toBe(options.childPath)
      expect(isAbsolutePath(options.backend, options.rootPath)).toBe(true)
      expect(isPathInsideRoot(options.backend, options.rootPath, options.childPath)).toBe(true)
      expect(isPathInsideRoot(options.backend, options.rootPath, options.outsidePath)).toBe(false)
    })

    it('derives backend-aware execution and display paths', () => {
      expect(
        getRepositoryExecutionPath({
          path: options.repositoryPath,
          backend: options.backend
        })
      ).toBe(options.expectedExecutionPath)
      expect(getBasename(options.rootPath, options.backend)).toBe('repo')
      expect(toUiPath(options.backend, options.rootPath)).toBe(options.displayPath)
      expect(pathForDisplay(options.rootPath, options.backend)).toBe(options.displayPath)
    })

    it('wraps commands appropriately for the backend', () => {
      const command = buildBackendCommand(
        options.backend,
        buildNativeCommand('git', ['status']),
        options.rootPath
      )

      expect(command.file).toBe(options.wrappedCommandFile)
      expect(command.args.slice(0, options.wrappedCommandArgsPrefix.length)).toEqual(
        options.wrappedCommandArgsPrefix
      )
      for (const value of options.wrappedCommandArgsContains) {
        expect(command.args).toContain(value)
      }
    })
  })
}
