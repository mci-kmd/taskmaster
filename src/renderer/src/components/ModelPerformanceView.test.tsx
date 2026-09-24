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
  timeToFirstTokenMs: number | null
): ModelPerformanceSample {
  return {
    id,
    model,
    timestamp: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    outputTokens,
    durationMs,
    timeToFirstTokenMs
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
  const model = screen.getByRole('region', { name: 'Alpha performance' })
  expect(within(model).getByText('50')).toBeTruthy()
  expect(within(model).getByText('300')).toBeTruthy()
  expect(within(model).getByText('2 / 3 recorded')).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Older performance' })).toBeNull()
  expect(within(model).getByRole('img', { name: /Alpha Tokens per second trend/ })).toBeTruthy()
  expect(within(model).getByRole('img', { name: /Alpha Time to first token trend/ })).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '1w' }))
  expect(screen.getByRole('region', { name: 'Older performance' })).toBeTruthy()
})

it('names each used model and shows bucket metrics and time on hover and keyboard focus', () => {
  view([
    sample('alpha-1', 'Alpha', 2, 120, 2000, 320),
    sample('alpha-2', 'Alpha', 1, 80, 2000, 120),
    sample('beta', 'Beta', 10, 30, 1000, null)
  ])
  const models = screen.getByRole('group', { name: 'Models in this period' })
  expect(within(models).getByText('Alpha')).toBeTruthy()
  expect(within(models).getByText('Beta')).toBeTruthy()
  const alpha = screen.getByRole('region', { name: 'Alpha performance' })
  const alphaGraph = alpha.querySelector('.tm-performance__metric--tps')!
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
  const betaGraph = beta.querySelector('.tm-performance__metric--ttft')!
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
  const graph = screen
    .getByRole('region', { name: 'Alpha performance' })
    .querySelector('.tm-performance__metric--tps') as HTMLElement
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
