# taskmaster

A personal Windows-only Electron app for running Copilot CLI inside the app and organizing repo-scoped threads.

## Current features

- Add git repositories from a folder picker
- Create persisted threads in active-branch mode or owned-worktree mode
- Launch Copilot CLI inside the embedded terminal per selected thread
- Resume prior Copilot sessions by persisted thread session name
- Configure global Copilot flags for all thread launches
- Remove owned worktrees and branches when closing a worktree-backed thread

## Stack

- Bun
- Electron + electron-vite
- React + TypeScript
- Tailwind CSS 4

## Prerequisites

- Bun
- Git for Windows
- GitHub Copilot CLI installed and already signed in

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

### Build

```bash
bun run build

bun run build:win
```

Renderer dev server runs on port `5175`.

## Notes

- Worktree-backed threads prompt before deletion if the worktree is dirty.
- Native Electron rebuild stays opt-in through the packaging scripts. On this machine, `node-pty` packaging rebuilds require Python to be installed.
