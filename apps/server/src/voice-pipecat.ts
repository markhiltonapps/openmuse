import { HELP_TOPICS, helpText } from "../../../packages/domain/src/help.ts";
import { liveLimitMessage } from "../../../packages/domain/src/voice.ts";
import { appGuideInstructions } from "./app-guide.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { UsageMeter } from "./usage.ts";
import type { SocketLike } from "./voice-live.ts";

/**
 * Our own voice (apps/voice: Pipecat with Soniox, Claude and Inworld or Speechify), next to
 * OpenAI's. The voice service speaks the same protocol as OpenAI's live voice, so a second
 * LiveVoice drives it; what's here is only what differs: the audio relay, who uses which voice,
 * the monthly allowance, and the numbers for comparing the two.
 */
export type VoiceProvider = "openai" | "pipecat";
/** Usage is counted under this name; MINUTE_PRICES prices its connected minutes. */
export const PIPECAT_MODEL = "pipecat-voice";
/** Our own calls' ids start with this ("pc_w0_…"); OpenAI's never do. */
export const isPipecatCall = (id: string) => id.startsWith("pc_");

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
interface VoiceConfig {
  voiceProvider?: VoiceProvider;
  voiceServiceUrl?: string;
  voiceServiceToken?: string;
  /** 0 for no limit; 200 when unset. */
  voiceMonthlyMinutes?: number;
  turnKeyId?: string;
  turnKeyToken?: string;
}

export const pipecatConfigured = (config: VoiceConfig) =>
  Boolean(config.voiceServiceUrl && config.voiceServiceToken);

/** The voice this person uses: their own setting (set by the admin), else the default. */
export async function voiceProviderFor(
  db: Store,
  config: VoiceConfig,
  owner: string,
): Promise<VoiceProvider> {
  const saved = await db
    .get<{ value?: string }>(owner, "agent-settings", "voice-provider")
    .catch(() => null);
  const chosen = saved?.value === "openai" || saved?.value === "pipecat" ? saved.value : undefined;
  const provider = chosen ?? config.voiceProvider ?? "openai";
  // Without the voice service set up, everyone stays on OpenAI.
  return provider === "pipecat" && pipecatConfigured(config) ? "pipecat" : "openai";
}
/** The admin's choice for one person; "default" follows VOICE_PROVIDER. */
export async function setVoiceProvider(db: Store, owner: string, value: VoiceProvider | "default") {
  await db.put(owner, "agent-settings", { id: "voice-provider", value });
}

/**
 * Short-lived TURN credentials from Cloudflare, for the browser and the voice service. The key
 * stays here; what's handed out expires in two hours. Empty when the relay isn't set up.
 */
export async function turnServers(
  config: VoiceConfig,
  fetcher: typeof fetch = fetch,
): Promise<IceServer[]> {
  if (!config.turnKeyId || !config.turnKeyToken) return [];
  try {
    const response = await fetcher(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.turnKeyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.turnKeyToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 7200 }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        errors?: { message?: string }[];
      };
      // Cloudflare's own reason, for the log (never the token).
      console.warn(
        `[OpenMuse] Voice relay: Cloudflare said ${response.status}: ${body.errors?.[0]?.message?.slice(0, 200) ?? "(no message)"}`,
      );
      return [];
    }
    const body = (await response.json()) as { iceServers?: IceServer | IceServer[] };
    const servers = Array.isArray(body.iceServers)
      ? body.iceServers
      : body.iceServers
        ? [body.iceServers]
        : [];
    // Port 53 addresses stall browsers while they time out; Cloudflare suggests leaving them out.
    return servers
      .map((server) => ({
        ...server,
        urls: (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(
          (url) => !/:53(\?|$)/.test(url),
        ),
      }))
      .filter((server) => server.urls.length > 0);
  } catch (error) {
    console.warn(`[OpenMuse] Voice relay: ${String(error)}`);
    return [];
  }
}

