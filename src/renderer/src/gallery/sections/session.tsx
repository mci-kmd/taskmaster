import { useRef, useState } from 'react'
import type {
  CopilotAttachment,
  CopilotInteraction,
  CopilotQueuedMessage,
  CopilotSendDelivery,
  CopilotSessionSnapshot,
  CopilotTimelineItem,
  ThreadCommitPhase
} from '../../../../shared/app-types'
import Button from '../../components/ui/Button'
import Presence from '../../components/ui/Presence'
import Select from '../../components/ui/Select'
import { PaperclipIcon } from '../../components/Icons'
import AttachmentChips from '../../components/copilot/AttachmentChips'
import CommitButton from '../../components/copilot/CommitButton'
import { EmptyConversation, WorkingIndicator } from '../../components/copilot/ConversationStates'
import InteractionPanel from '../../components/copilot/InteractionPanel'
import ModelPicker from '../../components/copilot/ModelPicker'
import PendingMessages from '../../components/copilot/PendingMessages'
import PromptRail from '../../components/copilot/PromptRail'
import SendButton, { type SendMode } from '../../components/copilot/SendButton'
import SessionModelControls from '../../components/copilot/SessionModelControls'
import SessionPromptInput from '../../components/copilot/SessionPromptInput'
import SessionTimeline from '../../components/copilot/SessionTimeline'
import SessionTimelineItem from '../../components/copilot/SessionTimelineItem'
import type { RailPrompt } from '../../components/copilot/prompt-rail'
import type { GallerySection } from '../gallery-section'

const at = '2026-10-09T10:00:00.000Z'

const MARKDOWN = `Here's the direction I'm proposing. The neutrals get a subtle tint so the app has its own temperature, and a single accent carries focus and primary actions.

### Proposed palette

- Soft graphite behind everything; \`--color-panel\` becomes a card that floats above it.
- \`--color-accent\` is cobalt — selection, focus rings, Send and the working pulse.
- \`--color-fg-muted\` stays warm grey and keeps 7:1 contrast. See the [contrast guide](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum).

\`\`\`css
/* Graphite */
[data-theme='graphite'] {
  --color-bg: #232220;
  --color-accent: #7d99f5;
  --radius: 10px;
}
\`\`\`

| Token | Role |
| --- | --- |
| \`panel\` | The workspace card |
| \`accent-2\` | Things that need you |

1. Swap the tokens.
2. Restyle the primitives.`

const tool = (
  id: string,
  title: string,
  status: Extract<CopilotTimelineItem, { type: 'tool' }>['status'],
  detail = 'src/renderer/src/styles/tokens.css\nsrc/renderer/src/styles/themes.css'
): CopilotTimelineItem => ({ id, type: 'tool', title, detail, status, timestamp: at })

const TIMELINE: CopilotTimelineItem[] = [
  {
    id: 'u1',
    type: 'user',
    content:
      'The app looks very stark in all black. Give it a new coat of paint — modern, elegant and minimal, with a splash of color. [📎 current-ui.png]',
    attachments: ['current-ui.png'],
    model: 'Opus 5.5',
    timestamp: at
  },
  {
    id: 'r1',
    type: 'reasoning',
    content:
      "The palette lives in tokens.css, so a new theme is mostly a token swap. I'll add an accent scale and route primary actions, focus rings and selection through it.",
    timestamp: at
  },
  tool('t1', 'Read src/renderer/src/styles/tokens.css', 'complete'),
  tool('t2', 'Search for hard-coded colors in components', 'complete'),
  tool('t3', 'Edit themes.css — introduce accent tokens', 'running'),
  {
    id: 's1',
    type: 'skill',
    name: 'impeccable',
    description: 'Design review and polish',
    invokedBy: 'copilot',
    timestamp: at
  },
  { id: 'a1', type: 'assistant', content: MARKDOWN, model: 'Opus 5.5', timestamp: at },
  {
    id: 'sum1',
    type: 'summary',
    durationMs: 102_000,
    nanoAiu: 3_100_000_000,
    subagents: [
      {
        id: 'x',
        model: 'gpt-5',
        reasoningEffort: 'high',
        durationMs: 41_000,
        nanoAiu: 900_000_000
      },
      {
        id: 'y',
        model: 'gpt-5',
        reasoningEffort: 'high',
        durationMs: 22_000,
        nanoAiu: 400_000_000
      },
      { id: 'z', model: 'claude-haiku', reasoningEffort: null, durationMs: 8_000, nanoAiu: null }
    ],
    timestamp: at
  },
  {
    id: 'u2',
    type: 'user',
    content: 'Also tint the scrollbars and focus rings with the accent.',
    steered: true,
    model: 'Opus 5.5',
    timestamp: at
  },
  {
    id: 'i1',
    type: 'interaction',
    title: 'Copilot needs your input',
    prompt: 'Should the **focus ring** use the accent or the coral?',
    answer: 'The accent',
    outcome: 'answered',
    timestamp: at
  },
  tool('t4', 'Run tests', 'failed', 'FAIL src/renderer/src/components/Sidebar.test.tsx'),
  tool('t5', 'Check types', 'cancelled'),
  {
    id: 'n1',
    type: 'notice',
    tone: 'info',
    content: 'Switched to Opus 5.5 for the next message.',
    timestamp: at
  },
  {
    id: 'n2',
    type: 'notice',
    tone: 'warning',
    content: 'The context window is almost full; older turns will be summarized.',
    timestamp: at
  },
  {
    id: 'n3',
    type: 'notice',
    tone: 'error',
    content: 'The model returned an error. Try again.',
    timestamp: at
  },
  {
    id: 'r2',
    type: 'reasoning',
    content: 'Scrollbar thumbs read --color-fg at 14%; tinting them means mixing in the accent.',
    streaming: true,
    timestamp: at
  }
]

