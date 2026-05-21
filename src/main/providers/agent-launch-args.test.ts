import { describe, expect, it } from 'vitest'
import type { AgentLaunchRequest } from '../../shared/app-types'
import { buildCodexArgs, buildCopilotArgs } from './agent-launch-args'

const newLaunch: AgentLaunchRequest = {
  mode: 'new',
  sessionName: 'repo-thread-123',
  resumeSessionId: null,
  globalFlags: ['--model', 'gpt-5']
}

const resumeLaunch: AgentLaunchRequest = {
  mode: 'resume',
  sessionName: 'repo-thread-123',
  resumeSessionId: 'session-abc',
  globalFlags: ['--model', 'gpt-5']
}

describe('provider launch args', () => {
  it('passes raw Copilot args through without launch metadata', () => {
    expect(buildCopilotArgs(undefined, ['--help'])).toEqual(['--help'])
  })

  it('builds Copilot new-session args', () => {
    expect(buildCopilotArgs(newLaunch)).toEqual(['--name=repo-thread-123', '--model', 'gpt-5'])
  })

  it('builds Copilot resume args when a session id exists', () => {
    expect(buildCopilotArgs(resumeLaunch)).toEqual(['--resume=session-abc', '--model', 'gpt-5'])
  })

  it('falls back to Copilot name launch when resume id is missing', () => {
    expect(buildCopilotArgs({ ...resumeLaunch, resumeSessionId: null })).toEqual([
      '--name=repo-thread-123',
      '--model',
      'gpt-5'
    ])
  })

  it('passes raw Codex args through without launch metadata', () => {
    expect(buildCodexArgs('/repo', undefined, ['--help'])).toEqual(['--help'])
  })

  it('builds Codex new-session args with cwd and no alternate screen', () => {
    expect(buildCodexArgs('/repo', newLaunch)).toEqual([
      '--cd',
      '/repo',
      '--no-alt-screen',
      '--model',
      'gpt-5'
    ])
  })

  it('builds Codex resume args with session id last', () => {
    expect(buildCodexArgs('/repo', resumeLaunch)).toEqual([
      'resume',
      '--cd',
      '/repo',
      '--no-alt-screen',
      '--model',
      'gpt-5',
      'session-abc'
    ])
  })
})
