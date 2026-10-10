/**
 * Diagnostic reports (`process.report.getReport()`, used to tell glibc from musl Linux, both here
 * and by the Copilot SDK) resolve the peer of every open socket by default. On WSL that blocked
 * the main process, and with it the whole window, for about 20 seconds while sessions connected.
 * Nothing in the app needs network details in a report, so they are left out process-wide.
 */
export function excludeNetworkFromDiagnosticReports(): void {
  // `excludeNetwork` (Node 13.12+) is missing from the bundled type definitions.
  const report = process.report as (NodeJS.ProcessReport & { excludeNetwork?: boolean }) | undefined
  if (report) report.excludeNetwork = true
}
