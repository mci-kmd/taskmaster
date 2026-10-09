// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ModelPerformanceSample } from '../../../shared/app-types'
import ModelPerformanceView from './ModelPerformanceView'

const now = new Date('2026-09-24T12:00:00.000Z')
const onRetry = vi.fn()
const onClose = vi.fn()

function sample(
  id: string,
  model: string,
  minutesAgo: number,
  outputTokens: number,
  durationMs: number,
  timeToFirstTokenMs: number | null,
  nanoAiu?: number | null
): ModelPerformanceSample {
  return {
    id,
    model,
    timestamp: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    outputTokens,
    durationMs,
    timeToFirstTokenMs,
    ...(nanoAiu === undefined ? {} : { nanoAiu })
  }
}

function view(
  samples: ModelPerformanceSample[],
  loading = false,
  error: string | null = null
): ReturnType<typeof render> {
  return render(
    <ModelPerformanceView
      samples={samples}
      loading={loading}
      error={error}
      onRetry={onRetry}
      onClose={onClose}
    />
  )
}

beforeEach(() => vi.useFakeTimers().setSystemTime(now))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

it('shows only active models and calculates weighted end-to-end TPS and recorded TTFT', () => {
  view([
    sample('1', 'Alpha', 2, 100, 1000, 200),
    sample('2', 'Alpha', 3, 100, 3000, null),
    sample('3', 'Alpha', 4, 0, 0, 400),
    sample('4', 'Older', 1500, 500, 1000, 100)
  ])
  expect(screen.getByRole('button', { name: '1h' }).getAttribute('aria-pressed')).toBe('true')
  const model = screen.getByRole('region', { name: 'Alpha performance' })
  expect(within(model).getByText('50')).toBeTruthy()
  expect(within(model).getByText('300')).toBeTruthy()
  expect(within(model).getByText('2 / 3 recorded')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Older performance' })).toBeNull()
  const chart = within(model).getByRole('img', { name: /Alpha output speed and first token trend/ })
  expect(within(model).getAllByRole('img')).toEqual([chart])
  expect(chart.getAttribute('aria-label')).toContain('Tokens per second:')
  expect(chart.getAttribute('aria-label')).toContain('Time to first token:')
  expect(
    chart.querySelectorAll('.tm-performance__series--tps .tm-performance__point')
  ).toHaveLength(1)
  expect(
    chart.querySelectorAll('.tm-performance__series--ttft .tm-performance__point')
  ).toHaveLength(1)
  expect(within(model).getByText('TPS 0–50 tok/s')).toBeTruthy()
  expect(within(model).getByText('TTFT 0–300 ms')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '1w' }))
  expect(screen.getByRole('region', { name: 'Older performance' })).toBeTruthy()
})

it('names each used model and shows bucket metrics and time on hover and keyboard focus', () => {
  view([
    sample('alpha-1', 'Alpha', 2, 120, 2000, 320),
    sample('alpha-2', 'Alpha', 1, 80, 2000, 120),
    sample('beta', 'Beta', 10, 30, 1000, null)
  ])
  fireEvent.click(screen.getByRole('button', { name: '1d' }))
  const models = screen.getByRole('group', { name: 'Models in this period' })
  expect(within(models).getByText('Alpha')).toBeTruthy()
  expect(within(models).getByText('Beta')).toBeTruthy()
  const alpha = screen.getByRole('region', { name: 'Alpha performance' })
  const alphaGraph = alpha.querySelector('.tm-performance__metric')!
  const alphaPoint = within(alphaGraph as HTMLElement).getByRole('button', { name: /Alpha,/ })
  fireEvent.mouseEnter(alphaPoint)
  let tooltip = within(alphaGraph as HTMLElement).getByRole('tooltip')
  expect(within(tooltip).getByText('Alpha')).toBeTruthy()
  expect(tooltip.textContent).toContain('50 tok/s')
  expect(tooltip.textContent).toContain('220 ms')
  expect(tooltip.textContent).toContain('2 calls')
  const format = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  expect(tooltip.textContent).toContain(format.format(new Date(now.getTime() - 2 * 60 * 60_000)))
  expect(tooltip.textContent).toContain(' – ')
  fireEvent.mouseLeave(alphaPoint)
  expect(screen.queryByRole('tooltip')).toBeNull()

  const beta = screen.getByRole('region', { name: 'Beta performance' })
  const betaGraph = beta.querySelector('.tm-performance__metric')!
  const betaPoint = within(betaGraph as HTMLElement).getByRole('button', { name: /Beta,/ })
  fireEvent.focus(betaPoint)
  tooltip = within(betaGraph as HTMLElement).getByRole('tooltip')
  expect(within(tooltip).getByText('Beta')).toBeTruthy()
  expect(tooltip.textContent).toContain('30 tok/s')
  expect(tooltip.textContent).toContain('Not recorded')
  expect(betaPoint.getAttribute('aria-describedby')).toBe(tooltip.id)
  fireEvent.blur(betaPoint)
  expect(screen.queryByRole('tooltip')).toBeNull()
})

