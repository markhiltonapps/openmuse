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
- **Standing rule (owner, 2026-10-22):** every update to the app updates Help, with no exceptions
  and no "later". Whenever possible the topic is **visual**: screenshots of the real screen with
  numbered marks, and directions that point at what's in the picture ("tap the 2"), not walls of
  text. A feature isn't finished until its Help topic and pictures are in the same commit; if a
  picture can't be taken (a screen the sandbox can't show), say so in the session notes and why.
- **Standing rule (owner, 2026-10-22):** the website's home page (`apps/mobile/public/neddy.html`;
  also `pricing.html` and `compare.html` when a plan, price or comparison changes) is updated in the
  same commit as any feature people would notice. Say only what is true today, with its honest limits;
  retake its screenshots at 390×844 and 1280×800 and look at them.

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
  Local api runs too: the sandbox's shell has a real key, so start the server with
  `env -u OPENROUTER_API_KEY -u OPENAI_VOICE_API_KEY …` (a local run once made two real calls).
- **Prompt caching:** fixed instructions first, anything that changes (the time, the person's
  context, the task's state) last; one changing value early in a prompt makes everything after it
  full price. "Last" means after the conversation: the chat's time once sat in the system prompt,
  before the messages, so every turn re-read the whole conversation at full price (7.5¢ a message,
  5¢ a call hand-off). `withTail` (engine/tanstack-agent.ts) puts the volatile context
  (`VOLATILE_CONTEXT`) in the person's latest message and marks their words as a breakpoint;
  the steady context is its own cached system block. A new context entry that changes every turn
  must match `VOLATILE_CONTEXT`, or it silently breaks the cache again: check Railway's
  "Model call: chat … (N cached)" lines after adding one.
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
- **Approving by voice:** only the person's own words count: `approve_by_voice` checks the
  call's input transcript (OpenAI's transcript of their microphone) after a server-written
  read-back, never the model's judgement. Money and sign-in codes still need a tap.
