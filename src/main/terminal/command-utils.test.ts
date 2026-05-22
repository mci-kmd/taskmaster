import { describe, expect, it } from 'vitest'
import { buildScriptCommand, quoteCmdArgument } from './command-utils'

describe('command utilities', () => {
  it('quotes cmd arguments by doubling embedded quotes', () => {
    expect(quoteCmdArgument('C:\\Program Files\\App "Beta"\\app.cmd')).toBe(
      '"C:\\Program Files\\App ""Beta""\\app.cmd"'
    )
  })

  it('builds POSIX script commands for native non-Windows execution', () => {
    const command = buildScriptCommand('bun run dev', { kind: 'native' })

    expect(command.args).toEqual(['-lc', 'bun run dev'])
    expect(command.displayCommand).toMatch(/ -lc <script>$/u)
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
