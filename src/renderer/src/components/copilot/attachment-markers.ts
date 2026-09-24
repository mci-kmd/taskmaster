import type { CopilotAttachment } from '../../../../shared/app-types'

export const attachmentMarker = (name: string): string => `[📎 ${name}]`

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function uniqueAttachmentName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 2; ; index++) {
    const candidate = `${stem} (${index})${extension}`
    if (!used.has(candidate)) return candidate
  }
}

export function withUniqueNames(
  added: CopilotAttachment[],
  existing: CopilotAttachment[]
): CopilotAttachment[] {
  const taken = existing.map((item) => item.displayName)
  return added.map((item) => {
    const displayName = uniqueAttachmentName(item.displayName, taken)
    taken.push(displayName)
    return displayName === item.displayName ? item : { ...item, displayName }
  })
}

export function insertAttachmentMarkers(
  prompt: string,
  names: string[],
  start: number,
  end = start
): { prompt: string; caret: number } {
  const from = Math.max(0, Math.min(start, prompt.length))
  const to = Math.max(from, Math.min(end, prompt.length))
  if (!names.length) return { prompt, caret: from }
  const before = prompt.slice(0, from)
  const after = prompt.slice(to)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && /^\s/.test(after) ? '' : ' '
  const inserted = `${lead}${names.map(attachmentMarker).join(' ')}${trail}`
  return { prompt: before + inserted + after, caret: before.length + inserted.length }
}

export function removeAttachmentMarkers(prompt: string, name: string): string {
  return prompt.replace(
    new RegExp(`( ?)${escape(attachmentMarker(name))}( ?)`, 'gu'),
    (match: string, lead: string, trail: string, offset: number, whole: string) => {
      const before = whole[offset - 1]
      const after = whole[offset + match.length]
      const joinsWords = before && after && !/\s/.test(before) && !/\s/.test(after)
      return (lead || trail) && joinsWords ? ' ' : ''
    }
  )
}

export type MarkerPart = { text: string } | { attachment: string }

export function splitAttachmentMarkers(content: string, names: string[]): MarkerPart[] {
  const unique = [...new Set(names)].filter(Boolean).sort((a, b) => b.length - a.length)
  if (!unique.length) return [{ text: content }]
  const pattern = new RegExp(unique.map((name) => escape(attachmentMarker(name))).join('|'), 'gu')
  const parts: MarkerPart[] = []
  let index = 0
  for (const match of content.matchAll(pattern)) {
    if (match.index > index) parts.push({ text: content.slice(index, match.index) })
    parts.push({ attachment: unique.find((name) => attachmentMarker(name) === match[0])! })
    index = match.index + match[0].length
  }
  if (index < content.length) parts.push({ text: content.slice(index) })
  return parts
}

export function stripAttachmentMarkers(content: string, names: string[] = []): string {
  const stripped = names.reduce((text, name) => removeAttachmentMarkers(text, name), content)
  return stripped === content ? content : stripped.replace(/[ \t]+$/gm, '').trim()
}

export type MarkerRange = { start: number; end: number; name: string }

export function markerRanges(prompt: string, names: string[]): MarkerRange[] {
  const ranges: MarkerRange[] = []
  let index = 0
  for (const part of splitAttachmentMarkers(prompt, names)) {
    const length = 'text' in part ? part.text.length : attachmentMarker(part.attachment).length
    if ('attachment' in part)
      ranges.push({ start: index, end: index + length, name: part.attachment })
    index += length
  }
  return ranges
}

export function hasAttachmentMarker(prompt: string, name: string): boolean {
  return prompt.includes(attachmentMarker(name))
}

/**
 * Treats markers as single characters: edits that touch a marker remove all of it, and typing
 * inside one moves the new text after it. Returns null when the edit needs no adjustment.
 */
export function applyMarkerEdit(
  previous: string,
  next: string,
  names: string[],
  caret: number
): { prompt: string; caret: number } | null {
  const ranges = markerRanges(previous, names)
  if (!ranges.length) return null
  let newEnd = Math.max(0, Math.min(caret, next.length))
  let oldEnd = previous.length - (next.length - newEnd)
  if (oldEnd < 0 || previous.slice(oldEnd) !== next.slice(newEnd)) {
    let suffix = 0
    const limit = Math.min(previous.length, next.length)
    while (suffix < limit && previous.at(-1 - suffix) === next.at(-1 - suffix)) suffix++
    oldEnd = previous.length - suffix
    newEnd = next.length - suffix
  }
  let start = 0
  const limit = Math.min(oldEnd, newEnd)
  while (start < limit && previous[start] === next[start]) start++
  const inserted = next.slice(start, newEnd)
  if (start === oldEnd) {
    const inside = ranges.find((range) => range.start < start && start < range.end)
    if (!inside) return null
    return {
      prompt: previous.slice(0, inside.end) + inserted + previous.slice(inside.end),
      caret: inside.end + inserted.length
    }
  }
  const touched = ranges.filter((range) => range.start < oldEnd && range.end > start)
  const from = Math.min(start, ...touched.map((range) => range.start))
  let to = Math.max(oldEnd, ...touched.map((range) => range.end))
  const partial = touched.some((range) => range.start < start || range.end > oldEnd)
  if (!partial) return null
  if (!inserted && previous[from - 1] === ' ' && previous[to] === ' ') to++
  return {
    prompt: previous.slice(0, from) + inserted + previous.slice(to),
    caret: from + inserted.length
  }
}

/** Moves a caret that landed inside a marker to the closest edge of that marker. */
export function snapOutOfMarker(prompt: string, names: string[], caret: number): number {
  const inside = markerRanges(prompt, names).find(
    (range) => range.start < caret && caret < range.end
  )
  if (!inside) return caret
  return caret - inside.start <= inside.end - caret ? inside.start : inside.end
}

export function attachmentPreview(attachment: CopilotAttachment): string | null {
  if (attachment.previewUrl) return attachment.previewUrl
  if (attachment.type === 'blob' && attachment.data && attachment.mimeType?.startsWith('image/'))
    return `data:${attachment.mimeType};base64,${attachment.data}`
  return null
}
