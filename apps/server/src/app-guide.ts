import {
  APP_PLACES,
  cleanPlace,
  type ShowInApp,
  showInAppSchema,
} from "../../../packages/domain/src/app-places.ts";

/**
 * Where things are in the app, so the agent can tell people where to look. Keep it in step with
 * the app's navigation (apps/mobile/App.tsx, threads.tsx, apps-tabs.tsx and the Spaces tabs).
 */
export const appGuideInstructions = ` Where things are in the app, for when the person asks where to find something or to see their data (use the names as written here, such as "Spaces › Health › Food log"; never guess a screen that isn't listed):
- Bottom bar, left to right: Chat, Feed, Spaces, Activity, Ideas, Goals, Files, Apps. At the top: the menu (☰, top left: Main chat and other chats, Spaces, Delegate task, Agent computer, Calendar, Files, Apps & settings, Help & how-to), the agent's picture (opens Activity) and the bell (Updates).
- Feed: today's weather (tap it for the forecast), the calendar, plans and bookings ("See all plans & bookings": every one, upcoming and past, to mark done or cancelled), reminders ("See all reminders": upcoming, and those sent in the last 7 days), meals logged today ("View food log" opens Spaces › Health › Food log), and news on the topics they follow.
- Spaces: Health (everyone has one; if they removed it, Spaces › Start a health space brings it back with their log), Family and Social media. To start one: Spaces › All spaces (if a space is open) › Start a family planner or Start a social media space.
  - Health: Overview (today's calories, protein and exercise, a chart of each day of the week, week by week, and Workouts to start again), Food log (every meal as a table: today, this week or 30 days; Change fixes a meal), Food plan (the Family space's planned dinners next to what was eaten), Playbook (goals, food rules, targets, "Ask me what I ate" for meal check-ins and their times, and the weekly check-in). "Log a meal" opens a sheet to say or type a meal.
  - Family: Overview (this week's board: dinners with recipes, groceries, schedule, chores), Our weeks (past weeks and chore stars), Playbook.
  - Social media: Overview (posts waiting for their OK, this week and what's coming up), Results (reach, the plan's progress and past posts), Playbook.
- Activity: tasks in progress and finished, and Reviews & receipts.
- Ideas: suggestions to act on.
- Goals: goals and milestones, Tracking (routines and watched pages, with a price chart for a price watch), a Health summary that opens the Health space, and subscriptions.
- Files: files and media, mini-apps, and "Saved by" the agent (every report, comparison, plan and finance tracker it saved; tap a title to open it).
- Apps, with tabs: Apps (connections, their own apps, always allowed, app permissions), Agent (name and look, memory, people notes, voice, the agent's email), Alerts, Money (the spending limit with this month's purchases and a chart by month, and AI usage by month), Account (appearance, account, passwords, their data), Help.`;

/**
 * Take-me-there buttons: the agent names places in the app (show_in_app), and the app draws a
 * button under the reply that goes there, or opens the place straight away when asked to.
 */
export const showInAppInstructions = ` Take-me-there buttons: when the person asks where to find or see something in the app, answer in one short sentence and call show_in_app with that place, so a button under your reply takes them there (the button shows the way, so don't spell out a long path too). Use go: true when they ask to be taken somewhere, or to open or show them a screen ("take me to my food log", "open my reminders", "show me what I ate this week", "go to Money"): the app opens it straight away; then say in a few words what they'll find there. A question about their data ("what did I eat today?") is answered here in the chat, with a button if it helps, never go: true. After you do something whose result lives in the app (a meal logged, a reminder set, a plan or booking tracked, a report saved, a routine made), add one button to where it is, unless its own card already has one (a goal, a watched page, a task, a file, a workout, a map or products) or you showed that place in one of your last few replies. At most two places a reply, only from show_in_app's list; never write in-app paths as links.`;

const placeList = Object.entries(APP_PLACES)
  .map(([id, place]) => `${id} (${place.name}, ${place.where}): ${place.about}`)
  .join("; ");

export function showInAppToolSpec() {
  return {
    name: "show_in_app",
    description: `Show buttons under your reply that take the person to places in this app; with go: true the app also opens the first place straight away. Places: ${placeList}.`,
    parameters: showInAppSchema,
    // Only places the app knows, with only the details each one uses: a button can go nowhere else.
    execute: async (input: ShowInApp) => ({
      places: input.places.map(cleanPlace),
      ...(input.go ? { go: true } : {}),
    }),
  };
}
