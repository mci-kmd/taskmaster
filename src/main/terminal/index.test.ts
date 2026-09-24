import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalCreateRequest } from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { registerTerminalIpc } from './index'

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  on: vi.fn(),
  spawn: vi.fn(),
  readText: vi.fn(() => 'clipboard text'),
  fromId: vi.fn()
}))

vi.mock('electron', () => ({
  app: { isPackaged: false, on: vi.fn(), getPath: vi.fn() },
  clipboard: { readText: mocks.readText },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  webContents: { fromId: mocks.fromId }
}))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))

type Handler = (event: { sender: typeof sender }, ...args: unknown[]) => Promise<unknown> | unknown
const sender = {
  id: 21,
  isDestroyed: vi.fn(() => false),
  once: vi.fn(),
  send: vi.fn()
}
const handlers = new Map<string, Handler>()
const channels = new Map<string, Handler>()

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  channels.clear()
  mocks.handle.mockImplementation((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  mocks.on.mockImplementation((channel: string, handler: Handler) => {
    channels.set(channel, handler)
  })
  mocks.fromId.mockReturnValue(sender)
  registerTerminalIpc()
})

describe('shell terminal IPC', () => {
  it('rejects legacy agent launches without starting a process or checking a CLI', async () => {
    const create = handlers.get(IPC_CHANNELS.terminal.create)!
    const request = {
      kind: 'agent',
      cols: 80,
      rows: 24
    } as unknown as TerminalCreateRequest

    expect(await create({ sender }, request)).toEqual({
      ok: false,
      error: 'Only shell terminals are supported.'
    })
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(handlers.size).toBe(3)
  })

  it('starts a shell, forwards I/O, resizes and reports exit', async () => {
    let onData!: (data: string) => void
    let onExit!: (event: { exitCode: number }) => void
    const pty = {
      onData: vi.fn((callback) => {
        onData = callback
      }),
      onExit: vi.fn((callback) => {
        onExit = callback
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn()
    }
    mocks.spawn.mockReturnValue(pty)

    const create = handlers.get(IPC_CHANNELS.terminal.create)!
    const result = (await create(
      { sender },
      {
        kind: 'shell',
        cols: 80,
        rows: 24
      }
    )) as { ok: true; terminalId: string }

    expect(result.ok).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: process.cwd(),
        env: expect.objectContaining({ TERM: 'xterm-256color' })
      })
    )
    channels.get(IPC_CHANNELS.terminal.input)!(
      { sender },
      { terminalId: result.terminalId, data: 'hello' }
    )
    channels.get(IPC_CHANNELS.terminal.resize)!(
      { sender },
      { terminalId: result.terminalId, cols: 20, rows: 8 }
    )
    expect(pty.write).toHaveBeenCalledWith('hello')
    expect(pty.resize).toHaveBeenCalledWith(40, 12)

    onData('output')
    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.terminal.data, {
      terminalId: result.terminalId,
      data: 'output'
    })
    onExit({ exitCode: 0 })
    expect(sender.send).toHaveBeenCalledWith(IPC_CHANNELS.terminal.exit, {
      terminalId: result.terminalId,
      exitCode: 0
    })
  })

  it('keeps text clipboard access', () => {
    expect(handlers.get(IPC_CHANNELS.terminal.readClipboardText)!({ sender })).toBe(
      'clipboard text'
    )
  })
})
