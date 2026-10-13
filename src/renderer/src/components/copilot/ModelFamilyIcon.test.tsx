// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import ModelFamilyIcon from './ModelFamilyIcon'

afterEach(cleanup)

describe('ModelFamilyIcon', () => {
  it('shows a logo per family and shares OpenAI’s between GPT and the o-series', () => {
    const markup = (family: string): string =>
      render(<ModelFamilyIcon family={family} />).container.innerHTML
    const families = ['Claude', 'GPT', 'Gemini', 'Grok', 'Raptor', 'Other models']
    expect(new Set(families.map(markup)).size).toBe(families.length)
    expect(markup('OpenAI o-series')).toBe(markup('GPT'))
  })

  it('gives each Gemini logo its own mask and filter ids', () => {
    const { container } = render(
      <>
        <ModelFamilyIcon family="Gemini" />
        <ModelFamilyIcon family="Gemini" />
      </>
    )
    const ids = [...container.querySelectorAll('[id]')].map((element) => element.id)
    expect(ids).toHaveLength(16)
    expect(new Set(ids).size).toBe(16)
    for (const group of container.querySelectorAll('g[mask]')) {
      const id = /^url\(#(.+)\)$/.exec(group.getAttribute('mask') ?? '')?.[1]
      expect(id && container.querySelector(`[id="${id}"]`)?.tagName).toBe('mask')
    }
  })
})
