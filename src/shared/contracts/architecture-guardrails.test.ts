import { readdirSync, readFileSync, statSync } from 'fs'
import { relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = resolve(process.cwd(), 'src')
const CONTRACTS_ROOT = resolve(SOURCE_ROOT, 'shared', 'contracts')
const RENDERER_API_CLIENT = resolve(SOURCE_ROOT, 'renderer', 'src', 'shared', 'api', 'client.ts')
const MAIN_FEATURES_ROOT = resolve(SOURCE_ROOT, 'main', 'features')

function listSourceFiles(root: string): string[] {
  const entries = readdirSync(root)
  return entries.flatMap((entry) => {
    const path = resolve(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      return listSourceFiles(path)
    }
    return /\.(ts|tsx)$/u.test(entry) ? [path] : []
  })
}

function relativeSourcePath(path: string): string {
  return relative(process.cwd(), path).replaceAll('\\', '/')
}

describe('architecture guardrails', () => {
  it('keeps renderer Electron API access behind the shared client', () => {
    const offenders = listSourceFiles(resolve(SOURCE_ROOT, 'renderer', 'src')).filter((path) => {
      if (path === RENDERER_API_CLIENT) {
        return false
      }
      return readFileSync(path, 'utf8').includes('window.api')
    })

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })

  it('keeps IPC channel literals in the shared contract module', () => {
    const channelLiteralPattern = /['"`](?:app-state|terminal|native-menu):[^'"`]+['"`]/u
    const offenders = listSourceFiles(SOURCE_ROOT).filter((path) => {
      if (path.startsWith(CONTRACTS_ROOT)) {
        return false
      }
      return channelLiteralPattern.test(readFileSync(path, 'utf8'))
    })

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })

  it('keeps ipcMain.handle registration behind typed IPC', () => {
    const offenders = listSourceFiles(resolve(SOURCE_ROOT, 'main')).filter((path) => {
      if (path.endsWith('typed-ipc.ts')) {
        return false
      }
      return readFileSync(path, 'utf8').includes('ipcMain.handle')
    })

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })

  it('keeps ipcMain.on registration behind typed IPC', () => {
    const offenders = listSourceFiles(resolve(SOURCE_ROOT, 'main')).filter((path) => {
      if (path.endsWith('typed-ipc.ts')) {
        return false
      }
      return readFileSync(path, 'utf8').includes('ipcMain.on')
    })

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })

  it('keeps main-to-renderer IPC events behind typed IPC', () => {
    const offenders = listSourceFiles(resolve(SOURCE_ROOT, 'main')).filter((path) => {
      if (path.endsWith('typed-ipc.ts')) {
        return false
      }
      return /\.send\(\s*IPC_CHANNELS\./u.test(readFileSync(path, 'utf8'))
    })

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })

  it('keeps Electron UI APIs behind platform adapters', () => {
    const electronUiImportPattern =
      /import\s+(?:[\s\S]*?\b(?:BrowserWindow|Menu|clipboard|dialog|shell)\b[\s\S]*?)from ['"]electron['"]/u
    const offenders = listSourceFiles(MAIN_FEATURES_ROOT).filter((path) =>
      electronUiImportPattern.test(readFileSync(path, 'utf8'))
    )

    expect(offenders.map(relativeSourcePath)).toEqual([])
  })
})
