import type { ProjectTaskSnapshot, ProjectTaskTag } from './app-types'
import { formatGitHubIssueReference, parseGitHubIssueReference } from './github-issue'

export type TaskFilter = {
  query: string
  labels: readonly ProjectTaskTag[]
}

export function normalizeTaskQuery(query: string): string {
  return query.trim().toLowerCase()
}

export function isTaskFilterActive(filter: TaskFilter): boolean {
  return normalizeTaskQuery(filter.query).length > 0 || filter.labels.length > 0
}

function matchesGitHubIssue(url: string | undefined, query: string): boolean {
  const issue = parseGitHubIssueReference(url)
  return (
    issue !== null &&
    (issue.url.toLowerCase().includes(query) ||
      formatGitHubIssueReference(issue).toLowerCase().includes(query))
  )
}

/**
 * Matches the query against the number (`#12`), title, description or linked GitHub issue
 * (`owner/repo#34` or its URL), and any selected label.
 */
export function matchesTaskFilter(
  task: Pick<ProjectTaskSnapshot, 'title' | 'description' | 'tags'> &
    Partial<Pick<ProjectTaskSnapshot, 'number' | 'githubIssueUrl'>>,
  filter: TaskFilter
): boolean {
  const query = normalizeTaskQuery(filter.query)
  const numberQuery = /^#(\d+)$/.exec(query)
  if (
    query.length > 0 &&
    !(numberQuery && task.number === Number(numberQuery[1])) &&
    !task.title.toLowerCase().includes(query) &&
    !task.description.toLowerCase().includes(query) &&
    !(!numberQuery && matchesGitHubIssue(task.githubIssueUrl, query))
  ) {
    return false
  }

  if (filter.labels.length === 0) {
    return true
  }

  const taskLabels = new Set(task.tags.map((tag) => tag.toLowerCase()))
  return filter.labels.some((label) => taskLabels.has(label.toLowerCase()))
}
