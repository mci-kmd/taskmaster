import {
  nativeImage,
  shell,
  webContents as allWebContents,
  type Session,
  type WebContents
} from 'electron'
import type { PreviewCaptureRequest, PreviewCaptureResult } from '../../shared/app-types'
import { IPC_CHANNELS } from '../../shared/contracts/ipc'
import { isHttpUrl, PREVIEW_PARTITION_PREFIX } from '../../shared/preview'
import { handleIpc } from '../ipc/typed-ipc'
import { CAPTURE_MAX_DIMENSION_PX, cropRectForElement, fitWithin } from './preview-capture'

// Sanitized clipboard writes back "copy" buttons; everything else (fullscreen, pointer lock,
// media, notifications, ...) is denied.
const ALLOWED_PERMISSIONS = new Set(['clipboard-sanitized-write'])
const configuredSessions = new WeakSet<Session>()
const previewGuests = new WeakSet<WebContents>()
// Error pages for failed loads commit under chrome-error:.
const isAllowedDocumentUrl = (url: string): boolean =>
  isHttpUrl(url) || url === 'about:blank' || url.startsWith('chrome-error:')

function configurePreviewSession(session: Session): void {
  if (configuredSessions.has(session)) return
  configuredSessions.add(session)
  session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission))
  )
  session.setPermissionCheckHandler((_contents, permission) => ALLOWED_PERMISSIONS.has(permission))
}

/**
 * Previewed sites are untrusted: they run sandboxed in their own storage partition with only the
 * element inspector preload, and never gain access to Taskmaster's IPC bridge.
 */
export function hardenPreviewWebviews(host: WebContents, inspectorPreloadPath: string): void {
  host.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isHttpUrl(params.src ?? '') || !params.partition?.startsWith(PREVIEW_PARTITION_PREFIX)) {
      event.preventDefault()
      return
    }
    delete params.allowpopups
    webPreferences.preload = inspectorPreloadPath
    webPreferences.nodeIntegration = false
    webPreferences.nodeIntegrationInSubFrames = false
    webPreferences.nodeIntegrationInWorker = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    webPreferences.webSecurity = true
    webPreferences.allowRunningInsecureContent = false
    webPreferences.webviewTag = false
  })

  host.on('did-attach-webview', (_event, guest) => {
    previewGuests.add(guest)
    configurePreviewSession(guest.session)
    guest.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    guest.on('will-navigate', (event, url) => {
      if (!isHttpUrl(url)) event.preventDefault()
    })
    guest.on('will-redirect', (event) => {
      if (event.isMainFrame && !isHttpUrl(event.url)) event.preventDefault()
    })
    // Also covers navigations started through the host (webview.loadURL), which skip will-navigate.
    // Stopping synchronously inside this event crashes Electron, so defer it.
    guest.on('did-start-navigation', (event) => {
      if (event.isMainFrame && !event.isSameDocument && !isAllowedDocumentUrl(event.url))
        setImmediate(() => {
          if (!guest.isDestroyed()) guest.stop()
        })
    })
    guest.on('did-navigate', (_event, url) => {
      if (!isAllowedDocumentUrl(url))
        setImmediate(() => {
          if (!guest.isDestroyed()) void guest.loadURL('about:blank').catch(() => {})
        })
    })
  })
}

async function captureElement(
  sender: WebContents,
  request: PreviewCaptureRequest
): Promise<PreviewCaptureResult> {
  const guest = allWebContents.fromId(request?.webContentsId)
  const available = (candidate: WebContents | null | undefined): candidate is WebContents =>
    candidate !== undefined &&
    candidate !== null &&
    !candidate.isDestroyed() &&
    previewGuests.has(candidate) &&
    candidate.getType() === 'webview' &&
    candidate.hostWebContents === sender &&
    isHttpUrl(candidate.getURL())
  const unavailable: PreviewCaptureResult = {
    ok: false,
    error: 'The preview is no longer available.'
  }
  if (!available(guest)) return unavailable
  try {
    const captured = await guest.capturePage()
    if (!available(guest)) return unavailable
    // Re-decode at scale factor 1 so sizes and crops are in physical pixels.
    const full = nativeImage.createFromBuffer(captured.toPNG())
    const crop = cropRectForElement(request.rect, request.viewport, full.getSize())
    if (!crop) return { ok: false, error: 'The selected element is not visible.' }
    let image = full.crop(crop)
    const size = image.getSize()
    const fitted = fitWithin(size, CAPTURE_MAX_DIMENSION_PX)
    if (fitted.width !== size.width || fitted.height !== size.height) image = image.resize(fitted)
    const thumbnail = image.resize(fitWithin(image.getSize(), 160))
    return {
      ok: true,
      data: image.toPNG().toString('base64'),
      mimeType: 'image/png',
      thumbnailUrl: thumbnail.toDataURL()
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export function registerPreviewIpc(): void {
  handleIpc(IPC_CHANNELS.preview.captureElement, (event, request) =>
    captureElement(event.sender, request)
  )
}
