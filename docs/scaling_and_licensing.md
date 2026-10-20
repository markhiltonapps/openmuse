# Selling Neddy: how it scales, and what the MIT licence asks of you

Written 2026-10-20 for the owner. Plain answers first, details after.

## 1. Scaling

### What runs today (Railway project "openmuse", one environment)

| Service | What it does | How it scales |
|---|---|---|
| api (Node) | Accounts, chat agent, background jobs, meetings, files, the voice signalling | One instance. Vertical first (more CPU/RAM on the same box). Horizontal needs the checks below. |
| web (Caddy) | Serves the app and this landing page; static files | Stateless. Any number of copies, or put it behind a CDN. |
| voice (Python, Pipecat) | Our own live voice: Soniox → Haiku → Inworld, WebRTC through Cloudflare TURN | CPU-bound: about 0.44 core per call. VOICE_WORKERS × VOICE_CALLS_PER_WORKER calls per box (2 × 4 = 8 today). More boxes behind the front router for more. |
| browser (Node, Playwright) | The agent's web hands for jobs | One browser per job; add replicas as jobs grow. Redeploys only when apps/worker changes. |
| Postgres | Every record (accounts, jobs, chats' saved parts, meetings, usage) | Railway's managed Postgres; grows vertically to large sizes. Read replicas later if ever needed. |
| Bucket (S3-style) | Files, recordings, exports | Effectively unlimited. |
| Outside: CopilotKit Cloud | Chat threads and their history | Their problem to scale; our cost per thread. |
| Outside: Anthropic / OpenRouter, Soniox, Inworld, OpenAI (optional voice) | Models, speech | Pay per use; rate limits rise with spend tiers. |

### What this means in numbers

- **Chat and jobs**: the api spends almost all its time waiting on model calls, so one instance handles hundreds of active people before CPU matters. The ceiling is model rate limits and your bill, not the server.
- **Calls**: the one thing that eats CPU. Eight calls at once today. The largest single Railway box carries roughly 70. Past that, more voice boxes.
- **Meetings**: transcription is sent out to Soniox; the api only joins pieces and writes notes. Cheap.
- **Database**: at thousands of users the data is still small (text). The biggest rows are meeting transcripts.

### Before taking paying customers, in this order

1. **Make the api safe to run as two copies.** It keeps a few things in memory today: request-access rate limits, the "which job is running right now" maps, a signing key read at start. Each must move to Postgres or become harmless when duplicated. Then set Railway replicas to 2, so a deploy or a crash never takes everyone down.
2. **A load test** with fake users (200 chatters, 20 calls) against a staging environment, to find the first real limit instead of guessing.
3. **Two environments**: staging and production. Today a push deploys straight to the people using it.
4. **Alerts**: Railway's built-in alerts on CPU, memory and restarts, plus the api's own "Model call" log lines into a dashboard, so cost per person is visible daily.
5. **Backups**: Railway Postgres backups are on by default; confirm the schedule and test a restore once.
6. **Per-person limits** already exist for calls (minutes a month) and meetings (hours a month); add one for chat tokens before offering an "unlimited" plan.

### Cost side, so pricing stays sane

- A call minute costs about 1.6¢ on our voice (5¢ on OpenAI's).
- A chat message costs about 2¢ when the conversation is warm, up to 18¢ for the first message after an hour away. Trimming the 70k-token context is the biggest lever.
- A recorded meeting costs 10¢ an hour.
- Fixed: Railway (roughly $20 to $60 a month at today's size), CopilotKit Cloud, domains.

## 2. The MIT licence, done right

OpenMuse is MIT-licensed (LICENSE in this repo, "Copyright (c) 2026 OpenMuse contributors"). MIT lets you use, change, sell and keep your changes private. It asks one thing: keep the copyright and permission notice with any copy or substantial portion of the software you distribute.

### What you must do

1. **Keep the LICENSE file** in your repository, unchanged in substance. You may add your own copyright line above it for your changes ("Copyright (c) 2026 Neato Ventures" for the parts you wrote); the OpenMuse line stays.
2. **Ship the notice with what you distribute.** A web app served from your servers isn't "distributed" in the copyright sense, so the strict obligation only bites when you hand out the code or a packaged app (an Android APK, a desktop build). For those, include the MIT text in the package (an About screen or a bundled LICENSES file). It costs nothing to do it on the website too, and the landing page already says "Built on OpenMuse, open source under the MIT license."
3. **Don't imply endorsement.** MIT doesn't grant trademark rights. Say "built on OpenMuse", never "by CopilotKit" or "official". The same applies to logos.
4. **Keep a THIRD-PARTY-NOTICES file.** The app pulls in about 1,240 npm packages and a handful of Python ones. Nearly all are MIT, ISC, BSD or Apache, which only ask for notice. Generate the file with `pnpm licenses list --json` (and `pip-licenses` for apps/voice) and include it in any packaged app. Worth doing once now and again before each packaged release.

### Things checked on 2026-10-20

- **No GPL or AGPL** in the dependency tree. Two packages are dual-licensed and you take the permissive side: jszip (MIT or GPL) and node-forge (BSD or GPL).
- **MPL-2.0** (dompurify, lightningcss, web-push): fine to use unmodified in a commercial product. If you ever change their source, those changed files must stay open; nothing else.
- **Three packages declare no licence field**: @ag-ui/mcp-middleware, @ag-ui/mcp-apps-middleware (both from CopilotKit's ag-ui repo, which is MIT), and khroma (used by mermaid; its repo is MIT). Nothing to do beyond noting them.
- **Python (apps/voice)**: pipecat-ai (BSD-2), aiortc (BSD-3), anthropic (MIT), aiohttp (Apache-2), fastapi (MIT), uvicorn (BSD-3), websockets (BSD-3). Silero VAD and the smart-turn model are MIT/BSD. All fine.
- **Backdrop clips** come from Mixkit under its free licence, which allows commercial use; attribution is not required but we credit them (apps/mobile/public/backdrops/CREDITS.txt and the landing page footer). Keep that file with the clips.
- **Fonts**: Figtree is under the SIL Open Font Licence. Fine for commercial use, including self-hosting.
- **Icons**: lucide (ISC). Fine.

### Things only you can settle

1. **Neddy's artwork.** The character pictures arrived with the Future page on Sept 30 and the notes don't record which tool or artist made them. If they were generated, check that tool's terms give you commercial rights to its output (most paid tiers do; some free tiers don't); if an artist drew them, keep the agreement. Either way, write down the source now. Generated images may not be copyrightable, which means others could reuse them; a registered trademark on the name and a distinctive logo is the real protection.
2. **The name.** Before printing it anywhere, run a trademark search for "Neddy" in your class (software, class 9 and 42) in the US and wherever you'll sell, then file. Avoid "Neato" in the product name: Neato Robotics holds that mark for consumer devices.
3. **Upstream changes.** You're free to keep your fork private. If you ever contribute fixes back to CopilotKit/OpenMuse, their contribution rules apply (CONTRIBUTING.md). Taking their later commits in is covered by the same MIT licence.
4. **Model and API terms.** Anthropic, OpenAI, OpenRouter, Soniox and Inworld each have commercial-use terms separate from code licences. All allow resale in a product; Anthropic's require that you don't present Claude as your own model and that you follow their usage policy for end users. Keep a short acceptable-use line in your own terms of service.
5. **Your own terms and privacy policy.** Needed before the first paying customer: what you store (chats, recordings for 30 days, memory), which third parties see it (the model providers, Soniox for audio, CopilotKit for chat history), and how to delete it (the app's export and reset already exist; point to them).

### A short checklist to keep in the repo

- [ ] LICENSE kept; own copyright line added for new work
- [ ] THIRD-PARTY-NOTICES generated and bundled with any packaged app
- [ ] "Built on OpenMuse (MIT)" on the site and an About screen
- [ ] Mixkit CREDITS.txt kept with the clips
- [ ] Artwork rights confirmed and recorded
- [ ] Trademark search and filing for the name
- [ ] Terms of service and privacy policy published; link from the sign-in screen
