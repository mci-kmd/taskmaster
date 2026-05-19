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

## Notes

- Worktree-backed threads prompt before deletion if the worktree is dirty.
- Worktree-backed threads can run an optional setup script on creation and an optional cleanup script on close.
- Normal install/dev/build flows do not require Python on platforms where native binaries are shipped.
- `node-pty` is still a native dependency; Linux may require a local rebuild with the native build tools above.