- **Help screenshots (`scripts/help-shots.mjs`):** `node scripts/help-shots.mjs <ids>` retakes
  only those and keeps the others' sizes in `help-shots.ts`; check its diff afterwards. each shot's `go()` puts the screen where it
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
- **Pills that pop up on their own** (new version, backdrop Reopen) go in the top slot under the
  header (`NewVersion`'s `top`), never near the bottom, where New job, the toasts and the message
  box are. Show one at a time (`giveWay`); a "Not now" there has to be shared state.
- **The backdrop's colours are made once:** `glass` (theme.ts) is decided when the app opens, so
  turning the backdrop on or off needs a reopen (never during a call); a new scene or "hold still"
  changes live. The sandbox's Chromium can't play H.264, so clips show as their still frame here.
- **Base images come from `mirror.gcr.io`:** Docker Hub turns Railway's shared builders away
  with 429 Too Many Requests, and retrying doesn't help. `infra/*.Dockerfile` take Node and Caddy
  from Google's mirror (`mirror.gcr.io/library/<image>`); do the same for any new image.
- **The main chat is kept in parts (main-pages.ts):** past ~1 MB it starts a new CopilotKit thread on
  the next open; earlier parts are saved whole in "main-pages", hidden from the Chats list
  (`isMain`), summarized for the agent and searched by search_earlier_chat. Anything that walks
  "the main chat" (export, reset, a call's snapshot) must include the parts.
- **Chat rows redraw by signature:** CopilotKit may update a message object in place while it
  streams, so `MessageRow` (chat-rows.tsx) compares a text signature (words, tool-call argument
  lengths, result lengths), not the object. Pass it stable callbacks, or every row redraws.
- **Opening a chat:** history replays piece by piece from CopilotKit's cloud (not in Railway's
  logs). Show the device copy or a loading line until the replay is done (`historyDone`), and
  don't count the replay as replying.
- **SVG gradient ids:** an id with spaces or other odd characters silently fails (tiles drew
  black); clean ids with `replace(/[^A-Za-z0-9_-]/g, "-")`. An absolutely placed `GlossFill`
  covers what's drawn before it, so wrap the icon in `OnGloss`.
- **Fades past the 760px column:** extend the existing fade with negative `left`/`right`
  (`-sideRoom`) rather than adding a second full-width layer; an extra layer dims the header's
  buttons.
- **The app opens on Home:** `scripts/help-shots.mjs` taps the Chat tab first unless a shot
  passes `start: "home"`. Home draws nothing below the greeting until the jobs are in.
- **Live talk turned away:** the server answers `LIVE_UNAVAILABLE` (503); the app marks live talk
  off for the session (`liveVoiceTurnedAway`) so Talk goes to the chat instead of failing again.
- **CopilotKit Intelligence's saved history isn't the chat's format:** `getThreadMessages` gives
  tool calls as `{id, name, args}`, while the chat reads `{function: {name, arguments}}`. Convert
  anything saved from it (`asChatMessage` in main-pages.ts / chat-rows.tsx) before the app draws
  it; one unconverted card once blanked the whole app. Each chat row has an error boundary now.
- **Tidying Activity (engine/service.ts `archive`):** archived jobs stay in the agent snapshot
  (chat cards and Spaces look them up by id) and are hidden only in Activity's lists. Every tidy
  is one server batch ("last-tidy") so Undo, tapped or said, restores exactly that; do several
  things (stop + archive + turn off a routine) in one call, never in a row of calls.
- **compareAndSwap with `{field: null}`:** Postgres `@>` doesn't match a missing field, so an
  expected `leaseId: null` fails on records that never had one. Only expect a field you know is
  stored.
- **Sample data in screenshots:** the sample server's dates are fixed in the past, so anything that
  ages things (the weekly Activity tidy) is off there. A test run that archives or stops sample
  jobs changes `${DATA_DIR}`; copy it before such runs and put it back (while the server is
  stopped), or the Help shots lose their jobs.
- **Deleting for good:** a destructive route takes the exact ids the confirm counted (422
  without), never "everything archived" at the time the request lands, so a job that arrived
  between the count and the tap isn't deleted unseen. By voice, the whole lot only with an
  explicit "all"; otherwise the agent asks which.
- **Container users:** Debian images already have system groups such as `voice` and `audio`;
  `useradd <name>` fails (exit 9) when a group has that name. Give a container's user its own
  name (`openmuse`, uid 10001).
- **Claude Haiku 4.5 caches only prompts of 4,096 tokens or more** (others: 512-2,048). Below that,
  `cache_creation_input_tokens` is silently 0. Pipecat 1.12 also counts Anthropic's input tokens
  twice (message_start + cumulative message_delta); `_CountOnce` in apps/voice fixes it. Check
  real usage in Railway's logs before trusting a cost estimate.
- **The voice service's logs:** Pipecat's DEBUG lines print the whole prompt (personal details)
  and every word said; keep VOICE_LOG_LEVEL at INFO on Railway.
- **What a call minute costs (Oct 2026):** silence costs only Soniox's 0.2¢/min (nothing speaks
  or thinks), speaking ~0.5¢ and thinking ~0.4¢ only while there's conversation, and a look-up's
  first run in a call ~5¢ (the Haiku cache write), later ones ~0.5¢. Soniox bills the open
  stream's whole duration, keepalive or not, so "pause listening" saves nothing; only closing
  and reopening the stream would, for ~0.01–0.1¢/min with a reconnect risk. Cut look-ups and
  chat prompts before touching silence.
