export function safeExternalUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? parsed.href : undefined
  } catch {
    return undefined
  }
}
