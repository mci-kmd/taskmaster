import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../../../shared/themes'

const read = (file: string): string => readFileSync(join(__dirname, file), 'utf8')
const themesCss = read('themes.css')
const tokensCss = read('tokens.css')

function themeBlock(id: string): string {
  const match = themesCss.match(new RegExp(`\\[data-theme='${id}'\\] \\{([\\s\\S]*?)\\n\\}`))
  if (!match) throw new Error(`No block for theme ${id}`)
  return match[1]
}

function declaredNames(css: string): Set<string> {
  return new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]))
}

// Tokens every theme must define itself; the shared [data-theme] block derives the rest.
const derived = declaredNames(themesCss.slice(themesCss.indexOf('[data-theme] {')))
const registered = [...declaredNames(tokensCss.slice(0, tokensCss.indexOf('@theme {')))].filter(
  (name) => !derived.has(name)
)
const required = [
  ...registered,
  '--color-shadow',
  '--elevation-card',
  '--elevation-raised',
  '--elevation-pop',
  '--elevation-inset',
  '--elevation-accent',
  '--sidebar-elevation',
  '--sidebar-inset',
  '--workspace-elevation'
]

describe('themes', () => {
  it.each(THEMES.map((theme) => theme.id))('%s defines every themed token', (id) => {
    const names = declaredNames(themeBlock(id))
    expect(required.filter((name) => !names.has(name))).toEqual([])
  })

  it.each(THEMES.map((theme) => [theme.id, theme.background]))(
    '%s paints the window with its backdrop color',
    (id, background) => {
      expect(themeBlock(id)).toMatch(new RegExp(`--color-bg: ${background};`))
    }
  )
})