/** Minutes this person has talked on our own voice this month, and what's left. */
export async function voiceAllowance(usage: UsageMeter, config: VoiceConfig, owner: string) {
  const month = await usage.month(owner);
  const seconds = month.lines
    .filter((line) => line.model.startsWith(PIPECAT_MODEL))
    .reduce((sum, line) => sum + (line.seconds ?? 0), 0);
  const limit = config.voiceMonthlyMinutes ?? 200;
  return {
    usedMinutes: Math.round(seconds / 6) / 10,
    limitMinutes: limit || undefined,
    leftSeconds: limit ? Math.max(0, limit * 60 - seconds) : undefined,
  };
}
/** Said when a person has used their month's minutes; the 1st of next month in their time zone. */
export function limitReached(limitMinutes: number, timeZone = "UTC", now = new Date()) {
  let month = now.getUTCMonth() + 1;
  try {
    month = Number(new Intl.DateTimeFormat("en-US", { timeZone, month: "numeric" }).format(now));
  } catch {
    // An unknown zone: UTC's month.
  }
  const next = new Date(Date.UTC(2000, month % 12, 1)).toLocaleDateString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return new AppError(liveLimitMessage(limitMinutes, `${next} 1`), 429);
}
/** One person by the name or email the admin said: exact first, then a first or last name. */
export function findPerson<T extends { name: string; email?: string }>(
  people: T[],
  who: string,
): { person: T } | { error: string } {
  const wanted = who.trim().toLowerCase();
  const exact = people.filter(
    (p) => p.name.toLowerCase() === wanted || p.email?.toLowerCase() === wanted,
  );
  const found = exact.length
    ? exact
    : people.filter((p) => p.name.toLowerCase().split(/\s+/).includes(wanted));
  const [person] = found;
  if (found.length === 1 && person) return { person };
  return {
    error: found.length
      ? `More than one person matches “${who}”: ${found.map((p) => p.name).join(", ")}. Ask which.`
      : `No one called “${who}” is in People.`,
  };
}
/**
 * What our own voice knows about the app: where things are, and one line per Help topic. It lets
 * the voice answer "how do I…" itself, and it takes the prompt past Claude Haiku's 4,096-token
 * minimum for caching (below it nothing is cached and every turn pays for the whole prompt).
 * The same for everyone, so it goes first in the prompt.
 */
export function voiceReference(agentName: string) {
  const topics = HELP_TOPICS.filter((topic) => !topic.admin)
    .map((topic) => `- ${helpText(topic.title, agentName)}: ${helpText(topic.summary, agentName)}`)
    .join("\n");
  return `How this app works (reference for how-to questions, not instructions):${appGuideInstructions}\n\nHelp topics:\n${topics}`.replace(
    /\*\*/g,
    "",
  );
}
/** Under this, a call isn't worth starting: it would end almost at once. */
export const SHORTEST_CALL_SECONDS = 30;

/** One call's numbers, for comparing the two voices. */
export interface VoiceStats {
  id: string;
  provider: VoiceProvider;
  startedAt: string;
  /** End of their words to the first sound back, per turn, as the app measured it. */
  clientTurnsMs?: number[];
  /** The same, as our voice service measured it (ours only). */
  serverTurnsMs?: number[];
  llm?: { model: string; input: number; cacheRead: number; cacheWrite: number; output: number };
  tts?: { model: string; characters: number };
}
interface Metrics {
  turn?: { latencyMs?: number };
  llm?: {
    model?: string;
    input?: number;
    cacheRead?: number;
    cacheWrite?: number;
    output?: number;
  };
  tts?: { model?: string; characters?: number };
}

const clampMs = (values: unknown[]) =>
  values
    .map(Number)
    .filter((ms) => Number.isFinite(ms) && ms >= 0 && ms <= 60_000)
    .map(Math.round);