it('keeps one tab stop per chart and moves between intervals with arrow keys', () => {
  view([
    sample('early', 'Alpha', 20 * 60, 10, 1000, 100),
    sample('mid', 'Alpha', 10 * 60, 20, 1000, 100),
    sample('late', 'Alpha', 1, 30, 1000, 100)
  ])
  fireEvent.click(screen.getByRole('button', { name: '1d' }))
  const graph = screen
    .getByRole('region', { name: 'Alpha performance' })
    .querySelector('.tm-performance__metric') as HTMLElement
  const points = within(graph).getAllByRole('button', { name: /Alpha,/ })
  expect(points.map((point) => point.tabIndex)).toEqual([-1, -1, 0])
  points[2].focus()
  fireEvent.keyDown(points[2], { key: 'ArrowLeft' })
  expect(document.activeElement).toBe(points[1])
  expect(within(graph).getByRole('tooltip').textContent).toContain('20 tok/s')
  expect(points.map((point) => point.tabIndex)).toEqual([-1, 0, -1])
  fireEvent.keyDown(points[1], { key: 'Home' })
  expect(document.activeElement).toBe(points[0])
  fireEvent.keyDown(points[0], { key: 'End' })
  expect(document.activeElement).toBe(points[2])
  expect(within(graph).getByRole('tooltip').style.getPropertyValue('--tm-tooltip-center')).not.toBe(
    ''
  )
})

it('includes boundary samples and hides models older than each selected period', () => {
  const hour = 60
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day
  view(
    [
      ['Hour edge', hour],
      ['Past hour', hour + 1],
      ['Day edge', day],
      ['Past day', day + 1],
      ['Week edge', week],
      ['Past week', week + 1],
      ['Month edge', month],
      ['Past month', month + 1]
    ].map(([model, minutes], index) =>
      sample(String(index), String(model), Number(minutes), 10, 1000, 100)
    )
  )

  function visibleModels(): string[] {
    return screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-label'))
      .filter((name): name is string => name !== null)
      .sort()
  }

  fireEvent.click(screen.getByRole('button', { name: '1h' }))
  expect(visibleModels()).toEqual(['Hour edge performance'])

  fireEvent.click(screen.getByRole('button', { name: '1d' }))
  expect(visibleModels()).toEqual([
    'Day edge performance',
    'Hour edge performance',
    'Past hour performance'
  ])

  fireEvent.click(screen.getByRole('button', { name: '1w' }))
  expect(visibleModels()).toEqual([
    'Day edge performance',
    'Hour edge performance',
    'Past day performance',
    'Past hour performance',
    'Week edge performance'
  ])

  fireEvent.click(screen.getByRole('button', { name: '1m' }))
  expect(visibleModels()).toEqual([
    'Day edge performance',
    'Hour edge performance',
    'Month edge performance',
    'Past day performance',
    'Past hour performance',
    'Past week performance',
    'Week edge performance'
  ])
})

it('includes new samples when props change before the clock interval fires', async () => {
  const { rerender } = view([sample('1', 'Initial', 2, 10, 1000, 100)])
  await act(async () => {})
  vi.setSystemTime(new Date(now.getTime() + 30_000))
  await act(async () => {
    rerender(
      <ModelPerformanceView
        samples={[sample('2', 'New', -0.5, 10, 1000, 100)]}
        loading={false}
        error={null}
        onRetry={onRetry}
        onClose={onClose}
      />
    )
  })
  expect(screen.getByRole('region', { name: 'New performance' })).toBeTruthy()
})

