# Renderer design system

The renderer's look comes from four things: **tokens** (themeable values), **component classes**
(`tm-*` CSS for anything with states or structure), **primitives** (`components/ui/*`, `Modal`,
`Toast`) and **motion presets**. Prefer composing these over new one-off styles.

## Themes and tokens

- `src/shared/themes.ts` lists the themes (Graphite, Slate, Mist, Stone, Porcelain): labels, light
  or dark appearance and the window background the main process paints before the renderer loads.
- `styles/themes.css` holds every theme's values, keyed by `[data-theme]`. `<html>` always carries
  the active theme (`lib/theme.ts`), and any element may carry another to preview it in place.
- `styles/tokens.css` names the tokens and registers them with Tailwind, so they are available as
  utilities: `bg-panel`, `text-fg-muted`, `border-border-strong`, `bg-accent/15`, `elevation-pop`.

Use semantic tokens only. No hex values, `rgba()` literals or Tailwind palette colors (`bg-black/50`)
in components; if a role is missing, add a token to every theme. Roles:

| Token                                               | Use                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `bg`                                                | window backdrop                                                   |
| `sidebar`, `panel`                                  | the sidebar plane and the workspace card; dialogs use `panel`     |
| `surface`, `surface-2`                              | quiet tiles inside a panel; recessed tracks and inline code       |
| `input`, `raised`, `popover`                        | fields and the composer; raised controls and selected rows; menus |
| `hover`, `control-hover`, `active`                  | translucent state layers that work on any surface                 |
| `fg`, `fg-muted`, `fg-subtle`, `fg-faint`           | text, from primary to decorative-only                             |
| `accent*`                                           | cobalt: selection, focus, the primary action, live work           |
| `accent-2*`                                         | coral: the logo, things that need you, skills. Use sparingly      |
| `positive`, `warning`, `danger`, `info` (+ `-soft`) | status                                                            |
| `syntax-*`                                          | code                                                              |
| `elevation-card/raised/pop/inset/accent`            | shadows (utilities of the same name)                              |

The shell (`tm-app`, `tm-app-sidebar`, `tm-workspace-card` in `components/layout.css`) reads layout
tokens (`--sidebar-inset`, `--sidebar-elevation`, `--workspace-elevation`), which is how Slate floats
its sidebar as a card and Stone sinks the workspace into a well.

Canvases that can't read CSS variables (xterm, Monaco) resolve tokens with `readThemeColor()` and
re-theme when `useTheme()` changes.

## Where styles go

- `styles/index.css` imports everything. Layers, lowest precedence first: `base` (element defaults,
  `base.css`), `components` (`tm-*` classes), `utilities` (Tailwind). Utilities therefore override
  component classes; resets never beat either.
- `components/<area>.css` holds an area's `tm-*` classes inside `@layer components`. Overrides of
  third-party CSS (xterm, react-diff-view, Monaco) stay unlayered so they beat those libraries.
- Use Tailwind utilities for layout and one-off spacing; use a `tm-*` class when an element has
  states (hover, selected, data attributes), is reused, or needs more than a handful of utilities.

## Primitives

`Button` (`primary` / `secondary` / `ghost` / `danger`; `xs`–`lg`; `iconOnly`; `aria-pressed` for
toggles), `TextInput` / `TextArea` / `Field`, `Checkbox`, `Select`, `SegmentedControl`, `ActionMenu`,
`Modal`, `Toast`, `Presence`. Use these instead of hand-rolled buttons and inputs.

## Motion

Everything that appears, disappears or moves animates, using the presets in `styles/motion.css`:

| Preset     | For                                                           |
| ---------- | ------------------------------------------------------------- |
| `fade`     | scrims, crossfading views, overlays                           |
| `pop`      | dialogs and centered surfaces                                 |
| `drop`     | popovers and menus opening from their trigger                 |
| `rise`     | toasts, floating pills, content appearing in place            |
| `collapse` | in-flow content whose arrival or removal moves its neighbours |

- Conditional content: wrap it in `<Presence show={…} motion="…">` (a single DOM element child).
  It keeps the element mounted, showing its last content, while it animates out.
- Things that manage their own mounting (popovers, dialogs): `usePresence(open)` gives `mounted`
  and `state`; render while `mounted` with `data-motion` and `data-state={state}`.
- Lists: `usePresenceList` + `useAnimatedListMotion` animate insertions, moves and removals.
- Two icons sharing one slot (run/stop, branch/worktree): `tm-icon-swap` with `data-active` on each.
- Keyed replacements that don't need an exit: the entrance classes `tm-fade-in`, `tm-rise-in`,
  `tm-pop-in`, `tm-slide-in`.
- State changes (hover, selection, color) transition with `--duration-fast`; movement uses
  `--duration-base`/`--duration-slow` with `--ease-out`; exits use `--duration-exit` with `--ease-in`.
- `prefers-reduced-motion` collapses every animation; `canAnimate()` is false then (and in tests),
  so presence unmounts immediately.

## UI gallery

Run the app in dev mode and open it with `#gallery` (for example
`http://localhost:5173/#gallery?theme=slate&section=session`). Each file in `gallery/sections/`
renders real components with fixture data. Add a section when you build a new surface or state.
