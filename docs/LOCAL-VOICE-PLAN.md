# Neddy's voice on our own server (plan)

Status: proposal only. Nothing here is built yet. Written 2026-10-10.

## The idea in one line

Neddy's live voice runs on a server you control: LiveKit, Whisper, a Llama model and Kokoro.
OpenAI is no longer needed for calls. People still use any phone or computer, with nothing to
install.

## Your answers this plan follows

- **No special hardware for the people using it.** They talk to Neddy from the app, as now. The
  heavy work happens on one server.
- **Hand off to the app.** The voice handles the conversation itself. When it needs to look
  something up or do something, it hands the question to the chat agent, as today's "hold on,
  let me check" does.
- **Tailscale** links our server pieces privately.
- **Plan only.** The Python code comes in Slice 0, once the server is chosen.

## The honest part: speed needs a graphics card on the server

Under 500 ms from when you stop talking to when Neddy starts speaking is a hard target, even for
OpenAI. With our own stack, each step adds a delay:

| Step | On a server with a GPU | On a server without one |
|---|---|---|
| Noticing you've stopped talking | 200–300 ms | 200–300 ms |
| Whisper turning your words into text | 100–200 ms | 400–1,000 ms |
| Llama starting its reply (first words) | 100–300 ms | 500–2,000 ms |
| Kokoro starting to speak | 100–200 ms | 200–500 ms |
| Network | 50–100 ms | 50–100 ms |
| **Total before Neddy speaks** | **about 0.5–1 second** | **about 1.5–4 seconds** |

These are estimates. Slice 0 measures the real numbers.

- **With a GPU:** about half a second to one second. Tuning gets it lower:
  - noticing sooner that you've finished;
  - starting the reply before your turn is fully confirmed;
  - short replies;
  - keeping the model loaded and warm.

  Under 500 ms is possible on good days, not every time.
- **Without a GPU:** works, but there's a noticeable pause of a few seconds, like a slow phone
  line. Fine for a test, not as good as the current calls.
- **Railway has no GPUs.** The voice server has to live somewhere else. The api, app and worker
  stay on Railway.

Only the server needs the GPU. Nobody's phone or computer does.

## What "local" covers

- **Stays on our server:** your voice, the words you say (Whisper), Neddy's side of the
  conversation (Llama), and Neddy's voice (Kokoro). No audio goes to OpenAI or anyone else.
- **Still leaves it:** a hand-off. "What's on my calendar", "email Jamie", a web search: these go
  to the chat agent (cloud models and connected apps), as they do in the chat today. That's what
  you chose. Only the question and the answer travel, not the audio.

## What it would feel like

The same as today:
- tap Talk, speak, cut in while Neddy is talking (barge-in);
- "hold on, let me check" for anything Neddy has to look up;
- cards on the call screen, approving by voice;
- calls saved into the chat afterwards.

Neddy's voice changes to one of Kokoro's voices; you'd pick one in Slice 0. The first reply may
be a little slower, depending on the server.

## Where the server could live

| Option | What it is | Rough cost (to confirm) | Good for |
|---|---|---|---|
| **A. Rented GPU server** (recommended) | A cloud machine with one GPU, such as an NVIDIA L4, A10 or RTX 4090 (RunPod, Lambda, Hetzner and others) | about $0.40–1.10 an hour; $300–800 a month left on all the time | Everyone, all day, at real call speed |
| **B. A PC with a GPU you already own** | Your own computer, on Tailscale | electricity only | Trying it out; only as reliable as that PC and your internet |
| **C. CPU only** | A normal server, even a large Railway service | low | A backup, not the main path; the pause is a few seconds |

One GPU server should handle several calls at once; how many depends on the model size and is
measured in Slice 0. More people means a second server, or a model that can serve several calls
at once (see "Growing past a few calls").

## How the pieces connect

Today:

```
Phone/computer ──WebRTC──▶ OpenAI live voice
                               │ (sideband websocket)
Railway api ◀──────────────────┘  transcripts, minutes, hand-offs ──▶ chat agent
```

After:

