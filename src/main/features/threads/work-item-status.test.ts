import { describe, expect, it, vi } from 'vitest'
import type { ThreadWorkItem } from '../../../shared/app-types'
import { createWorkItemStatusChecker } from './work-item-status'

const ghIssue: ThreadWorkItem = {
  provider: 'github',
  url: 'https://github.com/octo/repo/issues/42',
  container: 'octo/repo',
  number: 42
}

const ghPull: ThreadWorkItem = {
  provider: 'github',
  url: 'https://github.com/octo/repo/pull/7',
  container: 'octo/repo',
  number: 7
}

const adoItem: ThreadWorkItem = {
  provider: 'azure-devops',
  url: 'https://dev.azure.com/contoso/My%20Project/_workitems/edit/123',
  container: 'contoso/My Project',
  number: 123
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('work item status checker', () => {
  it('checks GitHub issues and PRs via gh api', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify({ state: 'closed' }) })
      .mockResolvedValueOnce({ ok: true, stdout: JSON.stringify({ state: 'open' }) })
    const checker = createWorkItemStatusChecker({ runCommand, env: {} })

    expect(await checker.isCompleted(ghIssue)).toBe(true)
    expect(await checker.isCompleted(ghPull)).toBe(false)
    expect(runCommand).toHaveBeenNthCalledWith(1, 'gh', ['api', 'repos/octo/repo/issues/42'])
    expect(runCommand).toHaveBeenNthCalledWith(2, 'gh', ['api', 'repos/octo/repo/issues/7'])
  })

  it('falls back to GitHub REST API when gh CLI is missing and returns null on CLI errors', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, stdout: '', errorCode: 'ENOENT' })
      .mockResolvedValueOnce({ ok: false, stdout: '', errorCode: '1' })
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ state: 'closed' }))
    const checker = createWorkItemStatusChecker({
      runCommand,
      fetch: fetchMock as unknown as typeof fetch,
      env: { GITHUB_TOKEN: 'tok' }
    })

    expect(await checker.isCompleted(ghIssue)).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/octo/repo/issues/42',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok' })
      })
    )
    // Auth or network failure from gh does not fall through or report completed.
    expect(await checker.isCompleted(ghPull)).toBeNull()
  })

  it('checks Azure DevOps work items using Entra token and work item type state categories', async () => {
    let clock = 1_000_000
    const runCommand = vi.fn().mockResolvedValue({
      ok: true,
      stdout: JSON.stringify({ accessToken: 'ado-token', expires_on: 2_000 })
    })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ fields: { 'System.State': 'Shipped', 'System.WorkItemType': 'User Story' } })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          value: [
            { name: 'Active', category: 'InProgress' },
            { name: 'Shipped', category: 'Completed' }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({ fields: { 'System.State': 'Active', 'System.WorkItemType': 'User Story' } })
      )

    const checker = createWorkItemStatusChecker({
      runCommand,
      fetch: fetchMock as unknown as typeof fetch,
      env: {},
      now: () => clock,
      platform: 'win32'
    })

    expect(await checker.isCompleted(adoItem)).toBe(true)
    // Second check reuses both the cached Entra token and cached work item type states.
    clock += 10_000
    expect(await checker.isCompleted(adoItem)).toBe(false)
    expect(runCommand).toHaveBeenCalledTimes(1)
    expect(runCommand).toHaveBeenCalledWith(
      'az',
      [
        'account',
        'get-access-token',
        '--resource',
        '499b84ac-1321-427f-aa17-267ca6975798',
        '--output',
        'json'
      ],
      { shell: true }
    )
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://dev.azure.com/contoso/My%20Project/_apis/wit/workitems/123?fields=System.State,System.WorkItemType&api-version=7.1'
    )
  })

  it('falls back to az boards CLI when no ADO token or PAT is available', async () => {
    const runCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, stdout: '' })
      .mockResolvedValueOnce({
        ok: true,
        stdout: JSON.stringify({ fields: { 'System.State': 'Done' } })
      })
    const checker = createWorkItemStatusChecker({
      runCommand,
      env: {},
      platform: 'linux'
    })

    expect(await checker.isCompleted(adoItem)).toBe(true)
    expect(runCommand).toHaveBeenNthCalledWith(
      2,
      'az',
      [
        'boards',
        'work-item',
        'show',
        '--id',
        '123',
        '--org',
        'https://dev.azure.com/contoso',
        '--output',
        'json'
      ],
      { shell: false }
    )
  })
})
