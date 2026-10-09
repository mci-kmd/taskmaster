type PreventableEvent = { preventDefault: () => void }

export type BusyThread = { name: string; activity: 'working' | 'committing' }

/** The confirmation text listing the threads whose work quitting would interrupt. */
export function describeBusyThreads(threads: BusyThread[]): { message: string; detail: string } {
  const committing = threads.filter((thread) => thread.activity === 'committing').length
  const count = (n: number): string => (n === 1 ? '1 thread' : `${n} threads`)
  const message =
    committing === 0
      ? `Copilot is still working in ${count(threads.length)}.`
      : committing === threads.length
        ? `A commit is still in progress in ${count(threads.length)}.`
        : `Work is still in progress in ${count(threads.length)}.`
  const lines = threads.map(
    (thread) => `• ${thread.name}${thread.activity === 'committing' ? ' (committing)' : ''}`
  )
  return { message, detail: `${lines.join('\n')}\n\nQuitting stops this work.` }
}

/**
 * Asks before quitting while Copilot agents are working or commits are in progress. The
 * before-quit handler must run before other quit listeners, which skip their cleanup when this
 * guard prevents the quit.
 */
export function createQuitGuard<Thread>(dependencies: {
  getRunningThreads: () => Thread[]
  confirmQuit: (threads: Thread[]) => Promise<boolean>
  quit: () => void
  platform: NodeJS.Platform
}): {
  beforeQuit: (event: PreventableEvent) => void
  windowClose: (event: PreventableEvent) => void
} {
  let confirmed = false
  let quitting = false
  let prompting = false

  return {
    beforeQuit: (event) => {
      if (quitting) return
      const threads = confirmed ? [] : dependencies.getRunningThreads()
      if (!threads.length) {
        quitting = true
        return
      }
      event.preventDefault()
      if (prompting) return
      prompting = true
      void dependencies
        .confirmQuit(threads)
        .catch(() => false)
        .then((ok) => {
          prompting = false
          if (!ok) return
          confirmed = true
          dependencies.quit()
        })
    },
    // Closing the last window quits on Windows and Linux, so route it through the same prompt.
    windowClose: (event) => {
      if (quitting || dependencies.platform === 'darwin') return
      if (!dependencies.getRunningThreads().length) return
      event.preventDefault()
      dependencies.quit()
    }
  }
}
