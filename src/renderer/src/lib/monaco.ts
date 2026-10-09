import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import {
  canResolveColors,
  mixColors,
  readThemeRgba,
  toHex,
  withAlpha,
  type Rgba
} from './canvas-colors'

const TASKMASTER_MONACO_THEME = 'taskmaster'

const globalScope = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker
  }
}

globalScope.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'json') {
      return new jsonWorker()
    }
    if (label === 'css' || label === 'scss' || label === 'less') {
      return new cssWorker()
    }
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker()
    }
    return new editorWorker()
  }
}

const jsDiagnostics = {
  noSemanticValidation: true,
  noSyntaxValidation: true,
  noSuggestionDiagnostics: true
}

monaco.typescript.javascriptDefaults.setDiagnosticsOptions(jsDiagnostics)
monaco.typescript.typescriptDefaults.setDiagnosticsOptions(jsDiagnostics)
monaco.css.cssDefaults.setOptions({
  ...(monaco.css.cssDefaults.options ?? {}),
  validate: false
})
monaco.css.scssDefaults.setOptions({
  ...(monaco.css.scssDefaults.options ?? {}),
  validate: false
})
monaco.css.lessDefaults.setOptions({
  ...(monaco.css.lessDefaults.options ?? {}),
  validate: false
})
monaco.css.cssDefaults.setModeConfiguration({
  ...(monaco.css.cssDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.css.scssDefaults.setModeConfiguration({
  ...(monaco.css.scssDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.css.lessDefaults.setModeConfiguration({
  ...(monaco.css.lessDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.html.htmlDefaults.setModeConfiguration({
  ...(monaco.html.htmlDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.html.handlebarDefaults.setModeConfiguration({
  ...(monaco.html.handlebarDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.html.razorDefaults.setModeConfiguration({
  ...(monaco.html.razorDefaults.modeConfiguration ?? {}),
  diagnostics: false
})
monaco.json.jsonDefaults.setDiagnosticsOptions({
  ...monaco.json.jsonDefaults.diagnosticsOptions,
  validate: false
})
monaco.json.jsonDefaults.setModeConfiguration({
  ...monaco.json.jsonDefaults.modeConfiguration,
  diagnostics: false
})

/**
 * Defines the editor theme from the active app theme's tokens and applies it. Monaco only takes
 * concrete colors, so tokens are resolved to hex; call again whenever the app theme changes.
 */
function applyMonacoTheme(appearance: 'dark' | 'light'): void {
  if (!canResolveColors()) return
  const token = (name: string): Rgba => readThemeRgba(`--color-${name}`)
  const hex = (name: string): string => toHex(token(name))
  // Token rules take colors without the leading '#'.
  const rule = (
    scope: string,
    name: string,
    fontStyle?: string
  ): monaco.editor.ITokenThemeRule => ({
    token: scope,
    foreground: toHex(withAlpha(token(name), 1)).slice(1),
    ...(fontStyle ? { fontStyle } : {})
  })
  const panel = token('panel')
  const fg = token('fg')
  const accent = token('accent')
  const tint = (color: Rgba, amount: number): string => toHex(mixColors(color, panel, amount))

  monaco.editor.defineTheme(TASKMASTER_MONACO_THEME, {
    base: appearance === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      rule('', 'fg'),
      rule('comment', 'syntax-comment', 'italic'),
      rule('keyword', 'syntax-keyword'),
      rule('tag', 'syntax-keyword'),
      rule('string', 'syntax-string'),
      rule('attribute.value', 'syntax-string'),
      rule('regexp', 'syntax-string'),
      rule('number', 'syntax-number'),
      rule('type', 'syntax-property'),
      rule('attribute.name', 'syntax-property'),
      rule('string.key.json', 'syntax-property'),
      rule('delimiter', 'syntax-punctuation')
    ],
    colors: {
      'editor.background': toHex(panel),
      'editor.foreground': toHex(fg),
      'editorLineNumber.foreground': hex('fg-faint'),
      'editorLineNumber.activeForeground': hex('fg-muted'),
      'editorCursor.foreground': toHex(accent),
      'editor.selectionBackground': toHex(withAlpha(accent, 0.28)),
      'editor.inactiveSelectionBackground': toHex(withAlpha(accent, 0.14)),
      'editor.selectionHighlightBackground': toHex(withAlpha(accent, 0.12)),
      'editor.lineHighlightBackground': tint(fg, 0.04),
      'editor.lineHighlightBorder': toHex(withAlpha(panel, 0)),
      'editor.findMatchBackground': toHex(withAlpha(token('warning'), 0.4)),
      'editor.findMatchHighlightBackground': toHex(withAlpha(token('warning'), 0.2)),
      'editor.rangeHighlightBackground': toHex(withAlpha(accent, 0.16)),
      'editorIndentGuide.background1': hex('border'),
      'editorIndentGuide.activeBackground1': hex('border-strong'),
      'editorWhitespace.foreground': hex('border-strong'),
      'editorWidget.background': hex('popover'),
      'editorWidget.border': hex('border-strong'),
      'editorWidget.foreground': toHex(fg),
      'input.background': hex('input'),
      focusBorder: toHex(withAlpha(accent, 0.6)),
      'scrollbarSlider.background': toHex(withAlpha(fg, 0.12)),
      'scrollbarSlider.hoverBackground': toHex(withAlpha(fg, 0.2)),
      'scrollbarSlider.activeBackground': toHex(withAlpha(fg, 0.28)),
      'scrollbar.shadow': toHex(withAlpha(panel, 0)),
      'editorBracketHighlight.foreground1': hex('syntax-number'),
      'editorBracketHighlight.foreground2': hex('syntax-keyword'),
      'editorBracketHighlight.foreground3': hex('syntax-property'),
      'editorBracketMatch.background': toHex(withAlpha(accent, 0.16)),
      'editorBracketMatch.border': toHex(withAlpha(accent, 0.5))
    }
  })
  monaco.editor.setTheme(TASKMASTER_MONACO_THEME)
}

// Editors re-apply it for the theme they mount in (MonacoFileEditor).
applyMonacoTheme(
  getComputedStyle(document.documentElement).colorScheme === 'light' ? 'light' : 'dark'
)

export { applyMonacoTheme, monaco, TASKMASTER_MONACO_THEME }
