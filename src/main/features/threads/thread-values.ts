export function normalizeTrackedText(value: string | null): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function normalizeCustomTitle(title: string | null | undefined): string | null {
  const trimmedTitle = title?.trim()
  return trimmedTitle ? trimmedTitle : null
}

export function sanitizeSessionNamePrefix(repositoryName: string): string {
  const sanitized = repositoryName
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized || 'thread'
}

export function buildThreadSessionName(repositoryName: string, createId: () => string): string {
  return `${sanitizeSessionNamePrefix(repositoryName)}-${createId()}`
}
