import type { SessionEvent } from '@github/copilot-sdk'

/** A message the user sent, as opposed to autopilot or system input. */
function isUserMessage(
  event: SessionEvent
): event is Extract<SessionEvent, { type: 'user.message' }> {
  return (
    event.type === 'user.message' &&
    !event.agentId &&
    !event.data.isAutopilotContinuation &&
    (!event.data.source || event.data.source === 'user')
  )
}

/** A message the user sent to start a turn, as opposed to steering the running one. */
export function isTurnStart(event: SessionEvent): boolean {
  return isUserMessage(event) && event.data.delivery !== 'steering'
}

/**
 * Where to cut the conversation to keep everything up to the end of a message's turn: the
 * event that starts the next turn, or null when the message is in the latest turn. Undefined
 * when the message isn't in the history.
 */
export function findTurnEndBoundary(
  events: SessionEvent[],
  messageId: string
): { eventId: string | null } | undefined {
  const index = events.findIndex(
    (event) =>
      !event.agentId &&
      ((event.type === 'assistant.message' && `assistant:${event.data.messageId}` === messageId) ||
        (event.type === 'user.message' && `user:${event.data.messageId ?? event.id}` === messageId))
  )
  if (index < 0) return undefined
  const next = events.slice(index + 1).find(isTurnStart)
  return { eventId: next?.id ?? null }
}

/** The event starting the latest turn, so cutting there drops a turn still in progress. */
export function latestTurnStart(events: SessionEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index--) {
    if (isTurnStart(events[index])) return events[index].id
  }
  return null
}

/** Events before `boundary`, or all of them without one. */
export function eventsBefore(events: SessionEvent[], boundary: string | null): SessionEvent[] {
  if (!boundary) return events
  const index = events.findIndex((event) => event.id === boundary)
  return index < 0 ? events : events.slice(0, index)
}

/** What a thread keeps about a conversation cut down to `events`. */
export function describeHistory(events: SessionEvent[]): {
  lastUserMessage: string | null
  messageIds: string[]
} {
  let lastUserMessage: string | null = null
  const messageIds: string[] = []
  for (const event of events) {
    if (event.agentId) continue
    if (isUserMessage(event)) lastUserMessage = event.data.content
    else if (event.type === 'assistant.message')
      messageIds.push(`assistant:${event.data.messageId}`)
  }
  return { lastUserMessage, messageIds }
}
