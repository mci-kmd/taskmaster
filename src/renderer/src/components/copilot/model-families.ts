import type { CopilotModelOption } from '../../../../shared/app-types'

// Infer families from runtime metadata rather than maintaining a fixed model catalog.
// Match IDs first so provider-qualified names and friendly display labels both work.
const families: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Claude', pattern: /(?:^|[\s/:])claude(?=$|[\s._-]|\d)/i },
  { label: 'GPT', pattern: /(?:^|[\s/:])gpt(?=$|[\s._-]|\d)/i },
  { label: 'Gemini', pattern: /(?:^|[\s/:])gemini(?=$|[\s._-]|\d)/i },
  { label: 'OpenAI o-series', pattern: /(?:^|[\s/:])o\d{1,2}(?=$|[\s._-])/i },
  { label: 'Grok', pattern: /(?:^|[\s/:])grok(?=$|[\s._-]|\d)/i },
  { label: 'Raptor', pattern: /(?:^|[\s/:])raptor(?=$|[\s._-]|\d)/i }
]

export function modelFamily(model: Pick<CopilotModelOption, 'id' | 'name'>): string {
  for (const value of [model.id, model.name]) {
    const family = families.find(({ pattern }) => pattern.test(value))
    if (family) return family.label
  }
  return 'Other models'
}
