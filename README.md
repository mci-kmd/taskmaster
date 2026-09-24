# taskmaster

A personal Electron app for running an embedded LLM CLI inside the app and organizing repo-scoped threads.

## Current features

- Switch between Projects and Inbox using the button beside Settings; both modes share projects and their configuration, while keeping separate threads and session selections
- View inbox threads across projects in activity order, with manual settle/unsettle and a collapsed Settled threads section
- Create inbox threads using the custom Copilot interface and the same branch/worktree options; settling preserves sessions, branches, and worktrees without cleanup
- Choose a predefined project icon and color as a fallback for custom favicons
- Browse available Custom UI models through nested family submenus, preserving the active model and per-model reasoning settings
- Change Custom UI model and reasoning effort while Copilot works; the queued choice applies to the next message
- Open Model performance beside Settings to compare end-to-end output tokens/second and time to first token for used Custom UI models over 1h, 1d, 1w, or 30 days; hover or focus chart intervals (arrow keys move between them) for each model's measurements. Completed intervals stay fixed while the current interval updates; the labeled vertical scale adjusts for new maxima. Samples are collected from new calls and kept locally for 30 days
- Reopen unused Custom UI threads after a restart even when Copilot has not yet written their session event log
- Recall sent Custom UI prompts with Up/Down from an empty composer; history stays within the thread and restores from its session
- Browse Custom UI skills with `/` at the start of a message or `$` within it; filter by name or description, select with arrows and Enter/Tab, and dismiss with Escape
- Discover project and personal Copilot skills from the session configuration and expand selected skills through the SDK when sending, retaining the original prompt in history
- Add git repositories from a folder picker
- Create persisted threads on the active branch, an existing branch, a new branch, or a worktree
- Launch Copilot CLI inside the embedded terminal per selected thread
- Resume prior agent sessions by persisted session ID or name
- Configure global Copilot flags for all thread launches
- Remove owned worktrees and branches when closing a worktree-backed thread
- Configure optional setup and cleanup scripts for worktree-backed threads

## Stack

- Bun
- Electron + electron-vite
- React + TypeScript
- Tailwind CSS 4

## Prerequisites

- Bun
- Git
- GitHub Copilot CLI installed and already signed in
- Linux: native build tools for `node-pty` (`sudo apt-get install build-essential python3` on Ubuntu/Debian)

## Install

```bash
bun install
```

The project uses Bun-native package hardening:

- `bun.lock` for reproducible dependency resolution
- direct dependency versions pinned exactly
- dependency lifecycle scripts blocked by default except explicit `trustedDependencies`
- `install.minimumReleaseAge` in `bunfig.toml`

## Development

```bash
bun run dev
```

Install the local git hooks before committing:

```bash
./scripts/register-precommit-hook.sh
```

```powershell
.\scripts\register-precommit-hook.ps1
```

If Electron or `node-pty` did not install its native binaries on Linux:

```bash
node node_modules/electron/install.js
bun run rebuild:native
```

### Build

```bash
bun run build

bun run build:win

bun run build:linux
```

Renderer dev server runs on port `5175`.

## Architecture

- `src/shared/contracts` is the source of truth for IPC channels and shared DTOs.
- `src/main/ipc/typed-ipc.ts` is the only place that should call `ipcMain.handle`; main features register through that adapter.
- `src/main/providers` contains Copilot CLI launch behavior behind the `LlmProvider` seam.
- `src/main/backends` contains native command, path, and git helpers.
- `src/main/features` is where main-process feature logic now lives; persistence, project-task rules, branch-status parsing, and snapshot building have started moving out of `app-state.ts`.
- `src/renderer/src/shared/api/client.ts` is the renderer bridge seam; renderer code should not use `window.api` directly.
- `src/renderer/src/shared/hooks` owns renderer orchestration hooks like app snapshot loading and branch-status polling so `App.tsx` and workspace components stay smaller.

## Testing and guardrails

- `bun run test` runs Vitest coverage for provider specs, git/backend helpers, state-store logic, branch-status parsing, snapshot building, terminal input behavior, and IPC contracts.
- `src/shared/contracts/architecture-guardrails.test.ts` enforces three core rules:
  - no raw IPC channel literals outside `src/shared/contracts/ipc.ts`
  - no direct `ipcMain.handle` outside `src/main/ipc/typed-ipc.ts`
  - no direct renderer `window.api` usage outside the shared API client
- Full validation for changes is `bun run lint && bun run test && bun run typecheck && bun run build`.

## Notes

- Worktree-backed threads prompt before deletion if the worktree is dirty.
- Worktree-backed threads can run an optional setup script on creation and an optional cleanup script on close.
- Existing worktrees can be attached as threads without rerunning the worktree setup script.
- Verified commits are enforced by local git hooks; `git commit --no-verify` is blocked.
- Normal install/dev/build flows do not require Python on platforms where native binaries are shipped.
- `node-pty` is still a native dependency; Linux may require a local rebuild with the native build tools above.
