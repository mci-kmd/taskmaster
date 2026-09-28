import { describe, expect, it } from 'vitest'
import { isHttpUrl, previewElementLabel, previewPartition } from './preview'

describe('preview helpers', () => {
  it('accepts only http(s) addresses', () => {
    expect(isHttpUrl('http://localhost:5173/')).toBe(true)
    expect(isHttpUrl('https://example.test/a?b')).toBe(true)
    expect(isHttpUrl('file:///C:/index.html')).toBe(false)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('localhost:3000')).toBe(false)
  })

  it('keeps partitions persistent and sanitized per project', () => {
    expect(previewPartition('repo 1/x')).toBe('persist:taskmaster-preview-repo_1_x')
  })

  it('labels elements by name, then component, then tag', () => {
    const base = { tagName: 'button', accessibleName: null, text: '', components: [] }
    expect(previewElementLabel({ ...base, accessibleName: 'Save [draft]' })).toBe(
      'button “Save draft”'
    )
    expect(previewElementLabel({ ...base, text: 'A very long button label that goes on' })).toBe(
      'button “A very long button label th…”'
    )
    expect(previewElementLabel({ ...base, tagName: 'div', components: ['Card'] })).toBe(
      'div in Card'
    )
    expect(previewElementLabel({ ...base, tagName: 'div' })).toBe('div')
  })
})
