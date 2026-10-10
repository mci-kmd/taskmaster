import { afterEach, describe, expect, it } from 'vitest'
import { excludeNetworkFromDiagnosticReports } from './diagnostic-reports'

type Report = NodeJS.ProcessReport & { excludeNetwork: boolean }

describe('excludeNetworkFromDiagnosticReports', () => {
  const report = process.report as Report
  const original = report.excludeNetwork

  afterEach(() => {
    report.excludeNetwork = original
  })

  it('keeps reports from resolving socket peers', () => {
    report.excludeNetwork = false
    excludeNetworkFromDiagnosticReports()
    expect(report.excludeNetwork).toBe(true)
  })
})
