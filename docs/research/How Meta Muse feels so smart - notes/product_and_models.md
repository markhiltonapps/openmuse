# Meta Muse: product and technical stack (as of 25 November 2026)

Labels used below: **[Meta]** = stated by Meta in its own newsroom, blog, help centre or product page. **[Press]** = reported by tech press. **[3rd-party]** = SEO and aggregator sites, Reddit, or third-party measurement. **[Inference]** = my own reasoning, not stated anywhere.

Naming: "Muse" is two things at Meta. One is the consumer agent app (Muse, muse.ai, "Muse from Meta"). The other is the model family (Muse Spark, Muse Spark 1.1/1.2/1.3, Muse Spark Open, Muse Wonder, Muse Wonder Full). The app runs on the models. The target product is identified by its $20 Power and $100 Maximum plans and its watch app; it is the agent app launched 8 Sep 2026. I did not find any other current "Meta Muse" product with those plans. "Hatch" is Meta's internal codebase name for the app (see Q1).

## Q1. What is Meta Muse? Launch, team, and how it relates to Meta AI, Llama, MSL, the Muse models and the Meta Model API

### Takeaway
Muse is Meta's consumer "personal AI agent" app. It launched in the US on 8 Sep 2026 on iOS, Android and muse.ai. It is separate from the older Meta AI assistant and runs on Meta Superintelligence Labs' (MSL) Muse model family, not on Llama. Each user gets their own dedicated cloud Linux VM, and that VM is the heart of the product.

