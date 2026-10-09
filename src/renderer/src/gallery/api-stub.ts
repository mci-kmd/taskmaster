// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fixture = (...args: any[]) => unknown

const fixtures = new Map<string, Fixture[]>()

/**
 * Answers one API method with fixture data in the gallery, e.g.
 * `setApiFixture('appState.getThreadDiffSummary', (query) => …)`. Sections branch on the
 * arguments (such as a thread id) to show several states side by side, and return undefined
 * for calls they don't own so other sections' fixtures (or the default stub) answer them.
 */
export function setApiFixture(path: string, fixture: Fixture): void {
  fixtures.set(path, [...(fixtures.get(path) ?? []), fixture])
}

/**
 * Lets the gallery run in a plain browser (no preload): every `window.api` call resolves to
 * undefined (unless a fixture answers it), and subscriptions return a no-op unsubscribe.
 */
export function installApiStub(): void {
  if (window.api) return
  // Both a resolved promise (for requests) and a no-op function (for unsubscribing).
  const result = (): (() => void) & Promise<undefined> => {
    const settled = Promise.resolve(undefined)
    return Object.assign(() => {}, {
      then: settled.then.bind(settled),
      catch: settled.catch.bind(settled),
      finally: settled.finally.bind(settled)
    }) as (() => void) & Promise<undefined>
  }
  const stub = (path: string): unknown =>
    new Proxy(() => {}, {
      get: (_target, key) =>
        key === 'then' ? undefined : stub(path ? `${path}.${String(key)}` : String(key)),
      apply: (_target, _this, args: unknown[]) => {
        for (const fixture of fixtures.get(path) ?? []) {
          const value = fixture(...args)
          if (value !== undefined) return value
        }
        return result()
      }
    })
  Object.defineProperty(window, 'api', { value: stub(''), configurable: true })
}

// Components read `window.api` when their modules load, before the gallery itself does, so
// main.tsx imports this module first and the stub is in place for them.
if (import.meta.env.DEV && window.location.hash.startsWith('#gallery')) installApiStub()
