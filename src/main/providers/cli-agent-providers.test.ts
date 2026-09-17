import { describe, expect, it, vi } from 'vitest'
import { createCopilotCliProvider } from './cli-agent-providers'

describe('Copilot CLI provider', () => {
  it('reports status through the CLI status adapter', () => {
    const createStatus = vi.fn(() => ({
      available: true,
      label: 'Copilot',
      defaultCwd: 'C:\\repo',
      message: 'ready',
      commandPath: 'C:\\tools\\copilot.cmd'
    }))
    const provider = createCopilotCliProvider({
      createStatus,
      buildCommand: () => ({ file: 'unused', args: [], displayCommand: 'unused' }),
      ensureTaskmasterHookConfig: () => {},
      getTaskmasterHookEventsDir: () => 'C:\\hooks',
      createHookFileReader: (filePath) => ({ filePath, offset: 0, remainder: '' }),
      hookFiles: {
        sessionStartEnvName: 'TASKMASTER_SESSION_START_FILE',
        userPromptEnvName: 'TASKMASTER_USER_PROMPT_FILE'
      }
    })

    expect(provider.getStatus()).toMatchObject({ available: true, label: 'Copilot' })
    expect(createStatus).toHaveBeenCalledWith(
      { kind: 'native' },
      expect.objectContaining({ cliName: 'copilot' })
    )
  })

  it('builds launches with Copilot hook readers', () => {
    const provider = createCopilotCliProvider({
      createStatus: () => ({
        available: true,
        label: 'Copilot',
        defaultCwd: 'C:\\repo',
        message: 'ready',
        commandPath: 'C:\\tools\\copilot.cmd'
      }),
      buildCommand: (commandPath, displayName, args) => ({
        file: commandPath,
        args,
        displayCommand: [displayName, ...args].join(' ')
      }),
      ensureTaskmasterHookConfig: () => {},
      getTaskmasterHookEventsDir: () => 'C:\\hooks',
      createHookFileReader: (filePath) => ({ filePath, offset: 0, remainder: '' }),
      hookFiles: {
        sessionStartEnvName: 'TASKMASTER_SESSION_START_FILE',
        userPromptEnvName: 'TASKMASTER_USER_PROMPT_FILE'
      }
    })

    const preparation = provider.prepareLaunch('C:\\tools\\copilot.cmd', {
      cwd: 'C:\\repo',
      backend: { kind: 'native' },
      terminalId: 'terminal-1',
      threadId: 'thread-1',
      launch: {
        mode: 'new',
        sessionName: 'session-1',
        resumeSessionId: null,
        globalFlags: []
      }
    })

    expect(preparation.command.displayCommand).toBe('copilot --name=session-1')
    expect(preparation.sessionStartReader?.filePath).toContain('terminal-1-session-start.jsonl')
    expect(preparation.userPromptReader?.filePath).toContain('terminal-1-user-prompt.jsonl')
    expect(preparation.env).toMatchObject({
      TASKMASTER_SESSION_START_FILE: preparation.sessionStartReader?.filePath,
      TASKMASTER_USER_PROMPT_FILE: preparation.userPromptReader?.filePath
    })
  })
})
