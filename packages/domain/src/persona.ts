import { z } from "zod";

/**
 * What the agent knows about the person, as named facts they can see, change and forget on
 * About you. This list is an allowlist: anything outside it stays an ordinary memory. It never
 * holds health conditions, religion, politics, immigration status, account numbers or logins.
 * Their town stays in the home area (Areas, for local news and weather); their full street
 * address is a fact here. People stay on People pages.
 */
export const PERSONA_GROUPS = [
  "You",
  "Work",
  "Home and family",
  "Email and apps",
  "How I help",
] as const;
export type PersonaGroup = (typeof PERSONA_GROUPS)[number];

export const PERSONA_FACTS = {
  "you.name": { label: "What I call you", group: "You", hint: "First name or nickname" },
  "you.focus": { label: "What you want help with", group: "You", hint: "Home, work or both" },
  "work.occupation": { label: "What you do", group: "Work", hint: "Nurse, landscaper, teacher" },
  "work.hours": { label: "When you work", group: "Work", hint: "Weekdays 9 to 5, or shifts" },
  "business.what": {
    label: "Your business",
    group: "Work",
    hint: "What you sell, and who to",
  },
  "business.team": { label: "Your team", group: "Work", hint: "Just you, or you and two others" },
  "business.tools": {
    label: "Business apps",
    group: "Work",
    hint: "QuickBooks, Square, Stripe, Shopify",
  },
  "household.people": {
    label: "Who’s at home",
    group: "Home and family",
    hint: "Partner Jess; kids Maya 9 and Leo 6; dog Biscuit",
  },
  "household.address": {
    label: "Home address",
    group: "Home and family",
    hint: "123 Oak St, Houston, TX 77002",
  },
  "household.home": {
    label: "Own or rent",
    group: "Home and family",
    hint: "We own it, or we rent",
  },
  "comms.email": { label: "Your email", group: "Email and apps", hint: "Outlook, Gmail…" },
  "comms.workEmail": { label: "Work email", group: "Email and apps", hint: "If it’s different" },
  "comms.calendar": {
    label: "Your calendar",
    group: "Email and apps",
    hint: "Outlook, Google Calendar…",
  },
  "comms.apps": {
    label: "Other apps you use",
    group: "Email and apps",
    hint: "Slack, Google Drive, Amazon",
  },
  "prefs.briefTime": {
    label: "When you’d like a morning brief",
    group: "How I help",
    hint: "7 am on weekdays",
  },
  "prefs.reach": {
    label: "How to reach you",
    group: "How I help",
    hint: "Notifications, text or email",
  },
  "prefs.quietHours": { label: "Quiet hours", group: "How I help", hint: "9 pm to 8 am" },
  "prefs.offPlate": {
    label: "What you’d like off your plate",
    group: "How I help",
    hint: "Fewer missed school emails",
  },
  "prefs.style": { label: "How I talk to you", group: "How I help", hint: "Short, or chattier" },
} as const satisfies Record<string, { label: string; group: PersonaGroup; hint: string }>;

export type PersonaKey = keyof typeof PERSONA_FACTS;
export const personaKeys = Object.keys(PERSONA_FACTS) as [PersonaKey, ...PersonaKey[]];

/** How the agent came to know it: "told" by the person, "confirmed" by them, or its own "guessed". */
export type PersonaConfidence = "told" | "confirmed" | "guessed";
export type PersonaSource = "you" | "chat" | "interview" | "email" | "app" | "account";

export interface PersonaFact {
  /** The fact's key: one row per key. */
  id: PersonaKey;
  key: PersonaKey;
  value: string;
  source: PersonaSource;
  confidence: PersonaConfidence;
  createdAt: string;
  updatedAt: string;
}

export const personaValue = z.string().trim().min(1).max(300);

/** What the agent saves: facts the person said about themselves, by key. */
export const personaSaveInput = z.object({
  facts: z
    .array(z.object({ key: z.enum(personaKeys), value: personaValue }))
    .min(1)
    .max(12),
});

/** Where a fact came from: "You told me", "From your email". */
export function personaSourceLabel(fact: Pick<PersonaFact, "source" | "confidence">) {
  // A guess also carries a "Guess" tag, so its line only says where it came from.
  if (fact.confidence === "guessed")
    return fact.source === "email"
      ? "From your email"
      : fact.source === "app"
        ? "From your apps"
        : fact.source === "account"
          ? "From your account"
          : "From our chats";
  if (fact.source === "you") return "You set this";
  if (fact.confidence === "confirmed") return "You confirmed this";
  if (fact.source === "account") return "From your account";
  if (fact.source === "email") return "From your email";
  if (fact.source === "app") return "From your apps";
  return "You told me";
}
