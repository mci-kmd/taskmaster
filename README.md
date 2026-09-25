# taskmaster

A personal Electron app for organizing repo-scoped Copilot SDK conversations and workspaces.

## Current features

- View all threads across projects in activity order, with manual settle/unsettle and a collapsed Settled threads section
- Choose a project from the sidebar to manage tasks, edit its configuration, or create a thread
- Create Copilot threads on a branch or worktree; settling preserves sessions, branches, and worktrees without cleanup, and keeps the current project selected
- Choose a predefined project icon and color as a fallback for custom favicons
- Browse available Copilot models through nested family submenus, preserving the active model and per-model reasoning settings
- Change model and reasoning effort while Copilot works; the queued choice applies to the next message
- Quitting while Copilot agents are still working asks for confirmation and lists the busy threads
- Open Model performance beside Settings to compare end-to-end output tokens/second and time to first token for used models over 1h, 1d, 1w, or 30 days; hover or focus chart intervals (arrow keys move between them) for each model's measurements. Completed intervals stay fixed while the current interval updates; the labeled vertical scale adjusts for new maxima. Samples are collected from new calls and kept locally for 30 days
- Reopen unused threads after a restart even when Copilot has not yet written their session event log
- Recall sent prompts with Up/Down from an empty composer; history stays within the thread and restores from its session
- Paste, drop, or pick files in the composer: each appears as a `📎 name` chip at the cursor so you and Copilot see where it belongs, and images show thumbnails. Chips behave like single characters: arrow keys skip them, typing never splits them, and deleting a chip (or its card) removes the file
- Browse Copilot skills with `/` at the start of a message or `$` within it; filter by name or description, select with arrows and Enter/Tab, and dismiss with Escape
- Discover project and personal Copilot skills from the session configuration and expand selected skills through the SDK when sending, retaining the original prompt in history
- Add git repositories from a folder picker
- Create persisted threads on the active branch, an existing branch, a new branch, or a worktree
- Open a plain shell terminal in a thread's working directory
- Resume Copilot conversations by persisted session ID
- Configure automatic permission approval (enabled by default); managed-policy approvals still prompt. Settings apply to newly opened sessions
- Sign in to MCP servers that require authentication from the session view; sign-ins are kept in the OS keychain and reused by later sessions
- Remove owned worktrees and branches when closing a worktree-backed thread
- Configure optional setup and cleanup scripts for worktree-backed threads

Existing SDK conversations from both former views remain in the unified list. Embedded-CLI threads are discarded; no CLI session migration is performed.

## Stack

- Bun
- Electron + electron-vite
- React + TypeScript
- Tailwind CSS 4

## Prerequisites

- Bun
- Git
- GitHub Copilot CLI installed and already signed in (used by the Copilot SDK runtime)
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
- `src/main/copilot` manages Copilot SDK sessions and runtime updates; `src/main/terminal` runs plain shells.
- `src/main/backends` contains native command, path, and git helpers.
- `src/main/features` is where main-process feature logic now lives; persistence, project-task rules, branch-status parsing, and snapshot building have started moving out of `app-state.ts`.
- `src/renderer/src/shared/api/client.ts` is the renderer bridge seam; renderer code should not use `window.api` directly.
- `src/renderer/src/shared/hooks` owns renderer orchestration hooks like app snapshot loading and branch-status polling so `App.tsx` and workspace components stay smaller.

## Testing and guardrails

- `bun run test` runs Vitest coverage for git/backend helpers, state-store logic, branch-status parsing, snapshot building, shell terminals, and IPC contracts.
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