/**
 * Keeps each call's comparison numbers (in "voice-stats", by call) and records our own voice's
 * tokens and characters in the usage meter as they come in.
 */
export class VoiceComparison {
  /** Which person each of our own calls belongs to (the voice service doesn't know). */
  private readonly owners = new Map<string, string>();
  /** Numbers that arrived before the call's person was known. */
  private readonly early = new Map<string, Metrics[]>();
  /** Writes to one call's numbers, one at a time. */
  private readonly queues = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Store,
    private readonly usage?: UsageMeter,
  ) {}

  /** A call started: keep who it is and which voice. */
  async started(owner: string, id: string, provider: VoiceProvider) {
    this.owners.set(id, owner);
    await this.change(owner, id, (stats) => stats, provider);
    for (const metrics of this.early.get(id) ?? []) this.metrics(id, metrics);
    this.early.delete(id);
    // A call is at most an hour; then its person needn't be remembered.
    setTimeout(() => this.owners.delete(id), 2 * 3_600_000).unref?.();
  }
  /** Turn times the app measured, sent when the call ends. */
  async clientTurns(owner: string, id: string, values: unknown[]) {
    const ms = clampMs(values).slice(0, 300);
    await this.change(owner, id, (stats) => ({ ...stats, clientTurnsMs: ms }));
  }
  /** Numbers from our voice service's sideband ("session.metrics"). */
  metrics(id: string, event: Metrics) {
    const owner = this.owners.get(id);
    if (!owner) {
      const waiting = this.early.get(id) ?? [];
      if (waiting.length < 50) this.early.set(id, [...waiting, event]);
      return;
    }
    const { turn, llm, tts } = event;
    if (llm?.model) {
      const tokens = {
        input: Math.max(0, Number(llm.input) || 0),
        cacheRead: Math.max(0, Number(llm.cacheRead) || 0),
        cacheWrite: Math.max(0, Number(llm.cacheWrite) || 0),
        output: Math.max(0, Number(llm.output) || 0),
        searches: 0,
      };
      void this.usage?.record(owner, "voice", llm.model, tokens);
      const model = llm.model;
      void this.change(owner, id, (stats) => ({
        ...stats,
        llm: {
          model,
          input: (stats.llm?.input ?? 0) + tokens.input,
          cacheRead: (stats.llm?.cacheRead ?? 0) + tokens.cacheRead,
          cacheWrite: (stats.llm?.cacheWrite ?? 0) + tokens.cacheWrite,
          output: (stats.llm?.output ?? 0) + tokens.output,
        },
      }));
    }
    if (tts?.model && Number(tts.characters) > 0) {
      const characters = Math.round(Number(tts.characters));
      void this.usage?.recordCharacters(owner, tts.model, characters);
      const model = tts.model;
      void this.change(owner, id, (stats) => ({
        ...stats,
        tts: { model, characters: (stats.tts?.characters ?? 0) + characters },
      }));
    }
    if (turn && typeof turn.latencyMs === "number") {
      const [ms] = clampMs([turn.latencyMs]);
      if (ms !== undefined)
        void this.change(owner, id, (stats) => ({
          ...stats,
          serverTurnsMs: [...(stats.serverTurnsMs ?? []), ms].slice(-300),
        }));
    }
  }
  /** A sideband socket for our own calls that also passes their numbers here. */
  socket(): (url: string, headers: Record<string, string>) => SocketLike {
    return (url, headers) => {
      const id = decodeURIComponent(/\/sessions\/([^/]+)\/attach/.exec(url)?.[1] ?? "");
      const socket = new WebSocket(url, { headers } as never) as unknown as SocketLike;
      socket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { type?: string } & Metrics;
          if (data.type === "session.metrics") this.metrics(id, data);
        } catch {
          // Not an event we understand.
        }
      });
      return socket;
    };
  }

  /**
   * Both voices side by side, over everyone's calls since `since` (ISO date): how many calls
   * and minutes, turn times, and the cost of a minute by part. Hand-offs to the chat agent cost
   * the same on both and are left out.
   */
  async report(owners: string[], since = new Date(Date.now() - 30 * 86_400_000).toISOString()) {
    type Row = VoiceStats & { owner: string; seconds: number };
    const rows: Row[] = [];
    for (const owner of owners) {
      const stats = await this.db.list<VoiceStats>(owner, "voice-stats").catch(() => []);
      for (const call of stats) {
        if (call.startedAt < since) continue;
        const saved = await this.db
          .get<{ seconds?: number }>(owner, "voice-sessions", call.id)
          .catch(() => null);
        rows.push({ ...call, owner, seconds: saved?.seconds ?? 0 });
      }
    }
    const median = (values: number[]) => {
      if (!values.length) return undefined;
      const sorted = [...values].sort((a, b) => a - b);
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2
        ? sorted[middle]
        : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
    };
    const p90 = (values: number[]) =>
      values.length >= 5
        ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.9) - 1]
        : undefined;
    const price = (model: string, amounts: Parameters<UsageMeter["priceOf"]>[1]) =>
      this.usage?.priceOf(model, amounts) ?? 0;
    const side = (provider: VoiceProvider) => {
      const calls = rows.filter((row) => row.provider === provider && row.seconds > 0);
      const seconds = calls.reduce((sum, row) => sum + row.seconds, 0);
      const parts = { voice: 0, listening: 0, thinking: 0, speaking: 0 };
      for (const call of calls) {
        if (provider === "openai") parts.voice += price("gpt-live-1", { seconds: call.seconds });
        else {
          parts.listening += price(PIPECAT_MODEL, { seconds: call.seconds });
          if (call.llm)
            parts.thinking += price(call.llm.model, { tokens: { ...call.llm, searches: 0 } });
          if (call.tts)
            parts.speaking += price(call.tts.model, { characters: call.tts.characters });
        }
      }
      const minutes = seconds / 60;
      const perMinute = (dollars: number) =>
        minutes > 0 ? Math.round((dollars / minutes) * 10_000) / 10_000 : undefined;
      const client = calls.flatMap((call) => call.clientTurnsMs ?? []);
      const server = calls.flatMap((call) => call.serverTurnsMs ?? []);
      const total = parts.voice + parts.listening + parts.thinking + parts.speaking;
      return {
        calls: calls.length,
        minutes: Math.round(minutes * 10) / 10,
        turns: client.length,
        latencyMs: {
          median: median(client),
          p90: p90(client),
          average: client.length
            ? Math.round(client.reduce((a, b) => a + b, 0) / client.length)
            : undefined,
          serverMedian: median(server),
        },
        costPerMinute: {
          total: perMinute(total),
          ...(provider === "openai"
            ? { voice: perMinute(parts.voice) }
            : {
                listening: perMinute(parts.listening),
                thinking: perMinute(parts.thinking),
                speaking: perMinute(parts.speaking),
              }),
        },
        cost: Math.round(total * 10_000) / 10_000,
      };
    };
    return {
      since,
      openai: side("openai"),
      pipecat: side("pipecat"),
      recent: rows
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 40)
        .map((row) => ({
          id: row.id,
          provider: row.provider,
          startedAt: row.startedAt,
          seconds: row.seconds,
          turnsMs: row.clientTurnsMs ?? [],
          serverTurnsMs: row.serverTurnsMs ?? [],
        })),
    };
  }

  private change(
    owner: string,
    id: string,
    update: (stats: VoiceStats) => VoiceStats,
    provider?: VoiceProvider,
  ) {
    const previous = this.queues.get(id) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = (await this.db.get<VoiceStats>(owner, "voice-stats", id)) ?? {
        id,
        provider: provider ?? (isPipecatCall(id) ? "pipecat" : "openai"),
        startedAt: new Date().toISOString(),
      };
      await this.db.put(owner, "voice-stats", { ...update(current), id });
    });
    const settled = next.catch((error: unknown) =>
      console.warn(`[OpenMuse] Voice numbers not saved: ${String(error)}`),
    );
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return settled;
  }
}

