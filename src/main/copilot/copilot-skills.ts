import type { CopilotSession } from '@github/copilot-sdk'
import type { CopilotSkill } from '../../shared/app-types'

export async function listSessionSkills(session: CopilotSession): Promise<CopilotSkill[]> {
  const { skills } = await session.rpc.skills.list()
  const seen = new Set<string>()
  return skills
    .filter((skill) => skill.enabled && skill.userInvocable)
    .map((skill) => ({
      name: skill.name,
      commandName: skill.commandName ?? skill.name,
      description: skill.description,
      source: skill.source,
      argumentHint: skill.argumentHint
    }))
    .filter((skill) => {
      const key = skill.commandName.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.commandName.localeCompare(b.commandName))
}

// Only invoke catalogued skills, never arbitrary CLI commands with host-side effects.
export async function expandSkillPrompt(
  session: CopilotSession,
  prompt: string
): Promise<{ prompt: string; displayPrompt?: string }> {
  const leading = /^\s*[/$]([^\s]+)(?:\s+([\s\S]*))?$/.exec(prompt)
  const references = [...prompt.matchAll(/(?:^|\s)\$([\w:./-]+)/g)].map((match) => match[1])
  if (!leading && !references.length) return { prompt }
  const { skills } = await session.rpc.skills.list()
  const names = [
    ...new Set([...(leading ? [leading[1]] : []), ...references].map((name) => name.toLowerCase()))
  ]
  const selected = names.flatMap((name) => {
    const skill = skills.find(
      (candidate) => (candidate.commandName ?? candidate.name).toLowerCase() === name
    )
    return skill ? [skill] : []
  })
  if (!selected.length) return { prompt }
  // Validate every reference before invoking any of them.
  for (const skill of selected) {
    if (!skill.enabled || !skill.userInvocable) {
      throw new Error(
        `The skill /${skill.commandName ?? skill.name} is not available for manual invocation.`
      )
    }
  }
  const expanded: string[] = []
  for (const skill of selected) {
    const commandName = skill.commandName ?? skill.name
    const result = await session.rpc.commands.invoke({
      name: commandName,
      input:
        leading && selected.length === 1 && leading[1].toLowerCase() === commandName.toLowerCase()
          ? (leading[2] ?? '')
          : prompt
    })
    if (result.kind !== 'agent-prompt') {
      throw new Error(
        `The skill /${commandName} did not return a prompt. Your message has not been sent.`
      )
    }
    expanded.push(result.prompt)
  }
  // Preserve the surrounding request when references occur inside a message.
  if (!leading || selected.length > 1) expanded.push(prompt)
  return { prompt: expanded.join('\n\n'), displayPrompt: prompt }
}
