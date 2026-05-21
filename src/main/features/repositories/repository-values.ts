export function normalizeRunCommand(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function normalizeRepositoryScript(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
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
