# Techniques that make AI personal assistants feel smart, proactive and human (for Neddy)

Research date: 2026-11-25. Scope: published, evidence-backed techniques a small team on hosted Claude/OpenAI models can apply. Neddy context assumed throughout: Claude Haiku 4.5 chat, ~26k-token prompt (~7k instructions, ~19k for 89 tool definitions), regex "turn coach", proactive engine + one daily small-model check, OSM directions written by a stronger model, prompt caching, voice-first.

Source-quality legend: [primary] = the author of the technique or study; [vendor] = a company describing its own product (treat numbers as marketing until reproduced); [secondary] = a third party summarising someone else. Items marked "(not re-fetched this session)" are well-known primary sources cited from prior knowledge; their URLs are stable but their exact figures were not re-checked today.

## Context: what Meta Muse says it does (the competitor)

### Takeaway
Meta's own launch post attributes Muse's quality to a frontier model ("MuseSpark"), long-term memory that drives unprompted suggestions, background work that comes back "when something changes", and approval gates. It says nothing published about search/maps grounding, routing or latency, so "why its travel answers are better" cannot be read off Meta's own words; the most likely explanation is a much stronger model plus first-party search, not a secret technique.

### Cited Findings
- Muse launched 2026-09-08; "Powered by MuseSpark, Meta's most capable model to date, built for real-world agentic work." — [Meta Newsroom, 2026-09-08, primary](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Memory is framed as the source of proactivity: "Muse also remembers what matter to a person, so it can make suggestions unprompted and act on details that person only mentioned once"; users can tell it to "forget" specific things. — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Background work: "Muse keeps working after people close the app, and comes back when something changes or when it needs approval, like before it sends an email or makes a purchase"; shows "a complete audit trail of everything it has done and plans to do". — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Muse rolled out to Singapore (2026-10-27) and the UK (2026-11). — [Meta Newsroom (UK)](https://about.fb.com/news/2026/11/introducing-muse-in-the-uk-a-personal-ai-agent-you-control/); [Wikipedia: Muse (AI agent)](https://en.wikipedia.org/wiki/Muse_(AI_agent))

### Inferences
- Neddy's gap on "real-world questions while travelling" is most plausibly model capability plus grounding (see sections 1 and 3), since Neddy already has memory, proactive notices, approvals and an audit trail in some form.

### Gaps
- No published Meta engineering detail on Muse's grounding, routing, prompt design or voice latency was found.

---

## 1. Model routing and cascades: when to send a turn to a stronger model

### Takeaway
Routing is the best-evidenced lever here: trained routers matched ~95% of GPT-4 quality while sending a minority of traffic to the strong model (cost cut 35-85% depending on the benchmark). For Neddy the inverse framing matters more: Haiku-only is the "all weak" corner of the curve; a router that sends the hardest ~10-30% of turns (open-world, travel, recommendation, multi-step) to Sonnet/Opus-class models is the published way to buy most of the quality gap at a fraction of the cost.

### Cited Findings
- RouteLLM (Ong et al., LMSYS/Berkeley, 2024-06): routers trained on Chatbot Arena preference data reduce cost "by over 2 times without sacrificing response quality". — [arXiv 2406.18665, primary](https://arxiv.org/abs/2406.18665); [OpenReview](https://openreview.net/forum?id=8sSqNntaMr)
- Same work, project page: "cost reductions of over 85% on MT Bench, 45% on MMLU, and 35% on GSM8K as compared to using only GPT-4, while still achieving 95% of GPT-4's performance." — [LMSYS blog, 2024-07-01, primary](https://www.lmsys.org/blog/2024-07-01-routellm/); [Berkeley Sky project page](https://sky.cs.berkeley.edu/project/routellm/)
- Reviewer summary: on MT Bench RouteLLM reaches GPT-4-comparable performance "with a cost saving of ~3.7x". — [OpenReview reviews](https://openreview.net/forum?id=8sSqNntaMr)
- Router overhead is negligible: a matrix-factorisation router costs ~$3.32 per million requests (155 req/s on a $0.8/h VM); a BERT router $3.19; a causal-LLM router $5.23. — [RouteLLM paper, Table 5.5](https://arxiv.org/pdf/2406.18665)
- Calls-to-strong-model needed for 50% of the quality gap (CPT(50%)) were as low as 1.41 on MMLU and 1.49 on GSM8K in RouteLLM's analysis (i.e., most of the gain from routing a small share). — [RouteLLM paper, Sec 5.4](https://arxiv.org/pdf/2406.18665)
- FrugalGPT (Chen, Zaharia, Zou, 2023) introduced the LLM cascade (try cheap model, score the answer, escalate if low) and is the standard reference for cascades; RouteLLM cites it. — [arXiv 2305.05176, primary (not re-fetched this session)](https://arxiv.org/abs/2305.05176)
- Anthropic's agent guidance lists "routing" as a core workflow: classify input and send it to a specialised path, e.g. "routing easy/common questions to smaller models like Claude Haiku and hard/unusual questions to more capable models". — [Anthropic, Building effective agents, 2024-12 (not re-fetched this session)](https://www.anthropic.com/research/building-effective-agents)

### Inferences
- Practical design for Neddy, cheapest first: (a) a rules router reusing the turn coach's pattern kinds (directions, places, shopping, live facts, recommendations, corrections) to escalate those turns to a stronger model; (b) later, a small trained classifier on logged turns labelled by an LLM judge ("would the strong model's answer be clearly better?"), which is exactly RouteLLM's recipe with Neddy's own preference data. A cascade (Haiku answers, a cheap verifier checks "did it use a tool / cite a source / answer the question", escalate on fail) is the FrugalGPT pattern and pairs with Neddy's existing "Answered without checking" log.
- Escalate on the person's correction ("that's wrong", "I got lost"): the turn after a correction is where a weak model is most likely to repeat itself, and it is a strong routing signal Neddy already detects.
- Routing to a different model breaks the prompt cache for that turn; keep the stronger model's prompt identical in structure so it builds its own cache, and measure cost per escalated turn on Railway logs before widening.

### Gaps
- RouteLLM/FrugalGPT evidence is on benchmarks (MT Bench, MMLU, GSM8K), not tool-using personal assistants; no published study found measuring routing on agentic, tool-heavy assistant traffic.
- No public data on what share of personal-assistant turns need a frontier model.

---

## 2. Tool selection at scale: fewer tools per turn, tool search, better tool definitions

### Takeaway
89 tools / ~19k tokens is well past the point where published tests show selection accuracy falling, and small models suffer most. Loading 3-5 core tools plus retrieving the rest per turn raised accuracy substantially in every published test, but the built-in keyword retrievers are weak at large scale; hybrid semantic + keyword retrieval did much better. Tool-use examples and clearer descriptions are a separate, cheap win.

### Cited Findings
- Anthropic Tool Search Tool (published 2025-11-24): on MCP evals with large tool libraries "Opus 4 improved from 49% to 74%, and Opus 4.5 improved from 79.5% to 88.1%". — [Anthropic, Introducing advanced tool use, primary](https://www.anthropic.com/research/advanced-tool-use)
- Same post: a 50+ tool setup used ~72K tokens of definitions (~77K before any work); with tool search only ~500 tokens load up front and 3-5 tools (~3K) are discovered on demand, ~8.7K total, an "85% reduction in token usage". Recommendation: "Keep your three to five most-used tools always loaded, defer the rest." Use it when definitions exceed ~10K tokens, there are 10+ tools, or there are selection accuracy problems; less useful under 10 tools. — [Anthropic, advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
- Tool Use Examples (example calls attached to a tool definition): accuracy "improved from 72% to 90% on complex parameter handling"; most useful for nested parameters, many optional fields, domain conventions, and "similar tools where examples clarify which one to use". — [Anthropic, advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
- Programmatic Tool Calling (model writes code that calls tools, only the result returns to context): average tokens 43,588 -> 27,297 (37% less) on complex research tasks; knowledge retrieval 25.6% -> 28.5%; GIA benchmark 46.5% -> 51.2%. Useful for multi-step workflows with 3+ dependent calls or large intermediate results; not for single quick lookups. — [Anthropic, advanced tool use](https://www.anthropic.com/research/advanced-tool-use)
- Independent tests of Anthropic's built-in search at very large scale are much worse: Arcade reported 56% retrieval accuracy (regex) and 64% (BM25) across 4,027 tools. — [Arcade test as reported by Stacklok, secondary](https://stacklok.com/blog/stackloks-mcp-optimizer-vs-anthropics-tool-search-tool-a-head-to-head-comparison/); [growthmethod summary, secondary](https://growthmethod.com/anthropic-tool-search/)
- Stacklok (vendor, 2026-01) with 2,792 tools and Sonnet 4.5 selecting: hybrid semantic + BM25 retrieval found the right tool 98% of the time vs 48% for Anthropic's Tool Search, giving 94% vs 34% selection accuracy. They also found frontier models barely changed (Sonnet 4: 94.6% -> 93.4%) while "mid-tier and smaller models showed significant improvements" from fewer tools. — [Stacklok, vendor comparing against a competitor; treat with caution](https://stacklok.com/blog/stackloks-mcp-optimizer-vs-anthropics-tool-search-tool-a-head-to-head-comparison/)
- RAG-MCP (Gan et al., 2025-05): retrieving only the relevant tools before the model sees them more than tripled selection accuracy (43.13% vs 13.62% with all tools in the prompt) and cut prompt tokens by over 50% (1,084 vs 2,134 avg). Its stress test shows retrieval precision degrading as the registry reaches thousands of tools. — [arXiv 2505.03275, primary](https://arxiv.org/abs/2505.03275); [HTML version with tables](https://arxiv.org/html/2505.03275v1)
- Anthropic's tool-writing guidance: consolidate overlapping tools, namespace them, return high-signal results, and write descriptions as for a new colleague; it reports improvements from Claude-assisted rewriting of tool descriptions on held-out evals. — [Anthropic, Writing effective tools for agents, 2025-09 (not re-fetched this session)](https://www.anthropic.com/engineering/writing-tools-for-agents)

### Inferences
- Neddy's 19k tokens of tool definitions sits above Anthropic's own >10K threshold and its 89 tools are far above 10. The most evidence-backed change: keep ~5-10 always-on tools (search_web, get_directions, find_nearby, weather, calendar read, memory, use_app), and load the rest per turn. Because Neddy already pattern-matches each message (turn coach), the cheapest first version is deterministic: the coach's kinds select a tool subset. That is a "router" for tools with no model call, and it likely helps Haiku more than it would help a frontier model (Stacklok's small-vs-large finding).
- Caveat for caching: a per-turn tool list changes the cached prefix. Anthropic's tool search is designed to keep deferred tools out of the prefix; a hand-rolled subset should put the stable core tools first and the variable ones after the cache breakpoint, or group tools into a few fixed bundles so each bundle caches.
- Add 1-3 example calls to the tools Neddy most often misuses (get_directions vs find_nearby vs search_web; Gmail move steps). This is the cheapest measured win (72% -> 90% on parameter handling).
- Programmatic tool calling matches Neddy's own lesson that "bulk work belongs on the server": both keep large intermediate data out of the model's context.

### Gaps
- No published Haiku 4.5-specific tool-search or tool-count study was found; numbers above are Opus/Sonnet or other models.
- Berkeley Function Calling Leaderboard (BFCL) findings were not retrieved this session; I could not confirm a current BFCL result on tool-count effects.

---

## 3. Grounding real-world answers (search, maps/places, sources)

### Takeaway
The big providers now sell "grounding" as a first-class tool precisely because model memory is unreliable for places, hours and directions. The technique is: always call a places/search tool for real-world questions, pass the user's coordinates, show place citations/links, and say what the data cannot see. Neddy's directions work (map data + strong writer + Maps link) is aligned with this; the gap is breadth of place data outside OSM and making grounding the default rather than a coach hint.

### Cited Findings
- Google's Gemini API "Grounding with Google Maps" connects the model to "data from over 250 million places"; answers detailed place questions (e.g., outdoor seating) from reviews and Maps data; accepts the user's lat/lng; returns Maps source links to display; can be combined with Search grounding ("Google Maps provides grounding with structured, factual data like addresses, hours and user ratings"). — [Google blog, 2025-10, vendor](https://blog.google/innovation-and-ai/technology/developers-tools/grounding-google-maps-gemini-api/); [Gemini API docs, current](https://aistudio.google.com/docs/maps-grounding)
- The GA announcement notes the personalised capability is "currently available for places in the United States and India" (a coverage limit relevant to a user in Singapore). — [Google Developers Blog, vendor](https://developers.googleblog.com/en/your-ai-is-now-a-local-expert-grounding-with-google-maps-is-now-ga/)
- Gemini's Maps grounding returns `place_citation` annotations (name + URL) per answer, i.e., sources are part of the response format. — [Gemini API docs](https://aistudio.google.com/docs/maps-grounding)

### Inferences
- For Neddy (Claude/OpenAI chat): the equivalent is a places tool backed by a commercial places API (Google Places API, Foursquare, or Apple Maps Server API) alongside OSM, returning name, address, hours, rating, distance and a link, and a rule that any answer naming a place, hours, price or route carries the link. OSM/Overpass is weak on shops, hours and reviews outside well-mapped areas, which matches the "where can I buy a travel pillow" failure.
- Consider routing grounded real-world turns to a model that has native grounding (e.g., a Gemini model with Maps+Search grounding) as a specialised route under section 1, if the owner accepts a third provider.

### Gaps
- No published head-to-head measuring hallucination rates for place/travel answers with vs without grounding was found in this session.
- Foursquare, Apple Maps and Google Places pricing/terms for assistant use were not researched here.

---

## 4. Memory for personal assistants

### Takeaway
Two production designs dominate: explicit, user-visible saved facts that can be edited or "forgotten" (ChatGPT saved memories, Claude memory, Muse "forget"), plus implicit recall from past chats (ChatGPT "reference chat history", Claude chat search). Benchmarks claiming one memory product is state-of-the-art are disputed; a plain store of past conversations with search scored as well as specialised memory layers. For a small team, simple, visible, editable facts plus searchable history is the evidence-supported choice.

### Cited Findings
- ChatGPT has two separate memory sources: "saved memories" (explicitly asked for, or saved as useful context; stored separately from chats; deletable or editable; deleting a chat doesn't delete the memory) and "reference chat history" (derived from past chats; "can change as ChatGPT updates what is most useful to remember"), each switchable independently. — [OpenAI Help Center, primary](https://help.openai.com/en/articles/8590148-memory-in-chatgpt)
- Claude offers chat search plus memory; memory is scoped to Projects ("New memory is saved to the project"). — [Claude Help Center, primary](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context)
- Muse: remembers "what matters" and lets users tell it to "forget" specific items. — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)
- Mem0 (2025-04 paper) claimed state-of-the-art on the LoCoMo benchmark; Mem0's current site claims 92.5 on LoCoMo and 94.4 on LongMemEval at "3-4x lower token cost than full-context". — [Mem0 paper arXiv 2504.19413 (not re-fetched)](https://arxiv.org/abs/2504.19413); [Mem0 research page, vendor](https://mem0.ai/research)
- Disputed: Letta (2025-08) placed LoCoMo history in files with only grep/search tools and scored 74.0% with GPT-4o mini, above Mem0's reported 68.5% for its best graph variant, arguing a filesystem plus search is competitive. — [Letta blog, vendor](https://www.letta.com/blog/benchmarking-ai-agent-memory/); [Charles Packer (Letta CEO) post](https://www.linkedin.com/posts/charles-packer_dont-trust-everything-you-read-online-activity-7361113034754347008-Ic7L)
- Disputed: Zep says Mem0's SOTA claim rests on a flawed benchmark and an incorrect implementation of Zep. — [Zep blog, vendor](https://www.getzep.com/blog/lies-damn-lies-statistics-is-mem0-really-sota-in-agent-memory/)
- A 2026 survey (arXiv 2603.07670) reportedly found models "that score near-perfectly on LoCoMo plummet to 40-60% in MemoryArena", i.e., LoCoMo is saturating. — [quoted in a Letta GitHub issue, secondary; survey not read directly](https://github.com/letta-ai/letta/issues/3115)
- MemGPT (Packer et al., 2023) introduced tiered memory the model manages itself (core memory in-context, archival memory searched by tools); it became Letta. — [arXiv 2310.08560 (not re-fetched)](https://arxiv.org/abs/2310.08560)
- Anthropic's context-engineering guidance recommends compaction (summarise and restart near the context limit), structured note-taking outside the context, and just-in-time retrieval over pre-loading. — [Anthropic, Effective context engineering for AI agents, 2025-09 (not re-fetched)](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

### Inferences
- Neddy's existing design (About you facts with sources, main chat in parts with summaries and search_earlier_chat, "remember this needs a real home") matches the leading production pattern. Treat memory vendor benchmarks as marketing; build a small internal eval of "facts it should have used" from real transcripts instead.
- What Muse emphasises and Neddy could add: use memory to *trigger* suggestions (the daily check reading About-you facts and goals), and handle updates (a newer fact supersedes an older one with a date), which the cited benchmark critiques say current benchmarks don't test.

### Gaps
- No controlled study found on how much memory improves perceived helpfulness in a personal assistant.
- Exact published retrieval/consolidation designs of ChatGPT's "reference chat history" are not public.

---

## 5. Proactive assistants: when to interrupt

### Takeaway
The evidence says timing matters more than content: people accept help that does not compete with what they are doing and reject correct help that interrupts. One misaligned interruption costs more trust than an aligned one earns, and LLM judges miss this. A decide-whether-to-speak step ("inner thoughts" with an intrinsic-motivation score) was strongly preferred over turn-based bots. Neddy's single judge with quiet hours, limits, dedupe and feedback-muting is consistent with this; the research suggests adding a "does this compete with what they're doing now?" check and preferring prepared-for-later over now.

### Cited Findings
- Proactivity-Gym (Oh, Do, Whang at KAIST; Lee, Kang at U. Minnesota; reported 2026-09-29) frames proactive agents by five choices: task scope, anticipation horizon, activation trigger (user request / external event / agent's self-review), processing timing, intervention depth. — [Personal Agent Bench summary, secondary](https://personalagentbench.com/proactive-ai-agents/); paper link given there: [arXiv 2609.37267](https://arxiv.org/abs/2609.37267) (not read directly)
- Same study (as summarised): acceptance of correct help that competed with ongoing work was 26.7%, versus 97.8% for help done during sleep time; 64.4% preferred the overnight version even when an immediate option cost only 10 minutes and clashed with nothing. — [Personal Agent Bench, secondary](https://personalagentbench.com/proactive-ai-agents/)
- Trust is asymmetric: moving from an aligned to a misaligned intervention cost 1.86 points on average, the reverse gained 1.27; an aligned-misaligned-aligned sequence ended at 3.43 trust vs 4.43 at the start. — [Personal Agent Bench, secondary](https://personalagentbench.com/proactive-ai-agents/)
- "LLM judges rated trust highly for agents that got the depth wrong", i.e., model graders missed what people noticed. Apart from Claude Opus 5 (51.7%), every model scored under 20% on deferring competing work. — [Personal Agent Bench, secondary](https://personalagentbench.com/proactive-ai-agents/)
- Inner Thoughts (Liu et al., CHI 2025): the agent continuously generates candidate "thoughts" and speaks only when its intrinsic motivation to share is high; participants preferred Inner Thoughts conversations 82% of the time and rated it higher on engagement and initiative (multi-party settings). — [ACM DL, primary](https://dl.acm.org/doi/10.1145/3706598.3713760); [arXiv 2501.00383](https://arxiv.org/abs/2501.00383)
- Muse's product framing: advance goals in the background and "come back when something changes or when it needs approval". — [Meta Newsroom](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/)

### Inferences
- Concrete rules for Neddy's judge: (1) prefer "prepared for later" delivery (morning digest, next app open) over a buzz unless urgent; (2) suppress non-urgent notices while the person is mid-call, typing or driving (competing work); (3) one misaligned notice costs more than one good notice earns, so keep daily caps low and mute areas fast (already done); (4) validate proactive behaviour with real user feedback, not an LLM judge alone.
- Event-driven triggers (calendar change, flight change, email arrival) plus a self-review pass (daily check) map onto the paper's three trigger types; Neddy already has two of three.

### Gaps
- Proactivity-Gym numbers come via a secondary summary site; the arXiv paper was not read directly, so treat figures as provisional.
- No published product metrics (opt-out rates, notification acceptance) from Google, OpenAI (ChatGPT Pulse) or Meta were found.

---

## 6. Conversational quality and how to evaluate it

### Takeaway
The published practice for "better, more human answers" is evaluation-driven: collect real transcripts, read them, label a small set by hand, calibrate an LLM judge against those labels, then run pairwise comparisons (Neddy vs competitor, old vs new prompt) at scale. Judges must point to evidence in the transcript, and humans still review samples because judges miss things people notice (see section 5).

### Cited Findings
- Anthropic's "Demystifying evals for AI agents" (2026) is the main primary guide: grader hierarchy (code checks, LLM judges, humans), an eval flywheel, and error analysis on transcripts. — [Anthropic, primary](https://www.anthropic.com/research/demystifying-evals-for-ai-agents); dated 2026 in [Cameron Wolfe's bibliography](https://cameronrwolfe.substack.com/p/agent-evals)
- Calibrating judges: a judge should "point to the section of the output, tool call, or transcript passage that supports its conclusion", and teams should "read the transcripts before declaring victory". — [Arize summary of Anthropic guidance, secondary](https://arize.com/blog/anthropic-tips-how-to-build-evals-you-can-trust/)
- Practitioner pipeline: humans label small high-quality samples, validate the judge's true-positive/true-negative rates against them, then let the judge evaluate at scale. — [Arnab Roy synthesis of Anthropic, Hamel Husain, Shankar & Husain, secondary](https://www.aroy.sh/posts/llm-agent-evals/)
- Chatbot Arena style pairwise human preference is the data RouteLLM's routers were trained on, i.e., pairwise preference is both an eval and a training signal. — [LMSYS RouteLLM blog](https://www.lmsys.org/blog/2024-07-01-routellm/)
- LLM judges over-rated trust for agents that got intervention depth wrong. — [Personal Agent Bench, secondary](https://personalagentbench.com/proactive-ai-agents/)

### Inferences
- Side-by-side against Muse: build 50-100 real prompts from the owner's travel days (directions, "where can I buy", "is X open", restaurant picks), get both assistants' answers, have a calibrated judge plus the owner pick winners blind, and tag *why* (grounded vs memory, specificity, brevity, tone). The per-category win rate tells which section (routing, tools, grounding) to fund first. The same labelled pairs can later train Neddy's router (section 1).
- Track "Answered without checking" rate and correction rate ("that's wrong") per category as production quality metrics.

### Gaps
- I found no published study isolating persona/brevity prompt changes with measured user-satisfaction effects for voice assistants; style guidance in vendor docs is mostly advice without numbers.
- The Anthropic evals post was found via search but its full text was not re-read this session.

---

## 7. Voice: latency, turn-taking, feeling human

### Takeaway
The working target in industry is ~800 ms voice-to-voice (human turn gaps are ~200 ms; ~1 s starts to feel broken), while measured real assistants often run 1.3-1.7 s. Endpointing (deciding the person has finished) eats a large share of the budget; semantic/acoustic turn detectors cut false interruptions substantially compared with silence timers.

### Cited Findings
- "Treat 800 ms as the line where it starts to feel slow"; it sits between the ~200 ms human gap and ~1 s where delay "reads as a problem". — [Soniox Voice AI Wiki, vendor](https://soniox.com/wiki/voice-agent-latency-budget)
- A 2025 observational study of nine voice-assistant users measured a 1,366 ms mean response delay; callers notice lag near 800 ms round trip. — [Deepgram architecture guide citing SemDial 2025, vendor/secondary](https://deepgram.com/blog/voice-agent-architecture-stt-llm-tts-pipeline-design); [SemDial paper PDF](https://www.semdial.org/anthology/Z25-Barthel_semdial_3315.pdf)
- Most voice AI systems respond in 1.4-1.7 s at the median. — [Voicetta, vendor (unsourced figure; weak)](https://voicetta.com/blog-md/low-latency-voice-ai-why-under-800ms-is-non-negotiable-for-real-calls)
- A fixed 200-400 ms silence timer can consume a third to a half of the 800 ms budget before the LLM sees a token; even a 400 ms pause can feel laggy on a phone call. — [Cerebrium, vendor](https://cerebrium.ai/resources/end-of-turn-detection-model-latency-voice-agent-pipelines)
- Example budget: of 800 ms, the LLM gets ~300 ms to first token, not to a full answer (so stream and speak the first sentence early). — [Outcome School, secondary](https://outcomeschool.com/blog/voice-agent-latency-budget)
- LiveKit reports an improved end-of-turn model that "cuts voice AI interruptions 39%"; its v1.0 turn detector listens to audio directly and fuses semantic and acoustic cues instead of waiting for a transcript. — [LiveKit blog, vendor](https://livekit.com/blog/improved-end-of-turn-model-cuts-voice-ai-interruptions-39); [LiveKit Turn Detector v1.0, vendor](https://livekit.com/blog/solving-end-of-turn-detection)
- Human turn-taking gaps average about 200 ms across languages (Stivers et al., PNAS 2009). — [PNAS (not re-fetched)](https://www.pnas.org/doi/10.1073/pnas.0903616106)

### Inferences
- For Neddy: measure p50/p95 voice-to-voice on real calls; use a semantic turn detector (Pipecat has smart-turn options; OpenAI live has semantic VAD) rather than a fixed silence timer; when a turn needs a hand-off or tool, speak a short, honest filler immediately ("Let me check the map") so the gap reads as thinking, consistent with Neddy's existing rule not to promise before the answer returns. Backchannels already exist in Neddy's own voice; the cited 39% interruption reduction suggests turn detection is the higher-value fix.
- Routing (section 1) conflicts with voice latency: a stronger model adds time-to-first-token, so on calls escalate only turns that already need a tool look-up (where the filler covers the wait).

### Gaps
- Most voice latency figures come from vendors selling voice infrastructure; I found no independent controlled study tying specific latencies to user satisfaction beyond the 9-user SemDial study.
- No published measurements found for backchannel effects on perceived humanness in LLM voice agents.

---

## Cross-cutting summary of highest-evidence moves for Neddy (inference, ranked by evidence x cost)

1. Cut tools in context per turn (keep ~5-10 core, load the rest by the turn coach's kinds or tool search), and add example calls to confusable tools. Evidence: Anthropic 49->74% / 79.5->88.1%; RAG-MCP 13.6->43.1%; examples 72->90%. Strongest for smaller models.
2. Route hard real-world turns (directions, places, shopping, recommendations, after a correction) to a stronger model; start rule-based, then train on labelled pairs. Evidence: RouteLLM 95% of strong-model quality at large cost savings.
3. Make grounding the default for real-world answers with a commercial places source in addition to OSM, always with links. Evidence: providers ship maps grounding for exactly this; no controlled hallucination numbers found.
4. Build a side-by-side eval against Muse on real travel prompts with a calibrated judge plus owner review; it decides which of 1-3 to fund and supplies router training data.
5. Proactive timing: deliver non-urgent help "for later", never during competing activity; keep caps low. Evidence: 26.7% vs 97.8% acceptance; asymmetric trust loss.
6. Voice: semantic turn detection and early honest fillers within an ~800 ms target. Evidence mostly vendor-reported.

Hype flags: memory-layer SOTA claims (Mem0 vs Letta vs Zep disputes); vendor tool-retrieval comparisons (Stacklok vs Anthropic); unsourced voice latency medians; Muse's own claims ("selling a car for more") are marketing without published evaluation.
