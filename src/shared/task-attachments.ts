import type { ProjectTaskAttachment } from './app-types'

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  log: 'text/plain'
}

const EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/json': 'json',
  'text/csv': 'csv'
}

/** Raster images Taskmaster can make thumbnails of. */
const PREVIEWABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp'
])

export function guessMimeType(fileName: string): string | undefined {
  const extension = /\.([^./\\]+)$/.exec(fileName)?.[1]?.toLowerCase()
  return extension ? MIME_TYPES_BY_EXTENSION[extension] : undefined
}

export function extensionForMimeType(mimeType: string | undefined): string | undefined {
  return mimeType ? EXTENSIONS_BY_MIME_TYPE[mimeType.toLowerCase()] : undefined
}

export function isPreviewableImage(
  attachment: Pick<ProjectTaskAttachment, 'displayName' | 'mimeType'>
): boolean {
  const mimeType = attachment.mimeType ?? guessMimeType(attachment.displayName)
  return mimeType !== undefined && PREVIEWABLE_IMAGE_TYPES.has(mimeType.toLowerCase())
}
