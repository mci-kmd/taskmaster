import type { CopilotPastedText } from '../../../../shared/app-types'
import { splitUserMessage } from './attachment-markers'

export interface RailPrompt {
  id: string
  content: string
  attachments?: string[]
  pastedTexts?: CopilotPastedText[]
}

/** One line of prompt text, with attachments and pasted text shown as `📎 name`. */
export function promptPreview({ content, attachments = [], pastedTexts = [] }: RailPrompt): string {
  return splitUserMessage(content, attachments, pastedTexts)
    .map((part) =>
      'text' in part ? part.text : `📎 ${'pasted' in part ? part.pasted.name : part.attachment}`
    )
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
