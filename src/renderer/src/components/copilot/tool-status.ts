import type { CopilotTimelineItem } from '../../../../shared/app-types'

export type ToolStatus = Extract<CopilotTimelineItem, { type: 'tool' }>['status']

export const TOOL_STATUS_LABELS: Record<ToolStatus, string> = {
  running: 'Running',
  complete: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped'
}
