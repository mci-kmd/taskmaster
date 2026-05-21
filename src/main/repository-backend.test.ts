import { describe, expect, it } from 'vitest'
import {
  buildBackendCommand,
  buildNativeCommand,
  createNativeBackend,
  linuxPathToWslUncPath,
  normalizeLinuxPath,
  parseWslUncPath
} from './backends/repository-backend'
import { defineRepositoryBackendContractSuite } from './backends/repository-backend-contract-suite.test'

const nativeBackend = createNativeBackend()
const wslBackend = {
  kind: 'wsl' as const,
  distro: 'Ubuntu',
  windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
  linuxPath: '/home/me/repo'
}

defineRepositoryBackendContractSuite({
  name: 'native backend contract',
  backend: nativeBackend,
  repositoryPath: 'C:\\repo',
  expectedExecutionPath: 'C:\\repo',
  rootPath: 'C:\\repo',
  childPath: 'C:\\repo\\src',
  outsidePath: 'C:\\outside',
  relativeChildPath: 'src',
  joinedPath: 'C:\\repo\\src',
  resolvedPath: 'C:\\shared',
  displayPath: 'C:\\repo',
  wrappedCommandFile: 'git',
  wrappedCommandArgsPrefix: ['status'],
  wrappedCommandArgsContains: ['status']
})

defineRepositoryBackendContractSuite({
  name: 'wsl backend contract',
  backend: wslBackend,
  repositoryPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
  expectedExecutionPath: '/home/me/repo',
  rootPath: '/home/me/repo',
  childPath: '/home/me/repo/src',
  outsidePath: '/home/other/repo',
  relativeChildPath: 'src',
  joinedPath: '/home/me/repo/src',
  resolvedPath: '/home/me/shared',
  displayPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
  wrappedCommandFile: 'wsl.exe',
  wrappedCommandArgsPrefix: ['-d', 'Ubuntu', '--cd', '/home/me/repo', '--', '/usr/bin/env'],
  wrappedCommandArgsContains: ['git', 'status']
})

describe('repository backend helpers', () => {
  it('parses WSL UNC paths into backend metadata', () => {
    expect(parseWslUncPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo')).toEqual(wslBackend)
  })

  it('normalizes Linux paths and converts them back to UNC paths', () => {
    expect(normalizeLinuxPath('home\\me\\repo')).toBe('/home/me/repo')
    expect(linuxPathToWslUncPath('Ubuntu', '/home/me/repo')).toBe(
      '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo'
    )
  })

  it('leaves native commands unwrapped', () => {
    const command = buildBackendCommand(nativeBackend, buildNativeCommand('git', ['status']))
    expect(command).toEqual({
      file: 'git',
      args: ['status'],
      displayCommand: 'git status'
    })
  })
})
