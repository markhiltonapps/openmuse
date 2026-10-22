/**
 * Sensitive numbers and secrets, hidden before the AI sees them (owner, 2026-10-22). Card numbers,
 * Social Security numbers, bank and ID numbers, passwords, PINs and API keys are found by their
 * shape (not by asking the model to ignore them) and replaced with a short stand-in that keeps what
 * is safe to keep (the last four digits). Pure and shared: the server runs it on everything that
 * goes to the model; `docs/PROACTIVE-AND-SAFETY-PLAN.md` has the design.
 *
 * This reduces risk, it is not a guarantee: ID formats from other countries are only caught next to
 * a word that says what they are, and a number spelled out in words isn't caught at all.
 */
export type SensitiveKind = "card" | "ssn" | "secret" | "password" | "pin" | "bank" | "id";
export interface Found {
  kind: SensitiveKind;
  /** How many characters were replaced. */
  length: number;
}
export interface Redacted {
  text: string;
  found: Found[];
}

/** What each kind is called to the person ("I hid a card number"). */
const NAMES: Record<SensitiveKind, string> = {
  card: "a card number",
  ssn: "a Social Security number",
  secret: "a secret key",
  password: "a password",
  pin: "a PIN or security code",
  bank: "a bank account number",
  id: "an ID number",
};

const luhn = (digits: string) => {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
};
/** A real card's start and length, so an order or tracking number that happens to pass Luhn isn't hidden. */
const cardShape = (digits: string) => {
  const n = digits.length;
  if (/^4/.test(digits)) return n === 13 || n === 16 || n === 19;
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(digits)) return n === 16;
  if (/^3[47]/.test(digits)) return n === 15;
  if (/^(6011|65|64[4-9])/.test(digits)) return n >= 16 && n <= 19;
  if (/^(35(2[89]|[3-8]\d))/.test(digits)) return n >= 16 && n <= 19;
  if (/^(36|38|39|30[0-5])/.test(digits)) return n >= 14 && n <= 16;
  if (/^62/.test(digits)) return n >= 16 && n <= 19;
  return false;
};

