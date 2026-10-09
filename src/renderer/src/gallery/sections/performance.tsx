import { useEffect, useRef } from 'react'
import type { ModelPerformanceSample } from '../../../../shared/app-types'
import ModelPerformanceView from '../../components/ModelPerformanceView'
import type { GallerySection } from '../gallery-section'

const MINUTE = 60_000

/** Calls spread over the past day, with a few gaps and some calls without timing or usage. */
function makeSamples(): ModelPerformanceSample[] {
  const now = Date.now()
  const samples: ModelPerformanceSample[] = []
  const models = [
    { model: 'claude-sonnet-4.5', tps: 62, ttft: 820, nanoAiu: 900_000_000 },
    { model: 'gpt-5', tps: 44, ttft: 1450, nanoAiu: 1_400_000_000 },
    { model: 'gpt-5-mini', tps: 118, ttft: 380, nanoAiu: 150_000_000 }
  ]
  models.forEach(({ model, tps, ttft, nanoAiu }, modelIndex) => {
    for (let index = 0; index < 28; index += 1) {
      // The mini model was only used in the last hour.
      if (modelIndex === 2 && index > 6) break
      if ((index + modelIndex) % 7 === 3) continue
      const minutesAgo = modelIndex === 2 ? 4 + index * 8 : 3 + index * 50
      const wave = 1 + 0.35 * Math.sin(index * 0.9 + modelIndex)
      const durationMs = 4_000 + ((index * 977) % 9_000)
      samples.push({
        id: `${model}:${index}`,
        model,
        timestamp: new Date(now - minutesAgo * MINUTE).toISOString(),
        outputTokens: Math.round(((tps * wave) / 1000) * durationMs),
        durationMs,
        timeToFirstTokenMs: index % 5 === 1 ? null : Math.round(ttft * (2 - wave)),
        nanoAiu: index % 6 === 4 ? null : Math.round(nanoAiu * wave)
      })
    }
  })
  return samples
}

const SAMPLES = makeSamples()
const noop = (): void => {}

/** Clicks the named options once mounted, to show a view other than the default. */
function Clicked({
  labels,
  children,
  height
}: {
  labels: string[]
  children: React.ReactNode
  height: number
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const key = labels.join('|')
  useEffect(() => {
    if (!key) return
    const timers = key.split('|').map((label, index) =>
      window.setTimeout(
        () => {
          Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])
            .find((element) => element.textContent?.trim() === label)
            ?.click()
        },
        150 * (index + 1)
      )
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [key])
  return (
    <div className="tm-workspace-card" ref={ref} style={{ height }}>
      {children}
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-2 font-mono text-[11px] text-fg-subtle">{children}</p>
}

function Performance(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Label>Performance · past day (hover a point for the tooltip)</Label>
        <Clicked height={720} labels={['1d']}>
          <ModelPerformanceView
            error={null}
            loading={false}
            onClose={noop}
            onRetry={noop}
            samples={SAMPLES}
          />
        </Clicked>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Credits · past hour</Label>
          <Clicked height={520} labels={['Credits']}>
            <ModelPerformanceView
              error={null}
              loading={false}
              onClose={noop}
              onRetry={noop}
              samples={SAMPLES}
            />
          </Clicked>
        </div>
        <div>
          <Label>DKK · past 7 days · live rate</Label>
          <Clicked height={520} labels={['DKK', '1w']}>
            <ModelPerformanceView
              error={null}
              loading={false}
              onClose={noop}
              onRetry={noop}
              samples={SAMPLES}
              usdDkkRate={{ dkkPerUsd: 6.42, source: 'live', updatedAt: null }}
            />
          </Clicked>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label>Loading</Label>
          <Clicked height={380} labels={[]}>
            <ModelPerformanceView error={null} loading onClose={noop} onRetry={noop} samples={[]} />
          </Clicked>
        </div>
        <div>
          <Label>Error</Label>
          <Clicked height={380} labels={[]}>
            <ModelPerformanceView
              error="EACCES: permission denied, open 'performance.jsonl'"
              loading={false}
              onClose={noop}
              onRetry={noop}
              samples={[]}
            />
          </Clicked>
        </div>
        <div>
          <Label>Empty</Label>
          <Clicked height={380} labels={[]}>
            <ModelPerformanceView
              error={null}
              loading={false}
              onClose={noop}
              onRetry={noop}
              samples={[]}
            />
          </Clicked>
        </div>
      </div>
    </div>
  )
}

const section: GallerySection = {
  id: 'performance',
  title: 'Model performance',
  order: 60,
  Component: Performance
}

export default section
