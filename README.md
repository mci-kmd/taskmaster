# taskmaster

A personal Electron app for organizing repo-scoped Copilot SDK conversations and workspaces.

## Current features

- View all threads across projects in activity order, with manual settle/unsettle and a collapsed Settled threads section
- Choose a project from the sidebar to manage tasks, edit its configuration, or create a thread
- Drag project tasks by their handle (or focus it and use ↑/↓) to order them by priority; tasks may be added without any title or description
- Search tasks by title or description (debounced, with highlighted matches), filter by one or more labels, and clear both at once; reordering still works while filtered
- Completed tasks are kept rather than deleted: open them from the quiet "N completed tasks" link below the task list, newest first, with the same search and label filters, and reopen any of them
- Tag tasks with global labels from Settings plus optional project-specific labels from Edit project
- Create Copilot threads on a branch or worktree; settling preserves sessions, branches, and worktrees without cleanup, and keeps the current project selected
- Choose a predefined project icon and color as a fallback for custom favicons
- Browse available Copilot models through nested family submenus, preserving the active model and per-model reasoning settings; star models (click the star or press `*`) to list them as favorites at the bottom of the picker
- Change model and reasoning effort while Copilot works; the queued choice applies to the next message
- Quitting while Copilot agents are still working asks for confirmation and lists the busy threads
- Open Model performance beside Settings to compare end-to-end output tokens/second and time to first token for used models over 1h, 1d, 1w, or 30 days; hover or focus chart intervals (arrow keys move between them) for each model's measurements. Completed intervals stay fixed while the current interval updates; the labeled vertical scale adjusts for new maxima. Samples are collected from new calls and kept locally for 30 days
- Reopen unused threads after a restart even when Copilot has not yet written their session event log
- Recall sent prompts with Up/Down from an empty composer; history stays within the thread and restores from its session
- Paste, drop, or pick files in the composer: each appears as a `📎 name` chip at the cursor so you and Copilot see where it belongs, and images show thumbnails. Chips behave like single characters: arrow keys skip them, typing never splits them, and deleting a chip (or its card) removes the file
- Browse Copilot skills with `/` at the start of a message or `$` within it; filter by name or description, select with arrows and Enter/Tab, and dismiss with Escape
- Commit from the composer: when no session in the checkout is working and it has uncommitted changes, a commit button (Ctrl+S) appears left of Send. It stages everything and commits with a message written by a background Copilot agent (Luna 6, medium effort by default), showing separate progress while the message is written and while a pre-commit hook runs. Edit project sets the commit message model and effort, and can push to the remote after each commit (off by default)
- Discover project and personal Copilot skills from the session configuration and expand selected skills through the SDK when sending, retaining the original prompt in history
- Add git repositories from a folder picker
- Remove a project from Edit project: a confirmation lists the active and settled threads and tasks that will be lost. Only Taskmaster's metadata is deleted; the repository, branches, and worktrees are untouched. Unavailable while any of the project's threads are working
- Create persisted threads on the active branch, an existing branch, a new branch, or a worktree
- Open a plain shell terminal in a thread's working directory
- Resume Copilot conversations by persisted session ID
- Configure automatic permission approval (enabled by default); managed-policy approvals still prompt. Settings apply to newly opened sessions
- Automatically sign in to MCP servers that require authentication when a session connects, without flashing a login button; show sign-in controls only when browser sign-in or manual retry is needed. Copilot uses persistent OAuth storage for later sessions
- Remove owned worktrees and branches when closing a worktree-backed thread
- Configure optional setup and cleanup scripts for worktree-backed threads
- Opt into a Preview view by setting a project's Preview URL next to its run command (supports the same branch tokens). While the thread's run command runs, browse the app beside the conversation and use Comment (or Ctrl+Shift+C in the page) to pick an element: it lands in the composer as a screenshot chip, and Copilot also receives its page, selector, role, text, HTML, and, when available, React/Vue/Svelte/Angular component names and source file. The preview waits for the dev server to come up, is disabled with an explanation while the run command is stopped, and keeps each project's site storage in its own isolated partition

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
- `src/main/preview` hardens preview `<webview>` guests (http(s) only, sandboxed, no Node or Taskmaster IPC, permissions denied except sanitized clipboard writes, popups opened in the default browser) and captures element screenshots; `src/preload/preview.ts` is the guest-only element inspector preload, which messages only its host view.
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
