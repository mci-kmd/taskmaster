import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import type { HookFileReaderState } from '../providers/cli-agent-providers'
import { runGit } from '../backends/git-client'

export const TASKMASTER_SESSION_START_FILE_ENV = 'TASKMASTER_COPILOT_SESSION_START_FILE'
export const TASKMASTER_USER_PROMPT_FILE_ENV = 'TASKMASTER_COPILOT_USER_PROMPT_FILE'
export const TASKMASTER_HOOK_EVENTS_DIRNAME = 'taskmaster-hook-events'

const TASKMASTER_HOOKS_FILENAME = 'taskmaster-session-hooks.json'
const TASKMASTER_HOOK_RELATIVE_PATH = join('.github', 'hooks', TASKMASTER_HOOKS_FILENAME)
const TASKMASTER_HOOK_EXCLUDE_ENTRY = '.github/hooks/taskmaster-session-hooks.json'
const TASKMASTER_SESSION_START_HOOK_COMMAND =
  '$file=$env:TASKMASTER_COPILOT_SESSION_START_FILE; if (![string]::IsNullOrWhiteSpace($file)) { $payload=[Console]::In.ReadToEnd(); if (-not [string]::IsNullOrWhiteSpace($payload)) { Add-Content -LiteralPath $file -Value $payload } }'
const TASKMASTER_USER_PROMPT_HOOK_COMMAND =
  '$file=$env:TASKMASTER_COPILOT_USER_PROMPT_FILE; if (![string]::IsNullOrWhiteSpace($file)) { $payload=[Console]::In.ReadToEnd(); if (-not [string]::IsNullOrWhiteSpace($payload)) { Add-Content -LiteralPath $file -Value $payload } }'

function resolveGitPath(cwd: string, gitPath: string): string {
  const resolvedPath = runGit(cwd, ['rev-parse', '--git-path', gitPath])
  return isAbsolute(resolvedPath) ? resolvedPath : resolve(cwd, resolvedPath)
}

function ensureTaskmasterHookIgnored(cwd: string): void {
  const excludePath = resolveGitPath(cwd, 'info/exclude')
  mkdirSync(dirname(excludePath), { recursive: true })

  const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  const lines = current.split(/\r?\n/u).map((line) => line.trim())
  if (lines.includes(TASKMASTER_HOOK_EXCLUDE_ENTRY)) {
    return
  }

  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  writeFileSync(excludePath, `${current}${prefix}${TASKMASTER_HOOK_EXCLUDE_ENTRY}\n`)
}

export function ensureTaskmasterHookConfig(cwd: string): void {
  const hookPath = join(cwd, TASKMASTER_HOOK_RELATIVE_PATH)
  mkdirSync(dirname(hookPath), { recursive: true })

  const hookConfig = {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: 'command',
          powershell: TASKMASTER_SESSION_START_HOOK_COMMAND,
          timeoutSec: 5
        }
      ],
      userPromptSubmitted: [
        {
          type: 'command',
          powershell: TASKMASTER_USER_PROMPT_HOOK_COMMAND,
          timeoutSec: 5
        }
      ]
    }
  }

  writeFileSync(hookPath, `${JSON.stringify(hookConfig, null, 2)}\n`)
  ensureTaskmasterHookIgnored(cwd)
}

export function createHookFileReader(filePath: string): HookFileReaderState {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, '')
  return {
    filePath,
    offset: 0,
    remainder: ''
  }
}

export function readHookFile<T>(
  reader: HookFileReaderState,
  onPayload: (payload: T) => void
): void {
  if (!existsSync(reader.filePath)) {
    return
  }

  const buffer = readFileSync(reader.filePath)
  if (buffer.length < reader.offset) {
    reader.offset = 0
    reader.remainder = ''
  }
  if (buffer.length === reader.offset) {
    return
  }

  const chunk = buffer.subarray(reader.offset).toString('utf8')
  reader.offset = buffer.length

  const text = reader.remainder + chunk
  const lines = text.split(/\r?\n/u)
  reader.remainder = lines.pop() ?? ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    try {
      onPayload(JSON.parse(trimmed) as T)
    } catch {
      // Ignore malformed hook lines.
    }
  }
}

export function removeHookEventFiles(readers: Array<HookFileReaderState | null>): void {
  for (const reader of readers) {
    if (!reader) {
      continue
    }
    try {
      rmSync(reader.filePath, { force: true })
    } catch {
      // Ignore cleanup failures.
    }
  }
}
