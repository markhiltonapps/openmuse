// Compares vision models on reading receipt photos, using the app's real reader code
// (apps/server/src/receipt-reader.ts: receiptPrompt, parseReceiptRead, reconcile).
//
//   OPENROUTER_API_KEY=... npx tsx scripts/receipt-model-test/run.mjs <folder> [options]
//
//   <folder>             pictures plus a truth.json in the same shape as this folder's (see README.txt)
//   --models a,b         model ids to compare (default: the five in DEFAULT_MODELS)
//   --out <dir>          where raw per-call JSON and the summary go (default: <folder>/results)
//   --cap <dollars>      stop before total spend (this folder's raw results included) passes it (default 1.50)
//   --concurrency <n>    calls in flight at once per model (default 3)
//   --only a.png,b.png   only these pictures (a quick smoke test)
//   --today YYYY-MM-DD   the date given in the prompt (default 2026-11-11)
//   --country <name>     the country given in the prompt (default "United States")
//   --score-only         no calls: score the raw results already in <out>/raw
//   --force              call again even where a raw result is already saved
//
// The key is read from the environment and sent only as the Authorization header; it is never
// printed or written anywhere. A model's answer that doesn't parse is recorded as a failure (the
// app's retry-once rule is deliberately not used, so the numbers show the first-try rate).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseReceiptRead,
  plausibleDate,
  receiptPrompt,
  reconcile,
} from "../../apps/server/src/receipt-reader.ts";

const DEFAULT_MODELS = [
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-haiku-5.5",
  "anthropic/claude-sonnet-5",
  "anthropic/claude-sonnet-5.5",
  "google/gemini-3.5-flash-lite",
];
const API = "https://openrouter.ai/api/v1";

// ---------- arguments ----------

function parseArgs(argv) {
  const opts = {
    folder: null,
    models: DEFAULT_MODELS,
    out: null,
    cap: 1.5,
    concurrency: 3,
    only: null,
    today: "2026-11-11",
    country: "United States",
    scoreOnly: false,
    force: false,
  };
  const rest = [...argv];
  const take = (name) => {
    const value = rest.shift();
    if (value === undefined) throw new Error(`${name} needs a value`);
    return value;
  };
  while (rest.length) {
    const arg = rest.shift();
    if (arg === "--models")
      opts.models = take(arg)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    else if (arg === "--out") opts.out = take(arg);
    else if (arg === "--cap") opts.cap = Number(take(arg));
    else if (arg === "--concurrency") opts.concurrency = Math.max(1, Number(take(arg)));
    else if (arg === "--only")
      opts.only = take(arg)
        .split(",")
        .map((s) => s.trim());
    else if (arg === "--today") opts.today = take(arg);
    else if (arg === "--country") opts.country = take(arg);
    else if (arg === "--score-only") opts.scoreOnly = true;
    else if (arg === "--force") opts.force = true;
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else if (!opts.folder) opts.folder = arg;
    else throw new Error(`unexpected argument ${arg}`);
  }
  if (!opts.folder) throw new Error("give the folder with the pictures and truth.json");
  if (!Number.isFinite(opts.cap) || opts.cap <= 0)
    throw new Error("--cap must be a positive number");
  return opts;
}

const slug = (s) => s.replace(/[^A-Za-z0-9.-]+/g, "_");
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

// ---------- calling OpenRouter ----------

