import { ipcRenderer, webFrame } from 'electron'
import type { PreviewElementReference } from '../shared/app-types'
import { PREVIEW_GUEST_CHANNELS } from '../shared/preview'
import { collectFrameworkHints } from './preview-framework-hints'
import { describeElement, implicitRole, inspectableTarget } from './preview-inspector'

// Guest preload for the project preview. It runs sandboxed in an isolated world: the page cannot
// reach it, and it can only message the embedding Taskmaster view, never the main process.

const SWALLOWED_EVENTS = [
  'pointerdown',
  'pointerup',
  'mousedown',
  'mouseup',
  'click',
  'dblclick',
  'auxclick',
  'contextmenu',
  'touchstart',
  'touchend'
] as const

let inspecting = false
let hovered: Element | null = null
let overlay: { host: HTMLElement; box: HTMLElement; label: HTMLElement } | null = null

function createOverlay(): NonNullable<typeof overlay> {
  const host = document.createElement('taskmaster-inspector')
  host.setAttribute(
    'style',
    'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;'
  )
  const root = host.attachShadow({ mode: 'closed' })
  const box = document.createElement('div')
  box.setAttribute(
    'style',
    'position: fixed; display: none; box-sizing: border-box; border: 2px solid #4c9aff; background: rgba(76, 154, 255, 0.14); border-radius: 3px; transition: all 60ms ease-out;'
  )
  const label = document.createElement('div')
  label.setAttribute(
    'style',
    'position: fixed; display: none; max-width: 360px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 3px 7px; border-radius: 4px; background: #0f1b2d; color: #dbe9ff; font: 500 11px/16px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; box-shadow: 0 2px 8px rgba(0,0,0,.35);'
  )
  root.append(box, label)
  return { host, box, label }
}

function attachOverlay(): NonNullable<typeof overlay> {
  overlay ??= createOverlay()
  if (!overlay.host.isConnected) document.documentElement.append(overlay.host)
  return overlay
}

function describeHover(element: Element, rect: DOMRect): string {
  const role = implicitRole(element)
  const id = element.id ? `#${element.id}` : ''
  const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`
  return `${element.localName}${id}${role && role !== element.localName ? ` · ${role}` : ''} · ${size}`
}

function highlight(element: Element | null): void {
  hovered = element
  if (!inspecting || !element) {
    if (overlay) {
      overlay.box.style.display = 'none'
      overlay.label.style.display = 'none'
    }
    return
  }
  const { box, label } = attachOverlay()
  const rect = element.getBoundingClientRect()
  Object.assign(box.style, {
    display: 'block',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  })
  label.textContent = describeHover(element, rect)
  const above = rect.top >= 26
  Object.assign(label.style, {
    display: 'block',
    left: `${Math.max(4, Math.min(rect.left, window.innerWidth - 200))}px`,
    top: `${above ? rect.top - 24 : Math.min(rect.bottom + 4, window.innerHeight - 24)}px`
  })
}

function setInspecting(next: boolean, notifyHost: boolean): void {
  if (inspecting === next) return
  inspecting = next
  document.documentElement.style.setProperty('cursor', next ? 'crosshair' : '')
  if (!next) {
    highlight(null)
    overlay?.host.remove()
  }
  if (notifyHost) ipcRenderer.sendToHost(PREVIEW_GUEST_CHANNELS.inspectingChanged, next)
}

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()))

async function frameworkHints(
  element: Element
): Promise<Pick<PreviewElementReference, 'components' | 'sourceFile'>> {
  const attribute = `data-taskmaster-inspect-${Math.random().toString(36).slice(2, 10)}`
  element.setAttribute(attribute, '')
  try {
    const result = await Promise.race([
      webFrame.executeJavaScript(
        `(${collectFrameworkHints.toString()})(${JSON.stringify(attribute)})`
      ) as Promise<ReturnType<typeof collectFrameworkHints>>,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))
    ])
    return {
      components: Array.isArray(result?.components)
        ? result.components.filter((name): name is string => typeof name === 'string').slice(0, 6)
        : [],
      sourceFile: typeof result?.sourceFile === 'string' ? result.sourceFile : null
    }
  } catch {
    return { components: [], sourceFile: null }
  } finally {
    element.removeAttribute(attribute)
  }
}

async function select(element: Element): Promise<void> {
  setInspecting(false, true)
  const hints = await frameworkHints(element)
  // Let the highlight disappear from the page before the host captures a screenshot.
  await nextFrame()
  await nextFrame()
  const reference: PreviewElementReference = { ...describeElement(element, window), ...hints }
  ipcRenderer.sendToHost(PREVIEW_GUEST_CHANNELS.elementSelected, reference)
}

function eventTarget(event: Event): Element | null {
  return inspectableTarget(event.composedPath()[0] ?? event.target)
}

// Registered before any page script runs, so these capture listeners see events first.
for (const type of SWALLOWED_EVENTS) {
  window.addEventListener(
    type,
    (event) => {
      if (!inspecting || !event.isTrusted) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (type !== 'click') return
      const element = eventTarget(event)
      if (element) void select(element)
    },
    { capture: true, passive: false }
  )
}

window.addEventListener(
  'pointermove',
  (event) => {
    if (!inspecting || !event.isTrusted) return
    const element = eventTarget(event)
    if (element !== hovered) highlight(element)
  },
  { capture: true, passive: true }
)

window.addEventListener(
  'scroll',
  () => {
    if (inspecting && hovered) highlight(hovered)
  },
  { capture: true, passive: true }
)

window.addEventListener(
  'keydown',
  (event) => {
    if (!event.isTrusted) return
    const toggle =
      event.shiftKey &&
      (event.ctrlKey || event.metaKey) &&
      !event.altKey &&
      event.key.toLowerCase() === 'c'
    if (toggle) {
      event.preventDefault()
      event.stopImmediatePropagation()
      setInspecting(!inspecting, true)
      return
    }
    if (inspecting && event.key === 'Escape') {
      event.preventDefault()
      event.stopImmediatePropagation()
      setInspecting(false, true)
    }
  },
  { capture: true }
)

window.addEventListener('blur', () => highlight(null))

ipcRenderer.on(PREVIEW_GUEST_CHANNELS.setInspecting, (_event, value: unknown) => {
  setInspecting(value === true, false)
})
