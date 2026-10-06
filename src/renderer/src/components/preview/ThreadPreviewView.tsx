import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CopilotAttachment,
  PreviewElementReference,
  ThreadSnapshot
} from '../../../../shared/app-types'
import {
  isHttpUrl,
  PREVIEW_GUEST_CHANNELS,
  previewElementLabel,
  previewPartition
} from '../../../../shared/preview'
import { getRendererApi } from '../../shared/api/client'
import CopilotThreadView from '../CopilotThreadView'
import ResizeHandle from '../ResizeHandle'
import type { ThreadSessionState } from '../TerminalSessions'
import Button from '../ui/Button'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  InspectIcon,
  RefreshIcon
} from '../Icons'
import { attachToDraft } from '../copilot/session-drafts'
import '../../assets/preview.css'

const api = getRendererApi()

type WebviewElement = HTMLElement & {
  loadURL: (url: string) => Promise<void>
  reload: () => void
  goBack: () => void
  goForward: () => void
  canGoBack: () => boolean
  canGoForward: () => boolean
  getURL: () => string
  send: (channel: string, ...args: unknown[]) => Promise<void>
  getWebContentsId: () => number
}

type WebviewEvent = Event & {
  url?: string
  isMainFrame?: boolean
  errorCode?: number
  errorDescription?: string
  validatedURL?: string
  channel?: string
  args?: unknown[]
}

type Props = {
  thread: ThreadSnapshot
  previewUrl: string
  onSessionChange: (threadId: string, state: ThreadSessionState) => void
  sharedCheckoutBusy?: boolean
}

const RETRY_DELAY_MS = 1500
// Chromium net errors that mean the dev server is not accepting connections (yet).
const SERVER_UNAVAILABLE_ERRORS = new Set([
  -7, -100, -101, -102, -104, -105, -106, -109, -118, -324
])
const CONVERSATION_WIDTH = { default: 440, min: 340, max: 760 }

// In-memory only: reopening the preview returns to the last page for the thread.
const lastUrls = new Map<string, string>()
let conversationWidth = CONVERSATION_WIDTH.default

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin
  } catch {
    return false
  }
}

function normalizeAddress(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  return isHttpUrl(candidate) ? candidate : null
}

const isRect = (value: unknown): boolean =>
  Boolean(value) &&
  ['x', 'y', 'width', 'height'].every(
    (key) => typeof (value as Record<string, unknown>)[key] === 'number'
  )

function isElementReference(value: unknown): value is PreviewElementReference {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    ['pageUrl', 'pageTitle', 'selector', 'tagName', 'text', 'html'].every(
      (key) => typeof record[key] === 'string'
    ) &&
    isRect(record.rect) &&
    Boolean(record.viewport) &&
    typeof (record.viewport as Record<string, unknown>).width === 'number' &&
    typeof (record.viewport as Record<string, unknown>).height === 'number' &&
    Array.isArray(record.components)
  )
}

export default function ThreadPreviewView(props: Props): React.JSX.Element {
  return <PreviewPane key={`${props.thread.id}:${props.previewUrl}`} {...props} />
}

