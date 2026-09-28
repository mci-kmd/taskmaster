import type { PreviewElementReference } from '../shared/app-types'

const TEST_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa']
const MAX_SELECTOR_DEPTH = 8
const TEXT_LIMIT = 300
const NAME_LIMIT = 120
const HTML_LIMIT = 1200

const IMPLICIT_ROLES: Record<string, string> = {
  a: 'link',
  article: 'article',
  aside: 'complementary',
  button: 'button',
  dialog: 'dialog',
  footer: 'contentinfo',
  form: 'form',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  header: 'banner',
  img: 'img',
  li: 'listitem',
  main: 'main',
  nav: 'navigation',
  ol: 'list',
  option: 'option',
  section: 'region',
  select: 'combobox',
  table: 'table',
  textarea: 'textbox',
  ul: 'list'
}

const INPUT_ROLES: Record<string, string> = {
  button: 'button',
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  reset: 'button',
  search: 'searchbox',
  submit: 'button'
}

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim()

export function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value
}

export function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value
    .replace(/[^\w-]/g, (character) => `\\${character}`)
    .replace(/^(-?)(\d)/, (_match, dash: string, digit: string) => `${dash}\\3${digit} `)
}

const attributeValue = (value: string): string => value.replace(/["\\]/g, '\\$&')

/** Framework-generated ids and hashed CSS-module class names make brittle selectors. */
export function looksGenerated(value: string): boolean {
  if (/^:r[\da-z]*:$|^radix-|^headlessui-|^mui-|^react-|^ember\d/.test(value)) return true
  return value.split(/[-_]+/).some((part) => part.length >= 5 && /\d/.test(part) && /\D/.test(part))
}

function isUnique(root: ParentNode, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

function anchorFor(element: Element): string | null {
  const tag = element.localName
  for (const name of TEST_ATTRIBUTES) {
    const value = element.getAttribute(name)
    if (value) return `${tag}[${name}="${attributeValue(value)}"]`
  }
  const id = element.getAttribute('id')
  if (id && !looksGenerated(id)) return `#${cssEscape(id)}`
  return null
}

function stepFor(element: Element): string {
  const classes = Array.from(element.classList)
    .filter((name) => /^[A-Za-z][\w-]*$/.test(name) && !looksGenerated(name))
    .slice(0, 2)
  const base = `${cssEscape(element.localName)}${classes.map((name) => `.${cssEscape(name)}`).join('')}`
  const parent = element.parentElement
  if (!parent) return base
  const sameTag = Array.from(parent.children).filter(
    (sibling) => sibling.localName === element.localName
  )
  const matching = sameTag.filter((sibling) => {
    try {
      return sibling.matches(base)
    } catch {
      return false
    }
  })
  return matching.length > 1 ? `${base}:nth-of-type(${sameTag.indexOf(element) + 1})` : base
}

/** Builds a short, preferably stable CSS selector that matches only this element within its root. */
export function buildSelector(element: Element): string {
  const root = element.getRootNode() as Document | ShadowRoot
  const parts: string[] = []
  let current: Element | null = element
  while (current && parts.length < MAX_SELECTOR_DEPTH) {
    const anchor = anchorFor(current)
    if (anchor) {
      const candidate = [anchor, ...parts].join(' > ')
      if (isUnique(root, candidate)) return candidate
    }
    if (current.localName === 'html' || current.localName === 'body') {
      parts.unshift(current.localName)
      break
    }
    parts.unshift(stepFor(current))
    const candidate = parts.join(' > ')
    if (isUnique(root, candidate)) return candidate
    current = current.parentElement
  }
  return parts.join(' > ')
}

/** Selector that also crosses open shadow roots, using `>>>` between hosts and their contents. */
export function buildPiercingSelector(element: Element): string {
  const segments: string[] = []
  let current: Element | null = element
  while (current) {
    segments.unshift(buildSelector(current))
    const root = current.getRootNode()
    current = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.host : null
  }
  return segments.join(' >>> ')
}

export function implicitRole(element: Element): string | null {
  const explicit = element.getAttribute('role')
  if (explicit) return explicit.split(/\s+/)[0] || null
  const tag = element.localName
  if (tag === 'a') return element.hasAttribute('href') ? 'link' : null
  if (tag === 'input') {
    const type = (element.getAttribute('type') ?? 'text').toLowerCase()
    return INPUT_ROLES[type] ?? (type === 'hidden' ? null : 'textbox')
  }
  return IMPLICIT_ROLES[tag] ?? null
}

function textOf(element: Element): string {
  const inner = (element as HTMLElement).innerText
  return collapseWhitespace(typeof inner === 'string' ? inner : (element.textContent ?? ''))
}

export function accessibleName(element: Element): string | null {
  const document = element.ownerDocument
  const label = element.getAttribute('aria-label')
  if (label?.trim()) return truncate(collapseWhitespace(label), NAME_LIMIT)
  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .map((node) => (node ? textOf(node) : ''))
      .filter(Boolean)
      .join(' ')
    if (text) return truncate(text, NAME_LIMIT)
  }
  const id = element.getAttribute('id')
  if (id && /^(input|select|textarea)$/.test(element.localName)) {
    const labels = Array.from(document.querySelectorAll('label')).filter(
      (node) => node.htmlFor === id
    )
    const text = labels.map(textOf).filter(Boolean).join(' ')
    if (text) return truncate(text, NAME_LIMIT)
  }
  for (const name of ['alt', 'title', 'placeholder']) {
    const value = element.getAttribute(name)
    if (value?.trim()) return truncate(collapseWhitespace(value), NAME_LIMIT)
  }
  const role = implicitRole(element)
  if (role && /^(button|link|heading|tab|menuitem|option|checkbox|radio)$/.test(role)) {
    const text = textOf(element)
    if (text) return truncate(text, NAME_LIMIT)
  }
  return null
}

/** Picks the element worth commenting on: an icon rather than one of its paths. */
export function inspectableTarget(node: EventTarget | null): Element | null {
  if (!node || typeof (node as Element).closest !== 'function') return null
  const element = node as Element
  const svg = element.localName === 'svg' ? null : element.closest('svg')
  return svg ?? element
}

export function describeElement(
  element: Element,
  view: Pick<Window, 'innerWidth' | 'innerHeight' | 'location'>
): Omit<PreviewElementReference, 'components' | 'sourceFile'> {
  const rect = element.getBoundingClientRect()
  const html = element.outerHTML
  return {
    pageUrl: view.location.href,
    pageTitle: truncate(collapseWhitespace(element.ownerDocument.title ?? ''), NAME_LIMIT),
    selector: buildPiercingSelector(element),
    tagName: element.localName,
    role: implicitRole(element),
    accessibleName: accessibleName(element),
    text: truncate(textOf(element), TEXT_LIMIT),
    html: truncate(html, HTML_LIMIT),
    rect: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    viewport: { width: view.innerWidth, height: view.innerHeight }
  }
}
