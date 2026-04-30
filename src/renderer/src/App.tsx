import TerminalPane from './components/TerminalPane'

function App(): React.JSX.Element {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="grid min-h-screen grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex flex-col border-r border-white/10 bg-slate-900/70">
          <div className="border-b border-white/10 px-5 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
              Taskmaster
            </div>
            <h1 className="mt-2 text-xl font-semibold text-white">Copilot thread orchestrator</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Embedded Copilot CLI, repo-scoped threads, and owned worktrees.
            </p>
          </div>

          <div className="flex-1 overflow-auto px-4 py-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                Repositories
              </h2>
              <button className="rounded-md border border-cyan-400/30 bg-cyan-400/10 px-2.5 py-1 text-xs font-medium text-cyan-200">
                Add repo
              </button>
            </div>

            <div className="space-y-3">
              <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">example-repo</div>
                    <div className="mt-1 text-xs text-slate-400">C:\Code\example-repo</div>
                  </div>
                  <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                    2h
                  </span>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-white">feature/embedded-cli</div>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-300">
                        worktree
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">last active 14m ago</div>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">main</div>
                      <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                        active branch
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-400">last active 1w ago</div>
                  </div>
                </div>
              </section>
            </div>
          </div>

          <div className="border-t border-white/10 px-4 py-3 text-xs text-slate-400">
            Bun + Electron + React + Tailwind 4
          </div>
        </aside>

        <main className="flex min-w-0 flex-col">
          <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">Embedded CLI spike</div>
              <div className="mt-1 text-sm text-slate-400">
                Copilot now launches inside the app. Repo/thread routing comes next.
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
                port 5175
              </span>
              <span className="rounded-full border border-white/10 bg-slate-900 px-3 py-1 text-slate-300">
                embedded terminal
              </span>
            </div>
          </header>

          <section className="flex-1 overflow-auto p-6">
            <div className="mx-auto grid w-full max-w-5xl auto-rows-min gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <TerminalPane />

              <div className="self-start space-y-4">
                <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <h2 className="text-base font-semibold text-white">Implementation focus</h2>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    <li>Bind terminal sessions to actual repo/thread records</li>
                    <li>Let new threads choose active branch or owned worktree</li>
                    <li>Persist session metadata and recent activity</li>
                  </ul>
                </section>

                <section className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
                  <h2 className="text-base font-semibold text-white">Current limitations</h2>
                  <ul className="mt-3 space-y-2 text-sm text-slate-300">
                    <li>The terminal launches in the app working directory for now</li>
                    <li>Repo selection and thread lifecycle are still UI placeholders</li>
                    <li>Packaging-native rebuild stays opt-in until Python tooling is available</li>
                  </ul>
                </section>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  )
}

export default App
