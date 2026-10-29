# taskmaster

A personal Electron app for organizing repo-scoped Copilot SDK conversations and workspaces.

## Current features

- View all threads across projects in activity order, with manual settle/unsettle and a collapsed Settled threads section. Suspend an idle thread (pause button on its card) to park it, compact and greyed, below the other active threads; Unsuspend, a new prompt or settling brings it back
- Snooze a thread from its right-click menu (1 hour, tomorrow 08:00, next Monday 08:00, or a custom time) to move it into a collapsed Snoozed threads section above the settled ones. When the time comes it returns to the top of the inbox marked Awakened (yellow, like Done) until you interact with it; Unsnooze, a new prompt or settling ends a snooze early
- Choose a project from the sidebar to manage tasks, edit its configuration, or create a thread
- Star projects in the sidebar's project picker (click the star or press `*`) to list them as favorites at the top
- Drag project tasks by their handle (or focus it and use ↑/↓) to order them by priority; tasks may be added without any title or description
- Search tasks by `#number`, title or description (debounced, with highlighted matches), filter by one or more labels, and clear both at once; reordering still works while filtered
- Every task has a per-project number shown as `#N` (existing tasks are numbered oldest first on upgrade)
- Link a task to a GitHub issue (issue URL or `owner/repo#123`) when adding or editing it; the card shows a `#123` chip with an issue icon (hover for the full `owner/repo#123` and URL) that opens the issue in the browser, Clear removes the link, and search also matches linked issues
- Copilot sessions can list/search, create, edit (including labels and the GitHub issue link) and complete the project's tasks via `taskmaster_*` tools; the tools tell the agent these are the user's tasks, to be changed only when asked. Listing needs no approval; changes follow the normal permission prompts
- Ask Copilot to resolve its own thread when it is done (e.g. "fix the bug, then resolve yourself"): the `taskmaster_settle_thread` tool settles the thread without moving the selection. Its description tells the agent never to use it unless asked
- Copilot links a thread to the GitHub issues/pull requests or Azure DevOps work items it works on, via the `taskmaster_link_work_items` tool, which tells it to do so automatically. The thread card shows a `#123` link per item (issue, pull request or work item icon; hover for the full reference and title) that opens it in the browser, and the card's tooltip lists them. Links cannot be edited by hand; ask Copilot to change them
- Turn each askmaster_* tool on or off in Settings → Tools; Edit project → Copilot tools overrides them per project (Default/On/Off). Turning a tool off applies to open sessions right away (calls are refused); turning one on applies to newly opened sessions
- Completed tasks are kept rather than deleted: open them from the quiet "N completed tasks" link below the task list, newest first, with the same search and label filters, and reopen any of them
- Tag tasks with global labels from Settings plus optional project-specific labels from Edit project
- Threads are named automatically after your first message, using the project's commit message model; a title you set in Edit thread replaces it, and **Regenerate title** in a thread's menu writes a new one from the conversation (replacing any manual title)
- Create Copilot threads on a branch or worktree; settling preserves sessions, branches, and worktrees without cleanup, and keeps the current project selected
- Choose a predefined project icon and color as a fallback for custom favicons
- Settings and Edit project are split into sections (Edit project: General, Run & preview, Worktrees, Tasks, Commits, Danger zone) navigated from a sidebar (↑/↓ move between sections). There is no Save button: toggles and pickers save immediately, text fields after a short pause in typing, on Enter or blur, and when the dialog closes (Esc). The header shows the save status; a rejected value, such as an invalid preview URL, is flagged next to its field and on its section while the last valid value stays saved
- Browse available Copilot models through nested family submenus, preserving the active model and per-model reasoning settings; star models (click the star or press `*`) to list them as favorites at the bottom of the picker
- Mark outdated models as legacy in Settings: the model picker tucks them under a collapsed Legacy row at the end of their family (shown only for families with legacy models, and opened automatically when the current model is legacy). Copilot is kept from picking legacy models on its own, e.g. for sub-agents, while a legacy model you choose for a session stays usable
- Change model and reasoning effort while Copilot works; the queued choice applies to the next message
- Press Page Up/Page Down in the message box to raise or lower the selected model's reasoning effort
- Copilot always works in Interactive mode; turn on **Show the mode picker** in Settings → Copilot to pick Plan or Autopilot for the next message
- While Copilot works, the indicator at the end of the conversation shows how long it has spent on the current prompt
- Running sub-agents are listed below it with their name, task, model and runtime, including background ones that outlive the turn
- Copilot's questions list their choices visibly, with an **Other** field for answering in your own words. Instead of using a pending question, permission prompt or plan approval, you can type in the composer and press **Reply**: permission prompts and plans are declined with your reply as feedback, and questions are skipped with your reply sent as a steering message
- The conversation keeps each question, permission prompt and plan approval Copilot showed together with your answer (or your reason for declining), including after a restart
- Quitting while Copilot agents are still working or an AI commit is in progress asks for confirmation and lists the busy threads
- Thread cards show a pulsing Committing badge while an AI commit runs (hover for the current step) and a green play marker while the thread's run command is running
- Thread cards show the logo of the last prompted model's family (logos from [svgl](https://svgl.app)) and the checkout mode (worktree or local branch) at the card's edge. On hover they fade out and the suspend and settle buttons fade in; right-click a card for its menu. The card's tooltip names the model and mode in full
- Open Model performance beside Settings to chart used models over 1h, 1d, 1w, or 30 days, toggling between Performance (end-to-end output tokens/second as a solid line and time to first token as a dashed line, in one chart with a labeled scale for each), AI credits used, and estimated DKK cost (1 credit = $0.01; the USD→DKK rate is looked up at startup, with a built-in fallback). Hover or focus chart intervals (arrow keys move between them) for each model's measurements. Completed intervals stay fixed while the current interval updates; the labeled vertical scales adjust for new maxima. Samples, including each call's billed AI credits, are collected from new calls and kept locally for 30 days; older samples without credit data still show performance
- Reopen unused threads after a restart even when Copilot has not yet written their session event log
- Recall sent prompts with Up/Down from an empty composer; history stays within the thread and restores from its session
- Browse a thread's prompts from the rail at the left edge of the conversation (shown from the first prompt): each bar is one of your prompts, and the bar for the prompt in view is highlighted. Hovering magnifies the bars near the pointer and previews their prompts over the conversation; click a bar to scroll to that prompt. Tab into the rail and use ↑/↓, Home/End and Enter to do the same from the keyboard. Long threads list only the newest 15 prompts (numbered within the whole thread); reduced-motion preferences turn off the animation and smooth scrolling
- Pin Copilot messages for later reference with the pin button under each message: pinned messages are listed in a matching rail at the right edge of the conversation, each previewed by a short AI-written title (using the commit message model), and click a bar to scroll back to one. Pins are kept with the thread and cleared when it starts a new conversation
- Next to the pin button on the last Copilot message of each turn, **Reset to here** cuts the conversation back to the end of that turn (after confirming; file changes are not reverted), and **Fork from here** opens a new thread with the conversation up to that point. **Fork thread** in a thread's menu forks the whole conversation. Forks share the original thread's checkout; closing the thread that created the branch or worktree hands it over to a fork still using it
- The aside button in the composer opens an **Aside** panel over the right of the conversation: a side conversation on a copy of the thread's conversation, for questions that shouldn't disturb the thread. It keeps its history while you switch back and forth (Esc closes it), shows a dot on its button while it works, and **Start over** copies the thread's conversation afresh
- Paste, drop, or pick files in the composer: each appears as a `📎 name` chip at the cursor so you and Copilot see where it belongs, and images show thumbnails. Chips behave like single characters: arrow keys skip them, typing never splits them, and deleting a chip (or its card) removes the file
- Pasting more than 15 lines of text collapses it into a `📎 Pasted text, N lines` chip; click its card to read it in a read-only dialog, or remove it with its ×. The full text is sent in the chip's place
- Browse Copilot skills with `/` at the start of a message or `$` within it; filter by name or description, select with arrows and Enter/Tab, and dismiss with Escape
- Commit from the composer: when no session in the checkout is working and it has uncommitted changes, a commit button (Ctrl+S) appears left of Send. It stages everything and commits with a message written by a background Copilot agent (Luna 6, medium effort by default), showing separate progress while the message is written and while a pre-commit hook runs. Edit project sets the commit message model and effort, and can push to the remote after each commit (off by default). When nothing is left to commit but the branch has unpushed commits, the button pushes instead; Ctrl+D pushes whenever there are unpushed commits. A commit or push in progress keeps showing when you switch threads and back
- Discover project and personal Copilot skills from the session configuration and expand selected skills through the SDK when sending, retaining the original prompt in history
- Skills loaded into the conversation appear as a marker naming them (skills loaded together share one line) and whether you or Copilot asked for them; hover a skill name for its description
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

Dev builds use an orange variant of the app icon (`resources/icon-dev.png`, `build/icon-dev.ico`) so they are easy to tell apart from the installed app in the taskbar.

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
