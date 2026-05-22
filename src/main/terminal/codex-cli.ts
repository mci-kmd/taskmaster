import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AgentLaunchContext, CodexSessionReaderState } from '../providers/cli-agent-providers'
import type { HookSessionStartPayload, HookUserPromptPayload } from './types'

type CodexSessionMetaPayload = {
  id?: unknown
  cwd?: unknown
}

type CodexTranscriptEntry = {
  type?: unknown
  payload?: unknown
}

type CodexSessionReaderEvents = {
  onSessionStart: (payload: HookSessionStartPayload) => void
  onUserPrompt: (payload: HookUserPromptPayload) => void
  now: () => number
}

function getCodexSessionsDir(): string {
  return join(process.env.CODEX_HOME || join(app.getPath('home'), '.codex'), 'sessions')
}

function parseCodexTranscriptEntry(line: string): CodexTranscriptEntry | null {
  try {
    return JSON.parse(line) as CodexTranscriptEntry
  } catch {
    return null
  }
}

function getCodexSessionMeta(
  filePath: string
): (CodexSessionMetaPayload & { filePath: string }) | null {
  try {
    const firstLine = readFileSync(filePath, 'utf8').split(/\r?\n/u)[0]?.trim()
    if (!firstLine) {
      return null
    }

    const entry = parseCodexTranscriptEntry(firstLine)
    if (!entry || entry.type !== 'session_meta' || typeof entry.payload !== 'object') {
      return null
    }

    return {
      ...(entry.payload as CodexSessionMetaPayload),
      filePath
    }
  } catch {
    return null
  }
}

function listCodexSessionFiles(dir = getCodexSessionsDir()): string[] {
  if (!existsSync(dir)) {
    return []
  }

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = join(dir, entry)
    let stats
    try {
      stats = statSync(entryPath)
    } catch {
      continue
    }

    if (stats.isDirectory()) {
      files.push(...listCodexSessionFiles(entryPath))
    } else if (stats.isFile() && entryPath.endsWith('.jsonl')) {
      files.push(entryPath)
    }
  }

  return files
}

function findCodexSessionFile(reader: CodexSessionReaderState): string | null {
  const candidates = listCodexSessionFiles()
    .map((filePath) => {
      const meta = getCodexSessionMeta(filePath)
      if (!meta || typeof meta.id !== 'string' || typeof meta.cwd !== 'string') {
        return null
      }
      if (meta.cwd !== reader.cwd) {
        return null
      }
      if (reader.resumeSessionId && meta.id !== reader.resumeSessionId) {
        return null
      }

      let stats
      try {
        stats = statSync(filePath)
      } catch {
        return null
      }
      const isRecentEnough =
        reader.resumeSessionId !== null || stats.mtimeMs >= reader.launchStartedAt - 2_000
      return isRecentEnough ? { filePath, id: meta.id, mtimeMs: stats.mtimeMs } : null
    })
    .filter(
      (candidate): candidate is { filePath: string; id: string; mtimeMs: number } =>
        candidate !== null
    )
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  const match = candidates[0]
  if (!match) {
    return null
  }

  reader.sessionId = match.id
  return match.filePath
}

function getCodexUserPrompt(entry: CodexTranscriptEntry): string | null {
  if (typeof entry.payload !== 'object' || entry.payload === null) {
    return null
  }

  const payload = entry.payload as {
    type?: unknown
    message?: unknown
  }

  if (entry.type === 'event_msg' && payload.type === 'user_message') {
    return typeof payload.message === 'string' ? payload.message : null
  }

  return null
}

export function createCodexSessionReader(
  context: AgentLaunchContext
): CodexSessionReaderState | null {
  return context.backend.kind === 'native' && context.threadId && context.launch
    ? {
        cwd: context.cwd,
        launchStartedAt: Date.now(),
        mode: context.launch.mode,
        resumeSessionId: context.launch.resumeSessionId,
        sessionId: null,
        filePath: null,
        offset: 0,
        remainder: '',
        emittedSessionStart: false
      }
    : null
}

export function readCodexSessionFile(
  reader: CodexSessionReaderState,
  events: CodexSessionReaderEvents
): void {
  if (!reader.filePath) {
    reader.filePath = findCodexSessionFile(reader)
    if (!reader.filePath || !reader.sessionId) {
      return
    }

    let stats
    try {
      stats = statSync(reader.filePath)
    } catch {
      reader.filePath = null
      return
    }
    reader.offset = reader.mode === 'resume' ? stats.size : 0
  }

  if (!reader.emittedSessionStart && reader.sessionId) {
    reader.emittedSessionStart = true
    events.onSessionStart({
      providerId: 'codex',
      cwd: reader.cwd,
      sessionId: reader.sessionId,
      source: reader.mode,
      timestamp: events.now()
    })
  }

  if (!existsSync(reader.filePath)) {
    return
  }

  const buffer = readFileSync(reader.filePath)
  if (buffer.length < reader.offset) {
    reader.offset = 0
    reader.remainder = ''
  }
  if (buffer.length === reader.offset) {
    return
  }

  const chunk = buffer.subarray(reader.offset).toString('utf8')
  reader.offset = buffer.length
  const text = reader.remainder + chunk
  const lines = text.split(/\r?\n/u)
  reader.remainder = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || !reader.sessionId) {
      continue
    }

    const entry = parseCodexTranscriptEntry(trimmed)
    if (!entry) {
      continue
    }

    const prompt = getCodexUserPrompt(entry)
    if (!prompt) {
      continue
    }

    events.onUserPrompt({
      providerId: 'codex',
      cwd: reader.cwd,
      sessionId: reader.sessionId,
      prompt,
      timestamp: events.now()
    })
  }
}
