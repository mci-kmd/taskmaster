export type UserInputTrackingState = {
  draft: string
  dirty: boolean
}

export function isMissingResumeSessionError(output: string): boolean {
  return /No session, task, or name matched|No conversation\/session|session .*not found|No sessions? found/i.test(
    output
  )
}

export function normalizeTrackedUserMessage(value: string): string | null {
  const normalized = value.replace(/\r\n?/gu, '\n').trim()
  return normalized.length > 0 ? normalized : null
}

function trimLastCharacter(value: string): string {
  const chars = Array.from(value)
  chars.pop()
  return chars.join('')
}

function trimLastWord(value: string): string {
  return value.replace(/[^\s]+[\s\u00a0]*$/u, '')
}

export function consumeTrackedUserInput(
  state: UserInputTrackingState,
  data: string
): { state: UserInputTrackingState; submittedMessage: string | null } {
  let draft = state.draft
  let dirty = state.dirty
  let submittedMessage: string | null = null

  for (const char of Array.from(data)) {
    if (char === '\r' || char === '\n') {
      if (!dirty) {
        submittedMessage = normalizeTrackedUserMessage(draft)
      }
      draft = ''
      dirty = false
      continue
    }

    if (char === '\b' || char === '\x7f') {
      if (!dirty) {
        draft = trimLastCharacter(draft)
      }
      continue
    }

    if (char === '\x17') {
      if (!dirty) {
        draft = trimLastWord(draft)
      }
      continue
    }

    if (char === '\t') {
      if (!dirty) {
        draft += char
      }
      continue
    }

    if (char === '\x1b' || char.charCodeAt(0) < 0x20) {
      dirty = true
      continue
    }

    if (!dirty) {
      draft += char
    }
  }

  return {
    state: { draft, dirty },
    submittedMessage
  }
}
