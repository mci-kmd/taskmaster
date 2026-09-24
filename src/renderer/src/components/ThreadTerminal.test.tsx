// @vitest-environment jsdom
import { createRef } from 'react'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppSettingsSnapshot, ThreadSnapshot } from '../../../shared/app-types'
import ThreadTerminal, { type ThreadTerminalHandle } from './ThreadTerminal'

const mocks = vi.hoisted(() => ({
  inputHandler: null as ((data: string) => void) | null,
  keyHandler: null as ((event: KeyboardEvent) => boolean) | null,
  onData: vi.fn((callback: (payload: { terminalId: string; data: string }) => void) => {
    void callback
    return vi.fn()
  }),
  onExit: vi.fn((callback: (payload: { terminalId: string; exitCode: number }) => void) => {
    void callback
    return vi.fn()
  }),
  create: vi.fn(),
  input: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
  readClipboardText: vi.fn(),
  write: vi.fn(),
  focus: vi.fn(),
  reset: vi.fn()
}))

vi.mock('../shared/api/client', () => ({
  getRendererApi: () => ({
    terminal: {
      create: mocks.create,
      input: mocks.input,
      resize: mocks.resize,
      kill: mocks.kill,
      readClipboardText: mocks.readClipboardText,
      onData: mocks.onData,
      onExit: mocks.onExit
    }
  })
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80
    rows = 24
    options: { fontFamily?: string }
    _core = {
      _renderService: {
        clear: vi.fn(),
        dimensions: { css: { cell: { width: 0, height: 0 } } }
      }
    }
    constructor(options: { fontFamily?: string }) {
      this.options = options
    }
    open = vi.fn()
    resize = vi.fn()
    reset = mocks.reset
    focus = mocks.focus
    write = mocks.write
    paste(data: string): void {
      mocks.inputHandler?.(data)
    }
    getSelection(): string {
      return 'selected text'
    }
    onTitleChange(): { dispose: () => void } {
      return { dispose: vi.fn() }
    }
    onData(handler: (data: string) => void): { dispose: () => void } {
      mocks.inputHandler = handler
      return { dispose: vi.fn() }
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void {
      mocks.keyHandler = handler
    }
    dispose = vi.fn()
  }
}))

const thread = {
  id: 'thread-1',
  mode: 'active-branch',
  branchName: 'feature',
  cwd: 'C:\\repo',
  executionCwd: 'C:\\repo',
  backend: { kind: 'native' }
} as ThreadSnapshot

beforeEach(() => {
  vi.clearAllMocks()
  mocks.inputHandler = null
  mocks.keyHandler = null
  mocks.create.mockResolvedValue({ ok: true, terminalId: 'terminal-1' })
  mocks.readClipboardText.mockResolvedValue('clipboard text')
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn()
      disconnect = vi.fn()
    }
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1)
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('launches a plain shell and forwards PTY output and input unchanged', async () => {
  const ref = createRef<ThreadTerminalHandle>()
  const onRefresh = vi.fn(async () => {})
  render(
    <ThreadTerminal
      launchKey={0}
      onRefresh={onRefresh}
      onStateChange={vi.fn()}
      ref={ref}
      settings={{} as AppSettingsSnapshot}
      thread={thread}
      visible
    />
  )

  await act(async () => {
    await ref.current!.start()
  })
  expect(mocks.create).toHaveBeenCalledWith({
    kind: 'shell',
    threadId: 'thread-1',
    threadMode: 'active-branch',
    branchName: 'feature',
    cwd: 'C:\\repo',
    executionCwd: 'C:\\repo',
    backend: { kind: 'native' },
    cols: 80,
    rows: 24
  })
  const output = mocks.onData.mock.calls[0][0] as (payload: {
    terminalId: string
    data: string
  }) => void
  act(() => output({ terminalId: 'terminal-1', data: '\x1b[31m• hello\x1b[0m' }))
  expect(mocks.write).toHaveBeenCalledWith('\x1b[31m• hello\x1b[0m')
  act(() => mocks.inputHandler?.('ls\r'))
  expect(mocks.input).toHaveBeenCalledWith('terminal-1', 'ls\r')
  expect(onRefresh).toHaveBeenCalled()
})

it('preserves shell text paste and selection copy shortcuts', async () => {
  const ref = createRef<ThreadTerminalHandle>()
  const writeText = vi.fn()
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const { container } = render(
    <ThreadTerminal
      launchKey={0}
      onRefresh={async () => {}}
      onStateChange={vi.fn()}
      ref={ref}
      settings={{} as AppSettingsSnapshot}
      thread={thread}
      visible
    />
  )
  await act(async () => {
    await ref.current!.start()
  })

  const pasteEvent = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(pasteEvent, 'clipboardData', {
    value: { getData: () => 'pasted text' }
  })
  fireEvent(container.firstElementChild!.firstElementChild!, pasteEvent)
  expect(mocks.input).toHaveBeenCalledWith('terminal-1', 'pasted text')

  const keyboard = (key: string): KeyboardEvent =>
    new KeyboardEvent('keydown', { key, ctrlKey: true, cancelable: true })
  await act(async () => {
    expect(mocks.keyHandler?.(keyboard('v'))).toBe(false)
    await Promise.resolve()
  })
  expect(mocks.readClipboardText).toHaveBeenCalled()
  expect(mocks.input).toHaveBeenCalledWith('terminal-1', 'clipboard text')
  expect(mocks.keyHandler?.(keyboard('c'))).toBe(false)
  expect(writeText).toHaveBeenCalledWith('selected text')
})
