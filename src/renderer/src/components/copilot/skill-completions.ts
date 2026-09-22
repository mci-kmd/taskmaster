import type { CopilotSkill } from '../../../../shared/app-types'

export type SkillTrigger = { query: string; start: number; end: number; prefix: '/' | '$' }

// Slash skills start a message; T3-style dollar references can appear anywhere.
export function skillTrigger(prompt: string, caret: number): SkillTrigger | null {
  const before = prompt.slice(0, caret)
  const match = /(?:^|\s)([/$])([^\s]*)$/.exec(before)
  if (!match) return null
  const start = caret - match[2].length - 1
  const prefix = match[1] as '/' | '$'
  if (prefix === '/' && prompt.slice(0, start).trim()) return null
  const end = caret + (/^[^\s]*/.exec(prompt.slice(caret))?.[0].length ?? 0)
  return { query: match[2], start, end, prefix }
}

export function searchSkills(skills: CopilotSkill[], query: string): CopilotSkill[] {
  const term = query.toLowerCase()
  const score = (skill: CopilotSkill): number => {
    const name = skill.commandName.toLowerCase()
    if (name === term) return 0
    if (name.startsWith(term)) return 1
    if (name.includes(term)) return 2
    if (`${skill.name} ${skill.description}`.toLowerCase().includes(term)) return 3
    let index = 0
    for (const char of name) if (char === term[index]) index++
    return index === term.length ? 4 : Infinity
  }
  return skills
    .map((skill) => ({ skill, score: score(skill) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score || a.skill.commandName.localeCompare(b.skill.commandName))
    .map((item) => item.skill)
}

export function completeSkill(
  prompt: string,
  trigger: SkillTrigger,
  skill: CopilotSkill
): { prompt: string; caret: number } {
  const prefix = prompt.slice(0, trigger.start)
  const suffix = prompt.slice(trigger.end).replace(/^ /, '')
  const insertion = `${trigger.prefix}${skill.commandName} `
  return { prompt: prefix + insertion + suffix, caret: prefix.length + insertion.length }
}
