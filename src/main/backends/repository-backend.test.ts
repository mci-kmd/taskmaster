import { describe, expect, it } from 'vitest'
import { buildBackendCommand, buildNativeCommand, createNativeBackend } from './repository-backend'
import { defineRepositoryBackendContractSuite } from './repository-backend-contract-suite.test'

const nativeBackend = createNativeBackend()
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

describe('repository backend helpers', () => {
  it('leaves native commands unwrapped', () => {
    const command = buildBackendCommand(nativeBackend, buildNativeCommand('git', ['status']))
    expect(command).toEqual({
      file: 'git',
      args: ['status'],
      displayCommand: 'git status'
    })
  })
})
