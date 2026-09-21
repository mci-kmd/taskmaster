import { RuntimeConnection } from '@github/copilot-sdk'
import { describe, expect, it } from 'vitest'
import { createCopilotRuntimeConnection } from './copilot-runtime-connection'

describe('createCopilotRuntimeConnection', () => {
  it('passes global Copilot flags to the runtime', () => {
    expect(createCopilotRuntimeConnection(RuntimeConnection, null, ['--yolo'])).toEqual({
      kind: 'stdio',
      path: undefined,
      args: ['--yolo'],
      env: undefined
    })
  })

  it('keeps the packaged runtime path when adding global flags', () => {
    expect(
      createCopilotRuntimeConnection(RuntimeConnection, 'C:\\Taskmaster\\copilot-runtime.exe', [
        '--model',
        'gpt-5'
      ])
    ).toEqual({
      kind: 'stdio',
      path: 'C:\\Taskmaster\\copilot-runtime.exe',
      args: ['--model', 'gpt-5'],
      env: undefined
    })
  })
})