const MODELS: CopilotSessionSnapshot['models'] = [
  {
    id: 'claude-opus-5.5',
    name: 'Opus 5.5',
    supportsVision: true,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude-sonnet-5',
    name: 'Sonnet 5',
    supportsVision: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    supportsVision: true,
    supportedReasoningEfforts: ['low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    supportsVision: true,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  }
]

const SESSION: CopilotSessionSnapshot = {
  threadId: 'gallery',
  sessionId: null,
  title: null,
  phase: 'idle',
  model: 'claude-opus-5.5',
  reasoningEffort: 'high',
  nextModelSelection: null,
  agentMode: 'interactive',
  models: MODELS,
  timeline: [],
  pendingInteraction: null,
  mcpServersNeedingAuth: [],
  mcpServersSigningIn: [],
  queuedMessages: [],
  steeringMessages: [],
  error: null
}

const QUESTION: CopilotInteraction = {
  id: 'q1',
  kind: 'elicitation',
  title: 'Copilot needs your input',
  description: 'Which **accent** should primary actions use?',
  mode: 'form',
  allowFreeform: true,
  schema: {
    properties: {
      accent: {
        type: 'string',
        title: 'Accent',
        description: 'Applies to Send, focus rings and the selected thread.',
        options: ['Cobalt', 'Coral', 'Teal']
      }
    },
    required: ['accent']
  }
}

const PERMISSION: CopilotInteraction = {
  id: 'p1',
  kind: 'permission',
  title: 'Run a shell command?',
  description: 'bun run test -- src/renderer/src/components/Sidebar.test.tsx',
  allowSessionApproval: true,
  replyMode: 'feedback'
}

const CHOICES: CopilotInteraction = {
  id: 'c1',
  kind: 'user-input',
  title: 'Copilot asks',
  description: 'Should I also restyle the **settings** dialogs?',
  choices: ['Yes, restyle them', 'Not yet'],
  allowFreeform: true
}

const ATTACHMENTS: CopilotAttachment[] = [
  { id: 'f1', type: 'file', path: '/tmp/current-ui.png', displayName: 'current-ui.png' },
  { id: 'f2', type: 'file', path: '/tmp/brief.md', displayName: 'brief.md' }
]

const QUEUED: CopilotQueuedMessage[] = [
  { id: 'q1', text: 'Then update the screenshots in the README.' },
  { id: 'q2', text: 'And bump the version.' }
]

const noop = (): void => {}

/** The composer card as CopilotThreadView lays it out, driven by fixture props. */
function Composer({
  mode = 'send',
  initialPrompt = '',
  request = null,
  steering = [],
  queued = [],
  attachments = [],
  commitPhase,
  showCommit = true,
  session = SESSION
}: {
  mode?: SendMode
  initialPrompt?: string
  request?: CopilotInteraction | null
  steering?: string[]
  queued?: CopilotQueuedMessage[]
  attachments?: CopilotAttachment[]
  commitPhase?: ThreadCommitPhase | null
  showCommit?: boolean
  session?: CopilotSessionSnapshot
}): React.JSX.Element {
  const input = useRef<HTMLTextAreaElement>(null)
  const [prompt, setPrompt] = useState(initialPrompt)
  const [agentMode, setAgentMode] = useState('interactive')
  const [delivery, setDelivery] = useState<CopilotSendDelivery>(
    mode === 'queue' ? 'queue' : 'steer'
  )
  const running = mode === 'steer' || mode === 'queue'
  return (
    <div className="tm-session-composer">
      <Presence show={Boolean(request)} motion="collapse">
        <div>
          {request ? (
            <div className="tm-session-request" role="region" aria-label={request.title}>
              <InteractionPanel
                interaction={request}
                threadId="gallery"
                busy={false}
                onRespond={noop}
              />
            </div>
          ) : null}
        </div>
      </Presence>
      <PendingMessages steering={steering} queued={queued} cancelling={null} onCancel={noop} />
      <AttachmentChips attachments={attachments} onRemove={noop} />
      <SessionPromptInput
        threadId="gallery"
        sessionId={null}
        connected={false}
        inputRef={input}
        prompt={prompt}
        timeline={[]}
        hasAttachments={attachments.length > 0}
        hasInteraction={Boolean(request)}
        mode={mode}
        interactionKind={request?.kind}
        onChange={setPrompt}
        onSend={noop}
        onFiles={noop}
        attachmentNames={attachments.map((item) => item.displayName)}
      />
      <div className="tm-session-controls">
        <Button size="sm" variant="ghost" iconOnly aria-label="Attach files" title="Attach files">
          <PaperclipIcon aria-hidden="true" />
        </Button>
        <label className="tm-session-setting" title="Mode for your next message">
          <span>Mode</span>
          <Select
            compact
            aria-label="Agent mode"
            value={agentMode}
            onChange={setAgentMode}
            options={[
              { value: 'interactive', label: 'Interactive' },
              { value: 'plan', label: 'Plan' },
              { value: 'autopilot', label: 'Autopilot' }
            ]}
          />
        </label>
        <SessionModelControls
          session={session}
          disabled={false}
          busy={false}
          disabledReason=""
          onChange={noop}
        />
        <div className="tm-session-actions">
          <Presence show={running || Boolean(request)} motion="pop">
            <Button size="sm" variant="secondary">
              Stop
            </Button>
          </Presence>
          <Presence show={showCommit} motion="pop">
            <CommitButton
              phase={commitPhase ?? null}
              autoPush={false}
              disabledReason={null}
              onCommit={noop}
            />
          </Presence>
          <SendButton
            running={running}
            replying={mode === 'reply'}
            delivery={delivery}
            onDeliveryChange={setDelivery}
            disabled={!prompt.trim() && !attachments.length}
            onSend={noop}
          />
        </div>
      </div>
    </div>
  )
}

/** A session frame: scrolling transcript with the composer pinned below, like the app. */
function SessionFrame({
  height,
  transcript,
  bottom,
  railPrompts = [],
  overlay
}: {
  height: number
  transcript: React.ReactNode
  bottom: React.ReactNode
  railPrompts?: RailPrompt[]
  overlay?: React.ReactNode
}): React.JSX.Element {
  const scroll = useRef<HTMLDivElement>(null)
  return (
    <section
      className="tm-session overflow-hidden rounded-xl elevation-card"
      aria-label="Copilot session"
      style={{ height }}
    >
      <div className="relative min-h-0 flex-1">
        <div
          ref={scroll}
          className={
            railPrompts.length >= 2
              ? 'tm-session-scroll tm-session-scroll--with-rail'
              : 'tm-session-scroll'
          }
          role="region"
          aria-label="Conversation"
          tabIndex={0}
        >
          <div className="tm-session-transcript">{transcript}</div>
        </div>
        <PromptRail prompts={railPrompts} scrollRef={scroll} />
        {overlay}
      </div>
      <div className="tm-session-bottom">{bottom}</div>
    </section>
  )
}

const RAIL = TIMELINE.filter(
  (item): item is CopilotTimelineItem & RailPrompt => item.type === 'user'
)

/** The full conversation with toggles that exercise every appear/disappear animation. */
function LiveConversation(): React.JSX.Element {
  const [timeline, setTimeline] = useState(TIMELINE)
  const [working, setWorking] = useState(true)
  const [request, setRequest] = useState(false)
  const [queued, setQueued] = useState<CopilotQueuedMessage[]>([])
  const [attachments, setAttachments] = useState<CopilotAttachment[]>([])
  const [error, setError] = useState(false)
  const [jump, setJump] = useState(true)
  const [dragging, setDragging] = useState(false)
  const count = useRef(0)
  const toggle = (
    label: string,
    value: boolean,
    set: (next: boolean) => void
  ): React.JSX.Element => (
    <Button size="xs" aria-pressed={value} variant="ghost" onClick={() => set(!value)}>
      {label}
    </Button>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5" data-gallery-controls>
        <Button
          size="xs"
          onClick={() =>
            setTimeline((items) => [
              ...items,
              {
                id: `live-${++count.current}`,
                type: 'assistant',
                content: `Reply ${count.current}: the accent now carries **focus** and the primary action.`,
                model: 'Opus 5.5',
                timestamp: at
              }
            ])
          }
        >
          Add reply
        </Button>
        <Button
          size="xs"
          onClick={() =>
            setQueued((items) => [
              ...items,
              { id: `queued-${++count.current}`, text: `Queued follow-up ${count.current}` }
            ])
          }
        >
          Queue message
        </Button>
        <Button size="xs" onClick={() => setQueued((items) => items.slice(1))}>
          Pick up queued
        </Button>
        <Button
          size="xs"
          onClick={() =>
            setAttachments((items) => [
              ...items,
              {
                id: `file-${++count.current}`,
                type: 'file',
                path: '/tmp/file',
                displayName: `screenshot-${count.current}.png`
              }
            ])
          }
        >
          Attach
        </Button>
        <Button size="xs" onClick={() => setAttachments((items) => items.slice(1))}>
          Detach
        </Button>
        {toggle('Working', working, setWorking)}
        {toggle('Request', request, setRequest)}
        {toggle('Error', error, setError)}
        {toggle('Jump pill', jump, setJump)}
        {toggle('Drop overlay', dragging, setDragging)}
      </div>
      <SessionFrame
        height={900}
        railPrompts={RAIL}
        transcript={
          <>
            <SessionTimeline items={timeline} />
            <Presence show={working} motion="collapse">
              <WorkingIndicator waiting={request} />
            </Presence>
          </>
        }
        overlay={
          <>
            <Presence show={jump} motion="rise">
              <Button size="sm" className="tm-session-jump">
                ↓ Jump to latest
              </Button>
            </Presence>
            <Presence show={dragging} motion="fade">
              <div className="tm-session-drop">
                <PaperclipIcon aria-hidden="true" />
                Drop files to attach
              </div>
            </Presence>
          </>
        }
        bottom={
          <>
            <Presence show={error} motion="collapse">
              <div className="tm-session-slot">
                <div className="tm-session-error" role="alert">
                  <span>Copilot could not complete that action.</span>
                  <Button size="sm" variant="ghost" onClick={() => setError(false)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            </Presence>
            <Composer
              mode={working ? 'steer' : 'send'}
              initialPrompt="Also tint the scrollbars and focus rings with the accent"
              request={request ? QUESTION : null}
              steering={working ? ['Keep the sidebar as it is'] : []}
              queued={queued}
              attachments={attachments}
            />
          </>
        }
      />
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className="mb-2 text-[11px] font-medium text-fg-subtle">{children}</div>
}

function Session(): React.JSX.Element {
  const [model, setModel] = useState('claude-opus-5.5')
  return (
    <div className="flex flex-col gap-8">
      <LiveConversation />

      <div className="grid grid-cols-2 gap-6">
        <div>
          <Label>Empty conversation · update, error, reconnect and MCP sign-in notices</Label>
          <SessionFrame
            height={760}
            transcript={<EmptyConversation onSuggest={noop} />}
            bottom={
              <>
                <div className="tm-session-slot flex justify-end">
                  <Button size="sm" variant="ghost">
                    Update available
                  </Button>
                </div>
                <div className="tm-session-slot">
                  <div className="tm-session-error" role="alert">
                    <span>Could not connect to Copilot.</span>
                    <Button size="sm" variant="ghost">
                      Dismiss
                    </Button>
                  </div>
                </div>
                <div className="tm-session-slot flex justify-end">
                  <Button size="sm">Reconnect</Button>
                </div>
                <div className="tm-session-slot">
                  <div className="tm-session-notice" role="status">
                    <span>github needs you to sign in before Copilot can use it.</span>
                    <Button size="sm" variant="primary">
                      Sign in to github
                    </Button>
                  </div>
                </div>
                <div className="tm-session-slot">
                  <div className="tm-session-notice tm-session-notice--warning" role="status">
                    Copilot update: the download was interrupted.
                  </div>
                </div>
                <Composer showCommit={false} />
              </>
            }
          />
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <Label>Permission request · reply mode</Label>
            <div className="tm-session h-auto">
              <div className="tm-session-bottom">
                <Composer
                  mode="reply"
                  request={PERMISSION}
                  initialPrompt="Run only the sidebar tests"
                />
              </div>
            </div>
          </div>
          <div>
            <Label>Question with choices · queued and steering messages · attachments</Label>
            <div className="tm-session h-auto">
              <div className="tm-session-bottom">
                <Composer
                  mode="queue"
                  request={CHOICES}
                  steering={['Keep the sidebar as it is']}
                  queued={QUEUED}
                  attachments={ATTACHMENTS}
                  initialPrompt="Look at [📎 current-ui.png] and [📎 brief.md]"
                  commitPhase="generating"
                  session={{
                    ...SESSION,
                    nextModelSelection: { model: 'gpt-5', reasoningEffort: 'high' }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6 rounded-xl bg-panel p-6 elevation-card">
        <div className="tm-session h-auto bg-transparent">
          <Label>Send button</Label>
          <div className="flex flex-wrap items-center gap-3">
            <SendButton
              running={false}
              delivery="steer"
              disabled={false}
              onDeliveryChange={noop}
              onSend={noop}
            />
            <SendButton
              running
              delivery="steer"
              disabled={false}
              onDeliveryChange={noop}
              onSend={noop}
            />
            <SendButton
              running
              delivery="queue"
              disabled={false}
              onDeliveryChange={noop}
              onSend={noop}
            />
            <SendButton
              running
              replying
              delivery="steer"
              disabled={false}
              onDeliveryChange={noop}
              onSend={noop}
            />
            <SendButton
              running={false}
              delivery="steer"
              disabled
              onDeliveryChange={noop}
              onSend={noop}
            />
            <SendButton running delivery="steer" disabled onDeliveryChange={noop} onSend={noop} />
          </div>
          <div className="mt-6">
            <Label>
              Commit button: ready · writing message · hook · committing · pushing · blocked
            </Label>
            <div className="flex items-center gap-2">
              {([null, 'generating', 'hook', 'committing', 'pushing'] as const).map((phase) => (
                <CommitButton
                  key={phase ?? 'ready'}
                  phase={phase}
                  autoPush={phase === 'pushing'}
                  disabledReason={null}
                  onCommit={noop}
                />
              ))}
              <CommitButton
                phase={null}
                autoPush={false}
                disabledReason="Resolve merge conflicts before committing"
                onCommit={noop}
              />
            </div>
          </div>
          <div className="mt-6">
            <Label>Model picker</Label>
            <div className="w-[200px]" data-gallery-model-picker>
              <ModelPicker
                models={MODELS}
                value={model}
                disabled={false}
                placeholder="Choose model"
                favorites={['gpt-5']}
                onChange={setModel}
                onToggleFavorite={noop}
              />
            </div>
          </div>
        </div>
        <div className="tm-session h-auto bg-transparent">
          <Label>Tool calls: running · done · failed · stopped</Label>
          <div className="flex flex-col gap-1.5">
            <SessionTimelineItem
              item={tool('d1', 'Edit themes.css — introduce accent tokens', 'running')}
            />
            <SessionTimelineItem
              item={tool('d2', 'Read src/renderer/src/styles/tokens.css', 'complete')}
            />
            <SessionTimelineItem
              item={tool(
                'd3',
                'Run tests',
                'failed',
                'FAIL src/renderer/src/components/Sidebar.test.tsx\n  ✕ renders the selected thread (12 ms)'
              )}
            />
            <SessionTimelineItem item={tool('d4', 'Check types', 'cancelled')} />
          </div>
        </div>
        <div className="tm-session h-auto bg-transparent">
          <Label>Pending messages</Label>
          <div className="tm-session-composer">
            <PendingMessages
              steering={['Keep the sidebar as it is']}
              queued={QUEUED}
              cancelling="q2"
              onCancel={noop}
            />
            <div className="h-3" />
          </div>
          <div className="mt-6">
            <Label>Attachment chips</Label>
            <div className="tm-session-composer pb-3">
              <AttachmentChips attachments={ATTACHMENTS} onRemove={noop} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const section: GallerySection = {
  id: 'session',
  title: 'Copilot session',
  order: 40,
  Component: Session
}
export default section
