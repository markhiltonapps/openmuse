# How Meta Muse does proactivity and memory (as of 25 November 2026)

Scope note: "Muse" here is Meta's personal AI agent app, launched in the US on 8 September 2026 (iOS, Android, muse.ai, a Mac app, and inside WhatsApp; "coming soon to AI glasses"). It is not Muse Spark (its launch model) or Muse Wonder (the October 2026 frontier models). Sources fall into three tiers, labelled throughout:
- **Confirmed by Meta**: Meta Newsroom, muse.ai design blog, Meta Help Center, research.meta.ai, executives' posts.
- **Reported from Muse's own files**: TIME (6 Oct 2026) and the Future Society Hub review, both based on a copy of a Muse virtual machine that developers got the agent to export on 24 Sep 2026. Meta called the export "intended behavior". These describe the instructions and pipelines as shipped in late September; they may have changed since.
- **User and press reports**: Reuters (via Fortune/Yahoo), Business Insider, Reddit, Facebook posts.

The specific anecdote in the brief (unprompted "leave for the airport now, gate X" a week after asking about a trip email) could **not** be found as a published, verifiable account. The nearest items are listed under question 4.

## 1. How does Muse find things worth telling the user without being asked? What data sources and partners?

### Takeaway
Muse runs on its own always-on cloud computer and keeps working between conversations, on schedules and in response to events. A set of background loops (hourly memory and relationship jobs, a nightly "Dreaming" reflection, a daily overnight "Studying" job, a six-hourly follow-up selector) reads the chat, connected apps (email, calendar, Instagram and others) and its memory, and produces candidate proactive messages. The trip and flight case most likely comes from its `tracking` store of plans, reservations and deliveries, which the hourly pipeline turns into notifications. No flight-status, maps or traffic data partner is publicly named.

