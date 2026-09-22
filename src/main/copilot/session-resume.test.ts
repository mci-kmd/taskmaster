import { describe, expect, it, vi } from 'vitest'
import type { CopilotClient, CopilotSession, SessionConfig } from '@github/copilot-sdk'
import type { PersistedThread } from '../../shared/app-types'
import { resumeOrCreateSession } from './session-resume'

const thread = {
  resumeSessionId: 'empty-session',
  lastUserMessage: null,
  latestCopilotTitle: null,
  createdAt: '2026-09-22T10:00:00Z',
  lastActivityAt: '2026-09-22T10:00:00Z'
} as PersistedThread
const config: SessionConfig = {
  workingDirectory: '/repo',
  onPermissionRequest: async () => ({ kind: 'reject' })
}
function setup(
  message = 'Request session.resume failed with message: Failed to load session events: Session not found: empty-session'
): {
  session: CopilotSession
  resumeSession: ReturnType<typeof vi.fn>
  createSession: ReturnType<typeof vi.fn>
  client: CopilotClient
} {
  const session = { sessionId: 'empty-session' } as CopilotSession
  const resumeSession = vi.fn().mockRejectedValue(new Error(message))
  const createSession = vi.fn().mockResolvedValue(session)
  return {
    session,
    resumeSession,
    createSession,
    client: { resumeSession, createSession } as unknown as CopilotClient
  }
}

describe('resuming an empty SDK session', () => {
  it('applies model defaults only when creating a session, including empty-session recovery', async () => {
    const { client, createSession, resumeSession, session } = setup()
    const defaults = { model: 'last-model', reasoningEffort: 'high' as const }
    await resumeOrCreateSession(
      client,
      { ...thread, resumeSessionId: null },
      config,
      () => false,
      defaults
    )
    expect(createSession).toHaveBeenLastCalledWith({ ...config, ...defaults })
    await resumeOrCreateSession(client, thread, config, () => false, defaults)
    expect(createSession).toHaveBeenLastCalledWith({
      ...config,
      ...defaults,
      sessionId: thread.resumeSessionId
    })
    createSession.mockClear()
    resumeSession.mockResolvedValue(session)
    await resumeOrCreateSession(client, thread, config, () => false, defaults)
    expect(resumeSession).toHaveBeenLastCalledWith(thread.resumeSessionId, config)
    expect(createSession).not.toHaveBeenCalled()
  })
  it('recovers the missing event-log case using the same session ID and configuration', async () => {
    const { client, createSession, session } = setup()
    expect(await resumeOrCreateSession(client, thread, config, () => false)).toBe(session)
    expect(createSession).toHaveBeenCalledWith({ ...config, sessionId: 'empty-session' })
  })
  it('resumes existing conversations normally', async () => {
    const { client, resumeSession, createSession, session } = setup()
    resumeSession.mockResolvedValue(session)
    expect(await resumeOrCreateSession(client, thread, config, () => false)).toBe(session)
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([
    { lastUserMessage: 'A previous request' },
    { latestCopilotTitle: 'Work completed' },
    { lastActivityAt: '2026-09-22T11:00:00Z' }
  ])('does not replace a conversation with evidence of prior activity: %j', async (patch) => {
    const { client, createSession } = setup()
    await expect(
      resumeOrCreateSession(client, { ...thread, ...patch }, config, () => false)
    ).rejects.toThrow('Session not found')
    expect(createSession).not.toHaveBeenCalled()
  })
  it.each([
    'Authentication failed',
    'Permission denied loading events',
    'Session not found: a-different-session',
    'Failed to load session events: Invalid JSON'
  ])('does not mask other failures: %s', async (message) => {
    const { client, createSession } = setup(message)
    await expect(resumeOrCreateSession(client, thread, config, () => false)).rejects.toThrow(
      message
    )
    expect(createSession).not.toHaveBeenCalled()
  })
  it('does not recreate a session when shutdown cancelled the pending resume', async () => {
    const { client, createSession } = setup()
    await expect(resumeOrCreateSession(client, thread, config, () => true)).rejects.toThrow(
      'Session not found'
    )
    expect(createSession).not.toHaveBeenCalled()
  })
})
