import type { PersistedRepository } from './app-types'

export const GENERAL_PROJECT_ID = 'general'
export const GENERAL_PROJECT_NAME_MAX_LENGTH = 80

export const GENERAL_PROJECT_DEFAULTS = {
  name: 'Computer',
  icon: 'monitor',
  iconColor: 'default'
} as const

export const GENERAL_THREAD_FALLBACK_TITLE = 'New conversation'

export function normalizeGeneralProjectName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/gu, ' ')
  return name && name.length <= GENERAL_PROJECT_NAME_MAX_LENGTH ? name : null
}

export function isGeneralProject(
  repository: Pick<PersistedRepository, 'kind'> | null | undefined
): boolean {
  return repository?.kind === 'general'
}