it('keeps completed intervals and their positions stable as samples and the clock advance', async () => {
  vi.setSystemTime(new Date(now.getTime() + 60_000))
  const history = [
    sample('early', 'Alpha', 18, 10, 1000, 100),
    sample('middle', 'Alpha', 16, 90, 1000, 300),
    sample('late', 'Alpha', 14, 30, 1000, 200)
  ]
  const { rerender } = view(history)
  fireEvent.click(screen.getByRole('button', { name: '1h' }))
  const graph = screen
    .getByRole('region', { name: 'Alpha performance' })
    .querySelector('.tm-performance__metric') as HTMLElement
  const past = (): string[] =>
    within(graph)
      .getAllByRole('button', { name: /Alpha,/ })
      .slice(0, 2)
      .map((button) => button.getAttribute('aria-label')!)
  const heights = (): string[] =>
    Array.from(graph.querySelectorAll('.tm-performance__series--tps .tm-performance__point'))
      .slice(0, 2)
      .map((point) => point.getAttribute('cy')!)
  const original = past()
  const originalHeights = heights()
  expect(original[0]).toContain('50 tokens per second')
  expect(original[1]).toContain('30 tokens per second')
  expect(within(graph).getByText('TPS 0–50 tok/s')).toBeTruthy()
  expect(graph.querySelector('.tm-performance__line')?.getAttribute('d')).toContain(' L')
  const focused = within(graph).getAllByRole('button', { name: /Alpha,/ })[0]
  act(() => focused.focus())
  const focusedDetails = within(graph).getByRole('tooltip').textContent

  await act(async () => {
    vi.advanceTimersByTime(3 * 60_000)
  })
  expect(past()).toEqual(original)
  expect(heights()).toEqual(originalHeights)

  await act(async () => {
    rerender(
      <ModelPerformanceView
        samples={[...history, sample('new', 'Alpha', -4, 20, 1000, 150)]}
        loading={false}
        error={null}
        onRetry={onRetry}
        onClose={onClose}
      />
    )
  })
  expect(past()).toEqual(original)
  expect(heights()).toEqual(originalHeights)
  expect(graph.querySelector('.tm-performance__line')?.getAttribute('d')).toContain(' L')

  vi.setSystemTime(new Date(now.getTime() + 6 * 60_000))
  await act(async () => {
    rerender(
      <ModelPerformanceView
        samples={[
          ...history,
          sample('new', 'Alpha', -4, 20, 1000, 150),
          sample('newer', 'Alpha', -6, 25, 1000, 150)
        ]}
        loading={false}
        error={null}
        onRetry={onRetry}
        onClose={onClose}
      />
    )
  })
  expect(past()).toEqual(original)
  expect(heights()).toEqual(originalHeights)
  expect(graph.querySelector('.tm-performance__line')?.getAttribute('d')).toContain(' L')
  expect(document.activeElement).toBe(focused)
  expect(within(graph).getByRole('tooltip').textContent).toBe(focusedDetails)
})

it('labels a changed vertical scale without changing recorded interval metrics', async () => {
  vi.setSystemTime(new Date(now.getTime() + 60_000))
  const initial = sample('old', 'Alpha', 10, 50, 1000, 200)
  const { rerender } = view([initial])
  fireEvent.click(screen.getByRole('button', { name: '1h' }))
  const graph = screen
    .getByRole('region', { name: 'Alpha performance' })
    .querySelector('.tm-performance__metric') as HTMLElement
  const recorded = within(graph)
    .getByRole('button', { name: /Alpha,/ })
    .getAttribute('aria-label')
  expect(within(graph).getByText('TPS 0–50 tok/s')).toBeTruthy()

  vi.setSystemTime(new Date(now.getTime() + 2 * 60_000))
  await act(async () => {
    rerender(
      <ModelPerformanceView
        samples={[initial, sample('new', 'Alpha', -2, 100, 1000, 300)]}
        loading={false}
        error={null}
        onRetry={onRetry}
        onClose={onClose}
      />
    )
  })
  expect(within(graph).getByText('TPS 0–100 tok/s')).toBeTruthy()
  expect(
    within(graph)
      .getAllByRole('button', { name: /Alpha,/ })[0]
      .getAttribute('aria-label')
  ).toBe(recorded)
})

it('does not infer zero-duration TPS or unrecorded TTFT, and excludes future samples', () => {
  view([sample('1', 'No timing', 3, 200, 0, null), sample('2', 'Future', -5, 100, 1000, 50)])
  const model = screen.getByRole('region', { name: 'No timing performance' })
  expect(within(model).getAllByText('—')).toHaveLength(2)
  expect(within(model).getByText('0 / 1 recorded')).toBeTruthy()
  expect(screen.queryByText('Future')).toBeNull()
})

