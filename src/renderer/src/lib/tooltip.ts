import type { ReactNode, RefCallback } from 'react'

/** Where a tooltip opens relative to its element. */
export type TooltipPlacement = 'bottom' | 'right'

export type RichTooltip = { content: ReactNode; placement: TooltipPlacement }

/** Marks elements with structured tooltip content (see richTooltip). */
export const RICH_TOOLTIP_ATTRIBUTE = 'data-tooltip-rich'
/** Dispatched on an element when its structured tooltip content changes. */
export const RICH_TOOLTIP_CHANGE_EVENT = 'tm:rich-tooltip-change'

const richTooltips = new WeakMap<Element, RichTooltip>()

/**
 * Gives an element a structured tooltip, shown by the TooltipLayer like a `title` but with
 * React content. Use the result as the element's ref; plain text tooltips just use `title`.
 */
export function richTooltip(
  content: ReactNode,
  placement: TooltipPlacement = 'bottom'
): RefCallback<HTMLElement> {
  return (element) => {
    if (!element) return
    richTooltips.set(element, { content, placement })
    element.setAttribute(RICH_TOOLTIP_ATTRIBUTE, '')
    // Lets a tooltip that is showing follow the new content (e.g. a thread's status).
    element.dispatchEvent(new Event(RICH_TOOLTIP_CHANGE_EVENT, { bubbles: true }))
  }
}

export function getRichTooltip(element: Element): RichTooltip | undefined {
  return richTooltips.get(element)
}
