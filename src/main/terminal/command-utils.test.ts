import { describe, expect, it } from 'vitest'
import { buildScriptCommand, buildShellCommand, quoteCmdArgument } from './command-utils'

const isWindows = process.platform === 'win32'
const isUnixHost = !isWindows

describe('command utilities', () => {
  it('quotes cmd arguments by doubling embedded quotes', () => {
    expect(quoteCmdArgument('C:\\Program Files\\App "Beta"\\app.cmd')).toBe(
      '"C:\\Program Files\\App ""Beta""\\app.cmd"'
    )
  })

  it.runIf(isUnixHost)('builds POSIX script commands for native Unix execution', () => {
    const command = buildScriptCommand('bun run dev', { kind: 'native' })

    expect(command.args).toEqual(['-lc', 'bun run dev'])
    expect(command.displayCommand).toMatch(/ -lc <script>$/u)
  })

  it.runIf(isWindows)('builds native Windows script commands for the detected shell', () => {
    const shellCommand = buildShellCommand({ kind: 'native' })
    const command = buildScriptCommand('bun run dev', { kind: 'native' })

    expect(command.file).toBe(shellCommand.file)

    const shellPath = shellCommand.file.toLowerCase()
    if (shellPath.endsWith('pwsh.exe') || shellPath.endsWith('powershell.exe')) {
      expect(command.args).toEqual([
        ...shellCommand.args,
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'bun run dev'
      ])
      expect(command.displayCommand).toMatch(/ -Command <script>$/u)
      return
    }

    expect(command.args).toEqual(['/d', '/s', '/c', 'bun run dev'])
    expect(command.displayCommand).toMatch(/ \/d \/s \/c <script>$/u)
  })

  it('builds WSL script commands without wrapping in wsl.exe', () => {
    expect(
      buildScriptCommand('bun run dev', {
        kind: 'wsl',
        distro: 'Ubuntu',
        windowsPath: '\\\\wsl.localhost\\Ubuntu\\home\\me\\repo',
        linuxPath: '/home/me/repo'
      })
    ).toEqual({
      file: '/bin/sh',
      args: ['-lc', 'bun run dev'],
      displayCommand: 'sh -lc <script>'
    })
  })
})
