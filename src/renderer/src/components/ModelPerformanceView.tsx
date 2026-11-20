import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  FALLBACK_DKK_PER_USD,
  nanoAiuToCredits,
  nanoAiuToDkk,
  USD_PER_AI_CREDIT
} from '../../../shared/ai-credits'
import type { ModelPerformanceSample, UsdDkkRate } from '../../../shared/app-types'
import { formatCostAmount } from './copilot/prompt-cost'
import { CloseIcon } from './Icons'
import Button from './ui/Button'
import Presence from './ui/Presence'
import SegmentedControl from './ui/SegmentedControl'
import LeaveWith from './ui/LeaveWith'
import { useLastValue } from '../lib/motion'
import { useAnimatedListMotion, usePresenceList } from '../lib/use-presence-list'

type Props = {
  samples: ModelPerformanceSample[]
  loading: boolean
  error: string | null
  /** Defaults to the built-in fallback rate until the live lookup is known. */
  usdDkkRate?: UsdDkkRate
  onRetry: () => void
  onClose: () => void
}

type Period = '1h' | '1d' | '1w' | '1m'
type View = 'performance' | 'credits' | 'dkk'
type Metric = 'tps' | 'ttft' | 'credits' | 'dkk'

const FALLBACK_RATE: UsdDkkRate = {
  dkkPerUsd: FALLBACK_DKK_PER_USD,
  source: 'fallback',
  updatedAt: null
}

const PERIODS: { value: Period; label: string; description: string; duration: number }[] = [
  { value: '1h', label: '1h', description: 'Past hour', duration: 60 * 60 * 1000 },
  { value: '1d', label: '1d', description: 'Past day', duration: 24 * 60 * 60 * 1000 },
  { value: '1w', label: '1w', description: 'Past 7 days', duration: 7 * 24 * 60 * 60 * 1000 },
  { value: '1m', label: '1m', description: 'Past 30 days', duration: 30 * 24 * 60 * 60 * 1000 }
]
const VIEWS: { value: View; label: string; description: string }[] = [
  { value: 'performance', label: 'Performance', description: 'Output speed and first token' },
  { value: 'credits', label: 'Credits', description: 'AI credits used' },
  { value: 'dkk', label: 'DKK', description: 'Estimated cost in Danish kroner' }
]
const INTROS: Record<View, string> = {
  performance: 'Output speed and first-token latency for models used in this period.',
  credits: 'AI credits used by each model in this period.',
  dkk: 'Estimated cost in Danish kroner for each model in this period.'
}
const METRICS: Record<Metric, { name: string; label: string; unit: string; spoken: string }> = {
  tps: { name: 'TPS', label: 'Tokens per second', unit: 'tok/s', spoken: 'tokens per second' },
  ttft: { name: 'TTFT', label: 'Time to first token', unit: 'ms', spoken: 'milliseconds' },
  credits: { name: 'Credits', label: 'AI credits', unit: 'credits', spoken: 'credits' },
  dkk: { name: 'DKK', label: 'Estimated cost', unit: 'DKK', spoken: 'DKK' }
}
const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
/** Chart geometry in SVG units; the plot stretches horizontally to fit. */
const CHART = { width: 640, height: 160, left: 12, right: 628, top: 10, bottom: 150 }
/** Candidate gridline counts, in order of preference when scales fit equally well. */
const GRID_INTERVALS = [5, 4, 6]
const modelKey = (group: ModelPerformanceSample[]): string => group[0]?.model ?? ''
type SampleBucket = { start: number; end: number; samples: ModelPerformanceSample[] }
type Series = { metric: Metric; values: (number | null)[]; max: number }
type Row = { label: string; text: string; spoken: string }
type Point = { x: number; y: number }

function formatValue(value: number, metric: Metric): string {
  if (metric === 'credits' || metric === 'dkk') return formatCostAmount(value)
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: metric === 'tps' ? 1 : 0
  }).format(value)
}

