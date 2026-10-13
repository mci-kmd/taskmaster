import { describe, expect, it } from 'vitest'
import {
  applyMarkerEdit,
  collapsePastedText,
  expandPastedText,
  insertAttachmentMarkers,
  removeAttachmentMarkers,
  snapOutOfMarker,
  splitAttachmentMarkers,
  stripAttachmentMarkers,
  uniqueAttachmentName
} from './attachment-markers'
import { promptHistory } from './composer-history'

describe('attachment markers', () => {
  it('inserts markers at the caret with surrounding spaces', () => {
    expect(insertAttachmentMarkers('ab', ['x.png'], 1)).toEqual({
      prompt: 'a [📎 x.png] b',
      caret: 13
    })
    expect(insertAttachmentMarkers('', ['a', 'b'], 0).prompt).toBe('[📎 a] [📎 b] ')
    expect(insertAttachmentMarkers('see  now', ['a'], 4).prompt).toBe('see [📎 a] now')
    expect(insertAttachmentMarkers('replace me', ['a'], 0, 7).prompt).toBe('[📎 a] me')
  })

  it('removes markers without leaving doubled or joined words', () => {
    expect(removeAttachmentMarkers('a [📎 x.png] b', 'x.png')).toBe('a b')
    expect(removeAttachmentMarkers('[📎 x.png] b', 'x.png')).toBe('b')
    expect(removeAttachmentMarkers('a [📎 x.png]', 'x.png')).toBe('a')
    expect(removeAttachmentMarkers('a[📎 x.png] b', 'x.png')).toBe('a b')
    expect(removeAttachmentMarkers('a [📎 x.png]\nb', 'x.png')).toBe('a\nb')
    expect(removeAttachmentMarkers('keep [📎 y.png]', 'x.png')).toBe('keep [📎 y.png]')
  })

  it('numbers duplicate names before the extension', () => {
    expect(uniqueAttachmentName('image.png', ['image.png', 'image (2).png'])).toBe('image (3).png')
    expect(uniqueAttachmentName('README', ['README'])).toBe('README (2)')
  })

  it('splits only known attachment markers, preferring the longest name', () => {
    expect(
      splitAttachmentMarkers('[📎 a.png] and [📎 a.png.txt] [📎 other]', ['a.png', 'a.png.txt'])
    ).toEqual([
      { attachment: 'a.png' },
      { text: ' and ' },
      { attachment: 'a.png.txt' },
      { text: ' [📎 other]' }
    ])
  })

  it('edits markers as a whole', () => {
    const prompt = 'See [📎 a.png] now'
    const end = 'See [📎 a.png]'.length
    const names = ['a.png']
    const backspace = prompt.slice(0, end - 1) + prompt.slice(end)
    expect(applyMarkerEdit(prompt, backspace, names, end - 1)).toEqual({
      prompt: 'See now',
      caret: 4
    })
    const del = prompt.slice(0, 4) + prompt.slice(5)
    expect(applyMarkerEdit(prompt, del, names, 4)).toEqual({ prompt: 'See now', caret: 4 })
    const typed = prompt.slice(0, 8) + 'x' + prompt.slice(8)
    expect(applyMarkerEdit(prompt, typed, names, 9)).toEqual({
      prompt: 'See [📎 a.png]x now',
      caret: end + 1
    })
    const overlap = 'Sey' + prompt.slice(10)
    expect(applyMarkerEdit(prompt, overlap, names, 3)).toEqual({ prompt: 'Sey now', caret: 3 })
    expect(applyMarkerEdit(prompt, 'See [📎 a.png] now!', names, 19)).toBeNull()
    expect(applyMarkerEdit(prompt, 'See  now', names, 4)).toBeNull()
  })

  it('moves carets out of markers to the nearest edge', () => {
    expect(snapOutOfMarker('a [📎 x.png] b', ['x.png'], 4)).toBe(2)
    expect(snapOutOfMarker('a [📎 x.png] b', ['x.png'], 10)).toBe(12)
    expect(snapOutOfMarker('a [📎 x.png] b', ['x.png'], 12)).toBe(12)
  })

  it('drops markers from recalled prompts', () => {
    expect(stripAttachmentMarkers('  untouched  ', [])).toBe('  untouched  ')
    expect(
      promptHistory([
        {
          id: 'a',
          type: 'user',
          content: 'Fix [📎 x.png] now',
          attachments: ['x.png'],
          timestamp: ''
        },
        { id: 'b', type: 'user', content: '[📎 y.png]', attachments: ['y.png'], timestamp: '' }
      ])
    ).toEqual([{ id: 'a', prompt: 'Fix now' }])
  })

  it('collapses pastes longer than 15 lines, ignoring a final line break', () => {
    const lines = (count: number): string =>
      Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\r\n')
    expect(collapsePastedText(lines(15))).toBeNull()
    expect(collapsePastedText(`${lines(15)}\r\n`)).toBeNull()
    expect(collapsePastedText(`${lines(16)}\r\n`)).toMatchObject({
      type: 'text',
      displayName: 'Pasted text, 16 lines',
      text: `${lines(16).replaceAll('\r\n', '\n')}\n`
    })
  })

  it('sends pasted text in place of its marker and keeps files attached', () => {
    const file = { id: 'f', type: 'file' as const, path: '/a.png', displayName: 'a.png' }
    const pasted = {
      id: 't',
      type: 'text' as const,
      displayName: 'Pasted text, 16 lines',
      text: 'a\nb'
    }
    expect(
      expandPastedText('Fix [📎 Pasted text, 16 lines] using [📎 a.png]', [pasted, file])
    ).toEqual({ prompt: 'Fix a\nb using [📎 a.png]', attachments: [file] })
    expect(expandPastedText('Only [📎 a.png]', [file])).toEqual({
      prompt: 'Only [📎 a.png]',
      attachments: [file]
    })
  })
})
