export type GitHubIssueReference = {
  owner: string
  repo: string
  number: number
  /** Canonical issue URL, e.g. https://github.com/owner/repo/issues/12. */
  url: string
}

export const GITHUB_ISSUE_INPUT_HINT =
  'Use a GitHub issue URL like https://github.com/owner/repo/issues/123 or owner/repo#123.'

const OWNER = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})'
const REPO = '[A-Za-z0-9._-]{1,100}'
const ISSUE_URL_PATTERN = new RegExp(
  `^https?://(?:www\\.)?github\\.com/(${OWNER})/(${REPO})/issues/(\\d+)/?(?:[?#].*)?$`,
  'i'
)
const ISSUE_SHORTHAND_PATTERN = new RegExp(`^(${OWNER})/(${REPO})#(\\d+)$`)

/** Parses a github.com issue URL or `owner/repo#123`; returns null when it is neither. */
export function parseGitHubIssueReference(
  value: string | null | undefined
): GitHubIssueReference | null {
  const input = value?.trim() ?? ''
  const match = ISSUE_URL_PATTERN.exec(input) ?? ISSUE_SHORTHAND_PATTERN.exec(input)
  if (!match) {
    return null
  }

  const [, owner, repo, rawNumber] = match
  const number = Number(rawNumber)
  if (!Number.isSafeInteger(number) || number <= 0 || repo === '.' || repo === '..') {
    return null
  }

  return { owner, repo, number, url: `https://github.com/${owner}/${repo}/issues/${number}` }
}

/** `owner/repo#123` for display. */
export function formatGitHubIssueReference(reference: GitHubIssueReference): string {
  return `${reference.owner}/${reference.repo}#${reference.number}`
}
