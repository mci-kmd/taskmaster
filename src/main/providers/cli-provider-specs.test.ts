import { describe, expect, it } from 'vitest'
import type { AgentProviderId } from '../../shared/app-types'
import { AGENT_PROVIDERS } from '../../shared/agent-providers'
import { LLM_CLI_PROVIDER_SPECS, getLlmCliProviderSpec } from './cli-provider-specs'

describe('LLM CLI provider specs', () => {
  it('has one main-process CLI spec per shared provider descriptor', () => {
    const descriptorIds = AGENT_PROVIDERS.map((provider) => provider.id).sort()
    const specIds = Object.keys(LLM_CLI_PROVIDER_SPECS).sort()
    expect(specIds).toEqual(descriptorIds)
  })

  it('falls back to the default provider for unknown ids at runtime', () => {
    expect(getLlmCliProviderSpec('missing' as AgentProviderId).id).toBe('copilot')
  })

  it('keeps provider-specific CLI arg policy behind specs', () => {
    expect(
      LLM_CLI_PROVIDER_SPECS.copilot.buildArgs('/repo', {
        mode: 'new',
        sessionName: 'named-session',
        resumeSessionId: null,
        globalFlags: []
      })
    ).toEqual(['--name=named-session'])

    expect(
      LLM_CLI_PROVIDER_SPECS.codex.buildArgs('/repo', {
        mode: 'resume',
        sessionName: 'named-session',
        resumeSessionId: 'session-id',
        globalFlags: []
      })
    ).toEqual(['resume', '--cd', '/repo', '--no-alt-screen', 'session-id'])
  })
})
