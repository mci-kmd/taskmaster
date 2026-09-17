import { describe, expect, it } from 'vitest'
import { COPILOT_CLI_PROVIDER_SPEC } from './cli-provider-specs'

describe('Copilot CLI provider spec', () => {
  it('builds Copilot launch arguments', () => {
    expect(
      COPILOT_CLI_PROVIDER_SPEC.buildArgs('/repo', {
        mode: 'new',
        sessionName: 'named-session',
        resumeSessionId: null,
        globalFlags: []
      })
    ).toEqual(['--name=named-session'])
  })
})
