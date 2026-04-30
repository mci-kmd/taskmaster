# taskmaster

A personal Windows-only Electron app for running Copilot CLI inside the app and organizing repo-scoped threads.

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