const isAmount = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && Number.isFinite(value) && value >= 0

/** Sum of billed usage; null when no call in the group reported it. */
function totalNanoAiu(samples: ModelPerformanceSample[]): number | null {
  const billed = samples.map((sample) => sample.nanoAiu).filter(isAmount)
  return billed.length ? billed.reduce((sum, value) => sum + value, 0) : null
}

function aggregate(
  samples: ModelPerformanceSample[],
  metric: Metric,
  dkkPerUsd: number
): number | null {
  if (metric === 'credits' || metric === 'dkk') {
    const nanoAiu = totalNanoAiu(samples)
    if (nanoAiu === null) return null
    return metric === 'credits' ? nanoAiuToCredits(nanoAiu) : nanoAiuToDkk(nanoAiu, dkkPerUsd)
  }
  if (metric === 'ttft') {
    const recorded = samples.map((sample) => sample.timeToFirstTokenMs).filter(isAmount)
    return recorded.length
      ? recorded.reduce((sum, value) => sum + value, 0) / recorded.length
      : null
  }

  // Calls recorded only for their usage have no timing and don't count towards speed.
  const measured = samples.filter(
    (sample) =>
      Number.isFinite(sample.durationMs) &&
      sample.durationMs > 0 &&
      Number.isFinite(sample.outputTokens) &&
      sample.outputTokens > 0
  )
  if (!measured.length) return null
  const duration = measured.reduce((sum, sample) => sum + sample.durationMs, 0)
  const tokens = measured.reduce((sum, sample) => sum + sample.outputTokens, 0)
  return duration > 0 ? (tokens / duration) * 1000 : null
}

/**
 * Bucket edges aligned to local clock boundaries (5 minutes, hours or days), so completed
 * intervals stay put as the period's moving edge advances.
 */
function bucketEdges(period: Period, start: number, end: number): number[] {
  const first = new Date(start)
  if (period === '1h') first.setMinutes(Math.floor(first.getMinutes() / 5) * 5, 0, 0)
  else if (period === '1d') first.setMinutes(0, 0, 0)
  else first.setHours(0, 0, 0, 0)
  const edges = [first.getTime()]
  while (edges[edges.length - 1] < end) {
    const last = edges[edges.length - 1]
    if (period === '1h') edges.push(last + 5 * MINUTE)
    else if (period === '1d') edges.push(last + HOUR)
    else {
      // Calendar days, so daylight saving changes keep buckets on local midnight.
      const next = new Date(last)
      next.setDate(next.getDate() + 1)
      edges.push(next.getTime())
    }
  }
  return edges
}

function bucketSamples(
  samples: ModelPerformanceSample[],
  period: Period,
  start: number,
  end: number
): SampleBucket[] {
  const edges = bucketEdges(period, start, end)
  const buckets: SampleBucket[] = edges
    .slice(0, -1)
    .map((edge, index) => ({ start: edge, end: edges[index + 1], samples: [] }))
  for (const sample of samples) {
    const time = Date.parse(sample.timestamp)
    const after = edges.findIndex((edge) => edge > time)
    const index = after === -1 ? buckets.length - 1 : after - 1
    if (index >= 0 && index < buckets.length) buckets[index].samples.push(sample)
  }
  return buckets
}

/** Smallest 1, 2, 2.5 (from 25 up) or 5 × 10ⁿ step that is at least `raw`. */
function niceStep(raw: number): number {
  const power = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 2.5, 5, 10]) {
    if (factor === 2.5 && power < 10) continue
    if (factor * power >= raw * (1 - 1e-9)) return factor * power
  }
  return 10 * power
}

/**
 * Picks one gridline count shared by every series, each with its own round step, so each
 * horizontal line reads as a round number on every scale while wasting the least height.
 */