it('shows loading, error with retry, empty range, and close actions', () => {
  const { rerender } = view([], true)
  expect(screen.getByRole('status').textContent).toContain('Reading samples')
  rerender(
    <ModelPerformanceView
      samples={[]}
      loading={false}
      error="Unavailable"
      onRetry={onRetry}
      onClose={onClose}
    />
  )
  expect(screen.getByRole('alert').textContent).toContain('Unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(onRetry).toHaveBeenCalledOnce()
  rerender(
    <ModelPerformanceView
      samples={[]}
      loading={false}
      error={null}
      onRetry={onRetry}
      onClose={onClose}
    />
  )
  expect(screen.getByRole('status').textContent).toContain('No model activity')
  fireEvent.click(screen.getByRole('button', { name: 'Close model performance' }))
  expect(onClose).toHaveBeenCalledOnce()
})

it('toggles to AI credit and DKK usage per model, tolerating samples without usage', () => {
  const { container } = render(
    <ModelPerformanceView
      samples={[
        sample('a1', 'Alpha', 2, 100, 1000, 200, 2_000_000_000),
        sample('a2', 'Alpha', 3, 100, 1000, 200, 500_000_000),
        sample('a3', 'Alpha', 4, 100, 1000, 200),
        sample('legacy', 'Beta', 5, 100, 1000, 200),
        sample('usage-only', 'Gamma', 6, 0, 0, null, 1_000_000_000)
      ]}
      loading={false}
      error={null}
      usdDkkRate={{ dkkPerUsd: 6.5, source: 'live', updatedAt: null }}
      onRetry={onRetry}
      onClose={onClose}
    />
  )
  const chart = screen.getByRole('radiogroup', { name: 'Chart' })
  expect(
    within(chart).getByRole('radio', { name: 'Performance' }).getAttribute('aria-checked')
  ).toBe('true')
  const gamma = screen.getByRole('region', { name: 'Gamma performance' })
  expect(within(gamma).getAllByText('—')).toHaveLength(2)

  fireEvent.click(within(chart).getByRole('radio', { name: 'Credits' }))
  const alpha = screen.getByRole('region', { name: 'Alpha AI credits' })
  expect(within(alpha).getByText('2.50')).toBeTruthy()
  expect(within(alpha).getByText('2 / 3 with usage')).toBeTruthy()
  expect(within(alpha).getByText('0–2.50 credits')).toBeTruthy()
  expect(within(alpha).getByRole('img', { name: /Alpha AI credits trend/ })).toBeTruthy()
  const point = within(alpha).getByRole('button', { name: /Alpha,/ })
  expect(point.getAttribute('aria-label')).toContain('Credits: 2.50 credits')
  fireEvent.mouseEnter(point)
  const tooltip = within(alpha).getByRole('tooltip')
  expect(tooltip.textContent).toContain('2.50 credits')
  expect(tooltip.textContent).toContain('≈0.16 DKK')
  expect(tooltip.textContent).toContain('3 calls')
  const beta = screen.getByRole('region', { name: 'Beta AI credits' })
  expect(within(beta).getByText('—')).toBeTruthy()
  expect(within(beta).getByText('0 / 1 with usage')).toBeTruthy()
  expect(within(beta).getByRole('img', { name: /No recorded values/ })).toBeTruthy()
  expect(
    within(screen.getByRole('region', { name: 'Gamma AI credits' })).getByText('1.00')
  ).toBeTruthy()

  fireEvent.click(within(chart).getByRole('radio', { name: 'DKK' }))
  const alphaDkk = screen.getByRole('region', { name: 'Alpha estimated DKK' })
  expect(within(alphaDkk).getByText('≈0.16')).toBeTruthy()
  expect(within(alphaDkk).getByText('0–0.16 DKK')).toBeTruthy()
  expect(container.querySelector('.tm-performance__footer')?.textContent).toContain(
    '$1 = 6.5 DKK (live rate)'
  )
})

it('estimates DKK with the fallback rate until a live rate is available', () => {
  const { container } = view([sample('a1', 'Alpha', 2, 100, 1000, 200, 100_000_000_000)])
  fireEvent.click(screen.getByRole('radio', { name: 'DKK' }))
  const alpha = screen.getByRole('region', { name: 'Alpha estimated DKK' })
  expect(within(alpha).getByText('≈6.58')).toBeTruthy()
  expect(container.querySelector('.tm-performance__footer')?.textContent).toContain(
    '$1 = 6.58 DKK (fallback rate)'
  )
})
