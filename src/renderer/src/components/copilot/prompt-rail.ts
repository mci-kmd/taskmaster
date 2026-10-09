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