function niceScales(maxima: number[]): { intervals: number; steps: number[] } {
  let best = { intervals: GRID_INTERVALS[0], steps: [] as number[], waste: Infinity }
  for (const intervals of GRID_INTERVALS) {
    const steps = maxima.map((max) => niceStep((max > 0 ? max : 1) / intervals))
    const waste = steps.reduce(
      (sum, step, index) => sum + (step * intervals) / (maxima[index] > 0 ? maxima[index] : 1),
      0
    )
    if (waste < best.waste - 1e-9) best = { intervals, steps, waste }
  }
  return best
}

function formatTick(value: number, step: number, metric: Metric): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  // Cost amounts are shown with toFixed elsewhere, so their ticks match.
  if (metric === 'credits' || metric === 'dkk') return value === 0 ? '0' : value.toFixed(decimals)
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: value === 0 ? 0 : decimals,
    maximumFractionDigits: decimals,
    ...(step >= 1000 ? { notation: 'compact' as const, maximumFractionDigits: 1 } : {})
  }).format(value)
}

/** Monotone cubic tangents (as in d3's curveMonotoneX), so curves never overshoot the data. */
function monotoneSlopes(points: Point[]): number[] {
  const secants = points
    .slice(1)
    .map((point, index) => (point.y - points[index].y) / (point.x - points[index].x || 1))
  const inner = points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return 0
    const [s0, s1] = [secants[index - 1], secants[index]]
    if (s0 * s1 <= 0) return 0
    const h0 = point.x - points[index - 1].x
    const h1 = points[index + 1].x - point.x
    const p = (s0 * h1 + s1 * h0) / (h0 + h1)
    return 2 * Math.sign(s0) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p))
  })
  const last = points.length - 1
  if (last < 1) return inner
  inner[0] = last === 1 ? secants[0] : (3 * secants[0] - inner[1]) / 2
  inner[last] = last === 1 ? secants[0] : (3 * secants[last - 1] - inner[last - 1]) / 2
  return inner
}

/**
 * One continuous curve through every point: solid between adjacent intervals and dashed
 * where it bridges intervals without a value.
 */
function curvePaths(points: (Point | null)[]): { solid: string; gaps: string } {
  const plotted = points.flatMap((point, index) => (point ? [{ ...point, index }] : []))
  const slopes = monotoneSlopes(plotted)
  const f = (value: number): string => value.toFixed(1)
  let solid = ''
  let gaps = ''
  let continuing = false
  for (let index = 1; index < plotted.length; index += 1) {
    const [a, b] = [plotted[index - 1], plotted[index]]
    const third = (b.x - a.x) / 3
    const curve = ` C${f(a.x + third)} ${f(a.y + slopes[index - 1] * third)} ${f(b.x - third)} ${f(b.y - slopes[index] * third)} ${f(b.x)} ${f(b.y)}`
    const move = `M${f(a.x)} ${f(a.y)}`
    if (b.index === a.index + 1) {
      solid += `${continuing ? '' : `${solid ? ' ' : ''}${move}`}${curve}`
      continuing = true
    } else {
      gaps += `${gaps ? ' ' : ''}${move}${curve}`
      continuing = false
    }
  }
  return { solid, gaps }
}

