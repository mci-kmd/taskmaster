import type { CopilotClient, CopilotSession, SessionConfig } from '@github/copilot-sdk'
import type { CopilotModelSelection, PersistedThread } from '../../shared/app-types'

export async function resumeOrCreateSession(
  client: CopilotClient,
  thread: PersistedThread,
  config: SessionConfig,
  cancelled: () => boolean,
  defaults?: CopilotModelSelection
): Promise<CopilotSession> {
  const creationConfig = defaults
    ? { ...config, model: defaults.model, reasoningEffort: defaults.reasoningEffort ?? undefined }
    : config
  if (!thread.resumeSessionId) return client.createSession(creationConfig)
  try {
    return await client.resumeSession(thread.resumeSessionId, config)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // The runtime doesn't write events.jsonl until the first message. Such a
    // session has an ID and workspace but cannot be resumed after a restart.
    // Only recover that exact case, and keep the ID/workspace when recreating it.
    const emptyThread =
      !thread.lastUserMessage &&
      !thread.latestCopilotTitle &&
      Boolean(thread.createdAt) &&
      thread.createdAt === thread.lastActivityAt
    const missingEvents = message.endsWith(
      `Failed to load session events: Session not found: ${thread.resumeSessionId}`
    )
    if (!emptyThread || !missingEvents || cancelled()) throw error
    return client.createSession({ ...creationConfig, sessionId: thread.resumeSessionId })
  }
}