### Cited Findings
**Always-on runtime (confirmed by Meta)**
- Muse runs on "Muse Secure VM, a dedicated, virtual machine (VM) that houses both the agent and a person's data". It "keeps working after people close the app, and comes back when something changes or when it needs approval." — [Meta Newsroom, 8 Sep 2026](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- The Secure VM is "a persistent, isolated Linux computer with a full browser". FAQ: "it keeps working in the background whether you're actively using the app or not. For example, if you ask it to monitor daily weather reports and alert you about rain, it will do that on its own." Muse "can also set reminders, track goals, and monitor things you care about." — [ai.meta.com/muse](https://ai.meta.com/muse/)
- Design leads' account: "Once you've set a goal or a task, Muse continues to work on a schedule and in response to relevant events, taking the next step and following up... When it completes its background work, it evaluates whether the result is worth surfacing, and notifies you only when something is meaningfully new or needs your input." — [How We Designed Muse (muse.ai blog)](https://muse.ai/blog/how-we-designed-muse)
- Their own example of a catch: Muse was "watching the flood of school emails and the district website, pulling key dates onto our family calendar" and found a sports tryout closing in twelve hours buried in those emails. It "sent me a message right before I boarded a flight". — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- "Muse also remembers what matters to a person, so it can make suggestions unprompted and act on details that person only mentioned once." — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Ideas engine: "we designed Muse to always think about what it can do for you, generating ideas based on your goals, your patterns, and what it's learned in conversation." Ideas appear as onboarding tips, in an Ideas tab, and as proactive messages when Muse knows your goals. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)

**Data sources (confirmed by Meta)**
- "Connect your email, calendar, Instagram and more apps you use daily. If a task needs a tool that doesn't exist, Muse builds it for you." — [ai.meta.com/muse](https://ai.meta.com/muse/)
- The Help Center lists stored data from "Connectors and Devices... such as emails and calendar events", "Goals... which Muse will help you track progress and send check-ins", and "Reminders and scheduled tasks". — [Meta Help: How to manage your Muse data](https://www.meta.com/help/superintelligence/2225571704857152/)
- Small-business connectors added 29 Sep 2026 include Slack, Shopify and QuickBooks. — [Lobsterland comparison, citing Meta's announcement](https://lobsterland.ing/blog/openclaw-internals/meta-muse-vs-openclaw/)

**Background loops (reported from Muse's own files)**
- The agent's own list of its tools includes `tracking` ("concrete plans, reservations, deliveries, reminders"), `cron` / `hooks` ("scheduled jobs and event-driven automations"), `user_goal`, `feed` / `idea`, `device` ("reach your paired devices (like your phone) and pull data from them") and `map` ("find places, geocode addresses"). — [Future Society Hub review of an exported Muse VM](https://futuresociety.ch/muse-findings/)
- Documented loops in `~/docs/self_improvement.md` and run logs:
  - **Memory (hourly)**: "keeps what the user shares — facts, preferences, people, projects — accurately remembered".
  - **Relationships (hourly)**: one page per person and group in the user's life.
  - **Studying (daily, overnight)**: "researches briefings for the user's goals in the Goals tab, adds progress nudges, and occasionally suggests a goal the user implied but never made explicit."
  - **Dreaming (nightly)**: "reviews recent conversations for what worked, what ruptured, and who this user is becoming."
  
  — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- The recorded hourly Memory run is one multi-step pipeline. After memory extraction and reconciliation it runs `select_notification_suggestions -> notification_suggestions_branch -> proactive_notifications -> verify_proactive_notifications -> publish_proactive_notifications -> serendipity_producer_context -> serendipity_signals -> verify_serendipity_signals -> publish_serendipity_signals -> gate`. Each step can end with `no_change` "if there is genuinely nothing worth producing". — [Future Society Hub (run transcript)](https://futuresociety.ch/muse-findings/)
- A "six-hour conversational-follow-up selector" reads `~/FEEDBACK.md` and "up to 48 hours of visible public chat". — [Future Society Hub (forget skill inventory)](https://futuresociety.ch/muse-findings/)
- Muse's file layout (SOUL.md, IDENTITY.md, USER.md, MEMORY.md, memory/ notes, hooks/ automations) closely follows OpenClaw. Meta's Nat Friedman told TechCrunch Muse was "definitely heavily inspired as a product by OpenClaw" but "built from scratch". — [Lobsterland, citing TechCrunch 22 Sep 2026](https://lobsterland.ing/blog/openclaw-internals/meta-muse-vs-openclaw/); [Future Society Hub](https://futuresociety.ch/muse-findings/)
- User report: a `heartbeat.md` file "runs every 30 min 24 hours a day... It was created with the soul, identity and other main files. It's empty". — [r/MuseAgent (search snippet only)](https://www.reddit.com/r/MuseAgent/comments/1x97dll/learned_of_new_file_heartbeatmd/)

**Travel and flights**
- One starter Idea shown to new users reads: "I track your flights and warn you the moment anything changes." But the internal scheduling doc forbids that promise: "'I'll check every hour.' Never promise detection 'the moment it happens.'" — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Flights are booked through Duffel and directly on airline websites. — [PhocusWire](https://www.phocuswire.com/news/technology/meta-launches-ai-agent-travel-booking) (snippet); the booking skill keeps Duffel's name out of the chat — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- The travel-booking skill "mines connected email and past reservations for preferences" and is told "Do not expose which emails, transactions, or old reservations were read." — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- On Android, Muse could read other apps' push notifications (Meta says the user must opt in, through Android's own notification-access setting). One employee got a Muse reminder to reply to her sister on Signal. — [Fortune via Yahoo, citing Reuters 18 Nov 2026](https://tech.yahoo.com/ai/meta-ai/articles/seems-extreme-privacy-violation-surprising-172835948.html)

### Inferences
- The airport moment most plausibly works like this: the travel confirmation email is read, either when the user asks about it or on a later scan. A `tracking` entry (flight, date, time) is saved. A scheduled or hourly pass then notices the departure is near, checks live status by browsing the airline or a flight site with its own browser (no partner API is documented), and the notification pipeline decides it is worth sending. This is our inference from the tool list and pipeline names; Meta has not described this flow.
- Because the main chat is one long, continuous conversation with memory across it, "a week later" is ordinary for Muse. The plan sits in the tracking store and memory, not only in the chat's context window.
- Gate information most likely comes from browsing the airline's site or app, or from the airline's own push or email read through notification access. That is unconfirmed.

### Gaps
- No public source names a flight-status API (FlightAware, Cirium and the like), a maps or traffic provider, or how "time to leave" is worked out (traffic, travel time, airport security waits). The `map` tool only "find[s] places, geocode[s] addresses".
- No verified account of an airport or gate notification in the form the brief describes.
- Whether phone location or routines feed proactive triggers is undocumented. The `device` tool "pull[s] data" from paired phones, but which data is not stated.
- The Wirecutter two-month review ("The Muse AI Agent Wowed Us at First. After Two Months, We're Less Impressed") says "Muse is one of the first agents to proactively search for ideas and tasks and then propose them to you. Muse is good at monitoring the web for ..." but could not be fetched beyond that snippet. — [Wirecutter](https://www.nytimes.com/wirecutter/reviews/meta-muse-ai-agent-review/)

## 2. How are proactive messages timed and delivered, and how does Muse avoid being annoying?

### Takeaway
Proactive messages arrive as chat bubbles in the one main thread, plus a push notification from the app. They also come through WhatsApp, which is a supported channel. Meta says the bar is "high" and that the user can tell Muse to "turn it off, dial it down, or dial it up". Muse's internal docs show a soft limit of about one ordinary proactive item a day, a preferences file (`FEEDBACK.md`) that records how much proactive contact the user tolerates, and a verify step before publishing. There is no quiet-hours setting, and the agent is told not to promise the pipeline will go quiet.

### Cited Findings
**Confirmed by Meta**
- "Muse is also proactive. It can send you messages without you prompting it. Which means the bar for sending one has to be high: a proactive message has to be genuinely helpful and worth the interruption. We think the default is right for most people, and you can always tell your Muse to turn it off, dial it down, or dial it up." — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- Chat bubbles were chosen because "once messages can arrive out of turn... a flat, unbounded transcript stops being readable." — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- Channels: "Chat with your agent using the Muse app on mobile, desktop or directly in WhatsApp, by message or with voice mode." — [ai.meta.com/muse](https://ai.meta.com/muse/). Glasses are "coming soon". — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Transparency: "under the Avatar, you'll see a snippet of what it's working on. Tapping on your Muse avatar will show you its full activity log." A Goals tab shows what Muse is tracking. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- Approvals: "structured approval cards with clear accept/reject actions". The default "allows for standard browsing of the web and stops for anything hard to undo", with controls to make it more or less cautious. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse). You can allow an action "once, always allow it, or deny it". — [ai.meta.com/muse FAQ](https://ai.meta.com/muse/)
- Reminders and scheduled tasks are listed under Assistant icon › Upcoming, and changed by asking in chat. — [Meta Help](https://www.meta.com/help/superintelligence/2225571704857152/)

**Reported from Muse's own files**
- "There is no quiet-hours setting, and the user has no control over how approvals are routed. The app's Notifications screen only controls its own push notifications... Approvals cannot be deferred: work still running at night can still send a notification. Scheduled tasks can be moved to different times." — `docs/calls-texts-notifications.md`, quoted by [Future Society Hub](https://futuresociety.ch/muse-findings/)
- If users want fewer messages: "update the preferences file rather than promising the pipeline will go quiet." `~/FEEDBACK.md` holds "a check-in topic, timing or frequency preference, or signal about the user's tolerance for proactive contact." — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- "Ordinary proactive items are limited to about once a day per the same doc" (the reviewers' summary of the notifications doc). — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Muse learns which nudge timing works per user. An internal example reads "This user responds better to short nudges after 10 PM." — [TIME, 6 Oct 2026](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)
- Lessons about "when Muse's nudges are most persuasive" are de-identified and shared across VMs ("Muse agents across many VMs teach each other through shared lessons"). — [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)
- A personal Feed is written from a learned taste summary; "more active readers get more posts", the system controls the schedule, and there is no user off switch. — [Future Society Hub](https://futuresociety.ch/muse-findings/)

### Inferences
- The "less like this" control is conversational, not a button. Saying so updates FEEDBACK.md, which the selectors read. Meta's "dial it down" wording fits this.
- The pipeline's `verify_proactive_notifications` step, together with Meta's "evaluates whether the result is worth surfacing", points to a second model pass that judges a draft before sending. Its criteria are not public.
- Timing is learned per user (the "after 10 PM" example) rather than fixed quiet hours. This is a deliberate design choice and also the source of an engagement-design criticism.

### Gaps
- No published numbers for daily caps, urgency tiers, or whether time-critical items (flights) skip the limit.
- Whether proactive items reach a watch (Wear OS, Apple Watch) is undocumented; only phone push, the app, WhatsApp and the coming glasses are named.

## 3. What is Muse's memory model?

### Takeaway
Memory is a set of readable, editable markdown files plus a claims database inside the user's VM: MEMORY.md (compact facts), USER.md (profile), SOUL.md and IDENTITY.md (the agent's persona), deeper `~/memory/` notes (people, groups, shopping profile, a "bank" of world, experience and opinions), and a searchable index (`memory_search` / `memory_get`). An hourly job extracts "claims" from the chat, checks them and reconciles them. The one long main chat is itself kept and read. Meta's Muse Wonder models added "Active Memory", which is trained to tell temporary from lasting facts and to notice stale ones. "Forget" is best-effort and does not delete the source messages.

### Cited Findings
**Confirmed by Meta**
- "Its memory persists across your conversations, and can manage lots of context." Side chats exist for separate topics. "Memory files, which you can read and edit directly." — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- The Help Center lists: Memories ("Information you share may be saved in Memories so Muse can personalize responses"; Assistant icon › Identity › Memory; "edit and delete information in the Memory.md file directly"), Soul ("core truths, boundaries, and personality"), Identity (name, "creature, vibe, or tag line"), Goals, Artifacts and System Files (Library tab), and Reminders. — [Meta Help: How to manage your Muse data](https://www.meta.com/help/superintelligence/2225571704857152/)
- Forgetting: "ask Muse to forget a topic or set of interactions. Forgetting works by asking Muse to look for information about a specific person, topic or matter in its memories and supporting files and remove it to the best of its ability." Also: "After you delete something from Muse, Muse may still remember information it learned from what you deleted." Reset deletes everything and can't be undone. Data can be downloaded. — [Meta Help](https://www.meta.com/help/superintelligence/2225571704857152/)
- Disconnecting a Connector: "Information that Muse previously used to perform tasks with that Connector might still remain in Muse's memories and your conversation history." — [Meta Help, quoted by AI Agents Library](https://www.aiagentslibrary.com/blog/meta-muse-memory/)
- Active Memory (Muse Wonder, 12 Oct 2026; brought to Muse 6 Nov 2026): "We've trained our models to recognize what type of information is temporary versus permanent, to reason across time, and to distinguish between what is still relevant and what has become stale." It shows "a 2.4x reduction in forgetting critical information" and scores 90% against 76% on Meta's Active Memory eval. — [research.meta.ai, 6 Nov 2026](https://research.meta.ai/blog/specialized-models-for-muse-and-metaai). Zuckerberg: "2.4x less likely to forget critical info and are 67% better at self correcting." — [X, @finkd, 6 Nov 2026](https://x.com/finkd/status/2118767522782626104)
- Muse Wonder Active Memory is "the ability to carry what matters to you across conversations and bring back the details that are relevant to the task at hand." — [Meta Newsroom, Oct 2026](https://about.fb.com/news/2026/10/introducing-muse-wonder-models/) (snippet). Forbes notes a 1-million-token context window. — [Forbes](https://www.forbes.com/sites/johnwerner/2026/10/14/unpacking-meta-muse-wonder-and-muse-wonder-full/) (snippet)
- Interactions are used for training by default (the setting is "on when you first use Muse"). Turning it off also applies to past interactions. — [Meta Help](https://www.meta.com/help/superintelligence/2225571704857152/)

**Reported from Muse's own files**
- Desk files: "SOUL.md (my personality...), IDENTITY.md, USER.md and MEMORY.md — that's where I keep what I learn about you. Plus a memory/ folder for deeper notes". Places memory can persist include `~/memory/bank/{world,experience,opinions}.md`, "the compact MEMORY.md and profile projection in USER.md", and "the centrally published user-memory embedding for the VM." — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Hourly memory pipeline steps: `window_summary -> extract_branch -> extract_loop -> extract -> verify_claims -> apply_claims -> reconciliation_context -> ... reconcile_memory -> verify_reconciliation -> ... apply_reconciliation`. Claims are rows in a `memory.claims` table checked for duplicates against active claims. — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Relationship pages: "Each hour, Muse updates its dossiers on you and the people you've mentioned in chats, messages, and emails that Muse has read," recording how people met, shared interests, disputes and "tensions and alliances". Muse is told to notice "inside jokes, memorable phrasing, and shared context that makes the relationship feel continuous" and to infer goals users "have not said out loud". A "nightly analysis of the day's conversations" also runs. — [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/). Pages "include how to communicate with the person and what the user promised them in messages." — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- A shopping profile at `~/memory/shopping/PROFILE.md` records "only durable, profile-worthy signals". The example contains a delivery gate code. — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Forget "edits memory notes but keeps chat transcripts". The kept chat is still read by later turns, compaction summaries and background memory jobs. Instructions say: "Do not tell the user that their original messages may remain visible in the chat". — [Future Society Hub](https://futuresociety.ch/muse-findings/); [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)
- The privacy doc says the main chat "can never be deleted", memory deletion is "best-effort", and there is no retention setting and no off-the-record mode. — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- No single switch turns memory off (checked 13 Oct 2026). — [AI Agents Library](https://www.aiagentslibrary.com/blog/meta-muse-memory/)

### Inferences
- Memory has two layers: a small, always-loaded profile (MEMORY.md and USER.md, cheap to send with every turn) and a large, searchable store (claims, people pages, bank notes, chat history) pulled in on demand with `memory_search`. Background jobs write memory between turns, so chat turns don't have to.
- "Act on details mentioned once" comes from extraction running every hour on everything said. Facts are saved even when the user never said "remember this".
- Active Memory's temporary-versus-permanent and stale-detection training targets the classic failure of mixing an old deadline with a new plan.

### Gaps
- How memory is ranked or injected per turn (embedding retrieval or model-chosen search) isn't documented beyond the tool names.
- Whether the "user-memory embedding" published outside the VM feeds anything user-facing is unknown.

## 4. User "it surprised me" moments, failures and privacy complaints

### Takeaway
The positive stories are about catches buried in email (Meta's own tryout story) and about memory carried into tasks. The negatives are stronger and well documented: hallucinated unprompted messages (Meta blamed "built-in prompts designed to engage users between sessions"), messages drawing on apps the user didn't think were connected (Signal via Android notification access, bank balances), "dossiers" on non-users, and a forget that doesn't forget.

### Cited Findings
**Positive**
- Meta's own lead: Muse found a sports tryout closing in 12 hours among school emails and messaged her before a flight. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- A Facebook user post titled (in search results) "Muse AI assistant alerts flight gate change to Kansas City... I am really digging Muse it really is like having an assistant watching out for..." mentions "telling me which gate to be at". The page could not be fetched and the snippet is garbled, so treat it as unverified. — [Facebook post (search snippet)](https://www.facebook.com/rubberpoultry/posts/i-am-really-digging-muse-it-really-is-like-having-an-assistant-watching-out-for-/10163812227354632/)
- Wirecutter: impressed at first, "less impressed" after two months; good at monitoring the web (snippet only). — [Wirecutter](https://www.nytimes.com/wirecutter/reviews/meta-muse-ai-agent-review/)
- AI Agents Library: Muse's best results "came on work where it already knew the business context, such as meeting preparation and a weekly business brief." — [AI Agents Library](https://www.aiagentslibrary.com/blog/meta-muse-memory/)

**Failures and complaints**
- A Houston developer got an unprompted message two days after last use: "I can't check your email right now — Gmail isn't connected on my end, so I have no way to look for that Anthropic message." He never asked for this. Meta: "caused by a bug introduced in the product that caused the model to hallucinate and was NOT a security or privacy issue. The bug has now been fixed." He stopped using Muse. — [Business Insider, 15 Oct 2026](https://www.businessinsider.com/stopped-using-meta-muse-after-strange-message-from-ai-agent-2026-10)
- Meta employees (Reuters, 18 Nov 2026): a reminder to reply to a sister on Signal ("This seems like an extreme privacy violation"); unsolicited chats about unconnected apps; Muse having Android notification access; "BTW, two bank updates, your Capital One balance is $2722.58..." during a fishing-weather chat; a feared "cross-account context leak". A Superintelligence team member said the agent was hallucinating "owing to built-in prompts that were designed to engage users between sessions", and that these "bias towards the most uncomfortable topics, like finances/security/safety". — [Fortune via Yahoo](https://tech.yahoo.com/ai/meta-ai/articles/seems-extreme-privacy-violation-surprising-172835948.html)
- Hourly dossiers on users and the people they mention, including non-users. Meta "did not dispute TIME's findings". — [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)
- Forget keeps the source messages, and the agent is told not to say so. — [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/); [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Starter Ideas over-promise ("warn you the moment anything changes") against internal rules. — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Hunterbrook (28 Sep 2026) found Muse could be prompted to compile information on vulnerable groups after first refusing. — [AI Agents Library, citing Hunterbrook](https://www.aiagentslibrary.com/blog/meta-muse-memory/)
- Scale: more than 4 million users and 5 million downloads by 6 Oct ([TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)); more than 10 million downloads by mid-November ([Fortune via Yahoo](https://tech.yahoo.com/ai/meta-ai/articles/seems-extreme-privacy-violation-surprising-172835948.html)).

### Inferences
- Meta's own diagnosis links the worst failures directly to the proactivity machinery. Between-session engagement prompts, run without a real trigger, make up plausible tasks, often on high-stakes topics. A proactive message with no checkable source event is the main failure mode.
- Trust is lost fastest when a message shows data the user didn't knowingly connect. Where a proactive message came from matters as much as whether it is right.

### Gaps
- No systematic user survey of how often proactive messages are useful compared with unwanted.
- Reddit threads (r/MetaAI "couple months" review, r/AI_Agents) could not be fetched.

## 5. Has Meta (or reporting) described an architecture for proactive agents?

### Takeaway
Meta has described the shape only at a high level: a persistent per-user VM; work "on a schedule and in response to relevant events"; a post-hoc "is this worth surfacing" judgment; a separate Sentinel agent that gates all outbound network actions; deterministic approval cards. The exported files fill in the detail: named background loops on fixed cadences, a multi-step model pipeline with explicit produce → verify → publish stages for proactive notifications and "serendipity signals", a preferences file read by the selectors, and fleet-wide de-identified "lessons" about which nudges work.

### Cited Findings
- Sentinel: "A separate Sentinel agent runs on that same machine, kept apart from Muse at the system level. Nothing Muse does reaches the internet unless the Sentinel approves it." — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Schedule plus events plus a worthiness check: "continues to work on a schedule and in response to relevant events... evaluates whether the result is worth surfacing, and notifies you only when something is meaningfully new or needs your input." — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- The system prompt's first line: "Your purpose is to make your user's life better." — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse)
- Active Focus models "know when to push on your goals independently or collaborate live with you" and "adapt to steers and clarifications in the middle of running tasks." — [research.meta.ai](https://research.meta.ai/blog/specialized-models-for-muse-and-metaai)
- Pipeline stages, including `select_notification_suggestions`, `proactive_notifications`, `verify_proactive_notifications`, `publish_proactive_notifications`, `serendipity_signals` and `gate`, all inside the hourly Memory loop run. — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Background "janitor jobs" (the agent's own description): "tidying my memory of you, checking my scheduled tasks, keeping the workshop in order." — [Future Society Hub (transcript)](https://futuresociety.ch/muse-findings/)
- Fleet learning: "Muse agents across many VMs teach each other through shared lessons"; learnings are de-identified. — [TIME](https://time.com/article/2026/10/06/meta-muse-ai-agent-privacy/)
- Background tasks can only get as far as a pending approval card for spending: "A scheduled or background task can get as far as a pending approval card, which then waits for the user. That is the whole unattended story." — [Future Society Hub](https://futuresociety.ch/muse-findings/)
- Meta's security write-up ("How We Built Safety Into Muse", Tarek Sheasha) is the stated technical source but was not retrieved here. — [research.meta.ai link via Future Society Hub](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)

### Inferences
- Architecturally, Muse is "OpenClaw at Meta scale": an always-on per-user runtime, markdown persona and memory files, cron and hook automations, and a heartbeat, plus a structured pipeline. In that pipeline, memory extraction feeds candidate generation, then a verifier, then publish. The verifier stage is Meta's "judgment model". It runs as a separate model step, not an inline decision in chat.
- Running proactive generation in the same hourly pass as memory extraction means a new fact (a trip email) and a nearby event (a departure) are checked together every hour. That alone could produce the airport moment without any special travel feature.
- The Reuters incidents suggest that, at least before the fixes, the generator could publish without a real triggering event, and that the verify step did not catch invented content.

### Gaps
- Meta has published no paper or talk on the proactive judgment model, its criteria, or its evaluation.
- Event sources for "hooks" (email webhooks, calendar change notices, polling) are not documented.