function Trend({
  buckets,
  series,
  rows,
  title,
  start,
  end,
  timeLabels,
  model
}: {
  buckets: SampleBucket[]
  /** The first series is scaled on the left axis, a second on the right; gridlines are shared. */
  series: Series[]
  rows: (samples: ModelPerformanceSample[]) => Row[]
  title: string
  start: number
  end: number
  timeLabels: [string, string]
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
  const activeIndex =
    activeStart === null ? null : buckets.findIndex((bucket) => bucket.start === activeStart)
  const xAt = (time: number): number =>
    CHART.left + ((time - start) / (end - start)) * (CHART.right - CHART.left)
  const yAt = (value: number, top: number): number =>
    CHART.bottom - (value / top) * (CHART.bottom - CHART.top)
  const centers = buckets.map((bucket) =>
    xAt((Math.max(start, bucket.start) + Math.min(end, bucket.end)) / 2)
  )
  const scales = niceScales(series.map((item) => item.max))
  const plotted = series.map((item, seriesIndex) => {
    const step = scales.steps[seriesIndex]
    const top = step * scales.intervals
    const points = item.values.map((value, index) =>
      value === null ? null : { x: centers[index], y: yAt(value, top) }
    )
    return {
      ...item,
      points,
      paths: curvePaths(points),
      ticks: Array.from({ length: scales.intervals + 1 }, (_, index) => {
        const value = Number((index * step).toPrecision(12))
        return { value, label: formatTick(value, step, item.metric), y: yAt(value, top) }
      })
    }
  })
  const gridlines = plotted[0]?.ticks.map((tick) => tick.y) ?? []

  const rangeFormat = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  const interval = (index: number): string =>
    `${rangeFormat.format(Math.max(start, buckets[index].start))} – ${rangeFormat.format(Math.min(end, buckets[index].end))}`
  const description = series
    .map((item) => {
      const recorded = item.values
        .map((value, index) =>
          value === null
            ? null
            : `${interval(index)}: ${formatValue(value, item.metric)} ${METRICS[item.metric].spoken}`
        )
        .filter(Boolean)
        .join('; ')
      return recorded ? `${METRICS[item.metric].label}: ${recorded}.` : null
    })
    .filter(Boolean)
    .join(' ')
  const active = activeIndex === null || activeIndex < 0 ? null : buckets[activeIndex]
  // While the tooltip and guide fade out they stay at the last hovered point.
  const guideIndex = useLastValue(active ? activeIndex : null)
  const tooltipBucket = guideIndex === null ? null : buckets[guideIndex]
  const calls = (count: number): string => `${count} ${count === 1 ? 'call' : 'calls'}`
  const details = (index: number): string =>
    `${model}, ${interval(index)}. ${rows(buckets[index].samples)
      .map((row) => `${row.label}: ${row.spoken}. `)
      .join('')}${calls(buckets[index].samples.length)}.`
  const hasValues = series.some((item) => item.values.some((value) => value !== null))

  return (
    <div
      className={`tm-performance__chart-wrap tm-fade-in${series.length > 1 ? ' tm-performance__chart-wrap--dual' : ''}`}
    >
      {hasValues ? (
        <div className="tm-performance__scales" aria-hidden="true">
          {series.map((item) => (
            <span
              key={item.metric}
              className={`tm-performance__scale tm-performance__scale--${item.metric}`}
            >
              {series.length > 1 && <i className="tm-performance__swatch" />}
              {series.length > 1 ? `${METRICS[item.metric].name} ` : ''}
              {METRICS[item.metric].unit}
            </span>
          ))}
        </div>
      ) : null}
      {hasValues
        ? plotted.map((item, seriesIndex) => (
            <div
              key={item.metric}
              className={`tm-performance__ticks tm-performance__ticks--${seriesIndex === 0 ? 'start' : 'end'} tm-performance__scale--${item.metric}`}
              aria-hidden="true"
            >
              {item.ticks.map((tick) => (
                <span key={tick.value} style={{ top: `${(tick.y / CHART.height) * 100}%` }}>
                  {tick.label}
                </span>
              ))}
            </div>
          ))
        : null}
      <div className="tm-performance__chart-area">
        <svg
          className="tm-performance__chart"
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${model} ${title} trend. ${description || 'No recorded values in this period.'}`}
        >
          {gridlines.map((y, index) => (
            <path
              key={index}
              className={`tm-performance__grid${index === 0 ? ' tm-performance__grid--base' : ''}`}
              d={`M${CHART.left} ${y}H${CHART.right}`}
            />
          ))}
          {/* The guide slides between points and fades in and out with the hover. */}
          <Presence show={active !== null} motion="fade">
            {guideIndex !== null ? (
              <path
                className="tm-performance__guide"
                d={`M0 ${CHART.top - 6}V${CHART.bottom + 6}`}
                style={{ transform: `translateX(${centers[guideIndex]}px)` }}
              />
            ) : null}
          </Presence>
          {plotted.map((item) => (
            <g key={item.metric} className={`tm-performance__series--${item.metric}`}>
              {item.paths.gaps ? (
                <path
                  className="tm-performance__line tm-performance__line--gap"
                  d={item.paths.gaps}
                />
              ) : null}
              {item.paths.solid ? (
                <path className="tm-performance__line" d={item.paths.solid} />
              ) : null}
              {item.points.map((point, index) =>
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
            </g>
          ))}
        </svg>
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
                left: `${(xAt(Math.max(start, bucket.start)) / CHART.width) * 100}%`,
                width: `${((xAt(Math.min(end, bucket.end)) - xAt(Math.max(start, bucket.start))) / CHART.width) * 100}%`
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
        <Presence show={active !== null} motion="fade">
          {guideIndex !== null && tooltipBucket ? (
            <div
              className="tm-performance__tooltip"
              id={tooltipId}
              role="tooltip"
              style={
                {
                  '--tm-tooltip-center': `${(centers[guideIndex] / CHART.width) * 100}%`
                } as React.CSSProperties
              }
            >
              <strong>{model}</strong>
              <span>{interval(guideIndex)}</span>
              {rows(tooltipBucket.samples).map((row) => (
                <div key={row.label}>
                  <span>{row.label}</span>
                  <b>{row.text}</b>
                </div>
              ))}
              <small>{calls(tooltipBucket.samples.length)}</small>
            </div>
          ) : null}
        </Presence>
      </div>
      <div className="tm-performance__axis" aria-hidden="true">
        <span>{timeLabels[0]}</span>
        <span>{timeLabels[1]}</span>
      </div>
    </div>
  )
}

export default function ModelPerformanceView({
  samples,
  loading,
  error,
  usdDkkRate = FALLBACK_RATE,
  onRetry,
  onClose
}: Props): React.JSX.Element {
  const [period, setPeriod] = useState<Period>('1h')
  const [view, setView] = useState<View>('performance')
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
  const { dkkPerUsd } = usdDkkRate
  const selected = PERIODS.find((item) => item.value === period)!
  const start = now - selected.duration
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    ...(period === '1h' || period === '1d'
      ? { hour: 'numeric' as const, minute: '2-digit' as const }
      : { month: 'short' as const, day: 'numeric' as const })
  })
  const byModel = useMemo(() => {
    const groups = new Map<string, ModelPerformanceSample[]>()
    if (loading || error) return groups
    for (const sample of samples) {
      const timestamp = Date.parse(sample.timestamp)
      if (!Number.isFinite(timestamp) || timestamp < start || timestamp > now) continue
      const group = groups.get(sample.model) ?? []
      group.push(sample)
      groups.set(sample.model, group)
    }
    return groups
  }, [error, loading, now, samples, start])

  const value = (group: ModelPerformanceSample[], metric: Metric): number | null =>
    aggregate(group, metric, dkkPerUsd)
  const row = (group: ModelPerformanceSample[], metric: Metric, label: string): Row => {
    const amount = value(group, metric)
    const { unit, spoken } = METRICS[metric]
    const prefix = metric === 'dkk' && amount !== null && amount >= 0.01 ? '≈' : ''
    return {
      label,
      text: amount === null ? 'Not recorded' : `${prefix}${formatValue(amount, metric)} ${unit}`,
      spoken: amount === null ? 'not recorded' : `${formatValue(amount, metric)} ${spoken}`
    }
  }
  const performanceRows = (group: ModelPerformanceSample[]): Row[] => [
    row(group, 'tps', 'TPS'),
    row(group, 'ttft', 'TTFT')
  ]
  const costRows = (group: ModelPerformanceSample[]): Row[] => [
    row(group, 'credits', 'Credits'),
    row(group, 'dkk', 'DKK')
  ]
  const seriesFor = (buckets: SampleBucket[], metric: Metric): Series => {
    const values = buckets.map((bucket) => value(bucket.samples, metric))
    return {
      metric,
      values,
      max: Math.max(0, ...values.filter((item): item is number => item !== null))
    }
  }
  // Models entering or leaving the period (e.g. after switching it) animate in and out.
  const modelGroups = useMemo(() => Array.from(byModel.values()), [byModel])
  const modelEntries = usePresenceList(modelGroups, modelKey, 'models')
  const modelListRef = useAnimatedListMotion<HTMLDivElement>('models')
  const modelChips = usePresenceList(modelGroups, modelKey, 'models')
  const rateNote = `$1 = ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(dkkPerUsd)} DKK (${usdDkkRate.source === 'live' ? 'live rate' : 'fallback rate'})`

  return (
    <section className="tm-performance" aria-labelledby="tm-performance-title">
      <div className="tm-performance__inner">
        <header className="tm-performance__header">
          <div>
            <p className="tm-performance__eyebrow">Model telemetry / local sessions</p>
            <h1 id="tm-performance-title">Model performance</h1>
            <p className="tm-performance__intro tm-fade-in" key={view}>
              {INTROS[view]}
            </p>
          </div>
          <Button
            aria-label="Close model performance"
            onClick={onClose}
            size="sm"
            title="Close"
            variant="ghost"
          >
            Close
            <CloseIcon width={12} height={12} />
          </Button>
        </header>

        <div className="tm-performance__toolbar">
          <div className="tm-performance__controls">
            <div className="tm-performance__views">
              <SegmentedControl<View>
                ariaLabel="Chart"
                value={view}
                options={VIEWS}
                onChange={setView}
              />
            </div>
            <div className="tm-performance__periods">
              <SegmentedControl<Period>
                ariaLabel="Time period"
                value={period}
                options={PERIODS}
                onChange={(next) => {
                  setNow(Date.now())
                  setPeriod(next)
                }}
              />
            </div>
          </div>
          <span className="tm-performance__scope">
            {selected.description}
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
            {modelChips.map(({ key, exitToken }) => (
              <strong
                data-motion={exitToken === null ? undefined : 'fade'}
                data-state={exitToken === null ? undefined : 'closed'}
                key={key}
              >
                {key}
              </strong>
            ))}
          </div>
        )}

        {loading ? (
          <div className="tm-performance__state tm-fade-in" key="loading" role="status">
            <strong>Reading samples…</strong>
            <span>Collecting local model measurements.</span>
          </div>
        ) : error ? (
          <div className="tm-performance__state tm-fade-in" key="error" role="alert">
            <strong>Couldn’t load model performance</strong>
            <span>{error}</span>
            <Button className="mt-2.5" onClick={onRetry} size="sm" variant="secondary">
              Retry
            </Button>
          </div>
        ) : byModel.size === 0 ? (
          <div className="tm-performance__state tm-fade-in" key="empty" role="status">
            <strong>No model activity in this period</strong>
            <span>
              Run a Copilot model to collect samples. Past activity isn’t available; choose a longer
              period for recent measurements.
            </span>
          </div>
        ) : (
          <div className="tm-performance__models" key="models" ref={modelListRef}>
            {modelEntries.map(({ key: model, item: group, exitToken }) => {
              const buckets = bucketSamples(group, period, start, now)
              const tps = value(group, 'tps')
              const ttft = value(group, 'ttft')
              const recordedTtft = group.filter((sample) =>
                isAmount(sample.timeToFirstTokenMs)
              ).length
              const billed = group.filter((sample) => isAmount(sample.nanoAiu)).length
              const costMetric: Metric = view === 'dkk' ? 'dkk' : 'credits'
              const cost = value(group, costMetric)
              return (
                <section
                  className="tm-performance__model"
                  data-exiting={exitToken === null ? undefined : true}
                  data-motion-key={model}
                  key={model}
                  aria-label={
                    view === 'performance'
                      ? `${model} performance`
                      : `${model} ${view === 'credits' ? 'AI credits' : 'estimated DKK'}`
                  }
                >
                  <LeaveWith leaving={exitToken !== null}>
                    <div className="tm-performance__model-head">
                      <h2>
                        <span>Model</span>
                        {model}
                      </h2>
                      <span>
                        {group.length} {group.length === 1 ? 'sample' : 'samples'}
                      </span>
                    </div>
                    <div className={`tm-performance__metric tm-performance__metric--${view}`}>
                      {view === 'performance' ? (
                        <div className="tm-performance__readouts tm-fade-in" key="performance">
                          <div className="tm-performance__readout tm-performance__readout--tps">
                            <span className="tm-performance__metric-name">
                              <i className="tm-performance__swatch" aria-hidden="true" />
                              Output speed <abbr title="Tokens per second">TPS</abbr>
                            </span>
                            <span className="tm-performance__value">
                              {tps === null ? '—' : formatValue(tps, 'tps')}
                              <small>tok/s</small>
                            </span>
                          </div>
                          <div className="tm-performance__readout tm-performance__readout--ttft">
                            <span className="tm-performance__metric-name">
                              <i className="tm-performance__swatch" aria-hidden="true" />
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
                        </div>
                      ) : (
                        <div className="tm-performance__readouts tm-fade-in" key={costMetric}>
                          <div
                            className={`tm-performance__readout tm-performance__readout--${costMetric}`}
                          >
                            <span className="tm-performance__metric-name">
                              {view === 'credits' ? 'AI credits used' : 'Estimated cost'}
                            </span>
                            <span className="tm-performance__value">
                              {cost === null
                                ? '—'
                                : `${view === 'dkk' && cost >= 0.01 ? '≈' : ''}${formatValue(cost, costMetric)}`}
                              <small>{view === 'credits' ? 'credits' : 'DKK'}</small>
                            </span>
                            <span className="tm-performance__coverage">
                              {billed} / {group.length} with usage
                            </span>
                          </div>
                        </div>
                      )}
                      <div className="tm-performance__plot">
                        <Trend
                          key={`${period}:${view}`}
                          buckets={buckets}
                          series={
                            view === 'performance'
                              ? [seriesFor(buckets, 'tps'), seriesFor(buckets, 'ttft')]
                              : [seriesFor(buckets, costMetric)]
                          }
                          rows={view === 'performance' ? performanceRows : costRows}
                          title={
                            view === 'performance'
                              ? 'output speed and first token'
                              : METRICS[costMetric].label
                          }
                          start={start}
                          end={now}
                          timeLabels={[timeLabel.format(start), timeLabel.format(now)]}
                          model={model}
                        />
                      </div>
                    </div>
                  </LeaveWith>
                </section>
              )
            })}
          </div>
        )}
        <footer
          className="tm-performance__footer tm-fade-in"
          key={view === 'performance' ? 'performance' : 'cost'}
        >
          {view === 'performance'
            ? 'TPS = total output tokens ÷ total duration (end-to-end), in seconds. TTFT averages recorded values only. TPS uses the left scale and TTFT the right; gridlines mark round values on both. Each point combines calls in its time interval; dashed lines bridge intervals with no measurement. Samples come from new Copilot calls only, not past history.'
            : `Each point sums the AI credits billed for calls in its time interval, including sub-agents; dashed lines bridge intervals with no recorded usage. Estimate: 1 credit = $${USD_PER_AI_CREDIT}, ${rateNote}. Calls recorded before usage tracking have no credit data.`}
        </footer>
      </div>
    </section>
  )
}
