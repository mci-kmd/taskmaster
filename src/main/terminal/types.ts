import type { IPty } from 'node-pty'
import type {
  AgentProviderId,
  RepositoryBackend,
  TerminalKind,
  TerminalSessionStartEvent,
  TerminalUserPromptEvent
} from '../../shared/app-types'
import type { CodexSessionReaderState, HookFileReaderState } from '../providers/cli-agent-providers'

export type TerminalSession = {
  id: string
  cwd: string
  ownerId: number
  ptyProcess: IPty
  kind: TerminalKind
  backend: RepositoryBackend
  agentProviderId?: AgentProviderId
  threadId?: string
  launchConfirmationTimer: NodeJS.Timeout | null
  hookPollTimer: NodeJS.Timeout | null
  sessionStartReader: HookFileReaderState | null
  userPromptReader: HookFileReaderState | null
  codexSessionReader: CodexSessionReaderState | null
}

export type TerminalCommand = {
  file: string
  args: string[]
  displayCommand: string
}

export type TerminalHooks = {
  onThreadStart?: (threadId: string) => void
}

export type HookSessionStartPayload = Omit<TerminalSessionStartEvent, 'terminalId'> & {
  cwd: string
  timestamp: number
  initialPrompt?: string
}

export type HookUserPromptPayload = Omit<TerminalUserPromptEvent, 'terminalId'> & {
  cwd: string
  timestamp: number
}