```
Phone/computer ──WebRTC──▶ LiveKit server (on the GPU server, public address + TLS)
                               │
                        Voice worker (Python, LiveKit Agents, same server)
                          ├─ Silero: hears when you start and stop talking (barge-in)
                          ├─ Whisper (faster-whisper on the GPU): speech to text
                          ├─ Llama via Ollama: the conversation
                          └─ Kokoro: text to speech
                               │  Tailscale (private)
Railway api ◀──────────────────┘  transcripts, minutes, hand-offs ──▶ chat agent
```

- **LiveKit server** needs a public address. Phones on mobile data can't join a Tailscale
  network, and asking everyone to install Tailscale would be the "special setup" you want to
  avoid. Calls are protected by a short-lived pass the api gives each person when they tap Talk.
- **Tailscale** is for traffic between our own machines: the voice worker talking to the api, and
  you reaching the server to look after it. Ollama, Whisper and Kokoro are never open to the
  internet.
- **The api decides who may talk.** It checks the person is signed in and under their minutes,
  then gives the app a LiveKit room and pass. That's the same job it does for OpenAI today,
  where it hands over the SDP answer.

## What changes in the code

### Server (apps/server)

- **One switch between the two voice engines.** `VOICE_ENGINE=openai|local`.
  - `voice-live.ts` today does two things: it talks to OpenAI, and it handles calls (minutes,
    idle hang-up, saved calls, hand-offs).
  - Split the call handling from the engine, so both engines share it.
  - The "local" engine creates a LiveKit room and pass rather than an OpenAI session.
- **Routes for the voice worker**, over Tailscale with the worker's own token:
  - call started and ended;
  - each finished turn (what you said, what Neddy said);
  - a hand-off, which goes to the same `voiceAnswer` the OpenAI calls use;
  - show on screen;
  - minutes.

  These replace what the OpenAI sideband websocket delivers today.
- **Instructions:** `liveInstructions` and VOICE_RULES are reused. A smaller model needs shorter,
  plainer rules and fewer tools, so a trimmed version is written for it.
- **Approving by voice keeps its rule:** only your own words count.
  - Today they're checked against OpenAI's transcript of your microphone. Locally, Whisper's
    transcript of your microphone does the same job, never Llama's judgement.
  - Money and sign-in codes still need a tap.
- **Fallback:** if the local voice server doesn't answer its health check, Talk uses OpenAI when
  it has credit, or says live talk isn't available. That path (`LIVE_UNAVAILABLE`) already exists.

### App (apps/mobile)

- `live-voice.ts` gets a second way to connect: LiveKit's web client (`livekit-client`), which
  joins the room with the api's pass.
- Captions, the call screen and cards stay as they are. They read the same events, now from
  LiveKit's data messages.
- Loudness for the light on the call screen: LiveKit reports the speaker's audio level directly.
- Phones and computers need nothing new. It's still a browser call.

### Voice worker (new, Python, on the GPU server)

- Built on LiveKit Agents (`livekit-agents`) with its plugins:
  - Silero for voice activity;
  - Whisper through faster-whisper;
  - Ollama through its OpenAI-compatible address;
  - Kokoro through a local OpenAI-compatible speech server (Kokoro-FastAPI).
- Barge-in: when Silero hears you start talking, Kokoro stops at once and the half-finished
  reply is dropped. LiveKit Agents does this when interruptions are allowed.
- Four tools only: `ask_neddy` (the hand-off), `show_on_screen`, `approve_by_voice`, `end_call`.
  Llama models in the 3–8B range are weaker at tool calling than OpenAI's, so fewer tools work
  better. Slice 0 tests this.
- Versions pinned. LiveKit Agents has changed its interfaces between releases, so the code is
  written against the exact version installed in Slice 0, not from memory.

## In slices

**Slice 0: spike on a rented GPU (1–2 days).** Prove speed and quality before touching the app.
- Rent a GPU server by the hour; install LiveKit, Ollama (an 8B and a 3B Llama), faster-whisper,
  Kokoro and the worker.
- Talk to it from LiveKit's test page; cut in mid-sentence; try the four tools against a fake
  hand-off.
- Measure each step's delay, how many calls one GPU carries, and the cost per hour.
- Pick Neddy's Kokoro voice with you.
- Done when: we know the real delay (target under one second, aiming at 500 ms), barge-in works,
  and the costs are known. Then you decide whether to go on.

