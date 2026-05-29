import { existsSync, statSync } from 'fs'
import { extname, isAbsolute, normalize, relative, resolve } from 'path'
import { isPathInsideRepository } from './repository-path-utils'

type RelativePathResult = { ok: true; path: string } | { ok: false; error: string }

const REPOSITORY_SOLUTION_FILE_EXTENSIONS = new Set(['.sln', '.slnx'])

export function normalizeRepositorySolutionFilePath(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? ''
  return normalized.length > 0 ? normalized : null
}

export function resolveRepositorySolutionFilePath(
  repositoryPath: string,
  relativePath: string | null | undefined
): string | null {
  const normalizedPath = normalizeRepositorySolutionFilePath(relativePath)
  if (!normalizedPath || isAbsolute(normalizedPath)) {
    return null
  }

  const candidatePath = normalize(resolve(repositoryPath, normalizedPath))
  if (!isPathInsideRepository(repositoryPath, candidatePath)) {
    return null
  }

  if (!existsSync(candidatePath) || !statSync(candidatePath).isFile()) {
    return null
  }

  return REPOSITORY_SOLUTION_FILE_EXTENSIONS.has(extname(candidatePath).toLowerCase())
    ? candidatePath
    : null
}

export function validateRepositorySolutionFileInput(
  repositoryPath: string,
  input: string | null
): RelativePathResult | { ok: true; path: null } {
  const normalizedPath = normalizeRepositorySolutionFilePath(input)
  if (!normalizedPath) {
    return { ok: true, path: null }
  }

  if (isAbsolute(normalizedPath)) {
    return { ok: false, error: 'Use a path relative to the repository root.' }
  }

  const candidatePath = normalize(resolve(repositoryPath, normalizedPath))
  if (!isPathInsideRepository(repositoryPath, candidatePath)) {
    return { ok: false, error: 'Solution file must be inside the repository.' }
  }

  if (!existsSync(candidatePath)) {
    return { ok: false, error: 'Solution file not found.' }
  }

  if (!statSync(candidatePath).isFile()) {
    return { ok: false, error: 'Solution path must point to a file.' }
  }

  if (!REPOSITORY_SOLUTION_FILE_EXTENSIONS.has(extname(candidatePath).toLowerCase())) {
    return { ok: false, error: 'Unsupported solution file. Use .sln or .slnx.' }
  }

  return {
    ok: true,
    path: normalize(relative(repositoryPath, candidatePath))
  }
}

export function validateRepositorySolutionFileAbsolutePath(
  repositoryPath: string,
  candidatePath: string
): RelativePathResult {
  const normalizedCandidate = normalize(candidatePath)
  if (!isPathInsideRepository(repositoryPath, normalizedCandidate)) {
    return { ok: false, error: 'Solution file must be inside the repository.' }
  }

  if (!existsSync(normalizedCandidate)) {
    return { ok: false, error: 'Solution file not found.' }
  }

  if (!statSync(normalizedCandidate).isFile()) {
    return { ok: false, error: 'Solution path must point to a file.' }
  }

  if (!REPOSITORY_SOLUTION_FILE_EXTENSIONS.has(extname(normalizedCandidate).toLowerCase())) {
    return { ok: false, error: 'Unsupported solution file. Use .sln or .slnx.' }
  }

  return {
    ok: true,
    path: normalize(relative(repositoryPath, normalizedCandidate))
  }
}
