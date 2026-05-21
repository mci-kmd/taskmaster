import { existsSync, readFileSync, statSync } from 'fs'
import { extname, isAbsolute, normalize, relative, resolve } from 'path'
import { isPathInsideRepository } from './repository-path-utils'

type RelativePathResult = { ok: true; path: string } | { ok: false; error: string }

const REPOSITORY_FAVICON_EXTENSIONS = new Set([
  '.bmp',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.webp'
])

function resolveRepositoryAssetPath(
  repositoryPath: string,
  relativePath: string | null
): string | null {
  if (!relativePath) {
    return null
  }

  const candidatePath = resolve(repositoryPath, relativePath)
  if (!isPathInsideRepository(repositoryPath, candidatePath)) {
    return null
  }

  if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
    return null
  }

  const extension = extname(candidatePath).toLowerCase()
  if (!REPOSITORY_FAVICON_EXTENSIONS.has(extension)) {
    return null
  }

  return candidatePath
}

function getRepositoryFaviconMimeType(path: string): string | null {
  switch (extname(path).toLowerCase()) {
    case '.bmp':
      return 'image/bmp'
    case '.gif':
      return 'image/gif'
    case '.ico':
      return 'image/x-icon'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    default:
      return null
  }
}

export function buildRepositoryFaviconUrl(
  repositoryPath: string,
  relativePath: string | null
): string | null {
  const resolvedPath = resolveRepositoryAssetPath(repositoryPath, relativePath)
  if (!resolvedPath) {
    return null
  }

  const mimeType = getRepositoryFaviconMimeType(resolvedPath)
  if (!mimeType) {
    return null
  }

  const encoded = readFileSync(resolvedPath).toString('base64')
  return `data:${mimeType};base64,${encoded}`
}

export function validateRepositoryFaviconAbsolutePath(
  repositoryPath: string,
  candidatePath: string
): RelativePathResult {
  const normalizedCandidate = normalize(candidatePath)
  if (!isPathInsideRepository(repositoryPath, normalizedCandidate)) {
    return { ok: false, error: 'Favicon must be inside the repository.' }
  }

  if (!existsSync(normalizedCandidate)) {
    return { ok: false, error: 'Favicon file not found.' }
  }

  if (!statSync(normalizedCandidate).isFile()) {
    return { ok: false, error: 'Favicon path must point to a file.' }
  }

  const extension = extname(normalizedCandidate).toLowerCase()
  if (!REPOSITORY_FAVICON_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      error: 'Unsupported favicon file. Use .ico, .png, .svg, .jpg, .jpeg, .webp, .gif, or .bmp.'
    }
  }

  return {
    ok: true,
    path: normalize(relative(repositoryPath, normalizedCandidate))
  }
}

export function validateRepositoryFaviconInput(
  repositoryPath: string,
  input: string | null
): RelativePathResult | { ok: true; path: null } {
  const trimmed = input?.trim() ?? ''
  if (!trimmed) {
    return { ok: true, path: null }
  }

  if (isAbsolute(trimmed)) {
    return { ok: false, error: 'Use a path relative to the repository root.' }
  }

  return validateRepositoryFaviconAbsolutePath(repositoryPath, resolve(repositoryPath, trimmed))
}
