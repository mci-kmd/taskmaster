# taskmaster

A personal Electron app for running an embedded LLM CLI inside the app and organizing repo-scoped threads.

## Current features

- Add git repositories from a folder picker
- Create persisted threads in active-branch mode or owned-worktree mode
- Launch Copilot CLI or Codex CLI inside the embedded terminal per selected thread
- Resume prior agent sessions by persisted session ID or name
- Configure the active provider and global provider flags for all thread launches
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
- GitHub Copilot CLI or Codex CLI installed and already signed in
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
- `src/main/providers` contains provider-specific CLI behavior behind the `LlmProvider` seam.
- `src/main/backends` contains backend-aware command and git helpers so native vs WSL behavior stays isolated.
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
- Normal install/dev/build flows do not require Python on platforms where native binaries are shipped.
- `node-pty` is still a native dependency; Linux may require a local rebuild with the native build tools above.