const SECRETS = new RegExp(
  [
    // Keys and tokens from the services this app talks to, and the usual others.
    String.raw`\b(?:sk-(?:ant-|or-v1-|proj-)?[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|re_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9+/=]{20,}|rk_live_[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{16,}|pk_live_[A-Za-z0-9]{16,})\b`,
    String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{24,}`,
    String.raw`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
  ].join("|"),
  "g",
);
const CARD = /(?<![\w-])(?:\d[ -]?){12,18}\d(?![\w-])/g;
const SSN = /(?<![\w-])(?!000|666|9\d\d)\d{3}[- ](?!00)\d{2}[- ](?!0000)\d{4}(?![\w-])/g;
/** A word that says what the number is, then the number itself. */
const PASSWORD = /\b(pass(?:word|code|wd)|pwd)\b(\s*(?::|=|\bis\b|\bwas\b)\s*)(\S{3,})/gi;
const PIN = /\b(pin(?:\s*code)?|cvv2?|cvc2?|security code)\b(\s*(?::|=|\bis\b)\s*)(\d{3,8})\b/gi;
const BANK =
  /\b(routing(?:\s*(?:number|no\.?|#))?|account(?:\s*(?:number|no\.?|#))?|acct\.?(?:\s*(?:number|no\.?|#))?|iban|swift(?:\s*code)?)(?![A-Za-z])(\s*(?::|=|#|\bis\b)?\s*)([A-Za-z0-9][A-Za-z0-9 -]{5,32}[A-Za-z0-9])/gi;
const ID =
  /\b(ssn|social security(?:\s*(?:number|no\.?|#))?|passport(?:\s*(?:number|no\.?|#))?|driver'?s?[ -]licen[sc]e(?:\s*(?:number|no\.?|#))?|licen[sc]e(?:\s*(?:number|no\.?|#))|tax id|ein|national id)(?![A-Za-z])(\s*(?::|=|#|\bis\b)?\s*)([A-Za-z0-9][A-Za-z0-9 -]{4,20}[A-Za-z0-9])/gi;

/** What follows "password is" in a message about passwords rather than a password. */
const SENTENCE_WORDS =
  /^(required|incorrect|invalid|wrong|expired|too|not|correct|strong|weak|set|saved|changed|reset|ok|okay|valid|missing|empty|case|never|always|updated|ready|needed|confirmed|protected|enabled|disabled|the|your|a|an|at|least|and|or)$/i;
/** An IBAN: country, two check digits, then the account; the mod-97 check keeps ordinary codes out. */
const IBAN =
  /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{3,4}){3,8}(?: ?[A-Z0-9]{1,2})?(?![A-Za-z0-9])/g;
const ibanValid = (iban: string) => {
  const compact = iban.replace(/ /g, "");
  if (compact.length < 15 || compact.length > 34) return false;
  const moved = `${compact.slice(4)}${compact.slice(0, 4)}`;
  const digits = [...moved]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  return BigInt(digits) % 97n === 1n;
};
const hasDigit = (text: string) => /\d/.test(text);
/** The value part of "account number: 123 456 789", cut where the number stops (not at the next word). */
const numberPart = (value: string) => /^[A-Za-z]{0,3}\d+(?:[ -]\d+)*[A-Za-z]?/.exec(value)?.[0];

export function redact(input: string, options: { secretsOnly?: boolean } = {}): Redacted {
  if (!input || input.length < 4) return { text: input, found: [] };
  const found: Found[] = [];
  const note = (kind: SensitiveKind, length: number) => found.push({ kind, length });
  let text = input.replace(SECRETS, (match) => {
    note("secret", match.length);
    return "[secret key hidden]";
  });
  // Ids, links and hashes can be long digit strings that only look like a card: keys and tokens only.
  if (options.secretsOnly) return { text, found };
  text = text.replace(CARD, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 13 || !luhn(digits) || !cardShape(digits)) return match;
    note("card", match.length);
    return `[card ending ${digits.slice(-4)}]`;
  });
  text = text.replace(SSN, (match) => {
    note("ssn", match.length);
    return `[Social Security number ending ${match.slice(-4)}]`;
  });
  text = text.replace(PASSWORD, (_match, label: string, glue: string, value: string) => {
    // Already hidden, or a sentence about passwords ("password is required"), not a password.
    if (/^\[.*\]$/.test(value) || SENTENCE_WORDS.test(value.replace(/[.,;:!?)]+$/, "")))
      return `${label}${glue}${value}`;
    note("password", value.length);
    return `${label}${glue}[hidden]`;
  });
  text = text.replace(PIN, (_match, label: string, glue: string, value: string) => {
    note("pin", value.length);
    return `${label}${glue}[hidden]`;
  });
  const keyed =
    (kind: SensitiveKind) => (match: string, label: string, glue: string, value: string) => {
      const number = numberPart(value);
      if (!number || !hasDigit(number) || number.replace(/\D/g, "").length < 5) return match;
      note(kind, number.length);
      const rest = value.slice(number.length);
      const ending = number.replace(/\D/g, "").slice(-4);
      return `${label}${glue}[hidden, ending ${ending}]${rest}`;
    };
  text = text.replace(IBAN, (match) => {
    if (!ibanValid(match)) return match;
    note("bank", match.length);
    return `[IBAN ending ${match.replace(/ /g, "").slice(-4)}]`;
  });
  text = text.replace(BANK, keyed("bank"));
  text = text.replace(ID, keyed("id"));
  return { text, found };
}

/** Everything in a value that is text, hidden the same way; keys, numbers and shapes stay as they are. */
/** Keys that hold an id, a link or a hash: long digit strings there aren't cards. */
const ID_KEY = /(^|_)(id|ids|uuid|url|uri|href|src|hash|slug|ref|cursor)$|(Id|Ids|Url|Uri|Hash)$/;
export function redactDeep<T>(value: T, depth = 0): { value: T; found: Found[] } {
  const found: Found[] = [];
  const walk = (item: unknown, level: number, key = ""): unknown => {
    if (typeof item === "string") {
      const result = redact(item, { secretsOnly: ID_KEY.test(key) });
      found.push(...result.found);
      return result.text;
    }
    if (level > 8 || item === null || typeof item !== "object") return item;
    if (Array.isArray(item)) return item.map((entry) => walk(entry, level + 1, key));
    // Dates, streams and other objects with behaviour are left as they are.
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== null) return item;
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([name, entry]) => [
        name,
        walk(entry, level + 1, name),
      ]),
    );
  };
  return { value: walk(value, depth) as T, found };
}

/** "a card number and a password": what was hidden, in the words people use. */
export function hiddenNames(found: Found[]) {
  const kinds = [...new Set(found.map((f) => f.kind))];
  const names = kinds.map((kind) => NAMES[kind]);
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const hasSensitive = (text: string) => redact(text).found.length > 0;
