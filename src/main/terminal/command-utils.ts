import { accessSync, constants as fsConstants, statSync } from 'fs'
import { spawnSync } from 'child_process'
import { basename, delimiter, join } from 'path'
import type { RepositoryBackend } from '../../shared/app-types'
import { createNativeBackend } from '../backends/repository-backend'

export type ProcessCommand = {
  file: string
  args: string[]
  displayCommand: string
}

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false
    }
    if (process.platform === 'win32') {
      return true
    }
    accessSync(path, fsConstants.X_OK)
    return true
  } catch {
    return false
  }
}

export function resolveCommandOnPath(commandName: string): string | null {
  if (commandName.includes('/') || commandName.includes('\\')) {
    return isExecutableFile(commandName) ? commandName : null
  }

  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', [commandName], {
      encoding: 'utf8',
      windowsHide: true
    })

    if (result.status !== 0) {
      return null
    }

    const matches = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (matches.length === 0) {
      return null
    }

    const executableMatch = matches.find((match) => /\.(exe|cmd|bat|com)$/i.test(match))
    return executableMatch ?? matches[0] ?? null
  }

  const fallbackPathEntries =
    process.platform === 'darwin'
      ? ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']
      : ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']

  for (const pathEntry of [
    ...new Set([...(process.env.PATH ?? '').split(delimiter), ...fallbackPathEntries])
  ]) {
    if (!pathEntry) {
      continue
    }

    const candidate = join(pathEntry, commandName)
    if (isExecutableFile(candidate)) {
      return candidate
    }
  }

  return null
}

export function quoteCmdArgument(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

export function buildShellCommand(
  backend: RepositoryBackend = createNativeBackend()
): ProcessCommand {
  if (backend.kind === 'wsl') {
    return {
      file: '/bin/sh',
      args: [],
      displayCommand: 'sh'
    }
  }

  if (process.platform !== 'win32') {
    const configuredShell = process.env.SHELL
    if (configuredShell && isExecutableFile(configuredShell)) {
      return {
        file: configuredShell,
        args: [],
        displayCommand: basename(configuredShell)
      }
    }

    return {
      file: '/bin/sh',
      args: [],
      displayCommand: 'sh'
    }
  }

  const pwshPath = resolveCommandOnPath('pwsh')
  if (pwshPath) {
    return {
      file: pwshPath,
      args: ['-NoLogo'],
      displayCommand: 'pwsh -NoLogo'
    }
  }

  const powershellPath = resolveCommandOnPath('powershell')
  if (powershellPath) {
    return {
      file: powershellPath,
      args: ['-NoLogo'],
      displayCommand: 'powershell -NoLogo'
    }
  }

  const cmdPath = process.env.ComSpec ?? process.env.COMSPEC ?? 'C:\\Windows\\System32\\cmd.exe'
  return {
    file: cmdPath,
    args: [],
    displayCommand: 'cmd'
  }
}

export function buildScriptCommand(
  script: string,
  backend: RepositoryBackend = createNativeBackend()
): ProcessCommand {
  if (backend.kind === 'wsl') {
    return {
      file: '/bin/sh',
      args: ['-lc', script],
      displayCommand: 'sh -lc <script>'
    }
  }

  if (process.platform !== 'win32') {
    const shellPath =
      process.env.SHELL && isExecutableFile(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
    return {
      file: shellPath,
      args: ['-lc', script],
      displayCommand: `${basename(shellPath)} -lc <script>`
    }
  }

  const shellCommand = buildShellCommand()
  const shellPath = shellCommand.file.toLowerCase()
  if (shellPath.endsWith('pwsh.exe') || shellPath.endsWith('powershell.exe')) {
    return {
      file: shellCommand.file,
      args: [...shellCommand.args, '-NoProfile', '-NonInteractive', '-Command', script],
      displayCommand: `${shellCommand.displayCommand} -Command <script>`
    }
  }

  return {
    file: shellCommand.file,
    args: ['/d', '/s', '/c', script],
    displayCommand: `${shellCommand.displayCommand} /d /s /c <script>`
  }
}