**Slice 1: the api speaks to the local voice.**
- The engine switch, LiveKit room and pass, worker routes over Tailscale, and the hand-off to the
  chat agent.
- The `VOICE_ENGINE` switch is off by default.
- Tests with a fake worker (the sandbox can't reach a GPU server).

**Slice 2: the app joins LiveKit calls.**
- `livekit-client` in `live-voice.ts`, captions and the light from LiveKit, cards from data
  messages.
- On for you only at first.

**Slice 3: everything a call does today.**
- Show on screen, approving by voice, saved calls, minutes and limits.
- Idle hang-up, holding off the hang-up while you sign in to an app, urgent alerts during a call.
- Help and the app guide say which voice is in use.

**Slice 4: everyone, with a fallback.**
- Health check, automatic fallback, a usage card line for GPU hours next to the AI costs.
- Then turn it on for everyone.

**Later: growing past a few calls.**
- Swap Ollama for a server built for many calls at once (vLLM or llama.cpp's server) on the same
  GPU.
- Add a second GPU server; LiveKit spreads calls between workers.

## Deployment checklist (for the GPU server)

1. **Server:** Ubuntu 22.04 or 24.04, one NVIDIA GPU with 16–24 GB of memory, NVIDIA driver and
   CUDA, Docker with the NVIDIA container toolkit.
2. **Tailscale:**
   - Install it; tag the server `tag:voice`.
   - Allow only the Railway api and your own devices to reach it.
   - On Railway, the api joins the tailnet with an auth key (a new variable).
3. **Address:**
   - A name such as `voice.<your domain>` pointing at the server, with TLS.
   - Open 443 (TCP), LiveKit's TCP fallback port, and its UDP range for audio. Everything else
     stays closed.
4. **LiveKit server:** its config file with an API key and secret; TURN over TLS on, for phones
   behind strict networks.
5. **Ollama:** pull the Llama model chosen in Slice 0; keep it loaded (no unloading after idle).
   Reachable on the tailnet only.
6. **Whisper:** faster-whisper on the GPU (model size from Slice 0); tailnet only.
7. **Kokoro:** Kokoro-FastAPI on the GPU, with the chosen voice; tailnet only.
8. **Voice worker:**
   - Python 3.11 in its own environment, pinned versions, run by systemd.
   - Restarts on failure; logs each step's delay per turn.
9. **Railway variables (api):** `VOICE_ENGINE`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`,
   `LIVEKIT_API_SECRET`, `VOICE_WORKER_TOKEN`, the Tailscale auth key.
   - Adding them does nothing until you choose **Deploy** on the banner Railway shows.
   - After the deploy, the api's log says whether the local voice is on.
10. **Checks before turning it on:**
    - a test call from your phone on mobile data and on Wi-Fi;
    - cutting in mid-sentence;
    - a hand-off ("what's on my calendar tomorrow?");
    - approving by voice;
    - the fallback, with the worker stopped.

## Decisions needed from you

1. **Where the voice server lives:** rented GPU (recommended), a PC of yours with a GPU, or
   CPU-only with the slower pause?
2. **Is about half a second to one second all right,** with under 500 ms as a goal rather than a
   promise?
3. **Keep OpenAI as the fallback** when it has credit, or local only?
4. **Who gets it first:** only you, then everyone?
5. **Neddy's new voice:** you choose from Kokoro's voices in Slice 0.

## Risks and unknowns

- **Smaller model, simpler talk.** An 8B Llama is chattier and less careful than OpenAI's voice
  model. The hand-off covers anything that needs real work, but small talk and judgement calls
  will feel a bit different. Slice 0 shows how much.
- **Someone has to look after the server:** updates, restarts, the GPU bill. Railway does that for
  the rest of the app today.
- **A cost that doesn't depend on use.** A GPU left on costs the same with zero calls. Starting
  it only when someone taps Talk saves money but adds a long wait to the first call.
- **Licences:** Llama's licence has conditions for very large services; Kokoro, Whisper and
  LiveKit are open source. Worth a read before the app is offered widely.
- **Today's calls still need OpenAI credit** until this is built. The account is out of credit
  now.
