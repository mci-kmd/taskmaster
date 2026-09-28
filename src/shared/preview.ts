/** Messages exchanged between the preview `<webview>` host and its guest inspector preload. */
export const PREVIEW_GUEST_CHANNELS = {
  setInspecting: 'taskmaster-preview:set-inspecting',
  inspectingChanged: 'taskmaster-preview:inspecting-changed',
  elementSelected: 'taskmaster-preview:element-selected'
} as const

export const PREVIEW_PARTITION_PREFIX = 'persist:taskmaster-preview-'

/** Each project gets its own persistent browser storage, isolated from Taskmaster itself. */
export function previewPartition(repositoryId: string): string {
  return `${PREVIEW_PARTITION_PREFIX}${repositoryId.replace(/[^\w-]/g, '_')}`
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname)
  } catch {
    return false
  }
}

/** Short chip name for a picked element, e.g. `button “Save changes”`. */
export function previewElementLabel(element: {
  tagName: string
  accessibleName: string | null
  text: string
  components?: string[]
}): string {
  const tag = element.tagName || 'element'
  const name = (element.accessibleName || element.text).replace(/[[\]\s]+/g, ' ').trim()
  if (name) return `${tag} “${name.length > 28 ? `${name.slice(0, 27)}…` : name}”`
  const component = element.components?.[0]
  return component ? `${tag} in ${component}` : tag
}