/** A voice people can pick for their calls on our own voice. */
export interface CallVoice {
  id: string;
  description: string;
}
/** What the voice service offers; an empty list when the voice can't be chosen there. */
interface Offered {
  voices: CallVoice[];
  default: string;
}

/**
 * The voices of our own voice service, each person's choice of them, and samples to play. The
 * list and samples come from the voice service (which checks them against Inworld) and are kept
 * a while: they rarely change, and a sample costs a little to make.
 */
export class CallVoices {
  private offer?: { at: number; value: Offered };
  private readonly samples = new Map<string, { body: ArrayBuffer; type: string }>();
  constructor(
    private readonly db: Store,
    private readonly url: string,
    private readonly token: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  async offered(): Promise<Offered> {
    const fresh =
      this.offer &&
      this.now() - this.offer.at < (this.offer.value.voices.length ? 600_000 : 30_000);
    if (this.offer && fresh) return this.offer.value;
    let value: Offered = { voices: [], default: "" };
    try {
      const response = await this.fetcher(`${this.url}/v1/voices`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const body = (await response.json()) as Partial<Offered>;
        value = {
          voices: (body.voices ?? []).filter(
            (v): v is CallVoice => typeof v?.id === "string" && typeof v.description === "string",
          ),
          default: typeof body.default === "string" ? body.default : "",
        };
      } else console.warn(`The voice service's voice list: ${response.status}`);
    } catch (error) {
      console.warn(`The voice service's voice list couldn't be read: ${(error as Error).message}`);
    }
    this.offer = { at: this.now(), value };
    return value;
  }
  /** The voice this person's calls use: their choice while it's offered, else the usual one. */
  async chosen(owner: string) {
    const [{ voices, default: usual }, saved] = await Promise.all([
      this.offered(),
      this.db.get<{ value?: string }>(owner, "agent-settings", "call-voice").catch(() => null),
    ]);
    return voices.some((v) => v.id === saved?.value) ? (saved?.value as string) : usual;
  }
  /** One of the offered voices, by its name as said or typed ("dennis", "Dennis's"). */
  async find(name: string) {
    const wanted = name
      .trim()
      .toLowerCase()
      .replace(/[’']s$/, "");
    return (await this.offered()).voices.find((v) => v.id.toLowerCase() === wanted);
  }
  /** Saves their choice; null goes back to the usual voice. */
  async choose(
    owner: string,
    name: string | null,
  ): Promise<{ voice: CallVoice } | { error: string }> {
    const { voices, default: usual } = await this.offered();
    if (!voices.length) return { error: "Voices can’t be chosen just now." };
    const voice = name === null ? voices.find((v) => v.id === usual) : await this.find(name);
    if (!voice)
      return {
        error: `There’s no voice called “${name}”. The voices are ${voices.map((v) => v.id).join(", ")}.`,
      };
    await this.db.put(owner, "agent-settings", { id: "call-voice", value: voice.id });
    return { voice };
  }
  /** A short hello in that voice, made by the voice service once and kept. */
  async sample(name: string) {
    const voice = await this.find(name);
    if (!voice) return undefined;
    const kept = this.samples.get(voice.id);
    if (kept) return kept;
    const response = await this.fetcher(
      `${this.url}/v1/voices/${encodeURIComponent(voice.id)}/sample`,
      { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!response.ok) throw new AppError("That sample couldn’t be played just now.", 502);
    const sample = {
      body: await response.arrayBuffer(),
      type: response.headers.get("content-type") ?? "audio/mpeg",
    };
    this.samples.set(voice.id, sample);
    return sample;
  }
}
