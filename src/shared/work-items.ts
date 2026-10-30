import { parseGitHubIssueReference } from './github-issue'

export type WorkItemProvider = 'github' | 'azure-devops'

/** A GitHub issue/pull request or Azure DevOps work item a thread is linked to. */
export type ThreadWorkItem = {
  provider: WorkItemProvider
  /** Canonical URL; identifies the link. */
  url: string
  /** `owner/repo` on GitHub, `organization/project` on Azure DevOps. */
  container: string
  number: number
  /** Optional title, as reported by the agent. */
  title?: string
}

export const MAX_THREAD_WORK_ITEMS = 20
const MAX_TITLE_LENGTH = 200

export const WORK_ITEM_INPUT_HINT =
  'Use a GitHub issue or pull request URL (https://github.com/owner/repo/issues/123, ' +
  'https://github.com/owner/repo/pull/123 or owner/repo#123) or an Azure DevOps work item URL ' +
  '(https://dev.azure.com/org/project/_workitems/edit/123 or ' +
  'https://org.visualstudio.com/project/_workitems/edit/123).'

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})'
const REPO = '[A-Za-z0-9._-]{1,100}'
const GITHUB_PULL_PATTERN = new RegExp(
  `^https?://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/pull/(\\d+)(?:/[^?#]*)?/?(?:[?#].*)?$`,
  'i'
)
const SEGMENT = '[^/?#\\s]+'
const ADO_PATTERN = new RegExp(
  `^https?://dev\\.azure\\.com/(${SEGMENT})/(${SEGMENT})/_workitems/edit/(\\d+)/?(?:[?#].*)?$`,
  'i'
)
const VSTS_PATTERN = new RegExp(
  `^https?://([A-Za-z0-9-]+)\\.visualstudio\\.com/(?:DefaultCollection/)?(${SEGMENT})/_workitems/edit/(\\d+)/?(?:[?#].*)?$`,
  'i'
)

function toNumber(raw: string): number | null {
  const number = Number(raw)
  return Number.isSafeInteger(number) && number > 0 ? number : null
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    return decoded && decoded !== '.' && decoded !== '..' && !decoded.includes('/') ? decoded : null
  } catch {
    return null
  }
}

/** Parses a GitHub issue/pull request or Azure DevOps work item reference; null when it is neither. */
export function parseWorkItemReference(
  value: string | null | undefined
): Omit<ThreadWorkItem, 'title'> | null {
  const input = value?.trim() ?? ''
  const issue = parseGitHubIssueReference(input)
  if (issue) {
    return {
      provider: 'github',
      url: issue.url,
      container: `${issue.owner}/${issue.repo}`,
      number: issue.number
    }
  }

  const pull = GITHUB_PULL_PATTERN.exec(input)
  if (pull) {
    const [, owner, repo, raw] = pull
    const number = toNumber(raw)
    if (!number || repo === '.' || repo === '..') return null
    return {
      provider: 'github',
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
      container: `${owner}/${repo}`,
      number
    }
  }

  const ado = ADO_PATTERN.exec(input) ?? VSTS_PATTERN.exec(input)
  if (ado) {
    const [, rawOrganization, rawProject, raw] = ado
    const organization = decodeSegment(rawOrganization)
    const project = decodeSegment(rawProject)
    const number = toNumber(raw)
    if (!organization || !project || !number) return null
    return {
      provider: 'azure-devops',
      url:
        `https://dev.azure.com/${encodeURIComponent(organization)}/` +
        `${encodeURIComponent(project)}/_workitems/edit/${number}`,
      container: `${organization}/${project}`,
      number
    }
  }

  return null
}

export function normalizeWorkItemTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const title = value.replace(/\s+/g, ' ').trim()
  if (!title) return undefined
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title
}

/** Drops invalid entries and duplicates, canonicalizing the rest. Absent when nothing remains. */
export function normalizeThreadWorkItems(value: unknown): ThreadWorkItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: ThreadWorkItem[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const parsed = parseWorkItemReference(typeof record.url === 'string' ? record.url : null)
    if (!parsed || seen.has(parsed.url)) continue
    seen.add(parsed.url)
    const title = normalizeWorkItemTitle(record.title)
    items.push(title ? { ...parsed, title } : parsed)
    if (items.length === MAX_THREAD_WORK_ITEMS) break
  }
  return items.length > 0 ? items : undefined
}

export function sameThreadWorkItems(
  left: readonly ThreadWorkItem[] | undefined,
  right: readonly ThreadWorkItem[] | undefined
): boolean {
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false
  return (left ?? []).every((item, index) => {
    const other = right![index]
    return (
      item.provider === other.provider &&
      item.url === other.url &&
      item.container === other.container &&
      item.number === other.number &&
      item.title === other.title
    )
  })
}

/** `owner/repo#12` on GitHub, `organization/project#123` on Azure DevOps. */
export function formatWorkItemReference(
  item: Pick<ThreadWorkItem, 'container' | 'number'>
): string {
  return `${item.container}#${item.number}`
}

export const MAX_THREAD_TASKS = 20

/** Numbers of the project's Taskmaster tasks, without duplicates. Absent when none remain. */
export function normalizeThreadTaskNumbers(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined
  const numbers: number[] = []
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry <= 0) continue
    if (numbers.includes(entry)) continue
    numbers.push(entry)
    if (numbers.length === MAX_THREAD_TASKS) break
  }
  return numbers.length > 0 ? numbers : undefined
}

export function sameThreadTaskNumbers(
  left: readonly number[] | undefined,
  right: readonly number[] | undefined
): boolean {
  if ((left?.length ?? 0) !== (right?.length ?? 0)) return false
  return (left ?? []).every((number, index) => right![index] === number)
}
