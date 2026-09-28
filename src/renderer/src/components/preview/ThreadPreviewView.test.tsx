// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ThreadSnapshot } from '../../../../shared/app-types'
import ThreadPreviewView from './ThreadPreviewView'

const api = vi.hoisted(() => ({ preview: { captureElement: vi.fn() } }))
const attachToDraft = vi.hoisted(() => vi.fn())
vi.mock('../../shared/api/client', () => ({ getRendererApi: () => api }))
vi.mock('../CopilotThreadView', () => ({ default: () => <div>Conversation</div> }))
vi.mock('../copilot/session-drafts', () => ({ attachToDraft }))

const thread = { id: 'thread-preview', repositoryId: 'repo' } as ThreadSnapshot

function setup(
  src = 'http://localhost:4000/'
): HTMLElement & Record<'reload' | 'loadURL' | 'send', ReturnType<typeof vi.fn>> {
  render(
    <ThreadPreviewView
      onSessionChange={vi.fn()}
      previewUrl="http://localhost:4000/"
      thread={thread}
    />
  )
  const webview = document.querySelector('webview') as HTMLElement
  expect(webview.getAttribute('src')).toBe(src)
  expect(webview.getAttribute('partition')).toBe('persist:taskmaster-preview-repo')
  return Object.assign(webview, {
    reload: vi.fn(),
    loadURL: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    focus: vi.fn(),
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    getWebContentsId: vi.fn(() => 7),
    getURL: vi.fn(() => src)
  })
}

function emit(webview: HTMLElement, type: string, detail: Record<string, unknown> = {}): void {
  act(() => {
    webview.dispatchEvent(Object.assign(new Event(type), detail))
  })
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('waits for the dev server and retries until the page loads', () => {
  vi.useFakeTimers()
  const webview = setup()
  emit(webview, 'did-start-loading')
  emit(webview, 'did-fail-load', {
    errorCode: -102,
    isMainFrame: true,
    validatedURL: 'http://localhost:4000/'
  })
  // The error page still finishes loading; the preview keeps waiting.
  emit(webview, 'dom-ready')
  emit(webview, 'did-finish-load')
  expect(screen.getByText('Waiting for the app…')).toBeTruthy()
  act(() => vi.advanceTimersByTime(1500))
  expect(webview.reload).toHaveBeenCalledTimes(1)

  emit(webview, 'did-start-loading')
  emit(webview, 'did-navigate', { url: 'http://localhost:4000/' })
  emit(webview, 'did-finish-load')
  expect(screen.queryByText('Waiting for the app…')).toBeNull()
  act(() => vi.advanceTimersByTime(5000))
  expect(webview.reload).toHaveBeenCalledTimes(1)
})

it('reports other load errors without retrying', () => {
  vi.useFakeTimers()
  const webview = setup()
  emit(webview, 'did-fail-load', {
    errorCode: -3,
    isMainFrame: true
  })
  emit(webview, 'did-fail-load', {
    errorCode: -200,
    errorDescription: 'ERR_CERT_COMMON_NAME_INVALID',
    isMainFrame: true,
    validatedURL: 'https://localhost:4000/'
  })
  expect(screen.getByText('Could not load the preview')).toBeTruthy()
  expect(screen.getByText(/ERR_CERT_COMMON_NAME_INVALID/)).toBeTruthy()
  act(() => vi.advanceTimersByTime(5000))
  expect(webview.reload).not.toHaveBeenCalled()
})

it('picks an element and attaches its screenshot to the thread draft', async () => {
  api.preview.captureElement.mockResolvedValue({
    ok: true,
    data: 'AA==',
    mimeType: 'image/png',
    thumbnailUrl: 'data:image/png;base64,AA=='
  })
  const webview = setup()
  emit(webview, 'dom-ready')
  fireEvent.click(screen.getByRole('button', { name: 'Select an element to comment on' }))
  expect(webview.send).toHaveBeenCalledWith('taskmaster-preview:set-inspecting', true)
  expect(screen.getByText(/Click an element/)).toBeTruthy()

  const reference = {
    pageUrl: 'http://localhost:4000/',
    pageTitle: 'App',
    selector: '#save',
    tagName: 'button',
    role: 'button',
    accessibleName: 'Save',
    text: 'Save',
    html: '<button id="save">Save</button>',
    components: [],
    sourceFile: null,
    rect: { x: 1, y: 2, width: 3, height: 4 },
    viewport: { width: 800, height: 600 }
  }
  emit(webview, 'ipc-message', {
    channel: 'taskmaster-preview:inspecting-changed',
    args: [false]
  })
  emit(webview, 'ipc-message', {
    channel: 'taskmaster-preview:element-selected',
    args: [{ ...reference, rect: 'bogus' }]
  })
  expect(api.preview.captureElement).not.toHaveBeenCalled()
  emit(webview, 'ipc-message', {
    channel: 'taskmaster-preview:element-selected',
    args: [{ ...reference, pageUrl: 'http://localhost:4000/other' }]
  })
  expect(api.preview.captureElement).not.toHaveBeenCalled()
  emit(webview, 'ipc-message', {
    channel: 'taskmaster-preview:element-selected',
    args: [reference]
  })
  await waitFor(() => expect(attachToDraft).toHaveBeenCalledTimes(1))
  expect(api.preview.captureElement).toHaveBeenCalledWith({
    webContentsId: 7,
    rect: reference.rect,
    viewport: reference.viewport
  })
  expect(attachToDraft).toHaveBeenCalledWith('thread-preview', [
    expect.objectContaining({
      type: 'blob',
      data: 'AA==',
      displayName: 'button “Save”',
      previewUrl: 'data:image/png;base64,AA==',
      element: reference
    })
  ])
  expect(screen.queryByText(/Click an element/)).toBeNull()
})

it('navigates from the address bar and keeps the page per thread', () => {
  const webview = setup()
  emit(webview, 'dom-ready')
  const address = screen.getByRole('textbox', { name: 'Preview address' })
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: 'localhost:4000/settings' } })
  fireEvent.submit(address.closest('form')!)
  expect(webview.loadURL).toHaveBeenCalledWith('http://localhost:4000/settings')
  emit(webview, 'did-navigate', { url: 'http://localhost:4000/settings' })
  cleanup()

  setup('http://localhost:4000/settings')
})
