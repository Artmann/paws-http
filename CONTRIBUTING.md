# Contributing to pawsh

Thanks for poking around the source. This guide covers the layout, the
development loop, and how to add features without breaking the parser for the
80-odd real `.http` files we regression-test against.

## Prerequisites

- [Bun](https://bun.com) 1.3+
- No Node or npm needed — everything uses Bun's runtime, test runner, and
  bundler.

## Setup

```sh
bun install
bun test              # 32 tests across parser, vars, sandbox, runner
bun run typecheck     # tsc --noEmit
```

Run the CLI directly — no build step:

```sh
bun src/cli.ts run examples/01-hello.http
bun src/cli.ts run examples              # interactive TUI
```

There's a tiny Bun mock server for end-to-end smoke-testing against a local
fixture:

```sh
bun scripts/mock-server.ts &                            # port 9753
CI=1 bun src/cli.ts run examples/01-hello.http
```

And a bulk parse job that confirms we don't regress on a real-world corpus of
`.http` files. Point it at any directory full of them — the more the better:

```sh
bun scripts/parse-all.ts /path/to/http-corpus
```

## Project layout

```
src/
  cli.ts                — arg parsing, dispatch (interactive vs. CI)
  discover.ts           — recursive .http file discovery
  env.ts                — http-client.env.json loader + merging
  vars.ts               — {{var}} substitution + built-ins
  sandbox.ts            — new Function() runner for pre/post scripts
  theme.ts              — colour tokens translated from the design system
  parser/
    types.ts            — Flow / Step / Body / ParseError types
    parser.ts           — line-based state machine
    parser.test.ts      — grammar fixtures
    parser.rider.test.ts — Rider-specific corner cases
  runner/
    types.ts            — StepReport, FlowReport, RunnerEvent
    runner.ts           — sequential executor, emits events
    runner.test.ts      — runner tests with injected fetch
  reporter/
    console.ts          — pretty console output for non-interactive runs
  ui/
    App.tsx             — Ink entry, screen dispatcher
    Launcher.tsx        — `pawsh` (no args) welcome
    Picker.tsx          — (kept for future use)
    RunScreen.tsx       — three-pane live view
    primitives.tsx      — StatusIcon, MethodBadge, ProgressBar, Kbd
examples/               — public-API demo flows used in docs and QA
scripts/                — dev helpers (mock-server.ts, parse-all.ts)
```

## Philosophy

- **Match Rider first, extend later.** If a feature behaves differently from the
  JetBrains HTTP Client, that's a bug unless we have a reason.
- **Keep scripts opaque.** We feed the body of `{% … %}` blocks straight into
  `new Function()` — we don't lex or rewrite JS ourselves. This keeps the parser
  small and avoids a hard dependency on a JS parser.
- **Events, not tight coupling.** The runner emits events (`step:start`,
  `step:done`, `flow:done`); the CLI reporter and the Ink UI both subscribe.
  When adding a new surface (e.g. JSON output), add a subscriber, don't reach
  into the runner.
- **Terminal-first.** No mouse, no images. One atomic `<Text>` per list row in
  Ink — wrapping causes silent layout bugs on small terminals.

## Adding a parser feature

1. Read the Rider docs for the exact syntax:
   <https://www.jetbrains.com/help/rider/Exploring_HTTP_Syntax.html>.
2. Add a synthetic fixture to `parser.rider.test.ts`.
3. Update the state machine in `parser/parser.ts`. Favour narrow regex additions
   over new states.
4. Run `bun scripts/parse-all.ts <corpus-dir>` against a real-world corpus — any
   new failures mean your change regressed a real file.
5. Update the "Supported HTTP file syntax" section in `README.md`.

## Adding a UI feature

1. Keep each list row a single `<Text>` with manual pad/truncate. Nested
   `<Box>` + `wrap="truncate"` causes off-by-one rendering on narrow terminals.
2. Use the theme tokens in `src/theme.ts` rather than hard-coded hex.
3. Test against three widths: wide (≥130 cols), medium (80–129), and narrow
   (<80). The layout breakpoints live at the top of `RunScreen.tsx`.
4. If you add a keybind, update the status bar hints AND the "Interactive keys"
   table in `README.md`.

## Running the test suite

```sh
bun test                                # fast, no network
bun run typecheck                       # strict tsc
bun scripts/parse-all.ts <corpus-dir>   # bulk parse (no network)
CI=1 bun src/cli.ts run examples        # end-to-end, hits public APIs
```

## Style

- **Formatting** — `bun run format` (Prettier). Config in `.prettierrc.json`: no
  semicolons, single quotes, 2-space indent.
- **Bracers after control statements** — `if (x) { … }` not `if (x) do();` (see
  `CLAUDE.md`).
- **Prefer editing existing files** over creating new ones when the change is
  small.

## Opening a PR

- Include a note of what `bun scripts/parse-all.ts <corpus>` reported before and
  after your change.
- If you're adding a new syntax feature, bump the "Supported HTTP file syntax"
  list in `README.md`.
- No need for changelogs or release notes yet; the project is pre-1.0.

Thanks — happy to review.
