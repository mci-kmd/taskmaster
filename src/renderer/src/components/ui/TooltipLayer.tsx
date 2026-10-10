import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLastValue, usePresence } from '../../lib/motion'

/** How long the pointer rests on an element before its tooltip shows. */
const SHOW_DELAY_MS = 500
/** Moving to another element within this time after a tooltip hid shows the next one at once. */
const SKIP_DELAY_MS = 300
const GAP = 6
const MARGIN = 8

/** Marks an aria-description the layer added, so it can keep it in sync or remove it. */
const OWNED_DESCRIPTION = 'data-tooltip-description'

type Tip = { target: HTMLElement; text: string }

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
 * Shows the app's own tooltips for every element with a `title`, styled like the rest of the
 * theme instead of the native tooltip. Mounted once at the root; components keep using `title`.
 */
export default function TooltipLayer(): React.JSX.Element | null {
  const [tip, setTip] = useState<Tip | null>(null)
  const shown = useLastValue(tip)
  const presence = usePresence(tip !== null)
  const element = useRef<HTMLDivElement>(null)

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
      const text = target.getAttribute('data-tooltip')
      if (current !== target || !target.isConnected) return
      visible = Boolean(text)
      setTip(text ? { target, text } : null)
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
      node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null

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

  // Below the element, centered, flipped above when there is no room, kept on screen.
  useLayoutEffect(() => {
    const popup = element.current
    if (!popup || !tip) return
    const bounds = tip.target.getBoundingClientRect()
    const { offsetWidth: width, offsetHeight: height } = popup
    const below = bounds.bottom + GAP + height <= window.innerHeight - MARGIN
    const left = Math.max(
      MARGIN,
      Math.min(bounds.left + bounds.width / 2 - width / 2, window.innerWidth - width - MARGIN)
    )
    popup.style.left = `${left}px`
    popup.style.top = `${below ? bounds.bottom + GAP : Math.max(MARGIN, bounds.top - GAP - height)}px`
    popup.dataset.placement = below ? 'bottom' : 'top'
  }, [tip])

  if (!presence.mounted || !shown) return null
  return createPortal(
    <div
      aria-hidden="true"
      className="tm-tooltip"
      data-motion="drop"
      data-state={presence.state}
      ref={element}
    >
      {shown.text}
    </div>,
    document.body
  )
}