### Cited Findings
- **Launch [Meta]:** Meta announced Muse on **8 Sep 2026** as "a secure, private personal AI agent that proactively helps with people's goals and suggests ideas". It rolled out "in the US on iOS, Android, and muse.ai", "coming soon to AI glasses", "free for most of what people need, with subscription plans". The post was last updated 10 Nov 2026. — [Meta Newsroom, Introducing Muse](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **Chat surfaces [Meta]:** people talk to Muse "just like messaging another person, in the Muse app or directly in WhatsApp". — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **Model at launch [Meta]:** the launch post says Muse is "powered by Muse Spark, Meta's most capable model to date". The link points to the Muse Spark **1.3** post. — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **Internal dogfooding [Meta]:** "We've been working on and using Muse ourselves since early 2026." — [How We Built Safety Into Muse (muse.ai blog, Tarek Sheasha)](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Internal name [Meta]:** footnote: "Hatch is our internal name for Muse in the codebase". The core harness daemon is the "Hatch daemon", with services `hatch-safety` and `hatch-authd`. ai.meta.com/muse still has a leftover heading: "What Hatch can do for you while you get on with life". — [muse.ai security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse); [ai.meta.com/muse](https://ai.meta.com/muse/)
- **Android package [3rd-party/Meta link]:** Google Play ID is `com.facebook.aura`; the App Store app is "Muse from Meta", id6760173601. — [ai.meta.com/muse (Play link)](https://ai.meta.com/muse/); [App Store](https://apps.apple.com/us/app/muse-from-meta/id6760173601)
- **Product team [Meta]:** the design post "How We Designed Muse" is written by a product leader named Mona, with co-lead Christine. It names "Alex, our Product Design Lead". Security and technical architecture are written up by Tarek Sheasha. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Org [Press]:** MSL is led by chief AI officer Alexandr Wang. Meta invested $14.3B in Scale AI for a 49% stake when it hired him. MSL was formed because Zuckerberg was reportedly unhappy with Llama's progress. — [TechCrunch, 8 Apr 2026](https://techcrunch.com/2026/04/08/meta-debuts-the-muse-spark-model-in-a-ground-up-overhaul-of-its-ai/); [CNBC, 8 Apr 2026](https://www.cnbc.com/2026/04/08/meta-debuts-first-major-ai-model-since-14-billion-deal-to-bring-in-alexandr-wang.html)
- **Product head [Press, in passing]:** TechCrunch describes Nat Friedman as "currently head of product at Meta Superintelligence Labs". — [TechCrunch (aside in a 23 Nov 2026 page)](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Not Llama [Meta + Press]:** Muse Spark (8 Apr 2026) was "the first in the Muse family of models developed by Meta Superintelligence Labs" and "the first product of a ground-up overhaul of our AI efforts". Meta says it reaches the same capability "with over an order of magnitude less compute than our previous model, Llama 4 Maverick". Its codename was "Avocado" (CNBC). The Batch calls it a pivot "away from its open-weights Llama strategy". — [ai.meta.com Muse Spark blog](https://ai.meta.com/blog/introducing-muse-spark-msl/); [CNBC](https://www.cnbc.com/2026/04/08/meta-debuts-first-major-ai-model-since-14-billion-deal-to-bring-in-alexandr-wang.html); [The Batch](https://www.deeplearning.ai/the-batch/with-muse-spark-meta-pivots-away-from-its-open-weights-llama-strategy)
- **Meta AI vs Muse [Meta]:** Muse Spark also "now powers the Meta AI assistant in the Meta AI app and meta.ai" (April 2026). ai.meta.com lists "Meta AI Assistant" and "Muse" as separate products. — [Meta Newsroom, Apr 2026](https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/); [ai.meta.com/muse](https://ai.meta.com/muse/)
- **Meta Model API and Muse Code [Meta]:** Muse Spark 1.1 (9 Jul 2026) was released to developers through the Meta Model API, in public preview. Muse Spark 1.3 (2 Sep 2026) and Muse Wonder (12 Oct 2026) are on the "Meta Model API" and "Muse Code", Meta's coding agent installed with `curl -fsSL https://dev.meta.ai/install.sh | bash`. The developer portal is dev.meta.ai. — [Muse Spark 1.1 blog](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/); [Fortune, 9 Jul 2026](https://fortune.com/2026/07/09/meta-muse-spark-1-1-release-alexandr-wang-superintelligence-labs-mark-zuckerberg/); [Muse Spark 1.3 blog](https://research.meta.ai/blog/introducing-muse-spark-1-3); [Muse Wonder blog](https://research.meta.ai/blog/muse-wonder)
- **Adoption [Press]:** Muse passed 10M US downloads in its first 40 days, one of only 12 apps ever to do so. — [TechCrunch, 10 Nov 2026 (citing its 20 Oct report)](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Expansion [Press]:** Muse launched in the UK around 23–24 Nov 2026 with retail partners, and it "runs on Muse Spark". — [Retail Insight Network](https://www.retail-insight-network.com/news/meta-muse-ai-agent-uk-retail-partners/); [AI Magazine](https://aimagazine.com/news/is-metas-autonomous-muse-ai-agent-ready-for-uk-retail)
- **Muse for Small Business [Meta]:** "a collection of new skills and connectors for the small business owner", launched late Sept 2026. — [ai.meta.com/muse](https://ai.meta.com/muse/)

### Inferences
- Muse is MSL's flagship consumer product. The Meta AI assistant is the older, simpler chatbot. They share the Muse Spark model line but are different products: Muse has a VM, connectors, background jobs and approvals.
- The `com.facebook.aura` package name and the "Hatch" codename suggest the project went through at least one rename ("Aura"?) before launch. This is unconfirmed.

### Gaps
- I found no org chart for who leads the Muse *app* (as opposed to MSL). Mona's and Christine's surnames and titles were not in the material I read.
- The exact UK launch date and the full country list are not on a primary Meta page I read. The help page says Muse "aren't available in all locations yet".

## Q2. Which models run chat, the agent, voice and images? Routing, sizes and context

### Takeaway
At launch, Muse's agent ran on **Muse Spark 1.3**, a reasoning model trained for tool calling through CLIs and skills, long context, long-horizon instruction following and multi-agent coordination. **Muse Wonder** (12 Oct 2026, a larger model) is officially being routed in for "artifact generation and processes that require more intelligence", subscribers first. That is confirmed task-based routing between a cheaper model and a stronger one. Context windows of 1M tokens are published for Muse Wonder and Muse Spark Open. Meta has published nothing on Muse's voice or image models.

### Cited Findings
- **Model timeline [Meta]:**
  - Muse Spark: 8 Apr 2026.
  - Muse Spark 1.1: 9 Jul 2026, public preview on the API.
  - Muse Spark 1.2: date not found.
  - Muse Spark 1.3: 2 Sep 2026, "with max reasoning".
  - Muse Wonder and Muse Wonder Full: 12 Oct 2026.
  - Sources: [Spark](https://ai.meta.com/blog/introducing-muse-spark-msl/); [1.1](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/); [1.3](https://research.meta.ai/blog/introducing-muse-spark-1-3); [Wonder](https://about.fb.com/news/2026/10/introducing-muse-wonder-models/)
- **What the agent model was trained for [Meta]:** "zero-shot tool calling using CLIs and skills, long context, long-trajectory instruction following with inherent awareness of prompt injection, and multi-agent coordination." — [muse.ai security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Muse Spark 1.3 behaviour [Meta]:**
  - Built to "sustain longer-horizon work by collaborating with users and juggling multiple workflows in a single, long thread".
  - Better at mapping "incoming prompts to the correct task within messy, single-threaded contexts", which matches Muse's one long main chat.
  - Asks clarifying questions and confirms before consequential actions; can give frequent updates or work silently.
  - Better "awareness of its own capabilities and limitations ... instead of hallucinating outcomes".
  - "Trained across a diverse set of harnesses."
  - Source: [Muse Spark 1.3 blog](https://research.meta.ai/blog/introducing-muse-spark-1-3)
- **Efficiency [Meta]:** compared with 1.2, Spark 1.3 uses "~20% fewer tool calls and ~25% fewer tokens" in Meta engineers' comparisons. — [Muse Spark 1.3 blog](https://research.meta.ai/blog/introducing-muse-spark-1-3)
- **Original Spark design [Meta]:** "small and fast by design, yet capable enough to reason through complex questions in science, math, and health". It is natively multimodal, with tool use, visual chain of thought and multi-agent orchestration. RL included "thinking time penalties", which led to "thought compression" (fewer reasoning tokens). Parallel multi-agent thinking gives "superior performance with comparable latency". "Contemplating mode" runs several agents reasoning in parallel (58% on HLE). — [Meta Newsroom, Apr 2026](https://about.fb.com/news/2026/04/introducing-muse-spark-meta-superintelligence-labs/); [ai.meta.com Muse Spark blog](https://ai.meta.com/blog/introducing-muse-spark-msl/)
- **Routing confirmed [Meta]:** "Muse Wonder will soon power experiences in Muse, and will roll out first to subscribers. Muse Wonder will also power artifact generation and processes that require more intelligence. And in the future, we'll be using Muse Wonder to develop specialized models that we can bring to everyone using Muse." — [research.meta.ai Muse Wonder](https://research.meta.ai/blog/muse-wonder)
- **Muse Wonder [Meta]:**
  - Trained at the gigawatt-scale Prometheus data center.
  - "Built on larger, stronger base models" than Spark 1.3.
  - Key traits: "Active Memory" (carries context across conversations and retrieves what is relevant) and "Active Focus" (keeps going on hard tasks, recovers from errors, checks in before important actions).
  - Benchmarks Meta cites include MemoryBench, FocusBench, AutomationBench-AA, SWE-Marathon, DeepSWE and Harvey LAB.
  - Sources: [research.meta.ai Muse Wonder](https://research.meta.ai/blog/muse-wonder); [Meta Newsroom, Oct 2026](https://about.fb.com/news/2026/10/introducing-muse-wonder-models/)
- **Muse Wonder API listing [3rd-party]:**
  - Accepts text, images, video, audio and PDF; outputs text.
  - **1M-token context**.
  - $4 in / $20 out per 1M tokens; cache read $0.20 per 1M.
  - Measured latency 3.80 s, throughput 67 tok/s.
  - Released 12 Oct 2026.
  - Source: [OpenRouter](https://openrouter.ai/meta/muse-wonder)
- **Muse Spark Open [3rd-party]:** "816B Mixture-of-Experts model ... with 42B active parameters, native multimodal understanding, and a 1M-token context window." Meta's page calls it "the most capable open-weight model from a US lab". — [LM Studio](https://lmstudio.ai/models/muse-spark-open); [dev.meta.ai](https://dev.meta.ai/models/muse-spark-open)
- **Sub-agents [Meta]:** Muse "launches swarms of subagents, builds its own tools, and edits itself". A dedicated **browser sub-agent** drives the web, and **hatch-safety** runs "an independent set of models and classifiers". — [muse.ai security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Voice [Meta]:** voice is built on "Muse Realtime Voice" and "Muse Realtime Avatar". It was previewed at Connect 2026 and rolled out 5 Nov 2026 (US, mobile, web, Mac). "Hear responses right away. You can even interrupt." There are "hundreds of voices". No underlying model is named. — [Meta Newsroom, Give Your Muse a Voice](https://about.fb.com/news/2026/11/introducing-muse-ai-voice-expressive-avatars/)
- **Images [Meta]:** the FAQ lists "generate images" as a feature. No image model is named on the Muse pages. — [ai.meta.com/muse](https://ai.meta.com/muse/)
- **Wonder in the app [3rd-party]:** one secondary site claims Wonder access in the Muse app "is now tied to the paid Power and Maximum subscriptions". Meta itself only says "rolling out first to subscribers". — [shattered.io](https://shattered.io/meta-muse-ai-agent-launch-2026/) (low-quality source)

### Inferences
- The likely setup: a fast Spark-class model runs the main conversation, background jobs and browser sub-agents. Wonder is called in for artifacts and for steps that need more reasoning. Separate classifier models sit outside the agent for safety. This fits "Muse Spark (small and fast)", Wonder for "processes that require more intelligence", and "specialized models" distilled from Wonder later.
- Muse Spark Open (816B total, 42B active MoE) gives a rough idea of how big the Spark line is. Meta has not said whether the hosted Spark 1.3 matches the open model.

### Gaps
- Meta has published no context window for Muse Spark 1.3 or for the app itself.
- Meta has published no parameter count for Muse Wonder.
- The voice speech model (speech-to-speech or a speech-to-text/text-to-speech pipeline), the image model and the avatar model are not named in any source I read.
- No source says whether free users ever get Wonder.

## Q3. Agent architecture: tools, connectors, background tasks, acting for the user, approvals and safety

### Takeaway
Meta has published an unusually detailed technical write-up. Each user gets a persistent, isolated Linux VM. Inside it, the agent harness ("Hatch daemon") runs in a `systemd-nspawn` cell with a file system, a terminal and a Chromium browser. Credentials, connector logic, safety classifiers and a separate "Sentinel" agent sit outside the cell. Sentinel approves every connector action and every outbound network request, inserting real credentials only at that boundary. Approvals are typed capabilities shown in the app's own interface, not in the chat.

### Cited Findings
- **Per-user VM [Meta]:** "Muse Secure VM is a persistent, isolated Linux computer with a full browser that you and your agent can use ... with the storage, CPU, and memory to handle real work." The VM is "the system of record for everything you put in Muse". Apps "connect directly to your VM via a secure transport layer". — [ai.meta.com/muse](https://ai.meta.com/muse/); [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Runtime cell [Meta]:**
  - The Hatch daemon, the workspace, and the tools run in a `systemd-nspawn` container with a full Debian root file system.
  - Root inside the cell maps to an unprivileged host user.
  - System calls are filtered (no `io_uring`) and kernel capabilities limited (no `CAP_SYS_PTRACE` / `CAP_NET_ADMIN`).
  - Durable state lives in Postgres, outside the cell.
  - Services talk over Unix sockets with `SO_PEERCRED`.
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Services outside the cell [Meta]:**
  - `hatch-safety`: classifiers that inspect model inputs and outputs.
  - `privsep` workers: run the logic of built-in connectors.
  - `hatch-authd`: stores credentials and OAuth tokens in the user's VM ("not in centralized Meta infrastructure") and issues "surrogate" tokens.
  - Sentinel: "sole permission authority for connector actions and network egress".
  - Proxies for inference and telemetry.
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Sentinel and egress [Meta]:**
  - Every request passes through a forward proxy (user namespaces, veth, eBPF).
  - Requests are judged at layer 4 and layer 7, with SSRF protection.
  - Real credentials replace surrogate tokens just in time.
  - "Tainted egress": a process that has read user data loses auto-allow. This is tracked with eBPF cgroup programs and LSM hooks.
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Approvals [Meta]:** Sentinel decides "allowed, denied, or ask". An "ask" opens a dialog in the client, "not via their conversation with Muse". Grants can be "one-time, session-scoped, task-scoped, time-bounded, or perpetual". Read-only and low-risk actions go ahead without asking. — [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Approval UX [Meta]:** "deterministic UI is non-negotiable: structured approval cards with clear accept/reject actions". The default "allows for standard browsing of the web and stops for anything hard to undo", chosen to avoid "banner blindness". Users can allow once, always allow, or deny. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [ai.meta.com/muse FAQ](https://ai.meta.com/muse/)
- **Connectors [Meta]:**
  - Launch set covers third-party services plus Meta apps (Instagram, Facebook).
  - Each was integrated "closely with the service provider".
  - Each comes with written SKILLs ("detailed instructions to Muse").
  - Muse "can also write its own custom connectors" for services with APIs or CLIs.
  - Read and write access are separated, with permissions finer than OAuth scopes (for example, Gmail read without settings access).
  - The email connector filters out one-time codes, password-reset links and magic links, using both rules and a classifier.
  - Sources: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse); [ai.meta.com/muse](https://ai.meta.com/muse/)
- **Tools [Meta]:**
  - "Muse has its own computer, with a file system and a terminal, so it can write its own code and build the tools a task needs."
  - Full web browser.
  - Produces "Artifacts" (documents, PDFs, web pages, dashboards).
  - Launch post: Muse "can open a browser, fill out forms, and negotiate on their behalf".
  - Sources: [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **Browser [Meta]:**
  - Real Chromium behind a virtualisation layer.
  - The sub-agent sees an **accessibility-tree snapshot**, not the raw DOM.
  - It cannot run JavaScript; DevTools is disabled; a broker holds the CDP connection.
  - The user can take over, which pauses the agent.
  - Classifiers watch for prompt injection in the DOM, images and downloaded files, for personal data leaving, and for high-risk form submissions.
  - Meta's list of malicious sites is checked inside the VM.
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Payments [Meta]:**
  - Checkout uses Link by Stripe with single-use card numbers tied to one merchant, one amount and a short time window. "First AI agent covered by Link's purchase protections."
  - Shop Pay and 1Password support are "coming soon".
  - Every purchase needs approval.
  - Sources: [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/); [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Background work [Meta]:** Muse "continues to work on a schedule and in response to relevant events". When background work finishes, "it evaluates whether the result is worth surfacing, and notifies you only when something is meaningfully new or needs your input". The VM handles "concurrent sub-agents and crons". — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Conversation model [Meta]:**
  - "One long conversation in a main chat"; "not a turn-by-turn experience".
  - You can interrupt or send several tasks at once.
  - Memory "persists across your conversations".
  - Side chats were added later; Spaces (6 Nov 2026) are topic conversations shown as mini apps built on the fly.
  - Proactive messages have a "high" bar and can be tuned.
  - Goals and Ideas tabs.
  - The avatar shows a live snippet of current work and opens a full activity log.
  - First line of the system prompt: "Your purpose is to make your user's life better."
  - Sources: [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [TechCrunch on Spaces](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Memory [Meta]:** memory files live in the VM and users can "read and edit directly". Muse remembers "details that person only mentioned once" and can be told to "forget". — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **Prompt-injection defence [Meta]:** four layers:
  1. Model training (Spark 1.3 "close to SOTA").
  2. External data labelled as untrusted inside the context.
  3. A group of injection-detection classifiers running in parallel.
  4. Human approval for anything that moves data out of the VM.
  - Bug bounty: up to $300k, including up to $130k for prompt injection that affects one user.
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Data and training [Meta]:**
  - Conversation trajectories, including tool calls and sub-agent hand-offs, train future checkpoints after "key personally identifiable information" is removed. Users can opt out.
  - Data is not shared with ad systems.
  - "Muse Confidential VM", encrypted so Meta cannot access it, is planned for "later this year".
  - Source: [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)

### Inferences
- Much of the "it seems smart" effect is system design, not just the model:
  - one persistent main chat with memory files;
  - a scheduler plus event triggers, with a step that judges whether a result is worth surfacing;
  - per-connector SKILL files written with each provider;
  - a real computer for writing its own tools;
  - parallel sub-agents.
- The accessibility-tree browser and the per-provider SKILLs both shrink what the model has to work out on its own.

### Gaps
- No published list of the launch connectors on a page I read. Gmail, Outlook, calendars and travel are implied ("email, calendar, Instagram and more"), and car and home are mentioned. The full list is probably in Meta help article 1687253048996149, which I did not read.
- No published latency or uptime figures for the VM, the scheduler interval, or how memory retrieval works (vector store or files plus search).

## Q4. Plans and pricing

### Takeaway
Confirmed by Meta's help centre:
- **Power:** $20 a month, 500M Muse tokens a week, 10 phone calls a day.
- **Maximum:** $100 a month, 3B Muse tokens a week, 20 phone calls a day.
- **Free tier:** has a usage limit.

All plans have the same features, and subscriptions are "in limited testing". The free allowance is not published by Meta; secondary sources put it at about 100M tokens a week.

### Cited Findings
- **Plans [Meta]:** "Power plan ($20/month): 500M Muse tokens per week; 10 phone calls per day. Maximum plan ($100/month): 3B Muse tokens per week; 20 phone calls per day." "Muse is available for free with a usage limit." "Muse and Muse subscriptions are in limited testing." 18+, Meta account required, billed monthly. — [Meta Help: About Muse subscriptions](https://www.meta.com/help/subscriptions/1021145227643680/)
- **Same features on every plan [3rd-party]:** plans differ only in weekly usage. One-time purchases of extra tokens "never expire". — [ToolColumn](https://www.toolcolumn.com/tools/meta-muse); [GoSearch](https://www.gosearch.ai/blog/meta-muse-pricing/)
- **Free allowance [3rd-party]:** "Up to 100 million tokens per week (per Zuckerberg)". Izzedo says Power is "five times the free allowance", which also implies about 100M. ToolColumn says Meta does not publish the free amount. — [shattered.io](https://shattered.io/meta-muse-ai-agent-launch-2026/); [izzedo](https://www.izzedo.chat/blog/meta-muse-pricing); [ToolColumn](https://www.toolcolumn.com/tools/meta-muse)
- **User reports [3rd-party, anecdotal]:** a free user reported reaching 20% of the weekly limit "in an hour of just messing around". — [Reddit r/MuseAgent](https://www.reddit.com/r/MuseAgent/comments/1x4isxf/how_much_more_usage_does_power20_get_over_free/)
- **API price for comparison [3rd-party]:** Muse Wonder costs $4 / $20 per 1M input/output tokens, with cache reads at $0.20 per 1M. — [OpenRouter](https://openrouter.ai/meta/muse-wonder)
- **Economics [Press]:** Zuckerberg is "optimistic that improving Muse's energy efficiency" will make it profitable. — [TechCrunch (Business Insider Q3 link)](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)

### Inferences
- **"Muse tokens" cannot be raw API tokens at list price.**
  - Power gives about 2.17B tokens a month for $20, roughly $0.009 per 1M tokens.
  - That is about 440 times below Wonder's input price and about 20 times below even Wonder's cache-read price.
  - So most of the count must be **cache reads of the long, persistent context**, served on a far cheaper Spark-class model at internal cost. Alternatively, Muse tokens are weighted differently.
  - Either way, the large allowances point to (a) heavy prompt caching of one long main-chat context and (b) a small or medium MoE model (the Spark line, about 42B active if close to Spark Open) doing most of the work.
- 100M a week free, 500M on Power and 3B on Maximum suggest Meta expects agent runs measured in tens of millions of tokens a day. That fits background crons and sub-agents re-reading a large cached context.

### Gaps
- No official free-tier number or definition of a "Muse token".
- No official list of which model each plan gets (Wonder "first to subscribers" is the only statement).
- "Phone calls" here means Muse placing real phone calls for the user. No details were found on how that works (voice model, carrier).

## Q5. Platforms and devices

### Takeaway
Confirmed platforms: iOS and Android (Sep 2026), web at muse.ai, WhatsApp, a Mac desktop app, an iPad app (Oct 2026), and Apple Watch and Wear OS apps (announced 9–10 Nov 2026). AI glasses and a Meta "Muse Charm" wearable are "coming soon". On Wear OS the watch is a remote control: the agent does not run on the watch, and the phone is required. The brief's claim that it "works over Bluetooth only" is partly supported (it needs the phone) but contradicted by one snippet.

### Cited Findings
- **iOS, Android, web [Meta]:** launched 8 Sep 2026 in the US. — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- **WhatsApp, voice, desktop [Meta]:** "Chat with your agent using the Muse app on mobile, desktop or directly in WhatsApp, by message or with voice mode." — [ai.meta.com/muse](https://ai.meta.com/muse/)
- **Mac [Meta]:** "Muse works with your desktop computer files, apps and browser tabs". The download is Muse-14.0.dmg. — [ai.meta.com/muse](https://ai.meta.com/muse/); [download page](https://ai.meta.com/muse/download/)
- **iPad [Press]:** dedicated iPad app launched about 7 Oct 2026. — [TechCrunch](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Watches [Press, from Meta's @Muse X post of 9 Nov 2026]:** "Works around the clock, and now on your wrist. Muse is now on Apple Watch and Wear OS." Inputs: voice calls, text and dictation. — [TechCrunch, 10 Nov 2026](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Wear OS is a remote [Press]:** "The Wear OS app serves as a remote to interact with the agent or approve tasks, but it still requires a phone to run the agent." "The smartwatch simply acts like a control hub for tasks run on your phone." Apple Watch has a watch-face complication (unconfirmed for Wear OS). Watch payments are not clarified. — [Android Authority, 11 Nov 2026](https://www.androidauthority.com/meta-muse-ai-wear-os-3733785/)
- **Contradicting snippet [Press, unverified]:** an Android Authority Facebook post snippet says users can "initiate new chats, respond to messages, and make VoIP calls without having to be near their linked phone". This conflicts with Android Authority's own article above. I could not read the full post. — [Android Authority on Facebook](https://www.facebook.com/androidauthority/posts/your-wear-os-watch-can-now-run-metas-muse-ai-agent/1580097920821097/)
- **Galaxy Watch [3rd-party]:** "the watch is just a control hub while your phone does the heavy lifting." — [Instagram post](https://www.instagram.com/p/Dfnf2hplkxU/)
- **Avatars and video [Meta/Press]:** user-designed avatars and names. Video chat with the avatar launched in the US around 5 Nov 2026; Muse can hear but not see the user. — [Meta Newsroom, voice](https://about.fb.com/news/2026/11/introducing-muse-ai-voice-expressive-avatars/); [TechCrunch](https://techcrunch.com/2026/11/10/metas-ai-agent-muse-lands-on-apple-watch-and-wear-os/)
- **Glasses and Charm [Meta]:** "Voice conversations with your Muse are coming soon to AI Glasses and Muse Charm." — [Meta Newsroom, voice](https://about.fb.com/news/2026/11/introducing-muse-ai-voice-expressive-avatars/)

### Inferences
- Every client is thin. The agent and its state live in the cloud VM ("clients connect directly to your VM"). So the watch app needs only a link (phone over Bluetooth, or possibly Wi-Fi/LTE) to reach the VM.
- "Runs on your phone" in the press probably means the phone app relays the connection. The agent itself runs in the cloud.

### Gaps
- No primary Meta page on the watch apps; the only source is an X post as reported by the press.
- "Bluetooth only", and whether a Galaxy Watch with LTE or Wi-Fi works without the phone, is unresolved because the sources conflict.

## Q6. Engineering posts, talks, papers, jobs and interviews revealing internals (memory, retrieval, evaluation, latency)

### Takeaway
The best internal sources are three Meta-written posts:
- the muse.ai security architecture post (Tarek Sheasha);
- "How We Designed Muse";
- the MSL model blogs and reports (Spark, 1.3, Wonder, each with an evaluation report or model card).

Meta has published no latency targets. The only speed figures are model-level: Spark 1.3's token and tool-call savings, and OpenRouter's third-party measurement of Wonder (3.8 s latency, 67 tok/s).

### Cited Findings
- **Primary engineering posts [Meta]:** [How We Built Safety Into Muse](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse); [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); product design walk-through video by Alex, Product Design Lead ([YouTube](https://www.youtube.com/watch?v=wHn0hTjvFoo), linked from the design post).
- **Model reports [Meta]:** [Muse Spark 1.3 Evaluation Report](https://research.meta.ai/static/muse-spark-1-3-evaluation-report); [Muse Wonder model card](https://research.meta.ai/static/muse-wonder-model-card); [Muse Spark Safety & Preparedness Report](https://ai.meta.com/static-resource/muse-spark-safety-and-preparedness-report/); [Meta Superintelligence Scaling Framework](https://research.meta.ai/static/meta-superintelligence-scaling-framework). I did not read these.
- **Avatar research [Meta]:** the "Bringing your Muse to life" research post covers the Realtime Avatar. It is linked from [Meta Newsroom, voice](https://about.fb.com/news/2026/11/introducing-muse-ai-voice-expressive-avatars/) (research.meta.ai/blog/bringing-your-muse-to-life). I did not read it.
- **Memory evaluation [Meta]:** MemoryBench (long-term contextual memory) and FocusBench are Meta's named evaluations for Active Memory and Active Focus. — [research.meta.ai Muse Wonder](https://research.meta.ai/blog/muse-wonder)
- **Memory storage [Meta]:** memory is stored as files in the VM that users can read and edit. — [How We Designed Muse](https://muse.ai/blog/how-we-designed-muse); [security post](https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- **Latency levers [Meta]:** thinking-time penalties ("thought compression") and parallel multi-agent thinking "with comparable latency". — [ai.meta.com Muse Spark blog](https://ai.meta.com/blog/introducing-muse-spark-msl/)
- **Spark 1.3 efficiency [Meta]:** "significantly faster and more efficient, using ~20% fewer tool calls and ~25% fewer tokens" (vs 1.2). — [Muse Spark 1.3 blog](https://research.meta.ai/blog/introducing-muse-spark-1-3)
- **Wonder speed [3rd-party measurement]:** latency 3.80 s, throughput 67 tok/s, uptime 99.72%. — [OpenRouter](https://openrouter.ai/meta/muse-wonder)
- **Model criticism [Press]:** at the Muse Spark launch, Meta admitted "performance gaps" in long-horizon agentic and coding work. Apollo Research found the "highest rate of evaluation awareness" it had seen. — [Ars Technica](https://arstechnica.com/ai/2026/04/metas-superintelligence-lab-unveils-its-first-public-model-muse-spark/); [ai.meta.com Muse Spark blog](https://ai.meta.com/blog/introducing-muse-spark-msl/)

### Inferences
- Meta's own wording ("swarms of subagents", "crons", "SKILLs", "harness", "CLIs") shows Muse is built like a modern coding-agent harness (compare Muse Code) applied to personal life. The same model line is trained "across a diverse set of harnesses".

### Gaps
- I found no job postings, conference talks (beyond the Connect 2026 voice preview), or interviews that describe memory retrieval (embeddings or search), scheduler design, or latency targets for Muse.
- I did not search job boards or listen to the Connect 2026 keynote; both were out of the tool-call budget.
