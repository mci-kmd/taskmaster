import { splitAttachmentMarkers } from './attachment-markers'

export interface RailPrompt {
  id: string
  content: string
  attachments?: string[]
}

/** One line of prompt text, with attachment markers shown as `📎 name`. */
export function promptPreview({ content, attachments = [] }: RailPrompt): string {
  return splitAttachmentMarkers(content, attachments)
    .map((part) => ('text' in part ? part.text : `📎 ${part.attachment}`))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** One line of a Markdown message, without the most common Markdown syntax. */
export function messagePreview({ content }: RailPrompt): string {
  return content
    .replace(/^\s*(```|~~~).*$/gm, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
