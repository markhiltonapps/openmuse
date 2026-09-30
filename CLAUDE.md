## Claude Interaction Guidelines

**CRITICAL**: Ask me any questions you have. Interview me to get clarification.
Never assume or guess about requirements. If something is ambiguous, stop and ask
before acting.

### Back up before you change anything

Before modifying any file, database, configuration, or repository state, create a
backup first and confirm it succeeded before proceeding.

- **Files**: copy the original to a timestamped backup (for example
  `filename.bak.YYYYMMDD-HHMMSS`) or to a `_backups/` folder before editing,
  overwriting, or deleting. Do the same for every file in a multi-file change.
- **Databases**: take a dump or snapshot of the affected tables (or the whole
  database if the change is broad) before any schema change, migration, bulk
  update, or delete. Where a full backup isn't practical, at minimum export the
  rows that will be touched.
- **Version control**: commit or stash uncommitted work, and create a backup
  branch or tag before any history-rewriting or branch-altering operation.
- **Infrastructure and config**: export or record the current state (env vars,
  settings, DNS records, deployment config) before changing it.

Tell me where the backup is and how to restore from it. If a backup cannot be
made, stop and ask me to confirm next steps. If GitHub has a backup you do not
need to make another backup.

## Daily Work Sessions

At the end of each working session, create or update
`docs/claude_working_session_YYYYMMDD.txt` with a summary of the day's changes.
Include: what was changed, test results, known issues, and any pending items.
This provides a daily changelog for the project.

I will manually maintain `working_session_YYYYMMDD.txt` with my notes, prompts,
etc. Claude should use these working sessions as reference of previous changes
and work with priority on the most recent ones.

Also update any skills or CLAUDE.md with any lessons learned.

## Time Log

Track daily work for billing in `docs/time_log.txt`. That file is the single
source of truth for hours — do not duplicate hours anywhere else.

- One row per working day, in the markdown table format below.
- The `Summary` should be specific enough to justify the hours to a client
  (what changed, what was tested/fixed), not just "worked on X".
- At the end of each session, update the day's row (or add it). If a row for
  today already exists, extend its summary and adjust the hours rather than
  adding a second row for the same date.
- ALWAYS ask the user how many hours to log before writing — never guess the
  number.

Template:

```
Time Log — <Project Name>
=====================================================

| Date       | Summary                                                          | Hours |
|------------|------------------------------------------------------------------|-------|
| YYYY-MM-DD | Short, specific description of the day's work                    | 0     |
```

## Lessons learned

- **Deploys:** a push to `claude/deploy-openmuse-repo-oza7s9` deploys to Railway straight away.
  Commit locally and hold pushes until the user says "push it".
- **New UI goes through the Design division** before it's committed: visual (UI Designer),
  usability (UX Researcher) and copy reviewers, looping until all three sign off.
- **Layout width:** the app's content column is capped at 760px (`apps/mobile/App.tsx`), so a
  layout that changes with width should measure its own container (`onLayout`), not the window.
- **Local dates:** never use `toISOString().slice(0, 10)` for a day in the person's calendar; it
  gives UTC's day, which is a day off in some time zones. Build it from the local date parts.
- **Charts:** `react-native-svg` text falls back to a serif font on the web; give it the app's
  font family.
- **Shell:** `pkill -f <pattern>` (or `pgrep | xargs kill`) inside a longer command can kill that
  command's own shell when the pattern appears in it. Find processes with
  `ps aux | grep "[p]attern"` in a separate command.
- **Checks before a commit:** lint (Biome), `pnpm typecheck`, the worker's `tsc --noEmit`, and
  `pnpm test` (runs with tsx).
- **react-native-web 0.21:** it reads `role` and `aria-*` (`aria-checked`, `aria-label`), not
  `accessibilityState`; and `Pressable` ignores `hitSlop`. For a small control, make the
  `Pressable` itself 44×44 (negative margins keep the row's height) and draw the small shape
  inside it.
- **Keyboard focus on web:** react-native-web 0.21's `Pressable` ignores `focusable={false}`; it
  reads `tabIndex`. A press target that shouldn't be a Tab stop (chart bars and points) needs
  `tabIndex={-1}` (keep `focusable={false}` for native).
- **One-line text on the web:** react-native-web gives `numberOfLines={1}` text `max-width: 100%`,
  so it can't be wider than its parent even with its own `width`. To let a label use more room
  (a chart's month name over two columns), put it in a wider `View`.
- **Escape over a sheet:** an RN `Modal` on the web closes on Escape's key *up*. Anything that
  handles Escape itself above a sheet (a tip) has to hold back that keyup too, or both close.
- **Sheets hide toasts:** `Sheet` is an RN `Modal`, a separate top layer on the web, so a toast
  (`notify`) from inside a sheet can't be seen. Say what happened in the sheet itself.
- **Live regions:** keep a `role="status"` line mounted all the time and change its text; one
  that appears together with its text often isn't read out.
- **Layers on the web:** an absolutely positioned `View` paints over a later sibling that isn't
  positioned, such as a lucide icon's SVG. Wrap the icon in a `View` (positioned on the web) to
  keep it on top, e.g. a selected pill drawn inside a tab.
- **Sandbox network:** api.weather.gov and open-meteo are blocked by the sandbox's egress proxy,
  so weather can only be tested locally with mocked responses. Live checks happen on Railway.
- **Playwright on this app:** the bottom bar's buttons are `role="tab"`. Short names like "Open"
  or "Details" need `exact: true`.
- **Web builds:** Expo bakes `EXPO_PUBLIC_API_URL` into the bundle and caches it, so builds for
  different servers (helpers testing in parallel) can pick up each other's address. Use
  `npx expo export --clear` whenever more than one build is going. Serve the build with
  `python3 -m http.server --directory <dir>` so it survives a rebuild, and give background servers
  a long timeout (the default stops them after 30 minutes).
- **Typing in tests:** Playwright's `fill()` doesn't always reach a React Native `TextInput`'s
  `onChangeText`; use `pressSequentially()`.
- **Local sample server:** the API keeps its database at `${DATA_DIR}/postgres`. Seed into that
  folder, and only while the server is stopped (a running one can overwrite it).
- **Chat in Playwright:** the app's chat runs in CopilotKit intelligence mode, which can't start
  locally. Mock `/api/copilotkit/info` (mode "sse", no intelligence) and fulfil
  `/agent/default/run` with an AG-UI SSE stream of scripted events.
- **Disabled links in Playwright:** it won't click an `aria-disabled` link; use
  `click({ force: true })` to test what happens when someone taps one anyway.
- **pnpm in a copied tree:** with symlinked `node_modules`, `pnpm typecheck`/`pnpm test` try to
  reinstall (and would wipe the real modules). Run `tsc --noEmit` and `tsx --test` directly there.
- **Taking control of the agent's browser:** anything a person does there must behave like a real
  browser: a hold is live (press sends down, release sends up), letting go elsewhere lets go there,
  and a press that turns into a scroll must not click. It's a live, signed-in site with no approvals.
- **Background jobs and placeholders:** a job text like "my bank's website" is sent literally, and a
  job with no real site can't start. Give people boxes to fill in, and have the agent ask.
- **Worker deploys:** the browser worker (Railway service be23c5b9) redeploys only when
  `apps/worker` changes; other pushes show it as SKIPPED.
