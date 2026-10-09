import { describe, expect, it } from 'vitest'
import { isTaskFilterActive, matchesTaskFilter, splitHighlightSegments } from './task-filter'

const task = { title: 'Fix Login', description: 'Session expires early', tags: ['Bug'] }

describe('task filter', () => {
  it('matches the query case-insensitively against title or description', () => {
    expect(matchesTaskFilter(task, { query: ' login ', labels: [] })).toBe(true)
    expect(matchesTaskFilter(task, { query: 'EXPIRES', labels: [] })).toBe(true)
    expect(matchesTaskFilter(task, { query: 'bug', labels: [] })).toBe(false)
  })

  it('matches "#N" queries against the task number', () => {
    const numbered = { ...task, number: 12 }
    expect(matchesTaskFilter(numbered, { query: '#12', labels: [] })).toBe(true)
    expect(matchesTaskFilter(numbered, { query: '#1', labels: [] })).toBe(false)
    expect(matchesTaskFilter(task, { query: '#12', labels: [] })).toBe(false)
  })

  it('matches the linked GitHub issue, but not for "#N" queries', () => {
    const linked = { ...task, number: 1, githubIssueUrl: 'https://github.com/octo/app/issues/34' }
    expect(matchesTaskFilter(linked, { query: 'Octo/App#34', labels: [] })).toBe(true)
    expect(matchesTaskFilter(linked, { query: 'issues/34', labels: [] })).toBe(true)
    expect(matchesTaskFilter(linked, { query: '#34', labels: [] })).toBe(false)
    expect(matchesTaskFilter(task, { query: 'octo/app', labels: [] })).toBe(false)
  })

  it('matches any selected label combined with the query', () => {
    expect(matchesTaskFilter(task, { query: '', labels: ['bug'] })).toBe(true)
    expect(matchesTaskFilter(task, { query: '', labels: ['feature', 'bug'] })).toBe(true)
    expect(matchesTaskFilter(task, { query: '', labels: ['feature'] })).toBe(false)
    expect(matchesTaskFilter(task, { query: 'nope', labels: ['bug'] })).toBe(false)
  })

  it('reports whether any filter is active', () => {
    expect(isTaskFilterActive({ query: '  ', labels: [] })).toBe(false)
    expect(isTaskFilterActive({ query: 'x', labels: [] })).toBe(true)
    expect(isTaskFilterActive({ query: '', labels: ['bug'] })).toBe(true)
  })

  it('splits text into highlighted segments', () => {
    expect(splitHighlightSegments('Login and login', 'LOGIN')).toEqual([
      { text: 'Login', match: true },
      { text: ' and ', match: false },
      { text: 'login', match: true }
    ])
    expect(splitHighlightSegments('Text', '')).toEqual([{ text: 'Text', match: false }])
  })
})
