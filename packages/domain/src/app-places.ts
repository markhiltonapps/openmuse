import { z } from "zod";

/**
 * Every place in the app a "take me there" button can open: a screen, a tab or a panel. The agent
 * names one by its id (show_in_app), and the app draws the button and goes there. Keep this in step
 * with the app's navigation (apps/mobile/App.tsx, apps-tabs.tsx, the Spaces tabs) and with
 * apps/server/src/app-guide.ts.
 *
 * `name` is what the button opens ("Open Food log"); `where` is the way there, shown under it so
 * people learn where it lives; `about` tells the agent what's there.
 */
export const APP_PLACES = {
  feed: {
    name: "Feed",
    where: "Bottom bar",
    about:
      "today at a glance: weather, calendar, plans and bookings, reminders, meals logged today, news",
  },
  plans: {
    name: "Plans & bookings",
    where: "Feed",
    about: "every plan and booking, upcoming (tab: upcoming) or past (tab: past), to mark done",
  },
  reminders: {
    name: "Reminders",
    where: "Feed",
    about: "upcoming reminders, and those sent in the last 7 days",
  },
  calendar: { name: "Calendar", where: "Menu, top left", about: "their calendar" },
  mail: { name: "Mail", where: "Apps", about: "their email, when Google is connected" },
  updates: {
    name: "Updates",
    where: "Bell, top right",
    about: "background updates and notifications",
  },
  spaces: { name: "Spaces", where: "Bottom bar", about: "the list of their spaces" },
  health: {
    name: "Health",
    where: "Spaces",
    about: "today's calories, protein and exercise, charts by day and week, workouts",
  },
  "health-food-log": {
    name: "Food log",
    where: "Spaces › Health",
    about: "every meal they logged, as tables; range: today, week (this week) or month (30 days)",
  },
  "health-food-plan": {
    name: "Food plan",
    where: "Spaces › Health",
    about: "the family's planned dinners next to what was eaten",
  },
  "health-playbook": {
    name: "Health playbook",
    where: "Spaces › Health",
    about: 'goals, food rules, targets, "Ask me what I ate" (meal check-ins), the weekly check-in',
  },
  "log-meal": { name: "Log a meal", where: "Spaces › Health", about: "say or type a meal" },
  family: {
    name: "Family",
    where: "Spaces",
    about: "this week's board: dinners, groceries, schedule, chores",
  },
  "family-weeks": {
    name: "Our weeks",
    where: "Spaces › Family",
    about: "past weeks and chore stars",
  },
  "family-playbook": {
    name: "Family playbook",
    where: "Spaces › Family",
    about: "the family space's playbook",
  },
  social: {
    name: "Social media",
    where: "Spaces",
    about: "posts waiting for their OK, this week and what's coming up",
  },
  "social-results": {
    name: "Results",
    where: "Spaces › Social media",
    about: "reach, the plan's progress and past posts",
  },
  "social-playbook": {
    name: "Social media playbook",
    where: "Spaces › Social media",
    about: "the social media space's playbook",
  },
  activity: { name: "Activity", where: "Bottom bar", about: "tasks in progress and finished" },
  task: {
    name: "Task",
    where: "Activity",
    about: "one task's plan, progress and results (id: the task's id)",
  },
  reviews: {
    name: "Reviews & receipts",
    where: "Activity",
    about: "actions waiting for their OK, and receipts of what was done",
  },
  ideas: { name: "Ideas", where: "Bottom bar", about: "suggestions to act on" },
  goals: {
    name: "Goals",
    where: "Bottom bar",
    about: "goals and milestones, tracking, subscriptions",
  },
  tracking: {
    name: "Tracking",
    where: "Goals",
    about: "routines and watched pages, with a price chart for a price watch",
  },
  files: { name: "Files & media", where: "Bottom bar", about: "files, photos and documents" },
  saved: {
    name: "Saved by your agent",
    where: "Files & media",
    about:
      "every report, comparison, plan and finance tracker the agent saved (id: one saved result's id, to open it)",
  },
  "agent-computer": {
    name: "Agent computer",
    where: "Menu, top left",
    about: "the agent's browser, terminal and files, to watch or take control",
  },
  delegate: {
    name: "New job",
    where: "The + at the top, next to the bell",
    about: "hand the agent a job to work on in the background",
  },
  apps: {
    name: "Apps",
    where: "Bottom bar",
    about: "connected apps, their own apps, always allowed actions, app permissions",
  },
  "agent-settings": {
    name: "Agent settings",
    where: "Apps › Agent",
    about: "the agent's name and look, people notes, voice, the agent's email",
  },
  memory: {
    name: "About you",
    where: "Apps › About you",
    about:
      "what the agent knows about them (name, work, home, apps, how to reach them) and everything else it remembers, to check, correct or forget",
  },
  alerts: { name: "Alerts", where: "Apps", about: "alerts from email and other apps" },
  money: {
    name: "Money",
    where: "Apps",
    about: "the spending limit, this month's purchases, spending and AI usage by month",
  },
  account: {
    name: "Account",
    where: "Apps",
    about: "appearance, account, passwords, their data",
  },
  help: { name: "Help", where: "Apps", about: "help and how-to" },
} as const satisfies Record<string, { name: string; where: string; about: string }>;

export type AppPlaceId = keyof typeof APP_PLACES;
export const appPlaceIds = Object.keys(APP_PLACES) as [AppPlaceId, ...AppPlaceId[]];

/** The Food log's time ranges, as the Food log's own choices name them. */
export const FOOD_LOG_RANGES = { today: "Today", week: "This week", month: "30 days" } as const;

export const placeRequestSchema = z.object({
  place: z.enum(appPlaceIds),
  /** The Food log's time range. */
  range: z.enum(["today", "week", "month"]).optional(),
  /** Plans & bookings: upcoming or past. */
  tab: z.enum(["upcoming", "past"]).optional(),
  /** One saved result or task. */
  id: z.string().trim().min(1).max(100).optional(),
});
export type PlaceRequest = z.infer<typeof placeRequestSchema>;

export const showInAppSchema = z.object({
  places: z.array(placeRequestSchema).min(1).max(2),
  /** Open the first place straight away: only when they asked to be taken there. */
  go: z.boolean().optional(),
});
export type ShowInApp = z.infer<typeof showInAppSchema>;

/** Keeps only the details a place uses, so a stray one can't change where a button goes. */
export function cleanPlace(request: PlaceRequest): PlaceRequest {
  const { place } = request;
  return {
    place,
    ...(place === "health-food-log" && request.range ? { range: request.range } : {}),
    ...(place === "plans" && request.tab ? { tab: request.tab } : {}),
    ...((place === "saved" || place === "task") && request.id ? { id: request.id } : {}),
  };
}

/**
 * A place's way there, with any detail: "Spaces › Health · This week". The app puts the space's
 * own name in place of "Health" when it has been renamed.
 */
export function placeWhere(request: PlaceRequest): string {
  const where: string = APP_PLACES[request.place].where;
  if (request.place === "health-food-log" && request.range)
    return `${where} · ${FOOD_LOG_RANGES[request.range]}`;
  if (request.place === "plans" && request.tab)
    return `${where} · ${request.tab === "past" ? "Past" : "Upcoming"}`;
  return where;
}