function PreviewPane({
  thread,
  previewUrl,
  onSessionChange,
  sharedCheckoutBusy
}: Props): React.JSX.Element {
  const webviewRef = useRef<WebviewElement | null>(null)
  const [initialUrl] = useState(() => {
    const last = lastUrls.get(thread.id)
    return last && sameOrigin(last, previewUrl) ? last : previewUrl
  })
  const [currentUrl, setCurrentUrl] = useState(initialUrl)
  const [address, setAddress] = useState(initialUrl)
  const editingAddress = useRef(false)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState({ back: false, forward: false })
  const [inspecting, setInspecting] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [width, setWidth] = useState(conversationWidth)
  const mounted = useRef(true)

  const captureSelection = useCallback(
    async (reference: PreviewElementReference): Promise<void> => {
      const webview = webviewRef.current
      if (!webview) return
      const samePage = (): boolean => {
        try {
          return webview.getURL() === reference.pageUrl
        } catch {
          return false
        }
      }
      if (!samePage()) return
      setCapturing(true)
      setError(null)
      try {
        const result = await api.preview.captureElement({
          webContentsId: webview.getWebContentsId(),
          rect: reference.rect,
          viewport: reference.viewport
        })
        if (!mounted.current) return
        if (!samePage())
          throw new Error('The page changed while capturing. Pick the element again.')
        if (!result.ok || !result.data)
          throw new Error(result.error ?? 'Could not capture the selected element.')
        const attachment: CopilotAttachment = {
          id: crypto.randomUUID(),
          type: 'blob',
          data: result.data,
          mimeType: result.mimeType ?? 'image/png',
          displayName: previewElementLabel(reference),
          previewUrl: result.thumbnailUrl,
          element: reference
        }
        attachToDraft(thread.id, [attachment])
      } catch (cause) {
        if (mounted.current) setError(message(cause))
      } finally {
        if (mounted.current) setCapturing(false)
      }
    },
    [thread.id]
  )
  const captureRef = useRef(captureSelection)
  useEffect(() => {
    captureRef.current = captureSelection
  }, [captureSelection])

  useEffect(() => {
    mounted.current = true
    const webview = webviewRef.current
    if (!webview) return
    let retry: ReturnType<typeof setTimeout> | null = null
    const clearRetry = (): void => {
      if (retry) clearTimeout(retry)
      retry = null
    }
    const updateHistory = (): void => {
      try {
        setHistory({ back: webview.canGoBack(), forward: webview.canGoForward() })
      } catch {
        // Not attached yet.
      }
    }
    const navigated = (url: string | undefined): void => {
      if (!url || !isHttpUrl(url)) return
      setCurrentUrl(url)
      if (!editingAddress.current) setAddress(url)
      lastUrls.set(thread.id, url)
      updateHistory()
    }
    // A failed load still commits an error page, which fires did-finish-load afterwards.
    let failed = false
    const handlers: Record<string, (event: WebviewEvent) => void> = {
      'dom-ready': () => {
        setReady(true)
        // Each document starts with its own inspector switched off.
        setInspecting(false)
        void webview.send(PREVIEW_GUEST_CHANNELS.setInspecting, false).catch(() => {})
        updateHistory()
      },
      'did-start-loading': () => {
        failed = false
        clearRetry()
        setLoading(true)
      },
      'did-stop-loading': () => {
        setLoading(false)
        updateHistory()
      },
      'did-finish-load': () => {
        if (failed) return
        setFailedUrl(null)
        setWaiting(false)
        setLoadError(null)
      },
      'did-navigate': (event) => {
        // A new document starts with a fresh inspector.
        setInspecting(false)
        navigated(event.url)
      },
      'did-navigate-in-page': (event) => {
        if (event.isMainFrame) navigated(event.url)
      },
      'did-fail-load': (event) => {
        // -3 is an aborted load, e.g. a newer navigation replaced it.
        if (!event.isMainFrame || event.errorCode === -3) return
        failed = true
        setInspecting(false)
        setFailedUrl(
          event.validatedURL && isHttpUrl(event.validatedURL) ? event.validatedURL : null
        )
        if (SERVER_UNAVAILABLE_ERRORS.has(event.errorCode ?? 0)) {
          setWaiting(true)
          setLoadError(null)
          clearRetry()
          retry = setTimeout(() => {
            retry = null
            try {
              // Reloading the error page retries the failed address.
              webview.reload()
            } catch {
              // Detached; nothing to retry.
            }
          }, RETRY_DELAY_MS)
          return
        }
        setWaiting(false)
        setLoadError(event.errorDescription || `Error ${event.errorCode}`)
      },
      'render-process-gone': () => {
        setInspecting(false)
        setLoadError('The page crashed. Reload to try again.')
      },
      'ipc-message': (event) => {
        if (event.channel === PREVIEW_GUEST_CHANNELS.inspectingChanged) {
          setInspecting(event.args?.[0] === true)
        } else if (event.channel === PREVIEW_GUEST_CHANNELS.elementSelected) {
          const reference = event.args?.[0]
          if (isElementReference(reference)) void captureRef.current(reference)
        }
      }
    }
    for (const [name, handler] of Object.entries(handlers))
      webview.addEventListener(name, handler as EventListener)
    return () => {
      mounted.current = false
      clearRetry()
      for (const [name, handler] of Object.entries(handlers))
        webview.removeEventListener(name, handler as EventListener)
    }
  }, [thread.id])

  const withWebview = (action: (webview: WebviewElement) => void): void => {
    const webview = webviewRef.current
    if (!webview || !ready) return
    try {
      action(webview)
    } catch (cause) {
      setError(message(cause))
    }
  }

  const setGuestInspecting = (next: boolean): void =>
    withWebview((webview) => {
      setInspecting(next)
      void webview.send(PREVIEW_GUEST_CHANNELS.setInspecting, next).catch(() => {
        if (mounted.current) setInspecting(false)
      })
      if (next) webview.focus()
    })

  const navigate = (value: string): void => {
    const url = normalizeAddress(value)
    if (!url) {
      setError('Enter an http:// or https:// address.')
      return
    }
    setError(null)
    withWebview((webview) => {
      void webview.loadURL(url).catch(() => {
        // Failures are reported through did-fail-load.
      })
    })
  }

  const blocked = waiting || Boolean(loadError)
  const addressState = loadError ? 'error' : waiting ? 'waiting' : loading ? 'loading' : 'ready'

  return (
    <div
      className="tm-preview"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && inspecting) setGuestInspecting(false)
      }}
    >
      <section className="tm-preview-browser" aria-label="App preview">
        <div className="tm-preview-toolbar">
          <Button
            aria-label="Back"
            disabled={!ready || !history.back}
            iconOnly
            onClick={() => withWebview((webview) => webview.goBack())}
            size="sm"
            title="Back"
            variant="ghost"
          >
            <ArrowLeftIcon width={13} height={13} />
          </Button>
          <Button
            aria-label="Forward"
            disabled={!ready || !history.forward}
            iconOnly
            onClick={() => withWebview((webview) => webview.goForward())}
            size="sm"
            title="Forward"
            variant="ghost"
          >
            <ArrowRightIcon width={13} height={13} />
          </Button>
          <Button
            aria-label="Reload"
            disabled={!ready}
            iconOnly
            onClick={() => withWebview((webview) => webview.reload())}
            size="sm"
            title="Reload"
            variant="ghost"
          >
            <RefreshIcon width={13} height={13} />
          </Button>
          <form
            className="tm-preview-address"
            onSubmit={(event) => {
              event.preventDefault()
              navigate(address)
              ;(event.currentTarget.elements.namedItem('address') as HTMLInputElement)?.blur()
            }}
          >
            <span className="tm-preview-address-dot" data-state={addressState} aria-hidden />
            <input
              aria-label="Preview address"
              name="address"
              onBlur={() => {
                editingAddress.current = false
                setAddress(currentUrl)
              }}
              onChange={(event) => setAddress(event.target.value)}
              onFocus={(event) => {
                editingAddress.current = true
                event.target.select()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') event.currentTarget.blur()
              }}
              spellCheck={false}
              value={address}
            />
          </form>
          <Button
            aria-label="Select an element to comment on"
            aria-pressed={inspecting}
            className="tm-preview-inspect"
            disabled={!ready || blocked || capturing}
            onClick={() => setGuestInspecting(!inspecting)}
            size="sm"
            title="Select an element to comment on (Ctrl+Shift+C in the page · Esc to cancel)"
            variant="secondary"
          >
            <InspectIcon width={13} height={13} />
            {capturing ? 'Capturing…' : inspecting ? 'Selecting…' : 'Comment'}
          </Button>
          <Button
            aria-label="Open in browser"
            iconOnly
            onClick={() => window.open(currentUrl, '_blank')}
            size="sm"
            title="Open in your browser"
            variant="ghost"
          >
            <ExternalLinkIcon width={13} height={13} />
          </Button>
        </div>
        {error ? (
          <div className="tm-preview-error" role="alert">
            <span>{error}</span>
            <Button
              aria-label="Dismiss error"
              iconOnly
              onClick={() => setError(null)}
              size="sm"
              title="Dismiss"
              variant="ghost"
            >
              <CloseIcon width={12} height={12} />
            </Button>
          </div>
        ) : null}
        <div className="tm-preview-stage" data-inspecting={inspecting}>
          <webview
            // eslint-disable-next-line react/no-unknown-property -- Electron <webview> attribute.
            partition={previewPartition(thread.repositoryId)}
            ref={(element: HTMLElement | null) => {
              webviewRef.current = element as WebviewElement | null
            }}
            src={initialUrl}
          />
          {inspecting ? (
            <div className="tm-preview-hint" role="status">
              Click an element to add it to your message · Esc to cancel
            </div>
          ) : null}
          {waiting ? (
            <div className="tm-preview-cover" role="status">
              <strong>Waiting for the app…</strong>
              <span>
                Retrying <code>{failedUrl ?? currentUrl}</code> until the run command starts serving
                it.
              </span>
            </div>
          ) : loadError ? (
            <div className="tm-preview-cover" role="alert">
              <strong>Could not load the preview</strong>
              <span>
                <code>{failedUrl ?? currentUrl}</code>: {loadError}
              </span>
            </div>
          ) : null}
        </div>
      </section>
      <aside className="tm-preview-conversation" style={{ width }}>
        <ResizeHandle
          ariaLabel="Resize conversation"
          invert
          max={CONVERSATION_WIDTH.max}
          min={CONVERSATION_WIDTH.min}
          onResize={setWidth}
          onResizeEnd={(final) => {
            conversationWidth = final
            setWidth(final)
          }}
          title="Drag to resize · double-click to reset"
          collapseWidth={CONVERSATION_WIDTH.default}
          width={width}
        />
        <CopilotThreadView
          thread={thread}
          onSessionChange={onSessionChange}
          sharedCheckoutBusy={sharedCheckoutBusy}
        />
      </aside>
    </div>
  )
}
