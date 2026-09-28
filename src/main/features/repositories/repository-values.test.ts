import { describe, expect, it } from 'vitest'
import {
  normalizeRepositoryPreviewUrl,
  validateRepositoryPreviewUrlInput
} from './repository-values'

describe('repository preview URL values', () => {
  it('keeps http(s) addresses with branch tokens', () => {
    expect(normalizeRepositoryPreviewUrl(' http://localhost:{BRANCH-PORT}/ ')).toBe(
      'http://localhost:{BRANCH-PORT}/'
    )
    expect(normalizeRepositoryPreviewUrl('https://{BRANCH-NAME-SAFE}.app.test')).toBe(
      'https://{BRANCH-NAME-SAFE}.app.test'
    )
  })

  it('drops empty or non-http persisted values', () => {
    expect(normalizeRepositoryPreviewUrl('')).toBeNull()
    expect(normalizeRepositoryPreviewUrl(42)).toBeNull()
    expect(normalizeRepositoryPreviewUrl('file:///C:/index.html')).toBeNull()
    expect(normalizeRepositoryPreviewUrl('localhost:3000')).toBeNull()
  })

  it('clears blank input and rejects invalid input', () => {
    expect(validateRepositoryPreviewUrlInput('  ')).toEqual({ ok: true, url: null })
    expect(validateRepositoryPreviewUrlInput(null)).toEqual({ ok: true, url: null })
    expect(validateRepositoryPreviewUrlInput('ftp://host')).toMatchObject({ ok: false })
  })
})
