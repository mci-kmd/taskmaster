import { expect } from 'vitest'
import { createCliAgentProviders, type AgentLaunchPreparation } from './cli-agent-providers'
import { defineProviderContractSuite } from './provider-contract-suite.test'

defineProviderContractSuite({
  name: 'copilot provider contract',
  providerId: 'copilot',
  createProvider: (dependencies) => createCliAgentProviders(dependencies).copilot,
  assertNativePreparation: (preparation: AgentLaunchPreparation) => {
    expect(preparation.command.displayCommand).toBe('copilot --name=session-1')
    expect(preparation.sessionStartReader?.filePath).toContain('terminal-1-session-start.jsonl')
    expect(preparation.userPromptReader?.filePath).toContain('terminal-1-user-prompt.jsonl')
    expect(preparation.env).toMatchObject({
      TASKMASTER_SESSION_START_FILE: preparation.sessionStartReader?.filePath,
      TASKMASTER_USER_PROMPT_FILE: preparation.userPromptReader?.filePath
    })
    expect(preparation.codexSessionReader).toBeNull()
  }
})

defineProviderContractSuite({
  name: 'codex provider contract',
  providerId: 'codex',
  createProvider: (dependencies) =>
    createCliAgentProviders({
      ...dependencies,
      createCodexSessionReader: (context) =>
        context.backend.kind === 'native' && context.threadId && context.launch
          ? {
              cwd: context.cwd,
              launchStartedAt: 123,
              mode: context.launch.mode,
              resumeSessionId: context.launch.resumeSessionId,
              sessionId: null,
              filePath: null,
              offset: 0,
              remainder: '',
              emittedSessionStart: false
            }
          : null
    }).codex,
  assertNativePreparation: (preparation: AgentLaunchPreparation) => {
    expect(preparation.command.displayCommand).toBe('codex --cd C:\\repo --no-alt-screen')
    expect(preparation.sessionStartReader).toBeNull()
    expect(preparation.userPromptReader).toBeNull()
    expect(preparation.env).toEqual({})
    expect(preparation.codexSessionReader).toMatchObject({
      cwd: 'C:\\repo',
      mode: 'new',
      resumeSessionId: null
    })
  }
})
