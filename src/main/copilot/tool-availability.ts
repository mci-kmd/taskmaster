import type { Tool, ToolResultObject } from '@github/copilot-sdk'

/**
 * Sessions get their tools when they open, so only enabled tools are offered then; a tool
 * turned off later refuses its calls instead.
 */
export function withToolAvailability(
  tools: Tool[],
  isEnabled: (toolName: string) => boolean
): Tool[] {
  return tools
    .filter((tool) => isEnabled(tool.name))
    .map((tool) => {
      const handler = tool.handler
      if (!handler) return tool
      return {
        ...tool,
        handler: (args, invocation) =>
          isEnabled(tool.name) ? handler(args, invocation) : turnedOff(tool.name)
      }
    })
}

function turnedOff(toolName: string): ToolResultObject {
  const message = `The ${toolName} tool has been turned off by the user.`
  return { textResultForLlm: message, resultType: 'failure', error: message }
}
