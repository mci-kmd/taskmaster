import type { IPty } from 'node-pty'

export type TerminalSession = {
  id: string
  ownerId: number
  ptyProcess: IPty
  threadId?: string
}
