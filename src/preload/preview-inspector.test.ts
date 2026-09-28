// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  accessibleName,
  buildPiercingSelector,
  buildSelector,
  describeElement,
  implicitRole,
  inspectableTarget,
  looksGenerated
} from './preview-inspector'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('preview inspector', () => {
  it('prefers test ids and stable ids over structural selectors', () => {
    document.body.innerHTML = `
      <main>
        <button data-testid="save">Save</button>
        <section id="profile"><p>One</p><p class="note">Two</p><p class="note">Three</p></section>
        <div id=":r1:"><span class="css-1x2y3z4">Generated</span></div>
      </main>`
    const [, second, third] = Array.from(document.querySelectorAll('#profile p'))
    expect(buildSelector(document.querySelector('button')!)).toBe('button[data-testid="save"]')
    expect(buildSelector(second!)).toBe('p.note:nth-of-type(2)')
    document.body.insertAdjacentHTML(
      'beforeend',
      '<aside><p class="note">x</p><p class="note">y</p><p class="note">z</p></aside>'
    )
    expect(buildSelector(third!)).toBe('#profile > p.note:nth-of-type(3)')
    const generated = document.querySelector('span')!
    const selector = buildSelector(generated)
    expect(selector).not.toContain(':r1:')
    expect(selector).not.toContain('css-1x2y3z4')
    expect(document.querySelectorAll(selector)).toHaveLength(1)
  })

  it('detects framework-generated names', () => {
    expect(looksGenerated(':r5:')).toBe(true)
    expect(looksGenerated('radix-12')).toBe(true)
    expect(looksGenerated('Button_primary__a1b2c')).toBe(true)
    expect(looksGenerated('primary-button')).toBe(false)
    expect(looksGenerated('h1')).toBe(false)
  })

  it('crosses open shadow roots', () => {
    document.body.innerHTML = '<my-card id="card"></my-card>'
    const root = document.getElementById('card')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<button class="primary">Buy</button>'
    expect(buildPiercingSelector(root.querySelector('button')!)).toBe('#card >>> button.primary')
  })

  it('derives roles and accessible names', () => {
    document.body.innerHTML = `
      <label for="email">Email address</label><input id="email" />
      <a>Plain</a><a href="/x" aria-label="Go home">⌂</a>
      <h2 id="title">Billing</h2><div role="dialog tabpanel" aria-labelledby="title"></div>
      <input type="checkbox" title="Remember me" />`
    const input = document.getElementById('email')!
    expect([implicitRole(input), accessibleName(input)]).toEqual(['textbox', 'Email address'])
    const [plain, home] = Array.from(document.querySelectorAll('a'))
    expect(implicitRole(plain!)).toBeNull()
    expect([implicitRole(home!), accessibleName(home!)]).toEqual(['link', 'Go home'])
    const dialog = document.querySelector('[role]')!
    expect([implicitRole(dialog), accessibleName(dialog)]).toEqual(['dialog', 'Billing'])
    const checkbox = document.querySelector('[type=checkbox]')!
    expect([implicitRole(checkbox), accessibleName(checkbox)]).toEqual(['checkbox', 'Remember me'])
  })

  it('selects icons instead of their inner shapes', () => {
    document.body.innerHTML = '<button><svg><path d="M0 0"/></svg></button>'
    expect(inspectableTarget(document.querySelector('path'))?.localName).toBe('svg')
    expect(inspectableTarget(document.querySelector('button'))?.localName).toBe('button')
    expect(inspectableTarget(null)).toBeNull()
  })

  it('describes the picked element for the host', () => {
    document.title = 'Shop'
    document.body.innerHTML = `<button data-testid="buy">  Buy   now </button>`
    const button = document.querySelector('button')!
    button.getBoundingClientRect = () =>
      ({ left: 10.4, top: 20.6, width: 99.5, height: 30 }) as DOMRect
    expect(
      describeElement(button, {
        innerWidth: 800,
        innerHeight: 600,
        location: { href: 'http://localhost:3000/' } as Location
      })
    ).toEqual({
      pageUrl: 'http://localhost:3000/',
      pageTitle: 'Shop',
      selector: 'button[data-testid="buy"]',
      tagName: 'button',
      role: 'button',
      accessibleName: 'Buy now',
      text: 'Buy now',
      html: '<button data-testid="buy">  Buy   now </button>',
      rect: { x: 10, y: 21, width: 100, height: 30 },
      viewport: { width: 800, height: 600 }
    })
  })
})
