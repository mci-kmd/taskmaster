import { describe, expect, it } from 'vitest'
import type { AgentProviderId, RepositoryBackend, TerminalStatus } from '../../shared/app-types'
import { createNativeBackend } from '../backends/repository-backend'
import type { LlmCliProviderSpec } from './cli-provider-specs'
import type {
  AgentLaunchContext,
  AgentLaunchPreparation,
  AgentProvider,
  CliAgentProviderDependencies
} from './cli-agent-providers'

type ProviderContractOptions = {
  name: string
  providerId: AgentProviderId
  createProvider: (dependencies: CliAgentProviderDependencies) => AgentProvider
  assertNativePreparation: (preparation: AgentLaunchPreparation) => void
}

function createBackend(kind: 'native' | 'wsl'): RepositoryBackend {
  if (kind === 'native') {
    return createNativeBackend()
  }

  return {
    kind: 'wsl',
    distro: 'Ubuntu',
    windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
    linuxPath: '/home/me/repo'
  }
}

export function defineProviderContractSuite(options: ProviderContractOptions): void {
  describe(options.name, () => {
    it('reports status via the shared provider status adapter', () => {
      const calls: Array<{
        providerId: AgentProviderId
        backend: RepositoryBackend
        spec: LlmCliProviderSpec
      }> = []

      const provider = options.createProvider({
        createStatus: (providerId, backend, spec): TerminalStatus => {
          calls.push({ providerId, backend, spec })
          return {
            available: true,
            providerId,
            label: spec.displayName,
            defaultCwd: 'C:\\repo',
            message: spec.statusMessages.available,
            commandPath: `C:\\tools\\${spec.cliName}.cmd`
          }
        },
        buildCommand: () => ({
          file: 'unused',
          args: [],
          displayCommand: 'unused'
        }),
        ensureTaskmasterHookConfig: () => {},
        getTaskmasterHookEventsDir: () => 'C:\\hooks',
        createHookFileReader: (filePath) => ({
          filePath,
          offset: 0,
          remainder: ''
        }),
        createCodexSessionReader: () => null,
        hookFiles: {
          sessionStartEnvName: 'TASKMASTER_SESSION_START_FILE',
          userPromptEnvName: 'TASKMASTER_USER_PROMPT_FILE'
        }
      })

      const status = provider.getStatus()
      expect(status.providerId).toBe(options.providerId)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.providerId).toBe(options.providerId)
      expect(calls[0]?.backend).toEqual(createNativeBackend())
    })

    it('builds launch commands from shared dependencies and provider specs', () => {
      const buildCommandCalls: Array<{
        commandPath: string
        displayName: string
        args: string[]
      }> = []

      const provider = options.createProvider({
        createStatus: () => ({
          available: true,
          providerId: options.providerId,
          label: options.providerId,
          defaultCwd: 'C:\\repo',
          message: 'ready',
          commandPath: 'C:\\tools\\provider.cmd'
        }),
        buildCommand: (commandPath, displayName, args) => {
          buildCommandCalls.push({ commandPath, displayName, args })
          return {
            file: commandPath,
            args,
            displayCommand: [displayName, ...args].join(' ')
          }
        },
        ensureTaskmasterHookConfig: () => {},
        getTaskmasterHookEventsDir: () => 'C:\\hooks',
        createHookFileReader: (filePath) => ({
          filePath,
          offset: 0,
          remainder: ''
        }),
        createCodexSessionReader: () => null,
        hookFiles: {
          sessionStartEnvName: 'TASKMASTER_SESSION_START_FILE',
          userPromptEnvName: 'TASKMASTER_USER_PROMPT_FILE'
        }
      })

      const launchContext: AgentLaunchContext = {
        cwd: 'C:\\repo',
        backend: createBackend('native'),
        terminalId: 'terminal-1',
        threadId: 'thread-1',
        launch: {
          mode: 'new',
          sessionName: 'session-1',
          resumeSessionId: null,
          globalFlags: []
        }
      }

      const preparation = provider.prepareLaunch('C:\\tools\\provider.cmd', launchContext)
      expect(buildCommandCalls).toHaveLength(1)
      expect(buildCommandCalls[0]?.commandPath).toBe('C:\\tools\\provider.cmd')
      expect(buildCommandCalls[0]?.displayName).toBe(options.providerId)
      options.assertNativePreparation(preparation)
    })

    it('supports WSL launches without leaking native-only state', () => {
      const provider = options.createProvider({
        createStatus: () => ({
          available: true,
          providerId: options.providerId,
          label: options.providerId,
          defaultCwd: 'C:\\repo',
          message: 'ready',
          commandPath: '/usr/bin/provider'
        }),
        buildCommand: (commandPath, displayName, args) => ({
          file: commandPath,
          args,
          displayCommand: [displayName, ...args].join(' ')
        }),
        ensureTaskmasterHookConfig: () => {},
        getTaskmasterHookEventsDir: () => 'C:\\hooks',
        createHookFileReader: (filePath) => ({
          filePath,
          offset: 0,
          remainder: ''
        }),
        createCodexSessionReader: () => null,
        hookFiles: {
          sessionStartEnvName: 'TASKMASTER_SESSION_START_FILE',
          userPromptEnvName: 'TASKMASTER_USER_PROMPT_FILE'
        }
      })

      const preparation = provider.prepareLaunch('/usr/bin/provider', {
        cwd: '/home/me/repo',
        backend: createBackend('wsl'),
        terminalId: 'terminal-1',
        threadId: 'thread-1',
        launch: {
          mode: 'resume',
          sessionName: 'session-1',
          resumeSessionId: 'resume-1',
          globalFlags: []
        }
      })

      expect(preparation.command.file).toBe('/usr/bin/provider')
      expect(preparation.sessionStartReader).toBeNull()
      expect(preparation.userPromptReader).toBeNull()
      expect(preparation.env).toEqual({})
    })
  })
}
