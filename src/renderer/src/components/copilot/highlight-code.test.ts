import { expect, it } from 'vitest'
import { highlightCode } from './highlight-code'

const kinds = (code: string, language?: string): Array<[string, string | undefined]> =>
  highlightCode(code, language).map((token) => [token.text, token.kind])

it('leaves code in unknown or missing languages as one plain token', () => {
  expect(highlightCode('const a = 1', undefined)).toEqual([{ text: 'const a = 1' }])
  expect(highlightCode('const a = 1', 'brainfuck')).toEqual([{ text: 'const a = 1' }])
})

it('colors keywords, strings, numbers, comments and punctuation', () => {
  expect(kinds("const a = 'x' // note\nreturn 42;", 'ts')).toEqual([
    ['const', 'keyword'],
    [' a = ', undefined],
    ["'x'", 'string'],
    [' ', undefined],
    ['// note', 'comment'],
    ['\n', undefined],
    ['return', 'keyword'],
    [' ', undefined],
    ['42', 'number'],
    [';', 'punctuation']
  ])
})

it('marks property names in CSS and JSON, and SQL keywords in any case', () => {
  expect(kinds('--color-bg: red;', 'css')[0]).toEqual(['--color-bg', 'property'])
  expect(kinds('{"name": "x"}', 'json').slice(0, 2)).toEqual([
    ['{', 'punctuation'],
    ['"name"', 'property']
  ])
  expect(kinds('SELECT id', 'sql')[0]).toEqual(['SELECT', 'keyword'])
})

it('keeps every character, so the code reads the same', () => {
  const code = 'fn main() {\n  let s = "unterminated\n}'
  expect(
    highlightCode(code, 'rust')
      .map((token) => token.text)
      .join('')
  ).toBe(code)
})
