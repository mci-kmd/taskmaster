import type { CopilotSubagentUsage } from '../../../../shared/app-types'

export interface SubagentUsageTotals {
  count: number
  /** Sum of reported runtimes; null when none was reported. */
  durationMs: number | null
  /** Sum of reported usage; null when none was reported. */
  nanoAiu: number | null
}

export interface SubagentUsageGroup extends SubagentUsageTotals {
  key: string
  model: string | null
  reasoningEffort: string | null
}

const add = (total: number | null, value: number | null): number | null =>
  value === null ? total : (total ?? 0) + value

const addAgent = <T extends SubagentUsageTotals>(totals: T, agent: CopilotSubagentUsage): T => ({
  ...totals,
  count: totals.count + 1,
  durationMs: add(totals.durationMs, agent.durationMs),
  nanoAiu: add(totals.nanoAiu, agent.nanoAiu)
})

/** Groups sub-agents by model and reasoning effort, most used first. */
export function groupSubagentUsage(agents: CopilotSubagentUsage[]): {
  groups: SubagentUsageGroup[]
  total: SubagentUsageTotals
} {
  const groups = new Map<string, SubagentUsageGroup>()
  let total: SubagentUsageTotals = { count: 0, durationMs: null, nanoAiu: null }
  for (const agent of agents) {
    const key = JSON.stringify([agent.model, agent.reasoningEffort])
    const group = groups.get(key) ?? {
      key,
      model: agent.model,
      reasoningEffort: agent.reasoningEffort,
      count: 0,
      durationMs: null,
      nanoAiu: null
    }
    groups.set(key, addAgent(group, agent))
    total = addAgent(total, agent)
  }
  return {
    groups: [...groups.values()].sort(
      (a, b) =>
        b.count - a.count ||
        (a.model ?? '\uffff').localeCompare(b.model ?? '\uffff') ||
        (a.reasoningEffort ?? '').localeCompare(b.reasoningEffort ?? '')
    ),
    total
  }
}
