import type { RuntimeConnection } from '@github/copilot-sdk'

type RuntimeConnectionFactory = {
  forStdio: (options?: { path?: string; args?: readonly string[] }) => RuntimeConnection
}

export function createCopilotRuntimeConnection(
  factory: RuntimeConnectionFactory,
  runtimePath: string | null,
  globalFlags: string[]
): RuntimeConnection {
  return factory.forStdio({
    ...(runtimePath ? { path: runtimePath } : {}),
    args: globalFlags
  })
}
