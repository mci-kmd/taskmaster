/** Token kinds, each colored by a --color-syntax-* token (see .tm-syntax-* in session.css). */
export type SyntaxKind = 'keyword' | 'property' | 'string' | 'number' | 'comment' | 'punctuation'
export type SyntaxToken = { text: string; kind?: SyntaxKind }

type Grammar = {
  comment: RegExp[]
  keywords: Set<string>
  /** Matches a property name before `:` (CSS, JSON, YAML). */
  property?: RegExp
  ignoreCase?: boolean
}

const words = (list: string): Set<string> => new Set(list.split(/\s+/).filter(Boolean))

const C_COMMENTS = [/\/\/[^\n]*/y, /\/\*[\s\S]*?(?:\*\/|$)/y]
const HASH_COMMENTS = [/#[^\n]*/y]

const SCRIPT = words(`
  abstract as async await break case catch class const continue debugger declare default delete do
  else enum export extends false finally for from function get if implements import in instanceof
  interface keyof let new null of package private protected public readonly return satisfies set
  static super switch this throw true try type typeof undefined var void while with yield
`)
const SYSTEMS = words(`
  as async await bool break case catch char class const continue default defer do double else enum
  extern false final fn for func go if impl import int interface let long loop match mod move mut
  namespace new nil null override package private protected pub public return self Self short static
  string struct super switch template this throw trait true try type typedef union unsafe use using
  var virtual void where while
`)
const PYTHON = words(`
  and as assert async await break class continue def del elif else except False finally for from
  global if import in is lambda None nonlocal not or pass raise return self True try while with yield
`)
const SHELL = words(`
  case do done echo elif else esac exit export fi for function if in local return set then unset until
  while
`)
const SQL = words(`
  and as asc by create delete desc distinct drop from group having in index inner insert into is join
  left limit not null on or order outer primary references right select set table union update values
  where
`)

const GRAMMARS: Record<string, Grammar> = {
  script: { comment: C_COMMENTS, keywords: SCRIPT },
  systems: { comment: C_COMMENTS, keywords: SYSTEMS },
  css: {
    comment: [/\/\*[\s\S]*?(?:\*\/|$)/y],
    keywords: words('important inherit initial none auto'),
    property: /--?[a-zA-Z][\w-]*(?=\s*:)/y
  },
  json: { comment: C_COMMENTS, keywords: words('true false null'), property: /"[^"\n]*"(?=\s*:)/y },
  yaml: {
    comment: HASH_COMMENTS,
    keywords: words('true false null yes no'),
    property: /[\w.-]+(?=\s*:(?:\s|$))/y
  },
  python: { comment: HASH_COMMENTS, keywords: PYTHON },
  shell: { comment: HASH_COMMENTS, keywords: SHELL },
  sql: { comment: [/--[^\n]*/y], keywords: SQL, ignoreCase: true }
}

const LANGUAGES: Record<string, keyof typeof GRAMMARS> = {
  js: 'script',
  jsx: 'script',
  javascript: 'script',
  mjs: 'script',
  cjs: 'script',
  ts: 'script',
  tsx: 'script',
  typescript: 'script',
  c: 'systems',
  cpp: 'systems',
  'c++': 'systems',
  cs: 'systems',
  csharp: 'systems',
  go: 'systems',
  java: 'systems',
  kotlin: 'systems',
  rust: 'systems',
  rs: 'systems',
  swift: 'systems',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'yaml',
  py: 'python',
  python: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shell: 'shell',
  ps1: 'shell',
  powershell: 'shell',
  sql: 'sql'
}

const STRING = /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\.|[^`\\])*`?/y
const NUMBER = /(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?)\b/y
const WORD = /[A-Za-z_$][\w$]*/y
const PUNCTUATION = /[{}()[\];,.:]/y

function matchAt(pattern: RegExp, text: string, index: number): string | null {
  pattern.lastIndex = index
  return pattern.exec(text)?.[0] || null
}

/**
 * A small, dependency-free highlighter for code blocks in Copilot's answers. It only knows
 * comments, strings, numbers, keywords and punctuation, which is enough to color the common
 * languages; unknown languages are returned as one plain token.
 */
export function highlightCode(code: string, language?: string): SyntaxToken[] {
  const grammar = language ? GRAMMARS[LANGUAGES[language.toLowerCase()]] : undefined
  if (!grammar) return [{ text: code }]
  const tokens: SyntaxToken[] = []
  let plain = ''
  const push = (text: string, kind: SyntaxKind | undefined): void => {
    if (!kind) {
      plain += text
      return
    }
    if (plain) tokens.push({ text: plain })
    plain = ''
    tokens.push({ text, kind })
  }

  let index = 0
  while (index < code.length) {
    let match: string | null = null
    for (const pattern of grammar.comment) {
      match = matchAt(pattern, code, index)
      if (match) {
        push(match, 'comment')
        break
      }
    }
    if (match) {
      index += match.length
      continue
    }
    if (grammar.property && (match = matchAt(grammar.property, code, index))) {
      push(match, 'property')
    } else if ((match = matchAt(STRING, code, index))) {
      push(match, 'string')
    } else if ((match = matchAt(NUMBER, code, index))) {
      push(match, 'number')
    } else if ((match = matchAt(WORD, code, index))) {
      const word = grammar.ignoreCase ? match.toLowerCase() : match
      push(match, grammar.keywords.has(word) ? 'keyword' : undefined)
    } else if ((match = matchAt(PUNCTUATION, code, index))) {
      push(match, 'punctuation')
    } else {
      match = code[index]
      push(match, undefined)
    }
    index += match.length
  }
  if (plain) tokens.push({ text: plain })
  return tokens
}
