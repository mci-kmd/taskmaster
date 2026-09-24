type PreventableEvent = { preventDefault: () => void }

/**
 * Asks before quitting while Copilot agents are working. The before-quit handler must run before
 * other quit listeners, which skip their cleanup when this guard prevents the quit.
 */
export function createQuitGuard(dependencies: {
  getRunningThreads: () => string[]
  confirmQuit: (threads: string[]) => Promise<boolean>
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
