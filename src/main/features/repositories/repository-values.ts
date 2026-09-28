import { isHttpUrl } from '../../../shared/preview'

export function normalizeRunCommand(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function normalizeRepositoryScript(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

// Branch tokens are only known per thread, so validate with representative values.
const PREVIEW_URL_SAMPLE_TOKENS: Array<[string, string]> = [
  ['{BRANCH-PORT}', '4000'],
  ['{BRANCH-NAME-SAFE}', 'branch'],
  ['{BRANCH-NAME}', 'branch']
]

/** Trimmed preview URL, or null when empty or not an http(s) address. */
export function normalizeRepositoryPreviewUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized) return null
  const sample = PREVIEW_URL_SAMPLE_TOKENS.reduce(
    (url, [token, replacement]) => url.split(token).join(replacement),
    normalized
  )
  return isHttpUrl(sample) ? normalized : null
}

export function validateRepositoryPreviewUrlInput(
  input: string | null | undefined
): { ok: true; url: string | null } | { ok: false; error: string } {
  if (!input?.trim()) return { ok: true, url: null }
  const url = normalizeRepositoryPreviewUrl(input)
  if (!url) {
    return {
      ok: false,
      error: 'Preview URL must be an http:// or https:// address, such as http://localhost:5173.'
    }
  }
  return { ok: true, url }
}

export function validateRepositoryRunCommandInput(input: string | null): {
  ok: true
  command: string | null
} {
  return {
    ok: true,
    command: normalizeRunCommand(input)
  }
}

export function validateRepositoryNewWorktreeSetupCommandInput(input: string | null): {
  ok: true
  command: string | null
} {
  return {
    ok: true,
    command: normalizeRepositoryScript(input)
  }
}

export function validateRepositoryPostWorktreeRemoveCommandInput(input: string | null): {
  ok: true
  command: string | null
} {
  return {
    ok: true,
    command: normalizeRepositoryScript(input)
  }
}
