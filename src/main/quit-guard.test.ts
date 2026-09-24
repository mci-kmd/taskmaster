import { describe, expect, it, vi } from 'vitest'
import { createQuitGuard } from './quit-guard'

type Event = { preventDefault: () => void }

function setup(
  running: string[],
  platform: NodeJS.Platform = 'win32'
): {
  guard: ReturnType<typeof createQuitGuard>
  confirmQuit: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
  event: () => Event & { preventDefault: ReturnType<typeof vi.fn<() => void>> }
  answer: (value: boolean) => void
} {
  let resolve!: (value: boolean) => void
  const confirmQuit = vi.fn(() => new Promise<boolean>((r) => (resolve = r)))
  const quit = vi.fn()
  const guard = createQuitGuard({ getRunningThreads: () => running, confirmQuit, quit, platform })
  const event = (): Event & { preventDefault: ReturnType<typeof vi.fn<() => void>> } => ({
    preventDefault: vi.fn<() => void>()
  })
  return { guard, confirmQuit, quit, event, answer: (value: boolean) => resolve(value) }
}

describe('quit guard', () => {
  it('quits without asking when no agent is working', () => {
    const { guard, confirmQuit, event } = setup([])
    const close = event()
    guard.windowClose(close)
    const quit = event()
    guard.beforeQuit(quit)
    expect(close.preventDefault).not.toHaveBeenCalled()
    expect(quit.preventDefault).not.toHaveBeenCalled()
    expect(confirmQuit).not.toHaveBeenCalled()
  })

  it('keeps the app open when the user cancels, and asks only once at a time', async () => {
    const { guard, confirmQuit, quit, event, answer } = setup(['Fix login'])
    const first = event()
    guard.beforeQuit(first)
    const second = event()
    guard.beforeQuit(second)
    expect(first.preventDefault).toHaveBeenCalled()
    expect(second.preventDefault).toHaveBeenCalled()
    expect(confirmQuit).toHaveBeenCalledTimes(1)
    expect(confirmQuit).toHaveBeenCalledWith(['Fix login'])
    answer(false)
    await Promise.resolve()
    await Promise.resolve()
    expect(quit).not.toHaveBeenCalled()
    guard.beforeQuit(event())
    expect(confirmQuit).toHaveBeenCalledTimes(2)
  })

  it('quits after confirmation without asking again', async () => {
    const { guard, confirmQuit, quit, event, answer } = setup(['Fix login'])
    guard.beforeQuit(event())
    answer(true)
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    const next = event()
    guard.beforeQuit(next)
    const close = event()
    guard.windowClose(close)
    expect(next.preventDefault).not.toHaveBeenCalled()
    expect(close.preventDefault).not.toHaveBeenCalled()
    expect(confirmQuit).toHaveBeenCalledOnce()
  })

  it('routes closing the window through the quit prompt except on macOS', () => {
    const windows = setup(['Fix login'])
    const close = windows.event()
    windows.guard.windowClose(close)
    expect(close.preventDefault).toHaveBeenCalled()
    expect(windows.quit).toHaveBeenCalledOnce()

    const mac = setup(['Fix login'], 'darwin')
    const macClose = mac.event()
    mac.guard.windowClose(macClose)
    expect(macClose.preventDefault).not.toHaveBeenCalled()
    expect(mac.quit).not.toHaveBeenCalled()
  })
})