async function callModel({ key, model, imagePath, prompt }) {
  const mime = MIME[path.extname(imagePath).toLowerCase()];
  if (!mime) throw new Error(`unsupported picture type: ${imagePath}`);
  const dataUri = `data:${mime};base64,${readFileSync(imagePath).toString("base64")}`;
  const body = {
    model,
    temperature: 0,
    max_tokens: 1500,
    usage: { include: true },
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUri } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
  let last = null;
  // Only transport trouble (429, 5xx, dropped connection) is retried, twice; a model's bad answer never is.
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(`${API}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const latencyMs = Date.now() - started;
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      if (res.status === 429 || res.status >= 500) {
        last = {
          latencyMs,
          httpStatus: res.status,
          error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok || json?.error) {
        const detail = json?.error?.message ?? text.slice(0, 300);
        return { latencyMs, httpStatus: res.status, error: `HTTP ${res.status}: ${detail}` };
      }
      const choice = json?.choices?.[0];
      const content = choice?.message?.content;
      return {
        latencyMs,
        httpStatus: res.status,
        answer: typeof content === "string" ? content : JSON.stringify(content ?? ""),
        finishReason: choice?.finish_reason ?? null,
        usage: json?.usage ?? null,
        generationId: json?.id ?? null,
        provider: json?.provider ?? null,
      };
    } catch (error) {
      last = {
        latencyMs: Date.now() - started,
        httpStatus: 0,
        error: `network: ${error?.cause?.code ?? error?.message}`,
      };
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return last;
}

function costOf(record, pricing) {
  const reported = record.usage?.cost;
  if (typeof reported === "number") return { cost: reported, estimated: false };
  const usage = record.usage;
  if (!usage || !pricing) return { cost: 0, estimated: true, unknown: true };
  const cost =
    (usage.prompt_tokens ?? 0) * Number(pricing.prompt ?? 0) +
    (usage.completion_tokens ?? 0) * Number(pricing.completion ?? 0);
  return { cost, estimated: true };
}

// ---------- scoring ----------

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");
const sameMerchant = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
};
const within = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 0.0101;
const moneyOrZero = (v) => (v === null || v === undefined ? 0 : v);
const FIELDS = [
  "merchant",
  "date",
  "total",
  "tax",
  "last4",
  "returnDays",
  "category",
  "isReceipt",
  "multiple",
];
const hasLongDigits = (text) => /\d{12,}/.test(text) || /\d(?:[ -]?\d){11,}/.test(text);

function scoreRecord(truth, record, today) {
  const skip = new Set(truth.skip ?? []);
  const out = { file: truth.file, checks: {}, notes: [] };
  const parsed =
    record.answer !== undefined
      ? parseReceiptRead(record.answer)
      : { ok: false, why: record.error ?? "no answer" };
  out.parsed = parsed.ok;
  out.parseWhy = parsed.ok ? null : parsed.why;
  out.longDigits = record.answer ? hasLongDigits(record.answer) : false;
  const key = {
    merchant: !skip.has("merchant"),
    date: !skip.has("date"),
    total: !skip.has("total"),
    tax: !skip.has("tax"),
    last4: !skip.has("paymentLast4"),
    returnDays: !skip.has("returnDays"),
    category: !skip.has("category"),
    isReceipt: true,
    multiple: true,
  };
  if (!parsed.ok) {
    for (const f of FIELDS) if (key[f]) out.checks[f] = false;
    out.status = "failed";
    return out;
  }
  const read = parsed.read;
  const rec = reconcile(read);
  out.read = read;
  out.final = {
    total: rec.total,
    status: rec.status,
    candidates: rec.candidates,
    settledBy: rec.settledBy,
  };
  const date = plausibleDate(read.date, today);
  if (key.merchant) out.checks.merchant = sameMerchant(read.merchant, truth.merchant);
  if (key.date) out.checks.date = date === truth.date;
  if (key.total) {
    out.checks.total = within(rec.total, truth.total);
    out.rawTotalOk = within(read.total, truth.total);
    out.dangerous = rec.status === "sure" && !out.checks.total;
    out.truthInCandidates = rec.candidates.some((c) => within(c, truth.total));
  }
  if (key.tax) out.checks.tax = within(moneyOrZero(read.tax), moneyOrZero(truth.tax));
  if (key.last4) out.checks.last4 = (read.paymentLast4 ?? null) === (truth.paymentLast4 ?? null);
  if (key.returnDays)
    out.checks.returnDays = (read.returnDays ?? null) === (truth.returnDays ?? null);
  if (key.category) {
    out.checks.category =
      read.category === truth.category || (truth.categoryAlso ?? []).includes(read.category);
    out.categoryExact = read.category === truth.category;
  }
  out.checks.isReceipt = read.isReceipt === truth.isReceipt;
  out.checks.multiple = read.multipleReceipts === (truth.multipleReceipts ?? false);
  out.extra = {
    warranty: read.warrantyMentioned === (truth.warrantyMentioned ?? false),
    currency: truth.currency ? read.currency === truth.currency : true,
  };
  out.flaggedTotalUnclear = read.unclear.includes("total");
  out.status = rec.status;
  if (truth.smudgedTotal) {
    out.smudge =
      out.checks.total && rec.status === "sure"
        ? "settled"
        : out.truthInCandidates
          ? "in-candidates"
          : "lost";
  }
  if (out.longDigits) out.notes.push("answer contains a 12+ digit run");
  return out;
}

// ---------- reporting ----------

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
const show = (v) =>
  v === null || v === undefined ? "null" : typeof v === "number" ? String(v) : JSON.stringify(v);

function summarize(model, truths, scored, records) {
  const fieldRight = Object.fromEntries(FIELDS.map((f) => [f, [0, 0]]));
  let right = 0;
  let total = 0;
  let keyAll = 0;
  let keyDen = 0;
  let dangerous = 0;
  let parseFail = 0;
  let longDigits = 0;
  const catExact = [0, 0];
  const statuses = { sure: 0, pick: 0, missing: 0, failed: 0 };
  let pickWithTruth = 0;
  const extraRight = [0, 0];
  for (const s of scored) {
    if (!s.parsed) parseFail++;
    if (s.longDigits) longDigits++;
    for (const [f, ok] of Object.entries(s.checks)) {
      fieldRight[f][1]++;
      total++;
      if (ok) {
        fieldRight[f][0]++;
        right++;
      }
    }
    const t = truths.find((x) => x.file === s.file);
    if (t?.isReceipt && !t.multipleReceipts) {
      keyDen++;
      const c = s.checks;
      if (s.parsed && c.merchant && c.date && c.total && c.last4 && !s.longDigits) keyAll++;
      if (s.categoryExact !== undefined) {
        catExact[1]++;
        if (s.categoryExact) catExact[0]++;
      }
      if (s.extra) {
        extraRight[1] += 2;
        extraRight[0] += (s.extra.warranty ? 1 : 0) + (s.extra.currency ? 1 : 0);
      }
    }
    if (s.dangerous) dangerous++;
    statuses[s.status ?? "failed"]++;
    if (s.status === "pick" && s.truthInCandidates) pickWithTruth++;
  }
  const good = records.filter((r) => r.latencyMs && !r.error);
  const lat = good.map((r) => r.latencyMs);
  const costs = records.filter((r) => !r.error).map((r) => r.cost);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const tokensIn = records.map((r) => r.usage?.prompt_tokens ?? 0);
  const tokensOut = records.map((r) => r.usage?.completion_tokens ?? 0);
  return {
    model,
    calls: records.length,
    callErrors: records.filter((r) => r.error).length,
    fieldRight,
    overall: { right, total },
    keyAll: [keyAll, keyDen],
    dangerous,
    parseFail,
    longDigits,
    statuses,
    pickWithTruth,
    catExact,
    extraRight,
    latencyMean: mean(lat),
    latencyP95: percentile(lat, 95),
    costMeanCents: costs.length ? mean(costs) * 100 : null,
    costTotal: records.reduce((n, r) => n + (r.cost ?? 0), 0),
    costEstimatedCalls: records.filter((r) => r.costEstimated).length,
    tokensInMean: mean(tokensIn),
    tokensOutMean: mean(tokensOut),
  };
}

function table(summaries) {
  const lines = [];
  const head = [
    pad("model", 30),
    padl("fields", 8),
    padl("key-4", 8),
    padl("danger", 7),
    padl("parse", 6),
    padl("16dig", 6),
    padl("lat avg", 8),
    padl("lat p95", 8),
    padl("c/receipt", 10),
    padl("$/100", 8),
  ];
  lines.push(head.join(" "));
  lines.push("-".repeat(head.join(" ").length));
  for (const s of summaries) {
    lines.push(
      [
        pad(s.model, 30),
        padl(pct(s.overall.right, s.overall.total), 8),
        padl(pct(s.keyAll[0], s.keyAll[1]), 8),
        padl(s.dangerous, 7),
        padl(s.parseFail, 6),
        padl(s.longDigits, 6),
        padl(s.latencyMean === null ? "n/a" : `${(s.latencyMean / 1000).toFixed(1)}s`, 8),
        padl(s.latencyP95 === null ? "n/a" : `${(s.latencyP95 / 1000).toFixed(1)}s`, 8),
        padl(s.costMeanCents === null ? "n/a" : `${s.costMeanCents.toFixed(3)}c`, 10),
        padl(s.costMeanCents === null ? "n/a" : `$${(s.costMeanCents).toFixed(2)}`, 8),
      ].join(" "),
    );
  }
  return lines;
}

function fieldTable(summaries) {
  const lines = [];
  lines.push([pad("model", 30), ...FIELDS.map((f) => padl(f, 10))].join(" "));
  for (const s of summaries) {
    lines.push(
      [
        pad(s.model, 30),
        ...FIELDS.map((f) => padl(`${s.fieldRight[f][0]}/${s.fieldRight[f][1]}`, 10)),
      ].join(" "),
    );
  }
  return lines;
}

function failureLines(model, truths, scored) {
  const lines = [];
  for (const s of scored) {
    const t = truths.find((x) => x.file === s.file);
    const bad = Object.entries(s.checks)
      .filter(([, ok]) => !ok)
      .map(([f]) => f);
    if (!s.parsed) {
      lines.push(`  ${s.file}: PARSE FAILURE (${s.parseWhy})`);
      continue;
    }
    if (!bad.length && !s.longDigits && !s.dangerous) continue;
    const r = s.read;
    const said = {
      merchant: r.merchant,
      date: r.date,
      total: r.total,
      totalOtherReadings: r.totalOtherReadings,
      tax: r.tax,
      paymentLast4: r.paymentLast4,
      returnDays: r.returnDays,
      category: r.category,
      isReceipt: r.isReceipt,
      multipleReceipts: r.multipleReceipts,
    };
    const want = {
      merchant: t.merchant,
      date: t.date,
      total: t.total,
      tax: t.tax,
      paymentLast4: t.paymentLast4,
      returnDays: t.returnDays,
      category: t.category,
    };
    const fieldMap = { last4: "paymentLast4", multiple: "multipleReceipts" };
    const detail = bad
      .map((f) => {
        const k = fieldMap[f] ?? f;
        const truthValue =
          k === "isReceipt" ? t.isReceipt : k === "multipleReceipts" ? t.multipleReceipts : want[k];
        return `${k}: said ${show(said[k])}, truth ${show(truthValue)}`;
      })
      .join("; ");
    lines.push(
      `  ${s.file}: ${detail}${s.dangerous ? "  [DANGEROUS: reconcile said sure]" : ""}${s.longDigits ? "  [12+ DIGITS IN ANSWER]" : ""}` +
        `\n      reconcile: total ${show(s.final.total)} ${s.final.status}${s.final.settledBy ? ` (settled by ${s.final.settledBy})` : ""}, candidates ${show(s.final.candidates)}, unclear ${show(r.unclear)}` +
        `\n      notes: ${r.notes || "(none)"}`,
    );
  }
  return lines.length ? [`${model}`, ...lines] : [`${model}`, "  (no mistakes)"];
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const folder = path.resolve(opts.folder);
  const outDir = path.resolve(opts.out ?? path.join(folder, "results"));
  const rawDir = path.join(outDir, "raw");
  mkdirSync(rawDir, { recursive: true });

  const truthPath = path.join(folder, "truth.json");
  if (!existsSync(truthPath)) throw new Error(`no truth.json in ${folder}`);
  let truths = JSON.parse(readFileSync(truthPath, "utf8"));
  if (opts.only) truths = truths.filter((t) => opts.only.includes(t.file));
  const missing = truths.filter((t) => !existsSync(path.join(folder, t.file)));
  for (const t of missing) console.log(`skipping ${t.file}: picture not found`);
  truths = truths.filter((t) => !missing.includes(t));
  if (!truths.length) throw new Error("nothing to read");

  // Which of the requested models exist (checked against OpenRouter's public list, no key needed).
  const list = await (await fetch(`${API}/models`)).json();
  const known = new Map((list.data ?? []).map((m) => [m.id, m]));
  const models = [];
  for (const id of opts.models) {
    if (known.has(id)) models.push(id);
    else console.log(`skipping ${id}: not in OpenRouter's model list`);
  }

  const key = process.env.OPENROUTER_API_KEY;
  if (!key && !opts.scoreOnly) throw new Error("OPENROUTER_API_KEY is not set");

  const readRaw = (model, file) => {
    const p = path.join(rawDir, `${slug(model)}__${slug(file)}.json`);
    if (!existsSync(p)) return null;
    const record = JSON.parse(readFileSync(p, "utf8"));
    // A saved error is not a result: it is called again next time (and left out of the scores).
    return record.error ? null : record;
  };
  // Spend so far in this output folder (cached calls count: the cap is for everything measured here).
  let spent = 0;
  for (const f of readdirSync(rawDir)) {
    if (!f.endsWith(".json")) continue;
    spent += JSON.parse(readFileSync(path.join(rawDir, f), "utf8")).cost ?? 0;
  }
  if (key && !opts.scoreOnly) {
    // How much the key itself still has under its own limit (only the numbers are printed).
    try {
      const info = await (
        await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` } })
      ).json();
      const remaining = info?.data?.limit_remaining;
      if (typeof remaining === "number") {
        console.log(`the key has $${remaining.toFixed(4)} left under its own limit`);
        if (remaining <= 0) {
          throw new Error(
            "the OpenRouter key has no credit or limit left; raise it and run again (finished calls are kept and not repeated)",
          );
        }
      }
    } catch (error) {
      if (String(error.message).includes("no credit or limit")) throw error;
    }
  }
  console.log(
    `models: ${models.join(", ")}\npictures: ${truths.length}  spent so far in ${rawDir}: $${spent.toFixed(4)}  cap $${opts.cap}`,
  );

  const prompt = receiptPrompt({ today: opts.today, country: opts.country });
  let aborted = false;
  let inflight = 0;
  let maxCost = 0;

  if (!opts.scoreOnly) {
    for (const model of models) {
      const pricing = known.get(model)?.pricing;
      // Worst case for one call before any real cost is known: ~3,000 tokens in, 1,500 out.
      const guess = 3000 * Number(pricing?.prompt ?? 0) + 1500 * Number(pricing?.completion ?? 0);
      const queue = truths.filter((t) => opts.force || !readRaw(model, t.file));
      let done = 0;
      const worker = async () => {
        while (queue.length && !aborted) {
          const estimate = Math.max(maxCost, guess);
          if (spent + estimate * (inflight + 1) > opts.cap) {
            aborted = true;
            console.log(
              `ABORT: spent $${spent.toFixed(4)}, the next calls could pass the $${opts.cap} cap`,
            );
            return;
          }
          const t = queue.shift();
          inflight++;
          let record;
          try {
            record = await callModel({ key, model, imagePath: path.join(folder, t.file), prompt });
          } finally {
            inflight--;
          }
          const c = costOf(record, pricing);
          record = { model, file: t.file, ...record, cost: c.cost, costEstimated: c.estimated };
          spent += c.cost;
          maxCost = Math.max(maxCost, c.cost);
          if (record.error && [401, 402, 403].includes(record.httpStatus)) {
            // The key is out of credit, over its own limit, or refused: nothing more will work, so stop.
            aborted = true;
            console.log(`ABORT: ${record.error.slice(0, 160)}`);
            return;
          }
          writeFileSync(
            path.join(rawDir, `${slug(model)}__${slug(t.file)}.json`),
            `${JSON.stringify(record, null, 2)}\n`,
          );
          done++;
          console.log(
            `${model} ${t.file} ${record.error ? `ERROR ${record.error.slice(0, 120)}` : `${record.latencyMs}ms $${c.cost.toFixed(5)}${c.estimated ? " (est.)" : ""}`}  [${done}/${done + queue.length}] total $${spent.toFixed(4)}`,
          );
        }
      };
      await Promise.all(Array.from({ length: opts.concurrency }, worker));
      if (aborted) break;
    }
  }

  // Score everything that exists on disk for these pictures.
  const summaries = [];
  const failures = [];
  const all = {};
  for (const model of models) {
    const records = [];
    const scored = [];
    for (const t of truths) {
      const record = readRaw(model, t.file);
      if (!record) continue;
      records.push(record);
      scored.push(scoreRecord(t, record, opts.today));
    }
    if (!records.length) continue;
    all[model] = scored;
    summaries.push(summarize(model, truths, scored, records));
    failures.push(...failureLines(model, truths, scored), "");
  }

  const report = [];
  report.push(`Receipt model test  pictures: ${truths.length}  today: ${opts.today}`);
  report.push("");
  report.push(
    "Overall (fields = share of all field checks right; key-4 = merchant+date+total+last4 all right;",
  );
  report.push(
    "danger = total wrong but reconcile said sure; parse = unparseable answers; 16dig = 12+ digit run in the answer)",
  );
  report.push(...table(summaries));
  report.push("");
  report.push("Per field (right/checked)");
  report.push(...fieldTable(summaries));
  report.push("");
  report.push(
    "How reconcile() settled the total (sure / pick / missing / failed), and picks where the right total was offered",
  );
  for (const s of summaries) {
    report.push(
      `${pad(s.model, 30)} sure ${s.statuses.sure}  pick ${s.statuses.pick} (truth offered in ${s.pickWithTruth})  missing ${s.statuses.missing}  failed ${s.statuses.failed}`,
    );
  }
  report.push("");
  report.push(
    "Extras: category exact (no alternates), warranty+currency, mean tokens in/out, call errors, total spent",
  );
  for (const s of summaries) {
    report.push(
      `${pad(s.model, 30)} category-exact ${s.catExact[0]}/${s.catExact[1]}  warranty+currency ${s.extraRight[0]}/${s.extraRight[1]}  tokens ${Math.round(s.tokensInMean ?? 0)}/${Math.round(s.tokensOutMean ?? 0)}  call errors ${s.callErrors}  spent $${s.costTotal.toFixed(4)}${s.costEstimatedCalls ? ` (${s.costEstimatedCalls} costs estimated from tokens)` : ""}`,
    );
  }
  const smudgeIdx = truths.find((t) => t.smudgedTotal);
  if (smudgeIdx) {
    report.push("");
    report.push(`Smudged total (${smudgeIdx.file}, truth ${smudgeIdx.total})`);
    for (const model of Object.keys(all)) {
      const s = all[model].find((x) => x.file === smudgeIdx.file);
      if (!s) continue;
      report.push(
        `${pad(model, 30)} ${s.smudge ?? "failed"}  (raw total ${show(s.read?.total)}, other readings ${show(s.read?.totalOtherReadings)}, unclear ${show(s.read?.unclear)}, reconcile ${show(s.final?.total)} ${s.final?.status})`,
      );
    }
  }
  report.push("");
  report.push(`Total spent in this folder: $${spent.toFixed(4)} (cap $${opts.cap})`);
  const text = report.join("\n");
  writeFileSync(path.join(outDir, "summary.txt"), `${text}\n`);
  writeFileSync(path.join(outDir, "failures.txt"), `${failures.join("\n")}\n`);
  writeFileSync(
    path.join(outDir, "scores.json"),
    `${JSON.stringify({ summaries, all }, null, 2)}\n`,
  );
  console.log(`\n${text}\n\nMistakes in detail: ${path.join(outDir, "failures.txt")}`);
}

main().catch((error) => {
  console.error(`run.mjs: ${error.message}`);
  process.exit(1);
});
