const MAX_PROMPT_CHARS = 1_500
const MAX_BRANCH_CHARS = 60
const MAX_WORDS = 6
const FALLBACK_NAME = 'thread'

export const BRANCH_NAME_SYSTEM_MESSAGE = [
  'You name git branches for the work a developer asks a coding assistant to do.',
  'Reply with only the branch name: no preamble, quotes, or explanation.',
  'Use at most five lowercase words joined by hyphens, with no prefix such as feature/.',
  'If the request mentions a user story, work item, or issue number, start with that number',
  'and a hyphen, for example: 12431234-build-the-thing.'
].join(' ')

export function buildBranchNamePrompt(prompt: string): string {
  const request = prompt.trim()
  const truncated =
    request.length > MAX_PROMPT_CHARS ? `${request.slice(0, MAX_PROMPT_CHARS)}…` : request
  return `Name a git branch for this request:\n\n${truncated}`
}

/** A safe branch name from free text: lowercase words joined by hyphens, or null when empty. */
export function toBranchName(text: string): string | null {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
  let name = ''
  for (const word of words) {
    const next = name ? `${name}-${word}` : word
    if (next.length > MAX_BRANCH_CHARS) break
    name = next
  }
  return name || null
}

/** The generated name from the model's reply, ignoring any preamble or formatting. */
export function cleanGeneratedBranchName(reply: string): string | null {
  const line = reply
    .split(/\r?\n/u)
    .map((text) => text.trim())
    .find(Boolean)
  if (!line) return null
  const name = line
    .replace(/^(branch(\s+name)?\s*:\s*)/iu, '')
    .replace(/^[`"'*\s]+|[`"'*.\s]+$/gu, '')
    .replace(/^(feature|feat|fix|bugfix|chore)\//iu, '')
  return toBranchName(name)
}

/** A name from the prompt itself, for when the model can't write one. */
export function fallbackBranchName(prompt: string): string {
  const id = /(?:^|[^\d])(\d{4,})(?!\d)/u.exec(prompt)?.[1]
  const words = toBranchName(
    prompt
      .replace(id ?? '', ' ')
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, MAX_WORDS)
      .join(' ')
  )
  const name = [id, words].filter(Boolean).join('-')
  return toBranchName(name) ?? FALLBACK_NAME
}

/** The name, or the name with the lowest free numeric suffix. */
export function uniqueBranchName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name
  for (let index = 2; index < 100; index++) {
    const candidate = `${name}-${index}`
    if (!taken(candidate)) return candidate
  }
  return `${name}-${Date.now()}`
}
