import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLastValue, usePresence } from '../../lib/motion'
import { useTheme } from '../../lib/theme'
import {
  RICH_TOOLTIP_ATTRIBUTE,
  RICH_TOOLTIP_CHANGE_EVENT,
  getRichTooltip,
  type TooltipPlacement
} from '../../lib/tooltip'

/** How long the pointer rests on an element before its tooltip shows. */
const SHOW_DELAY_MS = 500
/** Moving to another element within this time after a tooltip hid shows the next one at once. */
const SKIP_DELAY_MS = 300
const GAP = 6
const MARGIN = 8

/** Marks an aria-description the layer added, so it can keep it in sync or remove it. */
const OWNED_DESCRIPTION = 'data-tooltip-description'

type Tip = { target: HTMLElement; content: ReactNode; placement: TooltipPlacement; rich: boolean }

/**
 * Takes over an element's `title`: the text moves to `data-tooltip` and `title` becomes empty,
 * which hides the native tooltip and stops the element inheriting an ancestor's. The text stays
 * available to assistive technology as `aria-description` unless the element has its own.
 */
function adopt(element: Element): void {
  const title = element.getAttribute('title')
  if (!title) return
  element.setAttribute('data-tooltip', title)
  element.setAttribute('title', '')
  if (
    element.hasAttribute(OWNED_DESCRIPTION) ||
    (!element.hasAttribute('aria-description') && !element.hasAttribute('aria-describedby'))
  ) {
    element.setAttribute('aria-description', title)
    element.setAttribute(OWNED_DESCRIPTION, '')
  }
}

/** Forgets a tooltip whose `title` the app removed. */
function release(element: Element): void {
  element.removeAttribute('data-tooltip')
  if (element.hasAttribute(OWNED_DESCRIPTION)) {
    element.removeAttribute('aria-description')
    element.removeAttribute(OWNED_DESCRIPTION)
  }
}

/**
 * Shows the app's own tooltips: for every element with a `title` (components keep using
 * `title`), and for elements given structured content with richTooltip(). Mounted once at the
 * root. Tooltips use the opposite appearance from the app (light on the dark themes, dark on
 * Porcelain) so they never read as one more card or menu.
 */
export default function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const shown = useLastValue(tip)
  const presence = usePresence(tip !== null)
  const element = useRef<HTMLDivElement>(null)
  const contrastTheme = useTheme().appearance === 'dark' ? 'porcelain' : 'graphite'

  useEffect(() => {
    let timer: number | undefined
    let current: HTMLElement | null = null
    let hiddenAt = -Infinity
    /** Whether `current`'s tooltip is on screen (rather than waiting out the delay). */
    let visible = false

    const hide = (): void => {
      window.clearTimeout(timer)
      if (current) hiddenAt = performance.now()
      current = null
      visible = false
      setTip(null)
    }
    const show = (target: HTMLElement): void => {
      if (current !== target || !target.isConnected) return
      const rich = getRichTooltip(target)
      const text = target.getAttribute('data-tooltip')
      const next: Tip | null = rich
        ? { target, content: rich.content, placement: rich.placement, rich: true }
        : text
          ? { target, content: text, placement: 'bottom', rich: false }
          : null
      visible = next !== null
      setTip(next)
    }
    const schedule = (target: HTMLElement): void => {
      if (target === current) return
      window.clearTimeout(timer)
      current = target
      if (performance.now() - hiddenAt < SKIP_DELAY_MS) show(target)
      else {
        visible = false
        setTip(null)
        timer = window.setTimeout(() => show(target), SHOW_DELAY_MS)
      }
    }
    const tooltipTarget = (node: EventTarget | null): HTMLElement | null =>
      node instanceof Element
        ? node.closest<HTMLElement>(`[data-tooltip], [${RICH_TOOLTIP_ATTRIBUTE}]`)
        : null

    // Keep tooltips in step with the DOM: adopt titles as they appear or change, drop the ones
    // the app removed, and hide a tooltip whose element went away or started leaving.
    document.querySelectorAll('[title]').forEach(adopt)
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === 'childList') {
          record.addedNodes.forEach((node) => {
            if (!(node instanceof Element)) return
            adopt(node)
            node.querySelectorAll('[title]').forEach(adopt)
          })
        } else if (record.attributeName === 'title' && record.target instanceof Element) {
          if (record.target.hasAttribute('title')) adopt(record.target)
          else release(record.target)
          // A shown tooltip follows its element's new text.
          if (record.target === current && visible) show(current)
        }
      }
      if (current && (!current.isConnected || current.closest('[data-state="closed"], [inert]'))) {
        hide()
      }
    })
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-state', 'inert']
    })

    const onPointerOver = (event: PointerEvent): void => {
      const target = tooltipTarget(event.target)
      if (target) schedule(target)
      else if (current) hide()
    }
    const onPointerOut = (event: PointerEvent): void => {
      if (!current) return
      const next = event.relatedTarget
      if (next instanceof Node && current.contains(next)) return
      hide()
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = tooltipTarget(event.target)
      if (target && event.target instanceof Element && event.target.matches(':focus-visible')) {
        schedule(target)
      }
    }
    const onRichChange = (event: Event): void => {
      if (visible && event.target === current && current) show(current)
    }
    document.addEventListener(RICH_TOOLTIP_CHANGE_EVENT, onRichChange, true)
    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', hide, true)
    document.addEventListener('pointerdown', hide, true)
    document.addEventListener('keydown', hide, true)
    document.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
      document.removeEventListener(RICH_TOOLTIP_CHANGE_EVENT, onRichChange, true)
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', hide, true)
      document.removeEventListener('pointerdown', hide, true)
      document.removeEventListener('keydown', hide, true)
      document.removeEventListener('wheel', hide, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  // Below the element (centered) or beside it on the right (top-aligned), flipped to the other
  // side when there is no room, and kept on screen.
  useLayoutEffect(() => {
    const popup = element.current
    if (!popup || !tip) return
    const bounds = tip.target.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = popup
    const clamp = (value: number, size: number, limit: number): number =>
      Math.max(MARGIN, Math.min(value, limit - size - MARGIN))
    if (tip.placement === 'right') {
      const right = bounds.right + GAP + width <= window.innerWidth - MARGIN
      popup.style.left = `${right ? bounds.right + GAP : clamp(bounds.left - GAP - width, width, window.innerWidth)}px`
      popup.style.top = `${clamp(bounds.top, height, window.innerHeight)}px`
      popup.dataset.placement = right ? 'right' : 'left'
      return
    }
    const below = bounds.bottom + GAP + height <= window.innerHeight - MARGIN
    popup.style.left = `${clamp(bounds.left + bounds.width / 2 - width / 2, width, window.innerWidth)}px`
    popup.style.top = `${below ? bounds.bottom + GAP : Math.max(MARGIN, bounds.top - GAP - height)}px`
    popup.dataset.placement = below ? 'bottom' : 'top'
  }, [tip])

  if (!presence.mounted || !shown) return null
  return createPortal(
    <div
      aria-hidden="true"
      className="tm-tooltip"
      data-motion={shown.placement === 'right' ? 'rise' : 'drop'}
      data-rich={shown.rich || undefined}
      data-state={presence.state}
      data-theme={contrastTheme}
      ref={element}
    >
      {shown.content}
    </div>,
    document.body
  )
}