- **Two live voices (OpenAI's and our own, apps/voice):** ours speaks OpenAI's live protocol, so
  the api runs it as a second `LiveVoice` (pointed at VOICE_SERVICE_URL); never change OpenAI's
  request to suit ours (a test checks it's unchanged). Extras for ours go in `openmuse` in the
  body. Call ids `pc_w{worker}_…` route to ours (`voiceFor`).
- **Railway has no public UDP:** WebRTC to the voice service goes through Cloudflare's TURN relay
  (credentials minted per call; drop `:53` URLs). aiortc uses only one STUN and one TURN server.
- **aiortc is CPU-heavy (~0.44 core a call):** one Python process carries ~4 calls; scale with
  VOICE_WORKERS behind the front router, not by packing more calls into one process.
- **Say why before closing a data channel:** send `session.closed` with its reason, wait a beat,
  then close, or the app never learns why the call ended.
- **Running out is not an error:** a monthly limit shows as the headline with Type instead as the
  main button, not a red box with Talk again (`isLiveLimit`, `limited`).
- **Updates age out, they aren't deleted:** jobs re-post their outcome every minute
  (`insertIfAbsent`), so a deleted update comes back. Hide old ones instead (`recentUpdates`,
  7 days) but keep anything whose job still waits on the person. Email reaches the bell only for
  a rule or "Every new email"; the old "important" default let almost every email through.
- **Hand-offs during calls run on their own model:** `forwardedProps.voiceLookup` makes the chat
  agent use `modelFor("voice")` (the server's quick Claude by default). The chat's fixed
  instructions use a 1-hour cache (`ttl: "1h"` must come before any 5-minute breakpoint).
- **Voices people choose (apps/voice/openmuse_voice/voices.py):** offer only what the provider
  really has: the service checks its hand-picked list against Inworld's voice list and offers only
  those found (only the usual voice if the list can't be read), so a choice can't break a call.
  A voice changed mid-call goes to the service as `session.update` (`LiveVoice.update`).
- **Sounds while listening (Backchannel in pipeline.py):** play them only in a pause the turn
  detector hasn't ended (VAD stopped, no UserStoppedSpeakingFrame yet), and cancel on any new
  speech. Recordings are made once per process per voice, never per call.
- **The admin's voice list:** once the admin adds or removes a voice, their list (admin's
  agent-settings "call-voice-list") replaces our hand-picked one, minus voices Inworld no longer
  has. The voice service accepts any voice in Inworld's catalog, so its workers load the catalog
  at start. Murmurs are made with INWORLD_LISTEN_MODEL (TTS-2 follows "[directions]"; Flash may
  not) and fall back to plain.
- **Rows whose state the server can change:** reset local row state only when the server's
  answer changes (compare a key built from it), not on every new array; a filtered list is a new
  array each render and silently undid an Add.
- **The meeting recorder is its own layer, above the call:** `MeetingRecorderProvider` wraps
  `LiveCallProvider` (App.tsx), so the call screen's cards can reach it; a Record button ends a
  live call itself (`useStartRecording`), because the phone can't do both.
- **Background work that two callers can start:** claim it in an in-process map of running
  promises before awaiting the store lease, so a second ask waits for the same run instead of
  starting another (meetings.ts `process`).
- **Waiting inside a service:** a long wait that a test awaits needs a ref'd timer plus a
  `stopped` flag that `stop()` sets; an `unref()`'d sleep let the test process end early.
- **Web audio:** an `AudioContext` made after an `await` starts suspended; call `resume()` or the
  level meter stays flat. MediaRecorder's timesliced pieces only play joined in order from the
  first, so each part (a new start after a lock) is joined and transcribed on its own.
- **Restart local servers after server changes:** `tsx` doesn't reload, so a server started
  earlier runs old code. A reviewer once chased a "bug" that was only a stale local api.
- **Locked phones run no timers:** measure a pause (mute, app hidden) from a timestamp taken when
  it began and settle it when the person is back, never with `setTimeout` while away. An iPhone
  web app never records in the background and may give no microphone event at all, so time
  hidden counts as a pause there. Coming back can fire two events (the track's `unmute` and
  `visibilitychange`): guard the resume so only one new part starts, and send part lists with
  `Array.from` (a hole from a skipped index becomes `null` in JSON and fails validation).
- **Which model "the server's model" is:** on the real server `agent.models` (ModelChoices) is
  always set, so `ModelChoices.serverModel` decides it; `service.modelFor`'s own fallback only runs
  without it (tests). A change to "which model the chat uses" belongs in `serverModel` (and is
  mirrored in the fallback). The chat runs on CHAT_MODEL, else WORKER_MODEL (the quick Claude),
  else MODEL (owner, 2026-10-20: the leaner chat); every other job ignores CHAT_MODEL.
- **A chat call is ~26,000 tokens before the person says anything:** ~7,000 of instructions and
  ~19,000 of tool definitions (89 tools). Measure it by running `ConversationAgent` against
  `modelFixture` and sizing `body.instructions` and `body.tools` (a throwaway `.mts` inside
  `scripts/`, so packages resolve; delete it after). The conversation is the part you can trim:
  `chat-summary.ts` LIMIT/TAIL are in characters (about four a token).
- **The site's local server:** `python3 -m http.server 8787 --directory apps/mobile/public`
  serves neddy.html, pricing.html and compare.html for screenshots; it dies with the container,
  so check it answers before trusting a screenshot (a stale page looks like a failed edit).
- **Pricing claims need a basis:** margins on the pricing page come from `docs/pricing_math.md`.
  Per-message costs are projections until Railway's "Model call: chat" lines confirm them;
  "typical use" is an assumption until real per-person usage exists. Never say "unlimited" for a
  number with a ceiling.
- **Plans and limits (owner, 2026-10-21):** plan numbers live in `packages/domain/src/plans.ts` (the
  site, Help and `docs/pricing_math.md` must match). Anyone without a saved plan is on "early access" (the
  old limits, nothing counted), so adding a limit never changes existing testers; new invitees start on
  Free. A limit says so kindly and says when it comes back; keep `limitText` starting "You’ve used this
  month’s" (the call screen's `isLiveLimit` reads it). Count what a person starts (typed messages,
  handed-off jobs) once, by id, one person at a time (`Plans.claim`), and never let counting block a chat.
  A function that returns the next item of an ordered list needs a guard for ids not in the list
  (`nextPlan("early")` once offered Free).
- **A panel above the composer must be able to shrink:** react-native-web Views and ScrollViews don't
  shrink by default, so anything stacked above the message box (the attach panel) pushes the box under
  the bottom bar on a short window. Give the parts that can give way `flexShrink` (the message list a big
  one so it goes first) and a `minHeight`, and check a short window (1100x640, 390x700), not just a tall one.
- **Heads-ups (owner, 2026-10-22):** Neddy tells people first about their calendar (`heads-ups.ts`,
  rules in `heads-up-rules.ts`). On for everyone, no model per look: one calendar read per person per pass
  (10 minutes when something is near, an hour when nothing is, back-off on failures), plain rules, templates.
  A heads-up is a card above the chat box (like meal check-ins), a bell entry and a phone notification
  (limited per day; a meeting about to start never buzzes). Never tell people nothing is wrong when nothing is
  being watched: the server keeps `lastLook` (ok / none / failed / no-zone) for the screens and tools. No
  heads-ups until the app has sent the person's time zone (every clock time would be wrong). "Away from the
  desk" is a guess: lunch, coffee, the gym and interviews count only with a real place; a call, video visit or
  web address is never a trip. Tool text is shared with calls: say where a card appears only in the chat prompt.
  Help pictures mock `/api/heads-ups`; use the server's real wording in the mock, or the picture lies.
- **Review rounds work (owner rule, 2026-10-01, run again 2026-10-22):** visual, usability and copy reviewers each
  found real blockers in Heads-ups (a card cut off mid-button, a Later that nagged all day, an intro that said "on"
  with no calendar); expect two rounds, and send the reviewers the screenshots and the code.
- **Cards above the message box share the window (owner screenshot, 2026-10-22):** the dinner question, heads-ups
  and the attach (+) panel all sit above the composer, and nothing but the message list gives way, so together they
  pushed the message box under the bottom bar. The attach panel hides the cards while it's open, the dinner card is
  capped at 35% of the window and waits while a heads-up shows on a window under 900px, and heads-ups cap themselves.
  Test every new thing that goes above the composer with the others open, at 1913x911, 1100x640 and 390x700
  (`scratchpad` repro: mock `/api/meal-checkins` and `/api/heads-ups`, click "Attach a document").
- **Redaction (owner, 2026-10-22):** card, Social Security, bank and ID numbers, passwords, PINs and API
  keys are found by shape (`packages/domain/src/redact.ts`) and replaced before any model sees them.
  Everything that reaches a model goes through it: the chat's history (`guardInput`), every chat tool's
  result (`guardTools`), a job's tool results and prompt, connector results (`bounded()`), browser page
  text (`hide()`), chat summaries and meeting transcripts (`hideText`). A new tool or a new path into a
  prompt must use the same guard, or it is a hole. Keep id/url/hash keys on `secretsOnly` (a long digit
  string there isn't a card). Limits to say honestly: the raw typed message stays in the saved chat
  history, a live call's voice model hears the raw speech, and numbers spelled in words or unlabeled
  foreign ID formats can slip through. Tests: `tests/redact.test.ts`, `tests/redaction-chat.test.ts`.
- **Bucket keys (2026-10-23):** after Railway's incident the bucket rejected the api's pasted S3 keys (meetings
  failed with "403 SignatureDoesNotMatch", hourly backups stopped, and a new deploy crashed at start on
  `InvalidAccessKeyId` because the api checks the bucket as it boots, so it never passed Railway's healthcheck
  while the old version kept serving). Fix: reset the bucket's credentials and give the api's five `S3_*`
  variables as references to the bucket (`${{reserved-safe.ACCESS_KEY_ID}}` etc., never pasted codes), then
  redeploy. A failed healthcheck on the api after a deploy = read that deployment's logs first.
- **Mail sent to the agent's address is a job, not chat (2026-10-23):** `AgentInbox.receive` turns it into a background job, so
  the chat saw nothing and said "I didn't see it" about mail that had arrived. Anything the agent might be asked about
  ("did you get…") needs a tool that reads it (`check_agent_inbox`); a state that lives only in Activity is invisible to the
  chat and to calls. Hold a row only after the work it guards succeeds, or remove it on failure, or a retry is swallowed as a
  duplicate. Remembered values (address, name) are cleared in `clearSession`.
- **Recordings are never only in memory (owner, 2026-10-23):** a meeting's audio pieces are written to the device
  (IndexedDB, `meeting-store.ts`) before they're sent and removed only when the server has them; the recording is
  closed on the server only after every piece arrived (`meeting-uploader.ts`). The recorder warns within seconds
  of failed sends (`trouble`), and the server refuses to start a recording when storage won't take a test file
  (`checkStorage`). Keep a piece on the device if the server says it can't take it (closed): Save a copy.
  Count a piece from the moment it starts being written (`adding`), or Stop can close the recording before the last
  piece is queued. Audio found after a closed tab is finished only if its newest piece is over 90 s old (another tab
  may still be recording). "Safe on this device" is said only when `putPiece` really kept it. Review rounds found
  all three; send the reviewers the code, not only the screenshots.
  A failing-forever async loop with a no-wait delay starves a test's own timers: tests wait with a real
  `setTimeout` turn. And never `kill`/`pkill` by pattern in a command that contains the pattern (it ended
  my own shell twice).
- **A receipt must say "I don't know" when it doesn't (2026-10-23):** "What I used" showed "nothing hidden" for any answer without a
  server note (older answers, a failed fetch, a tap before the note arrived). Carry a `known` flag and say "Not available for this answer."
  A list of "where it looked" built from an allow-list of tools needs a fallback ("Other tools I used") or it says "nowhere" when it
  doesn't know. A row that changes after a tap (Forget → Forgotten + Undo) stays in place, or the next tap lands on another row.
