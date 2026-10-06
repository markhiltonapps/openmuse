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

**This project (owner, 2026-10-01): no time is logged.** Don't ask for hours and don't update
`docs/time_log.txt`; the rest of this section is for projects that bill.

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

## Keep the Help guide up to date

The app has a Help guide (☰ › Help & how-to, Apps › Help) that the agent also answers from by
voice and chat (`get_help`). Any change people can see or ask for updates it in the same commit:

- Edit `packages/domain/src/help.ts`: add or change the topic (steps, what to say, `place` or
  `more` for the screens it's about, related topics). A new screen in `APP_PLACES` needs a topic;
  `tests/help.test.ts` fails until it has one.
- If a screen in a topic's picture changed, retake its screenshots with `scripts/help-shots.mjs`
  (instructions at its top), and add a shot there for a new screen that needs one.
- Admin-only setup (Railway, keys, services) goes in the `admin` group.
- Mention the Help change in the session notes.

## Lessons learned

- **Voice first (owner, 2026-10-01):** anything a person can tap or look up must also be doable
  by saying it, on a call or in the chat; typing is a distant second. When the agent says
  something is "on your screen", a card for it must actually appear there (on the call screen
  and in the conversation). Fewest taps wins.
- **"It's on your screen" must be true:** a tool result tells the agent a card is on screen
  (`shown`) only when the app will really draw one; an empty answer gets no card and no claim.
- **Sign-in tabs from a card:** open the tab during the tap (`blankTab()` in own-apps.tsx), then
  point it at the link once the server answers (`openPage`); a `window.open` after an `await` is
  often blocked. Offer an "Open the sign-in page" button if it still is.
- **Signing in during a call:** a Connect card on a call holds off the quiet hang-up for 5 minutes
  (`quietUntil` in voice-live.ts); signing in is silent and slow.
- **No buttons swapping on load:** anything that depends on a server check (live talk on/off) is
  remembered in localStorage and shows nothing while unknown, so controls don't move under a thumb.
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
  `/agent/default/run` with an AG-UI SSE stream of scripted events. If the chat still says it's
  unavailable, also set `runtime.richThreads: false` in a mocked `/api/workspace`.
- **Disabled links in Playwright:** it won't click an `aria-disabled` link; use
  `click({ force: true })` to test what happens when someone taps one anyway.
- **pnpm in a copied tree:** with symlinked `node_modules`, `pnpm typecheck`/`pnpm test` try to
  reinstall (and would wipe the real modules). Run `tsc --noEmit` and `tsx --test` directly there.
- **Taking control of the agent's browser:** anything a person does there must behave like a real
  browser: a hold is live (press sends down, release sends up), letting go elsewhere lets go there,
  and a press that turns into a scroll must not click. It's a live, signed-in site with no approvals.
- **Background jobs and placeholders:** a job text like "my bank's website" is sent literally, and a
  job with no real site can't start. Give people boxes to fill in, and have the agent ask.
- **Full-page screenshots:** the app scrolls inside its own container, so Playwright's
  `fullPage` only captures the first screen. Use a tall viewport (e.g. 390×3400) instead.
- **Biome and string quotes:** Biome may switch a long string to single quotes. Before editing an
  agent-facing string with apostrophes, check its quotes (a single-quoted one needs `\'`).
- **Container restarts:** uncommitted work survives, but background servers don't. Before a long
  wait, save `git diff` and new files to the scratchpad so nothing depends on one container.
- **Job emails and notify():** `notify()` returns whether the update is new; send anything extra
  (email) only then, because maintenance re-publishes every job's outcome each minute.
- **Tool steps in a chat's history:** the model refuses any conversation where a tool call isn't
  followed straight away by its result, and then every later message in that chat fails.
  `repairToolSteps` (engine/tanstack-agent.ts) fixes cut-off steps anywhere in the history before
  each model call. Failed replies are logged as "A chat reply failed: …"; the app keeps the
  first real error, not the "Cannot send event type…" bookkeeping error that follows it.
- **A job starts again after each approval:** it keeps only its saved state, so it must be told
  what it has done (`done` in engine/job-steps.ts) and a repeat must be caught by what the step
  does (app + tool + short arguments), never by the agent's own summary or long text it rewrites
  each time. One Idea once asked four times for the same Google Drive spreadsheet.
- **Checkboxes and choices:** a checkbox's box needs the `edge` colour (1.5px) to be seen on a
  card, and Space must toggle it (`onKeyDown`; RN-web's Pressable passes it on). When only one of
  several options can be chosen, use `CheckRow`'s `radio` (a round box, `role="radio"` inside a
  `radiogroup`), not a column of checkboxes.
- **How answers are laid out (owner, 2026-10-03):** an answer covering several things leads with
  a one-sentence short answer, groups items under **bold** lines (Needs action / FYI only), one
  bullet each starting with a bold name, then one offer (`answer-layout.ts`, chat and jobs). An
  inbox check reads every connected mailbox and the sent mail before saying a reply is owed, and
  counts alerts and failed payments as needing the person (`inboxCheckInstructions`).
- **Which model does which job (owner, 2026-10-06):** chat, background jobs and simple jobs each
  get a model from `service.modelFor(job)` (model-choices.ts; the admin's AI models card).
  OpenRouter models ("openrouter/vendor/model") use the installed Chat Completions adapter on
  `OPENROUTER_API_KEY`, with effort, an output cap and a context cap; without the key everything
  stays on MODEL / WORKER_MODEL (Claude). Never a "-pro" model. Price a new model in usage.ts
  (with its cache-read price) or its cost shows as unknown. A routed call that fails before its
  first word falls back to the server's model (`withFallback`; TanStack adapters report a failure
  as RUN_STARTED then RUN_ERROR chunks, not a throw), and a model typed on the card is checked
  against OpenRouter's public list (`/api/v1/models`, no key needed) before it's saved.
- **Tests never see real keys:** `pnpm test` runs with `OPENROUTER_API_KEY` removed
  (`env -u` in package.json). With the key present, every test that builds the app sends its
  chat to the real OpenRouter (it spent about $0.05 once). Real-call tests are run by hand, with
  the owner's OK.
- **Prompt caching:** fixed instructions first, anything that changes (the time, the person's
  context, the task's state) last; one changing value early in a prompt makes everything after it
  full price.
- **"Connect it first" is a question:** `asksToConnect`/`connectLink`/`appToConnect`
  (packages/domain/src/app-names.ts) are shared by the server and the app, so a job asking for a
  connection waits for an answer and its page offers Connect plus a one-tap "carry on".
- **How a job's run ends:** the model may stop without finish_task. Only its text after the last
  tool call is its answer or question (earlier text is commentary); `readLastWords` in
  `engine/job-words.ts` decides which. Never show the whole run's text to the person.
- **Avatar clips in local screenshots:** they come from a CDN the sandbox can't reach. Route
  `/api/avatar-media/` in Playwright to `apps/mobile/public/home/neddy-wave-porthole.webp`.
- **Testing timers in Playwright:** `page.clock.install()` before `goto`, then `clock.runFor(…)`,
  to fire a 15-minute check without waiting (used for the new-version pill).
- **Light calls:** in a live call, read the agent's loudness from
  `RTCRtpReceiver.getSynchronizationSources()` (`audioLevel`, fresh when `rtpTimestamp` moves)
  rather than Web Audio, and fall back when it's absent. Batch caption updates, pass state only on
  change, and pause polling and looping animations while `liveCallOn()`.
- **Live voice details:** store what a hand-over shows (`show()`) before the voice is told the
  answer, so the app's fetch on `session.commentary.appended` finds it. Don't open an in-app view
  from the call sheet (it replaces the sheet and ends the call); open links in a new tab there.
- **Signed file links expire (15 min):** anything shown later (a saved call, a card) should fetch a
  fresh link (`GET /api/files/:id`) when tapped, not keep the one it was given.
- **Approvals where people are:** anything saved for approval shows its Approve card (approval-
  card.tsx) in the chat, on a call and in Activity; the agent must never send people to Activity.
  Tool messages are shared with background jobs (engine/model.ts), so keep them neutral; say where
  the card appears only in the chat prompt and VOICE_RULES.
- **Matching actions:** compare what an action does (app + tool + arguments, recipients + subject),
  never its title, summary or hash: the agent rewords those each time it sets something up again.
- **Always-mounted status lines inside a `gap` layout:** take the empty line out of the flow with
  `position: "absolute"` (1×1, opacity 0), or its slot adds a gap. Also give it
  `pointerEvents: "none"`: an invisible line still catches taps, and in a centred row it sits
  right in the middle (one swallowed every tap on the chat button).
- **Biome on a broken file:** if an edit leaves a parse error, `biome check --write` can apply odd
  fixes (it turned a reassigned `let` into `const`). Check `git diff` after fixing the break.
- **Worker deploys:** the browser worker (Railway service be23c5b9) redeploys only when
  `apps/worker` changes; other pushes show it as SKIPPED.
- **Live voice (OpenAI gpt-live-1):** the key never reaches the browser. The server creates the
  session (`POST /v1/live/sessions`) and returns only the SDP answer. It then attaches to
  `wss://api.openai.com/v1/live/sessions/{id}/attach` (Node 22's `WebSocket` takes `{headers}`) for
  transcripts, minutes and delegation. The browser's data channel can only send what
  `allowed_client_events` lists. api.openai.com is blocked in the sandbox, so test with a fake socket.
- **Fake WebRTC in Playwright:** replace `navigator.mediaDevices.getUserMedia` and
  `RTCPeerConnection` in `addInitScript`. Expose the fake data channel on `window` and play
  scripted server events through it (see the live-voice screenshot notes in the session docs).
- **Timers in services:** `unref()` long timers (idle checks, retries, call caps) so tests and
  shutdown don't hang. Give the service a `stop()` and call it from `index.ts`'s shutdown.
- **Railway variables are staged:** adding or changing a variable does nothing until someone
  chooses Deploy on the banner Railway shows. When telling the owner to add one, always include
  that step. After a deploy, the api's log line `Live voice on/off…` shows whether the voice key
  arrived.
- **New provider APIs:** check each request field's *type* against the SDK's `.d.ts`, not just
  its name (OpenAI Live wants `allowed_server_events` as `{ type }` objects; bare names were
  refused with a 400 on every call). Always log the provider's own error reason on the server
  (status, type, code, message, never the key), so a failure on Railway can be read from its logs.
- **Adding to a chat thread from the server:** CopilotKit Intelligence has no "append message"
  API. Have the app run the agent with `forwardedProps` (e.g. `{ spokenCall: id }`) and let
  `ConversationAgent` emit the message itself without a model, so the runtime saves it like any
  turn. Give it a recognisable message id (`spoken-…`) so the chat can render it as a card.
- **Running the chat agent without a browser:** `new ConversationAgent(config, agentService,
  owner).run(input)`. The last user message's id keys every tool's idempotency, so give each
  request a fresh one (e.g. `voice-<call>-<delegation>`). Nothing is saved to any chat.
- **Two mailboxes:** `search_mail`/`read_mail_thread` read the app's built-in Google sign-in (not set
  up on Railway); Gmail and Outlook under Apps go through Composio (`find_app_actions`, `use_app`).
  A tool that says "disconnected" must say which connection, or the agent sends a Connect card for an
  app that's already connected, over and over. Each chat turn is told which mailbox is on ("Mail").
  Background jobs (engine/model.ts) have their own copies of the built-in tools (read_workspace,
  read_mail_thread, prepare_email, prepare_event) and their own prompt: a fix to the chat's tools
  or prompt must go into jobs too (engine/mailboxes.ts holds the shared wording). A job once said
  it couldn't reach Gmail because read_workspace quietly returned an empty built-in inbox.
- **The call is its own layer:** the live call lives in `LiveCallProvider` (live-call.tsx); its
  screen opens over whatever sheet is open (`expand`/`shrink`), never as a `detail`, or opening it
  throws that sheet away. Most of the app reads `useCallControls()` (changes only with the phase);
  only the bar and call screen read `useLiveCall()` (words), so talking doesn't redraw every screen.
- **Focus traps and tooltips:** RN-web's modal focus trap walks a sheet's buttons in order, so a
  focus move made while it runs is carried past; move focus after it (`setTimeout(…, 0)`). Focusing
  a button with a tooltip shows the tip, and the first Escape only hides it; in Playwright, press
  Escape again if the dialog is still there. `role="dialog"` is only on the topmost modal.
- **Check for a live call right before pushing,** not minutes before: a push restarts the api
  within about a minute and ends any call.
- **"Remember this" needs a real home:** when people ask the agent to keep something (their
  address, their weight), it should land in a place they can see and change (an About you fact, a
  tracker), not a free-text note. And the voice never says "sure, I can do that" before the answer
  comes back: it doesn't know yet what can be done.
- **Help screenshots (`scripts/help-shots.mjs`):** each shot's `go()` puts the screen where it
  should be; `mark()` never scrolls, or the marks drawn earlier end up in the wrong place. Sample
  approvals need a future `expiresAt` in the mocked workspace, or they show as expired. After
  taking shots, rebuild the web app (`npx expo export --clear`) before checking them in Help,
  because the build copies `public/` when it's made.
  The pictures mock CopilotKit's chat list (as on Railway), so the chat button reads "Main chat".
- **Cards that do something (switch chats, open a place):** act only for a live result: one seen
  unfinished, a reply to a message sent from this screen (`BrowserRunContext`'s `fresh`), or on a
  live call. A card drawn again from a chat's history (a reload, another device, a saved call) only
  says what happened. Playwright sends a mocked SSE body all at once, so a card's first render can
  already be complete.
- **Mocking chats in Playwright:** set `runtime.richThreads: true` in `/api/workspace`; GET
  `/api/copilotkit/threads` → `{threads, nextCursor: null}` (404 for `subscribe`); `.../connect` →
  an SSE body with `MESSAGES_SNAPSHOT`; `/api/main-thread` → `{threadId, existing}`. Give mocked
  tool calls ids that are unique across runs (e.g. `Date.now()` in them): the sample server keeps
  each chat's saved copy, and a reused id makes a new call look like an old one from history.
- **Lint scope:** `pnpm lint` also checks an untracked `_backups/` folder at the repo root if one
  is there. Keep backups in the scratchpad, or run `npx biome check apps packages scripts tests`.
- **Example phrases people can tap:** an example that would save, change or start something ("I
  weighed 173", "Remind me to…") must open the chat with the words in the message box
  (`draft()` in the workspace), never send in one tap; only questions that change nothing send
  straight away. Phrases with "this" need somewhere to point (a photo, a call).
- **Sheets whose contents change size** (search results, pages inside a sheet) take `fill` on
  `Sheet`, so the sheet keeps one height and nothing moves under a thumb while typing.
