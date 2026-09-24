import { useEffect, useId, useRef, useState } from 'react'
import type { ModelPerformanceSample } from '../../../shared/app-types'
import '../assets/model-performance.css'

type Props = {
  samples: ModelPerformanceSample[]
  loading: boolean
  error: string | null
  onRetry: () => void
  onClose: () => void
}

type Period = '1h' | '1d' | '1w' | '1m'
type Metric = 'tps' | 'ttft'

const PERIODS: { key: Period; label: string; duration: number }[] = [
  { key: '1h', label: 'Past hour', duration: 60 * 60 * 1000 },
  { key: '1d', label: 'Past day', duration: 24 * 60 * 60 * 1000 },
  { key: '1w', label: 'Past 7 days', duration: 7 * 24 * 60 * 60 * 1000 },
  { key: '1m', label: 'Past 30 days', duration: 30 * 24 * 60 * 60 * 1000 }
]
const BUCKET_COUNT = 12
type SampleBucket = { start: number; end: number; samples: ModelPerformanceSample[] }

function formatValue(value: number, metric: Metric): string {
  return metric === 'tps'
    ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function aggregate(samples: ModelPerformanceSample[], metric: Metric): number | null {
  if (metric === 'ttft') {
    const recorded = samples
      .map((sample) => sample.timeToFirstTokenMs)
      .filter((value): value is number => value !== null && Number.isFinite(value) && value >= 0)
    return recorded.length
      ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
      : null
  }

  const measured = samples.filter(
    (sample) =>
      Number.isFinite(sample.durationMs) &&
      sample.durationMs > 0 &&
      Number.isFinite(sample.outputTokens) &&
      sample.outputTokens >= 0
  )
  if (!measured.length) return null
  const duration = measured.reduce((sum, sample) => sum + sample.durationMs, 0)
  const tokens = measured.reduce((sum, sample) => sum + sample.outputTokens, 0)
  return duration > 0 ? (tokens / duration) * 1000 : null
}

function bucketSamples(
  samples: ModelPerformanceSample[],
  start: number,
  end: number
): SampleBucket[] {
  const width = (end - start) / BUCKET_COUNT
  // Align to fixed time boundaries, not the moving edge of the selected period.
  const first = Math.floor(start / width) * width
  const buckets: SampleBucket[] = Array.from(
    { length: Math.ceil((end - first) / width) },
    (_, index) => ({
      start: first + index * width,
      end: first + (index + 1) * width,
      samples: []
    })
  )
  for (const sample of samples) {
    const index = Math.min(
      buckets.length - 1,
      Math.floor((Date.parse(sample.timestamp) - first) / width)
    )
    if (index >= 0 && index < buckets.length) buckets[index].samples.push(sample)
  }
  return buckets
}

function Trend({
  buckets,
  metric,
  start,
  end,
  model
}: {
  buckets: SampleBucket[]
  metric: Metric
  start: number
  end: number
  model: string
}): React.JSX.Element {
  const [activeStart, setActiveStart] = useState<number | null>(null)
  const [focusStart, setFocusStart] = useState<number | null>(null)
  const hitRefs = useRef<(HTMLButtonElement | null)[]>([])
  const tooltipId = useId()
  const filled = buckets.flatMap((bucket, index) => (bucket.samples.length ? [index] : []))
  const focusIndex = buckets.findIndex((bucket) => bucket.start === focusStart)
  const tabbable = filled.includes(focusIndex) ? focusIndex : (filled.at(-1) ?? null)
  const moveFocus = (event: React.KeyboardEvent, index: number): void => {
    const position = filled.indexOf(index)
    const target =
      event.key === 'ArrowLeft'
        ? filled[Math.max(0, position - 1)]
        : event.key === 'ArrowRight'
          ? filled[Math.min(filled.length - 1, position + 1)]
          : event.key === 'Home'
            ? filled[0]
            : event.key === 'End'
              ? filled.at(-1)
              : undefined
    if (target === undefined) return
    event.preventDefault()
    hitRefs.current[target]?.focus()
  }
  const values = buckets.map((bucket) => aggregate(bucket.samples, metric))
  const max = Math.max(0, ...values.filter((value): value is number => value !== null))
  const activeIndex =
    activeStart === null ? null : buckets.findIndex((bucket) => bucket.start === activeStart)
  const xAt = (time: number): number => 12 + ((time - start) / (end - start)) * 616
  const points = values.map((value, index) =>
    value === null
      ? null
      : {
          x: xAt((Math.max(start, buckets[index].start) + Math.min(end, buckets[index].end)) / 2),
          y: 72 - (value / (max || 1)) * 56
        }
  )
  const segments: string[] = []
  let segment = ''
  for (const point of points) {
    if (point) {
      segment += `${segment ? ' L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    } else if (segment) {
      segments.push(segment)
      segment = ''
    }
  }
  if (segment) segments.push(segment)

  const label = metric === 'tps' ? 'Tokens per second' : 'Time to first token'
  const unit = metric === 'tps' ? 'tokens per second' : 'milliseconds'
  const rangeFormat = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  const interval = (index: number): string =>
    `${rangeFormat.format(Math.max(start, buckets[index].start))} – ${rangeFormat.format(Math.min(end, buckets[index].end))}`
  const description = values
    .map((value, index) =>
      value === null ? null : `${interval(index)}: ${formatValue(value, metric)} ${unit}`
    )
    .filter(Boolean)
    .join('; ')
  const active = activeIndex === null || activeIndex < 0 ? null : buckets[activeIndex]
  const activeTps = active ? aggregate(active.samples, 'tps') : null
  const activeTtft = active ? aggregate(active.samples, 'ttft') : null
  const details = (index: number): string => {
    const tps = aggregate(buckets[index].samples, 'tps')
    const ttft = aggregate(buckets[index].samples, 'ttft')
    return `${model}, ${interval(index)}. TPS: ${tps === null ? 'not recorded' : `${formatValue(tps, 'tps')} tokens per second`}. TTFT: ${ttft === null ? 'not recorded' : `${formatValue(ttft, 'ttft')} milliseconds`}. ${buckets[index].samples.length} ${buckets[index].samples.length === 1 ? 'call' : 'calls'}.`
  }

  return (
    <div className="tm-performance__chart-wrap">
      <svg
        className={`tm-performance__chart tm-performance__chart--${metric}`}
        viewBox="0 0 640 84"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${model} ${label} trend. ${description || 'No recorded values in this period.'}`}
      >
        <path className="tm-performance__grid" d="M12 16H628 M12 44H628 M12 72H628" />
        {active && activeIndex !== null && (
          <path className="tm-performance__guide" d={`M${points[activeIndex]?.x ?? 0} 8V76`} />
        )}
        {segments.map((path, index) => (
          <path key={index} className="tm-performance__line" d={path} />
        ))}
        {points.map((point, index) =>
          point ? (
            <circle
              key={buckets[index].start}
              className="tm-performance__point"
              cx={point.x}
              cy={point.y}
              r={index === activeIndex ? 5 : 3.5}
            />
          ) : null
        )}
      </svg>
      {values.some((value) => value !== null) ? (
        <span className="tm-performance__scale" aria-hidden="true">
          0–{formatValue(max, metric)} {metric === 'tps' ? 'tok/s' : 'ms'}
        </span>
      ) : null}
      {buckets.map((bucket, index) =>
        bucket.samples.length ? (
          <button
            key={bucket.start}
            ref={(element) => {
              hitRefs.current[index] = element
            }}
            className="tm-performance__chart-hit"
            type="button"
            tabIndex={index === tabbable ? 0 : -1}
            style={{
              left: `${(xAt(Math.max(start, bucket.start)) / 640) * 100}%`,
              width: `${((xAt(Math.min(end, bucket.end)) - xAt(Math.max(start, bucket.start))) / 640) * 100}%`
            }}
            aria-label={details(index)}
            aria-describedby={activeIndex === index ? tooltipId : undefined}
            onMouseEnter={() => setActiveStart(bucket.start)}
            onMouseLeave={() => setActiveStart(null)}
            onFocus={() => {
              setFocusStart(bucket.start)
              setActiveStart(bucket.start)
            }}
            onBlur={() => setActiveStart(null)}
            onKeyDown={(event) => moveFocus(event, index)}
          />
        ) : null
      )}
      {active && activeIndex !== null && (
        <div
          className="tm-performance__tooltip"
          id={tooltipId}
          role="tooltip"
          style={
            {
              '--tm-tooltip-center': `${((points[activeIndex]?.x ?? 0) / 640) * 100}%`
            } as React.CSSProperties
          }
        >
          <strong>{model}</strong>
          <span>{interval(activeIndex)}</span>
          <div>
            <span>TPS</span>
            <b>{activeTps === null ? 'Not recorded' : `${formatValue(activeTps, 'tps')} tok/s`}</b>
          </div>
          <div>
            <span>TTFT</span>
            <b>{activeTtft === null ? 'Not recorded' : `${formatValue(activeTtft, 'ttft')} ms`}</b>
          </div>
          <small>
            {active.samples.length} {active.samples.length === 1 ? 'call' : 'calls'}
          </small>
        </div>
      )}
    </div>
  )
}

export default function ModelPerformanceView({
  samples,
  loading,
  error,
  onRetry,
  onClose
}: Props): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('1h')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    queueMicrotask(() => {
      if (active) setNow(Date.now())
    })
    return () => {
      active = false
    }
  }, [samples])
  const selected = PERIODS.find((item) => item.key === period)!
  const start = now - selected.duration
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    ...(period === '1h' || period === '1d'
      ? { hour: 'numeric' as const, minute: '2-digit' as const }
      : { month: 'short' as const, day: 'numeric' as const })
  })
  const byModel = new Map<string, ModelPerformanceSample[]>()
  if (!loading && !error) {
    for (const sample of samples) {
      const timestamp = Date.parse(sample.timestamp)
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) continue
      const group = byModel.get(sample.model) ?? []
      group.push(sample)
      byModel.set(sample.model, group)
    }
  }

  return (
    <section className="tm-performance" aria-labelledby="tm-performance-title">
      <div className="tm-performance__inner">
        <header className="tm-performance__header">
          <div>
            <p className="tm-performance__eyebrow">Model telemetry / local sessions</p>
            <h1 id="tm-performance-title">Model performance</h1>
            <p className="tm-performance__intro">
              Output speed and first-token latency for models used in this period.
            </p>
          </div>
          <button
            className="tm-performance__close"
            type="button"
            onClick={onClose}
            aria-label="Close model performance"
          >
            Close <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="tm-performance__toolbar">
          <div className="tm-performance__periods" role="group" aria-label="Time period">
            {PERIODS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="tm-performance__period"
                aria-pressed={period === item.key}
                title={item.label}
                onClick={() => {
                  setNow(Date.now())
                  setPeriod(item.key)
                }}
              >
                {item.key}
              </button>
            ))}
          </div>
          <span className="tm-performance__scope">
            {selected.label}
            {!loading &&
              !error &&
              ` · ${byModel.size} ${byModel.size === 1 ? 'model' : 'models'} · ${Array.from(byModel.values()).reduce((sum, group) => sum + group.length, 0)} samples`}
          </span>
        </div>

        {!loading && !error && byModel.size > 0 && (
          <div
            className="tm-performance__model-index"
            role="group"
            aria-label="Models in this period"
          >
            <span>Models in this period</span>
            {Array.from(byModel.keys(), (model) => (
              <strong key={model}>{model}</strong>
            ))}
          </div>
        )}

        {loading ? (
          <div className="tm-performance__state" role="status">
            <strong>Reading samples…</strong>
            <span>Collecting local model measurements.</span>
          </div>
        ) : error ? (
          <div className="tm-performance__state" role="alert">
            <strong>Couldn’t load model performance</strong>
            <span>{error}</span>
            <button className="tm-performance__retry" type="button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : byModel.size === 0 ? (
          <div className="tm-performance__state" role="status">
            <strong>No model activity in this period</strong>
            <span>
              Run a model in Custom UI to collect samples. Past activity isn’t available; choose a
              longer period for recent measurements.
            </span>
          </div>
        ) : (
          <div className="tm-performance__models">
            {Array.from(byModel, ([model, group]) => {
              const buckets = bucketSamples(group, start, now)
              const tps = aggregate(group, 'tps')
              const ttft = aggregate(group, 'ttft')
              const recordedTtft = group.filter(
                (sample) =>
                  sample.timeToFirstTokenMs !== null &&
                  Number.isFinite(sample.timeToFirstTokenMs) &&
                  sample.timeToFirstTokenMs >= 0
              ).length
              return (
                <section
                  className="tm-performance__model"
                  key={model}
                  aria-label={`${model} performance`}
                >
                  <div className="tm-performance__model-head">
                    <h2>
                      <span>Model</span>
                      {model}
                    </h2>
                    <span>
                      {group.length} {group.length === 1 ? 'sample' : 'samples'}
                    </span>
                  </div>
                  <div className="tm-performance__metric tm-performance__metric--tps">
                    <div className="tm-performance__readout">
                      <span className="tm-performance__metric-name">
                        Output speed <abbr title="Tokens per second">TPS</abbr>
                      </span>
                      <span className="tm-performance__value">
                        {tps === null ? '—' : formatValue(tps, 'tps')}
                        <small>tok/s</small>
                      </span>
                    </div>
                    <div className="tm-performance__plot">
                      <Trend
                        key={`${period}:tps`}
                        buckets={buckets}
                        metric="tps"
                        start={start}
                        end={now}
                        model={model}
                      />
                      <div className="tm-performance__axis" aria-hidden="true">
                        <span>{timeLabel.format(start)}</span>
                        <span>{timeLabel.format(now)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="tm-performance__metric tm-performance__metric--ttft">
                    <div className="tm-performance__readout">
                      <span className="tm-performance__metric-name">
                        First token <abbr title="Time to first token">TTFT</abbr>
                      </span>
                      <span className="tm-performance__value">
                        {ttft === null ? '—' : formatValue(ttft, 'ttft')}
                        <small>ms avg</small>
                      </span>
                      <span className="tm-performance__coverage">
                        {recordedTtft} / {group.length} recorded
                      </span>
                    </div>
                    <div className="tm-performance__plot">
                      <Trend
                        key={`${period}:ttft`}
                        buckets={buckets}
                        metric="ttft"
                        start={start}
                        end={now}
                        model={model}
                      />
                      <div className="tm-performance__axis" aria-hidden="true">
                        <span>{timeLabel.format(start)}</span>
                        <span>{timeLabel.format(now)}</span>
                      </div>
                    </div>
                  </div>
                </section>
              )
            })}
          </div>
        )}
        <footer className="tm-performance__footer">
          TPS = total output tokens ÷ total duration (end-to-end), in seconds. TTFT averages
          recorded values only. Each point combines calls in its time interval; gaps indicate no
          measurement. Samples come from new Custom UI calls only, not past history.
        </footer>
      </div>
    </section>
  )
}
