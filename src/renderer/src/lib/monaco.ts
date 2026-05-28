import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

const TASKMASTER_MONACO_THEME = 'taskmaster-dark'

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

monaco.editor.defineTheme(TASKMASTER_MONACO_THEME, {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#141414',
    'editor.foreground': '#ededed',
    'editorLineNumber.foreground': '#6b6b6b',
    'editorLineNumber.activeForeground': '#a3a3a3',
    'editor.selectionBackground': '#2a2a2a',
    'editor.inactiveSelectionBackground': '#232323',
    'editor.lineHighlightBackground': '#181818',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#242424',
    'editorIndentGuide.activeBackground1': '#3a3a3a'
  }
})
monaco.editor.setTheme(TASKMASTER_MONACO_THEME)

export { monaco, TASKMASTER_MONACO_THEME }
