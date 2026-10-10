import type { AppPlaceId } from "./app-places.ts";

/**
 * The help guide: every part of the app, in plain steps, shown on the Help screen and read by the
 * agent to answer "how do I…?" (get_help). Keep it in step with the app: a change people can see
 * or ask for updates its topic here in the same commit, and retakes the topic's screenshot with
 * scripts/help-shots.mjs (see CLAUDE.md).
 *
 * In the text, {agent} is the agent's name ("Neddy" unless they renamed it) and **bold** marks
 * the words on a button or screen. Steps are numbered to match the numbered marks on the
 * topic's screenshot. `say` is what to say to the agent instead (voice first).
 */
export const HELP_GROUPS = [
  { id: "start", title: "Get started", emoji: "👋" },
  { id: "talk", title: "Talk with {agent}", emoji: "🎙️" },
  { id: "chat", title: "Chat and ask", emoji: "💬" },
  { id: "day", title: "Your day", emoji: "☀️" },
  { id: "jobs", title: "Jobs", emoji: "🧑‍💻" },
  { id: "spaces", title: "Spaces", emoji: "🏡" },
  { id: "apps", title: "Apps and connections", emoji: "🧩" },
  { id: "files", title: "Files and documents", emoji: "📁" },
  { id: "you", title: "What {agent} knows", emoji: "🧠" },
  { id: "control", title: "You’re in control", emoji: "🛡️" },
  { id: "settings", title: "Settings and alerts", emoji: "⚙️" },
  { id: "fix", title: "Fix a problem", emoji: "🧰" },
  { id: "admin", title: "For the admin", emoji: "🔑", admin: true },
] as const;
export type HelpGroupId = (typeof HELP_GROUPS)[number]["id"];

/**
 * Something to say instead of tapping. A plain line is an example: in the app, tapping it puts it
 * in the message box to change and send. `send` marks a question that changes nothing, sent in one
 * tap. `where` marks one that only works there ("on a call", "after you add a photo"), just shown.
 */
export type HelpSay = string | { text: string; send: true } | { text: string; where: string };
export const sayText = (line: HelpSay) => (typeof line === "string" ? line : line.text);

export interface HelpTopic {
  id: string;
  group: HelpGroupId;
  title: string;
  /** One line under the title, and in search results. */
  summary: string;
  /** Numbered steps, matching the numbers on the screenshot. */
  steps?: string[];
  /** More to know, a paragraph each. */
  body?: string[];
  /** What to say to the agent instead of tapping (voice first). */
  say?: HelpSay[];
  /** A screenshot: /help/shots/<shot>-light.webp and -dark.webp. */
  shot?: string;
  /** Where it is in the app, for "Take me there". */
  place?: AppPlaceId;
  /** More places it covers, each with its own button (a space's other tabs). */
  more?: AppPlaceId[];
  /** Other words people use for it, for search. */
  keywords?: string[];
  related?: string[];
  /** Only the admin (the person who runs this Neato_Muse) sees it. */
  admin?: boolean;
}

export const HELP_TOPICS: HelpTopic[] = [
  // Get started
  {
    id: "welcome",
    group: "start",
    title: "What {agent} can do",
    summary: "Your own AI agent: it talks with you, works with your apps and gets things done.",
    body: [
      "{agent} reads and drafts your email, keeps your calendar, sets reminders, tracks your plans and bookings, researches things, makes documents, keeps an eye on the web and runs errands on websites.",
      "The quickest way to use it is to talk: tap the headset next to the message box and just say what you need. You can also type in the chat.",
      "Nothing is sent, bought or booked, and nothing changes in your other apps, without your OK: {agent} shows an **Approve** card first, unless you’ve said that kind of thing is always allowed.",
    ],
    say: [
      { text: "What can you do for me?", send: true },
      { text: "Help me get set up.", send: true },
    ],
    keywords: [
      "start",
      "intro",
      "overview",
      "about",
      "what is",
      "what can it do",
      "what can you do",
    ],
    related: ["first-steps", "find-your-way", "live-call"],
  },
  {
    id: "first-steps",
    group: "start",
    title: "Your first five minutes",
    summary: "Connect your apps, tell {agent} about you, and try a call.",
    steps: [
      "Connect your email and calendar: open **Apps**, search for Gmail, Outlook or Google Calendar, and tap **Connect**. You sign in to each app yourself.",
      "Tell {agent} about yourself: say “Ask me a few questions for my About you page.”",
      "Try a call: tap the headset next to the message box and say “What’s on my calendar today?”",
      "Add the app to your home screen so it’s one tap away and can send you notifications.",
    ],
    say: [
      { text: "Connect my Gmail.", send: true },
      { text: "Ask me a few questions for my About you page.", send: true },
    ],
    keywords: ["setup", "set up", "onboarding", "begin"],
    related: ["connect-apps", "about-you", "live-call", "home-screen"],
  },
  {
    id: "sign-in",
    group: "start",
    title: "Sign in",
    summary: "There’s no password: you sign in with a code or link sent to your email.",
    steps: [
      "On the sign-in screen, type your email and tap **Email me a sign-in code**.",
      "Type the 6-digit code from the email, or tap the link in it on this device. It works once and lasts 15 minutes (an invite lasts 3 days).",
      "Each device stays signed in for 30 days after you last used it.",
    ],
    body: [
      "New here? Tap **Request access** and leave your name and email; the person who runs Neato_Muse can invite you.",
      "Using the app from an iPhone home screen? Links open in Safari. Press and hold the link in the email, tap **Copy**, and paste it in the code box on the sign-in screen.",
    ],
    keywords: [
      "login",
      "log in",
      "sign in",
      "cant sign in",
      "cant log in",
      "get in",
      "link",
      "invite",
      "password",
      "access",
    ],
    related: ["fix-sign-in-link", "home-screen"],
  },
  {
    id: "home-screen",
    group: "start",
    title: "Add the app to your home screen",
    summary: "Neato_Muse installs like an app, so it opens full screen and can send notifications.",
    steps: [
      "**Android (Chrome):** tap ⋮ at the top right, then **Install app** or **Add to Home screen**.",
      "**iPhone (Safari):** tap **Share**, then **Add to Home Screen**, and open it from there. Notifications need this on iPhone.",
      "**Windows (Chrome or Edge):** click the install icon at the right of the address bar, or ⋮ › **Install Neato_Muse**.",
    ],
    keywords: ["install", "app", "icon", "pwa", "home screen", "shortcut"],
    related: ["notifications", "fix-look"],
  },
  {
    id: "find-your-way",
    group: "start",
    title: "Find your way around",
    summary:
      "The bottom bar has the main screens; the top has the Menu, {agent}, New job and Updates.",
    shot: "home",
    steps: [
      "**☰ Menu (top left):** Chats, New job, Calendar, Spaces, Files, {agent}’s browser, Apps & settings and Help & how-to, each with a line saying what it’s for.",
      "**{agent}’s picture:** what it’s working on now. Tap it to open that job, or Activity when it’s free. On the chat screen, the button under it says which chat you’re in and opens your chats.",
      "**The clipboard button (top right):** hand {agent} a new job. The **bell** next to it has your updates.",
      "**The bottom bar:** Chat, Feed, Spaces, Activity, Ideas, Goals, Files and Apps.",
    ],
    body: [
      "You don’t have to find anything: ask {agent} “Take me to my food log” or “Where are my reminders?” and it shows a button that takes you there.",
    ],
    say: [
      { text: "Take me to my reminders.", send: true },
      { text: "Where do I find my files?", send: true },
    ],
    keywords: ["menu", "navigate", "tabs", "bottom bar", "where", "hamburger"],
    related: ["side-chats", "updates", "new-job"],
  },

  // Talk with the agent
  {
    id: "live-call",
    group: "talk",
    title: "Talk live with {agent}",
    summary: "A real-time voice call: just talk, like on the phone.",
    shot: "call",
    steps: [
      "In the chat, tap the **headset** next to the message box. Allow the microphone if your browser asks.",
      "Talk naturally. You can interrupt {agent} any time by just speaking.",
      "**Mute** stops {agent} hearing you; tap it again to unmute.",
      "**End** hangs up. The call is saved in your main chat.",
    ],
    body: [
      "When {agent} has to look something up or do something, it says “One sec” and tells you when it’s done. Long answers and lists go on your screen instead of being read out. Anything to approve appears there too.",
      "Things that can’t wait (time to leave, security and money alerts) are said out loud; see **Urgent alerts on calls**.",
      "Say “brief me” any time, on a call or in the chat, for a short rundown of your day: what’s next, what’s waiting for your OK, jobs that need you, and what’s coming up.",
      "Things waiting for your OK can be approved by voice too: {agent} reads each one back, and you say “yes, approve” (purchases and payments still need a tap).",
      "A call hangs up by itself after about a minute and a half of quiet, so silence doesn’t cost anything.",
    ],
    say: [
      { text: "Brief me", send: true },
      { text: "What’s on my calendar today?", send: true },
      { text: "Read me my latest email.", send: true },
    ],
    keywords: [
      "voice",
      "call",
      "speak",
      "headset",
      "talk",
      "phone",
      "hands-free",
      "brief me",
      "rundown",
      "daily brief",
      "interrupt",
    ],
    related: ["call-bar", "see-it", "call-ends", "fix-call"],
  },
  {
    id: "call-bar",
    group: "talk",
    title: "Keep talking while you use the app",
    summary: "Shrink the call to a bar at the top and carry on talking anywhere in the app.",
    shot: "callbar",
    steps: [
      "On the call screen, tap the **down arrow** at the top. The call keeps going in a bar at the top of the app.",
      "Move around the app as usual. The bar shows what {agent} is doing and the last thing it said.",
      "Tap the bar to go back to the call. **Mute** and **End** are on the bar too.",
    ],
    body: ["Opening another screen never ends the call; only **End** does."],
    keywords: ["shrink", "minimize", "bar", "background", "multitask"],
    related: ["see-it", "live-call"],
  },
  {
    id: "see-it",
    group: "talk",
    title: "See what {agent} puts on your screen",
    summary: "When the call is shrunk, a See it button holds anything {agent} showed you.",
    shot: "seeit",
    steps: [
      "When {agent} puts something on your screen, the call bar shows a **See it** button with what it is (for example “Needs your OK”).",
      "Tap **See it** when it’s safe to look. The call screen opens right at that answer.",
      "Something waiting for your OK stays behind **See it** (“Still needs your OK”) until you approve, decline or it expires.",
    ],
    body: [
      "{agent} also tells you it’s behind the **See it** button, so you can look when you’re ready, for example when you’re not driving.",
    ],
    keywords: ["see it", "screen", "card", "show", "approve", "look"],
    related: ["approvals", "call-bar"],
  },
  {
    id: "call-ends",
    group: "talk",
    title: "When a call ends",
    summary: "Every call is saved in your main chat, with anything that was shown on screen.",
    steps: [
      "If a call ends by itself (quiet, or the connection dropped), the bar says why.",
      "Tap **Talk again** to start a new call, or the bar to see what was said.",
      "Later, scroll your main chat: the call is there, with what was shown on screen.",
    ],
    keywords: ["hang up", "ended", "dropped", "disconnected", "history", "saved call"],
    related: ["live-call", "fix-call"],
  },
  {
    id: "voice-tips",
    group: "talk",
    title: "Tips for talking with {agent}",
    summary: "Talk like you would to a person: short, plain, one thing at a time.",
    body: [
      "Say what you want done, not how: “Move my 3 o’clock to Thursday” works better than a list of steps.",
      "Interrupt any time; {agent} stops and listens.",
      "Ask it to put things on screen: “Show me those on screen.”",
      "Anything that sends, books or buys waits for you to tap **Approve**; {agent} tells you when something is waiting.",
    ],
    say: [
      { text: "Show me those on screen.", where: "on a call, after a list" },
      { text: "Say that again, slower.", where: "on a call" },
    ],
    keywords: ["voice", "tips", "how to talk", "commands"],
    related: ["live-call", "things-to-ask"],
  },
  {
    id: "speak-and-listen",
    group: "talk",
    title: "Speak a message or hear a reply",
    summary: "Dictate a message, or tap Listen to hear any reply read out.",
    steps: [
      "Tap **Listen** under any reply to hear it.",
      "Where live talk isn’t on, tap the **mic** to speak a message instead of typing, or the **sound-wave** button to talk hands-free.",
      "Choose the voice and microphone under **Apps › Agent › Voice**.",
    ],
    keywords: ["dictation", "mic", "read aloud", "listen", "voice", "spoken replies"],
    related: ["microphone", "live-call"],
  },

  // Chat and ask
  {
    id: "chat-basics",
    group: "chat",
    title: "Chat with {agent}",
    summary: "Type or talk in the chat; {agent} answers and does the work.",
    shot: "chat",
    steps: [
      "**+** adds a photo or a file.",
      "Type your message in the box.",
      "The **headset** starts a live call.",
      "**Send** (the arrow). While {agent} replies, it becomes **Stop**.",
    ],
    body: [
      "You can send a new message while {agent} is still working; it waits in line.",
      "Results come as cards in the chat: an email, your calendar, a file, places on a map, products, or an **Approve** button.",
    ],
    keywords: ["chat", "message", "type", "send", "stop"],
    related: ["photos-in-chat", "cards-in-chat", "things-to-ask"],
  },
  {
    id: "photos-in-chat",
    group: "chat",
    title: "Send a photo or a file",
    summary: "Show {agent} a photo, a PDF, a Word or Excel file, and ask about it.",
    steps: [
      "Tap **+** next to the message box and choose a photo or a file. On a computer you can also paste a picture.",
      "With just a photo, quick buttons appear, like finding a product in it.",
      "Or ask your own question: “What plant is this?” “Sum up this PDF.”",
    ],
    body: ["Files you send are kept in **Files & media**."],
    say: [
      { text: "What’s in this photo?", where: "after you add a photo" },
      { text: "Find this product for me.", where: "after you add a photo" },
    ],
    keywords: ["attach", "photo", "picture", "image", "pdf", "upload", "paste", "file"],
    related: ["files", "make-documents"],
  },
  {
    id: "things-to-ask",
    group: "chat",
    title: "Things you can ask",
    summary: "Ideas to try, by chat or by voice.",
    body: [
      "**Email:** “Sum up my unread email and draft replies to anything urgent.”",
      "**Calendar:** “What’s on tomorrow? Move my 3pm to Thursday.”",
      "**Reminders:** “Remind me to call Mom on Sunday at 5.”",
      "**Plans:** “Keep track of my dentist appointment on the 12th.”",
      "**Research:** “Compare the three best-reviewed robot vacuums and make me a one-page document.”",
      "**Places:** “Find good breakfast tacos near me.”",
      "**Restaurants:** “Find a table for 4 at Nobu on Friday at 7:30.”",
      "**Shopping:** “Buy the shoes in this photo, under $120.”",
      "**Money:** “Find my subscriptions.”",
      "**Health:** “I had a chicken salad for lunch.” “I weighed 173 this morning.”",
      "**The web:** “Watch this page and tell me when the price drops.”",
      "**Routines:** “Every weekday at 8, send me a rundown of my day.”",
      "**Mini apps:** “Make me a tip splitter for 4 people.”",
      "**Your day:** “Brief me.”",
      "**On a call:** “What’s waiting for my OK?” then “Approve all.”",
      "**Reminders that follow your calendar:** “Remind me 30 minutes before the dentist.”",
      "**Where you are:** “Where am I?” “Find a coffee shop near me.” (Turn on **Your location** first.)",
      "**Urgent alerts:** “Tell me straight away if Mom emails during a call.”",
      "**AI costs:** “How much has the AI cost this week?”",
    ],
    keywords: ["examples", "ideas", "what can I say", "prompts", "commands", "what can you do"],
    related: ["chat-basics", "live-call"],
  },
  {
    id: "cards-in-chat",
    group: "chat",
    title: "Cards and buttons in the chat",
    summary: "What {agent} shows you: cards to open, approve, connect or go somewhere.",
    body: [
      "**Approve:** something waiting for your OK, with exactly what will happen. See “Approve before anything happens”.",
      "**Connect:** a button that signs you in to an app {agent} needs.",
      "**Calendar, emails and files:** tap to open them in full.",
      "**Places and products:** a map with directions, or products with prices.",
      "**Open … buttons:** take you to the right place in the app, like your Food log. **Back to chat** brings you back.",
    ],
    keywords: ["card", "button", "approve", "connect", "take me there", "back to chat"],
    related: ["approvals", "connect-apps"],
  },
  {
    id: "side-chats",
    group: "chat",
    title: "Your chats",
    summary: "Keep a separate chat for a topic; your main chat is always there.",
    shot: "chats",
    steps: [
      "On the chat screen, tap the button under {agent}’s name (it says which chat you’re in), or open **☰ Menu › Chats**.",
      "Tap **New chat** to start one, or tap a chat to open it. Each space has its own chat too.",
      "Tap a chat’s **⋯** to **Rename**, **Archive** or **Delete** it. **Archived chats** at the bottom has the ones you put away, to **Restore**.",
      "Tap **Hide** next to **Other chats** to hide them, and **Show** to bring them back.",
    ],
    body: [
      "Each chat is separate, but what {agent} knows about you is shared. The main chat’s **⋯** has **Clear main chat**, which starts it fresh.",
      "Or just say it: {agent} opens, starts, renames, archives or brings back a chat for you, in the chat or on a call. Deleting a chat waits for you to tap **Delete** on its card, and clearing the main chat waits for **Clear**.",
    ],
    say: [
      "Open my car insurance chat.",
      "Start a new chat about the kitchen.",
      { text: "What chats do I have?", send: true },
    ],
    keywords: [
      "chats",
      "my chats",
      "conversation",
      "thread",
      "new chat",
      "rename",
      "archive",
      "delete chat",
      "menu",
    ],
    related: ["find-your-way", "past-chats"],
  },
  {
    id: "past-chats",
    group: "chat",
    title: "Find something said before",
    summary:
      "{agent} can search your earlier chats, including ChatGPT and Claude history you bring in.",
    say: [
      "What did we decide about the trip last week?",
      "Find my old ChatGPT chat about the kitchen.",
    ],
    body: [
      "Just ask: {agent} searches your past conversations and long chats it summed up.",
      "A chat opens on its latest messages. To read further back, scroll to the top and tap **Show earlier messages**. Keep tapping to go as far back as you like.",
      "The main chat never runs out of room. As it grows, it quietly starts a fresh part so it stays quick to open, and a line like “Continued Oct 8” shows where each part began. {agent} remembers what came before, and nothing is lost.",
      "To bring in ChatGPT or Claude chats, see “Bring your ChatGPT or Claude history”.",
    ],
    keywords: [
      "search",
      "history",
      "earlier",
      "old chat",
      "remember",
      "chatgpt",
      "claude",
      "scroll back",
      "show earlier",
      "older messages",
    ],
    related: ["import-chatgpt"],
  },
  {
    id: "copy-delete",
    group: "chat",
    title: "Copy, listen to or delete a message",
    summary: "Under each message: Copy, Listen and a bin to delete it.",
    steps: [
      "**Copy** under a message copies its text (on a phone it may say **Share**).",
      "**Listen** under a reply reads it out.",
      "The bin under a message deletes it: tap **Delete message** to confirm, or **Keep**.",
    ],
    keywords: ["copy", "delete message", "remove", "listen"],
    related: ["your-data"],
  },

  // Your day
  {
    id: "feed",
    group: "day",
    title: "The Feed",
    summary: "Today at a glance: weather, calendar, plans, reminders, meals and your news.",
    shot: "feed",
    place: "feed",
    steps: [
      "**Make me a feed about…**: tell it the topics you want news on. Your stories are further down.",
      "**Weather** for where you live; tap it for the forecast.",
      "**Your calendar** for today.",
      "**Meals** logged today, with **Log a meal** and **View food log**.",
    ],
    body: [
      "Below that: what’s waiting for your OK, jobs in progress, **Add a reminder**, then **Plans & bookings** and **Reminders** (each with **See all**) and your news. React to a story to see more or fewer like it.",
    ],
    say: ["Make me a feed about local news and the Warriors."],
    keywords: ["today", "dashboard", "home", "news", "weather", "glance"],
    related: ["weather-area", "news-topics", "plans", "reminders"],
  },
  {
    id: "calendar",
    group: "day",
    title: "Your calendar",
    summary: "{agent} reads every calendar you connect, and can add or move events with your OK.",
    place: "calendar",
    steps: [
      "Connect Google Calendar or Outlook under **Apps**.",
      "Ask “What’s on today?” and a calendar card shows your day, with your reminders.",
      "To see the calendar itself, open **☰ Menu › Calendar**.",
    ],
    body: [
      "New events and changes wait for you to tap **Approve**; attendees may get an invitation.",
    ],
    say: [{ text: "What’s on this week?", send: true }, "Move my 3pm to Thursday."],
    keywords: ["schedule", "events", "meetings", "appointments", "google calendar", "outlook"],
    related: ["connect-apps", "reminders"],
  },
  {
    id: "brief",
    group: "day",
    title: "Brief me: your day in one go",
    summary:
      "Ask any time for a short rundown: what’s next, what’s waiting for you, and what’s coming up.",
    steps: [
      "Say or type “Brief me”, in the chat or on a call.",
      "{agent} starts with what’s next on your calendar, then anything waiting for your OK or your answer, then what’s coming up.",
      "Want your email too? Say “and check my email”.",
    ],
    body: [
      "It’s kept short enough to listen to while driving. A routine can do the same every morning: “Every weekday at 8, brief me.”",
    ],
    say: [{ text: "Brief me", send: true }, "Every weekday at 8, brief me."],
    keywords: [
      "brief",
      "brief me",
      "rundown",
      "daily brief",
      "morning brief",
      "my day",
      "catch me up",
      "summary of my day",
    ],
    related: ["live-call", "routines", "calendar"],
  },
  {
    id: "reminders",
    group: "day",
    title: "Reminders",
    summary: "Ask {agent} to remind you, and it notifies you at that time.",
    place: "reminders",
    steps: [
      "Say or type “Remind me to … at …”.",
      "See them all on the **Feed** and tap **See all reminders**: upcoming, and ones sent in the last 7 days.",
      "To move or cancel one, just ask.",
    ],
    body: [
      "A reminder for something on your calendar (“Remind me 30 minutes before the dentist”) follows it: if the appointment moves, the reminder moves with it and you’re told. If the event can’t be found any more, you’re told once and the reminder stays.",
    ],
    say: [
      "Remind me to call Mom on Sunday at 5.",
      "Remind me 30 minutes before my next appointment.",
      "Move my Monday reminder to Tuesday.",
    ],
    keywords: [
      "remind",
      "alarm",
      "notification",
      "alert",
      "later",
      "before my appointment",
      "meeting moves",
      "appointment moves",
      "rescheduled",
      "moved reminder",
    ],
    related: ["routines", "notifications"],
  },
  {
    id: "plans",
    group: "day",
    title: "Plans & bookings",
    summary: "Trips, appointments, deliveries and bookings, kept track of for you.",
    place: "plans",
    steps: [
      "Tell {agent} about something coming up, or it notices booking emails when **Email alerts** are on.",
      "See them on the **Feed** and tap **See all plans & bookings**, upcoming and past.",
      "Mark one done or cancelled there, or just say so.",
    ],
    say: ["Keep track of my flight on Friday.", "My dentist appointment is cancelled."],
    keywords: ["commitments", "bookings", "trips", "appointments", "deliveries", "coming up"],
    related: ["email-alerts", "feed"],
  },
  {
    id: "updates",
    group: "day",
    title: "Updates and the bell",
    summary: "The bell keeps every update; small cards pop up under it as things happen.",
    place: "updates",
    steps: [
      "Tap the **bell** at the top right. A dot means something new.",
      "Results, changes {agent} noticed and anything needing you are listed there.",
      "Choose where updates show under **Apps › Agent › Where updates show**.",
    ],
    keywords: ["notifications", "bell", "alerts", "inbox", "pop-up", "toast"],
    related: ["notifications", "job-alerts"],
  },
  {
    id: "weather-area",
    group: "day",
    title: "Weather and where you live",
    summary: "Your town sets the weather, local news and “near me” searches.",
    steps: [
      "Tell {agent} your town or address, or tap the weather on the **Feed** and set your city.",
      "Your town is kept on **About you** as **Where you live**. If you give your street address, {agent} keeps all of it as your **Home address** too.",
    ],
    body: ["Weather covers US cities."],
    say: ["I live in Houston."],
    keywords: ["weather", "forecast", "location", "city", "town", "near me"],
    related: ["about-you", "feed"],
  },
  {
    id: "news-topics",
    group: "day",
    title: "News on topics you follow",
    summary: "Your Feed’s stories follow your topics and learn from your reactions.",
    steps: [
      "Ask {agent} to follow a topic, or change **Topics you follow** on the Feed.",
      "React to a story to see more or fewer like it. Tap a story to read the real article.",
    ],
    say: ["Follow electric cars on my feed.", "Less celebrity news."],
    keywords: ["news", "stories", "topics", "articles", "follow"],
    related: ["feed"],
  },
  {
    id: "ideas",
    group: "day",
    title: "Ideas from {agent}",
    summary: "Useful next steps {agent} suggests from your email, goals and plans.",
    place: "ideas",
    steps: [
      "Open **Ideas** in the bottom bar.",
      "Tap an idea to see why it’s suggested. **Start this** hands it to {agent} as a job, **Edit** changes what it will do, and **Dismiss** removes it.",
    ],
    keywords: ["suggestions", "ideas", "recommendations", "next steps"],
    related: ["goals"],
  },
  {
    id: "goals",
    group: "day",
    title: "Goals and tracking",
    summary: "Longer-term goals with milestones, and everything {agent} keeps an eye on.",
    place: "goals",
    steps: [
      "Open **Goals** in the bottom bar.",
      "**Goals** and their milestones; ask {agent} to set one up.",
      "**Tracking:** your routines and the pages {agent} watches, with a price chart for a price watch.",
      "**Subscriptions:** tap **Find my subscriptions** to have {agent} find the charges that repeat.",
    ],
    say: ["Help me save $5,000 by June.", { text: "Find my subscriptions.", send: true }],
    keywords: ["goals", "milestones", "tracking", "subscriptions", "routines", "watch"],
    related: ["routines", "watch-page", "subscriptions"],
  },

  // Jobs
  {
    id: "new-job",
    group: "jobs",
    title: "Start a new job",
    summary: "A job is work {agent} does in the background while you do other things.",
    shot: "newjob",
    place: "delegate",
    steps: [
      "Tap the **clipboard** button at the top right (or **New job** at the bottom of most screens).",
      "Say what you want done in one box, like “Compare the three best-reviewed robot vacuums”.",
      "Tap **Start job**. It keeps going even if you close the app.",
      "When it’s done you get an update (and a notification if they’re on).",
    ],
    body: [
      "Or just ask in the chat or on a call: {agent} turns bigger requests into a job by itself.",
    ],
    say: ["Make this a job: find me three hotels in Austin under $200."],
    keywords: ["new job", "delegate", "task", "background", "work"],
    related: ["job-page", "job-answers", "website-jobs"],
  },
  {
    id: "job-page",
    group: "jobs",
    title: "Follow a job",
    summary: "Each job has a page: what {agent} is doing now, and the result when it’s done.",
    shot: "job",
    place: "activity",
    steps: [
      "Open **Activity**, or tap {agent}’s picture at the top while it’s working.",
      "Tap the job. The top card says what {agent} is doing right now.",
      "When it’s finished, the **Done** card has the answer, with any files it made.",
    ],
    keywords: ["job", "progress", "status", "result", "activity", "report"],
    related: ["activity", "job-answers"],
  },
  {
    id: "job-answers",
    group: "jobs",
    title: "When a job needs you",
    summary: "A job stops to ask a question or to get your OK, then carries on.",
    steps: [
      "{agent}’s picture says **Needs your answer** or **Ready to review**, and you get an update.",
      "Open the job. Type under **Your answer** and tap **Send answer**, or tap **Approve** on its card (**See details** shows all of it first).",
      "The job carries on from where it stopped.",
    ],
    body: [
      "If it needs an app connected first, tap **Connect** on the job and sign in on the page that opens. Then tap **I’ve connected it, carry on**.",
    ],
    keywords: [
      "question",
      "waiting",
      "needs you",
      "approve",
      "answer",
      "continue",
      "connect first",
      "sign in first",
    ],
    related: ["approvals", "job-page"],
  },
  {
    id: "website-jobs",
    group: "jobs",
    title: "Jobs on websites",
    summary:
      "{agent} can work a website in its own browser: download a bill, fill in a form, compare prices.",
    steps: [
      "If the site needs a sign-in, save its password first under **Apps › Account › Passwords**.",
      "Hand over the job: “Download my latest bill from my electric company’s website.”",
      "{agent} asks before it signs in (unless you turned that off) and always before it pays, sends or submits.",
      "Files it downloads go to **Files & media**.",
    ],
    body: [
      "If it gets stuck on a “prove you’re human” check or a code only you can get, the job says so. Tap **Open browser** in the job and do that step yourself; for a “Press & hold” button, hold it down until the site lets you through. Then write “Done” under **Your answer** and tap **Send answer**.",
    ],
    keywords: ["website", "browser", "bill", "form", "sign in", "captcha", "download"],
    related: ["passwords", "agent-computer", "fix-website-blocked"],
  },
  {
    id: "routines",
    group: "jobs",
    title: "Routines: jobs on a schedule",
    summary: "A job that runs by itself at set times, like a morning rundown.",
    place: "tracking",
    steps: [
      "Ask in the chat or on a call: “Every weekday at 8, send me a rundown of my day.”",
      "On a call, {agent} says the routine back in plain words first; say “yes” to save it, or change it.",
      "Each run becomes a job in **Activity** and sends you an update.",
      "See, pause or remove them in **Goals › Tracking**.",
    ],
    body: [
      "Email rules work the same way: “When Dana at Acme emails me about an invoice, save the PDF and tell me the total.”",
    ],
    say: ["Every Friday at 4, check my inbox for anything I haven’t answered."],
    keywords: [
      "routine",
      "schedule",
      "recurring",
      "every day",
      "daily",
      "weekly",
      "automation",
      "rule",
      "email rule",
      "out loud",
      "by voice",
      "set up a rule",
    ],
    related: ["goals", "reminders"],
  },
  {
    id: "watch-page",
    group: "jobs",
    title: "Watch a page or a price",
    summary: "{agent} checks a web page for you and tells you when it changes.",
    place: "tracking",
    steps: [
      "Send the page’s link and say what to watch for: “Tell me when this drops under $300.”",
      "It’s in **Goals › Tracking**, with a price chart for a price. Tap **Check now** to look right away.",
    ],
    say: [
      {
        text: "Watch this page and tell me when the price drops.",
        where: "after you paste the page’s link",
      },
    ],
    keywords: ["watch", "price", "monitor", "track", "alert", "change"],
    related: ["goals"],
  },
  {
    id: "activity",
    group: "jobs",
    title: "Activity",
    summary: "What needs your OK, jobs in progress and finished, and receipts of what was done.",
    shot: "activity",
    place: "activity",
    steps: [
      "Open **Activity** in the bottom bar.",
      "Anything waiting for your OK is at the top.",
      "Then your jobs, newest first.",
      "**Reviews & receipts** lists everything that was approved and done.",
    ],
    keywords: ["activity", "jobs", "receipts", "history", "log", "approvals"],
    related: ["job-page", "approvals"],
  },
  {
    id: "agent-computer",
    group: "jobs",
    title: "{agent}’s browser",
    summary: "Watch {agent} work on a website, or take control to do a step yourself.",
    place: "agent-computer",
    steps: [
      "Open **☰ Menu › {agent}’s browser**. Beside it, **Ready**, **In use** or **Offline** says how it is.",
      "It lists the websites {agent} used. Tap **Take control** on one to sign in or finish something yourself.",
      "If it’s offline, {agent} can’t open or use websites until the browser is back; tap **Check again**.",
    ],
    body: [
      "Each website {agent} opens keeps its own sign-ins and downloads. What you do there is real: it’s a live website, and there’s no Approve step for what you click yourself.",
    ],
    keywords: ["computer", "browser", "take control", "session", "terminal", "remote"],
    related: ["website-jobs"],
  },

  // Spaces
  {
    id: "spaces-overview",
    group: "spaces",
    title: "What Spaces are",
    summary: "Areas of your life {agent} runs for you: Health, a Family planner and Social media.",
    shot: "spaces",
    place: "spaces",
    steps: [
      "Open **Spaces** in the bottom bar.",
      "Tap a space to open it. Each has an **Overview**, its history, and a **Playbook** of how you want it run.",
      "To start one, tap **Start a family planner** or **Start a social media space**. If a space is open, tap **All spaces** first.",
    ],
    body: ["Each space has its own chat: questions there follow that space’s playbook."],
    keywords: ["spaces", "health", "family", "social", "playbook"],
    related: ["health", "family", "social", "playbook"],
  },
  {
    id: "health",
    group: "spaces",
    title: "Health: meals, exercise and weight",
    summary: "What you eat, your workouts and your weight, with charts by day and week.",
    shot: "health",
    place: "health",
    steps: [
      "Open **Spaces › Health**.",
      "**Overview:** today’s calories, protein and exercise, a chart of the week, and your **Weight**.",
      "**Food log:** every meal as a table. **Food plan:** the family’s planned dinners next to what was eaten.",
      "**Playbook:** your goals, food rules, daily targets and meal check-ins.",
    ],
    say: [
      { text: "What did I eat today?", send: true },
      { text: "How did this week go?", send: true },
    ],
    keywords: ["health", "calories", "protein", "nutrition", "diet", "exercise", "charts"],
    related: ["log-meal", "weight", "workouts", "meal-checkins"],
  },
  {
    id: "weight",
    group: "spaces",
    title: "Track your weight",
    summary: "Tell {agent} your weight and see how it’s changing, in pounds.",
    shot: "weight",
    place: "health",
    steps: [
      "Say “I weighed 173 this morning,” or open **Spaces › Health** and find **Weight**.",
      "Type today’s weight in **Today’s weight (lb)** and tap **Save**.",
      "The chart shows the last 90 days; the line under your weight says how it changed.",
      "Remove a wrong one with the **×** next to it, or just tell {agent}.",
    ],
    body: ["One weigh-in a day: saving again the same day changes that day’s weight."],
    say: ["I weighed 173 this morning.", { text: "How’s my weight going?", send: true }],
    keywords: ["weight", "weigh", "scale", "pounds", "lb", "lbs", "kilos", "kg"],
    related: ["health"],
  },
  {
    id: "log-meal",
    group: "spaces",
    title: "Log a meal",
    summary: "Say or type what you ate; {agent} estimates calories, protein, carbs and fat.",
    place: "log-meal",
    steps: [
      "Just tell {agent}: “I had a chicken salad and iced tea for lunch.” A photo works too.",
      "Or open **Spaces › Health › Log a meal**, say or type it, and save.",
      "To fix one, open the **Food log** and tap **Change**, or just tell {agent}.",
    ],
    body: ["The numbers are estimates unless you change them."],
    say: ["Log my breakfast: two eggs and toast."],
    keywords: ["meal", "food", "log", "calories", "eat", "lunch", "dinner", "breakfast"],
    related: ["meal-checkins", "food-log"],
  },
  {
    id: "meal-checkins",
    group: "spaces",
    title: "Ask me what I ate",
    summary: "{agent} asks at each meal, and you answer by voice or text.",
    place: "health-playbook",
    steps: [
      "Say “Ask me what I ate at every meal,” or open **Spaces › Health › Playbook**.",
      "Choose the times (8:30 am, 12:30 pm and 6:30 pm unless you change them).",
      "At each time you get a notification and a card in the chat. Tap the mic and say it.",
    ],
    body: ["If you already logged that meal, you won’t be asked."],
    say: ["Ask me what I ate at every meal."],
    keywords: ["check-in", "meal reminder", "ask", "notification"],
    related: ["log-meal", "playbook"],
  },
  {
    id: "food-log",
    group: "spaces",
    title: "Food log and food plan",
    summary: "Every meal you logged, and the family’s planned dinners next to what was eaten.",
    place: "health-food-log",
    more: ["health-food-plan"],
    steps: [
      "Open **Spaces › Health › Food log**. Choose **Today**, **This week** or **30 days**.",
      "Tap **Change** on a meal to fix it.",
      "**Food plan** shows the Family space’s dinners next to what you ate.",
    ],
    keywords: ["food log", "meals", "table", "history", "food plan"],
    related: ["log-meal", "family"],
  },
  {
    id: "workouts",
    group: "spaces",
    title: "Guided workouts",
    summary: "{agent} designs a workout for your time and equipment and coaches you through it.",
    steps: [
      "Ask: “Coach me through a 20-minute workout, no equipment.”",
      "Tap **Start** on the workout card and follow along.",
      "Past workouts are on **Spaces › Health › Overview** to start again.",
    ],
    body: ["Check with a doctor first if you have an injury or a medical condition."],
    say: ["Give me a 15-minute stretch."],
    keywords: ["workout", "exercise", "training", "fitness", "coach"],
    related: ["health"],
  },
  {
    id: "family",
    group: "spaces",
    title: "Family planner",
    summary: "This week’s dinners with recipes, groceries, the schedule and chores, in one place.",
    shot: "family",
    place: "family",
    more: ["family-weeks"],
    steps: [
      "Open **Spaces** and tap **Start a family planner** (or open it if you have one). If a space is open, tap **All spaces** first.",
      "**Overview** is this week’s board: dinners (tap one for its recipe), groceries, who’s where when, and chores.",
      "Tap **Plan this week** or ask {agent} to plan it.",
      "**Our weeks** keeps past weeks and chore stars.",
    ],
    body: ["A short note comes each morning with today’s schedule, dinner and chores."],
    say: ["Plan our dinners for this week.", "Add milk to the grocery list."],
    keywords: ["family", "dinners", "recipes", "groceries", "chores", "schedule", "meal plan"],
    related: ["playbook", "food-log"],
  },
  {
    id: "social",
    group: "spaces",
    title: "Social media space",
    summary: "Posts planned and written for you, waiting for your OK before they go out.",
    place: "social",
    more: ["social-results"],
    steps: [
      "Open **Spaces › Social media**.",
      "**Overview:** posts waiting for your OK, this week and what’s coming up.",
      "Approve a post and it goes out at its time. **Results** shows reach and past posts.",
    ],
    say: ["Write three posts about our fall sale."],
    keywords: ["social", "posts", "instagram", "facebook", "schedule", "marketing"],
    related: ["playbook", "approvals"],
  },
  {
    id: "playbook",
    group: "spaces",
    title: "Playbooks",
    summary: "How you want a space run: its goals, rules and timings.",
    place: "health-playbook",
    more: ["family-playbook", "social-playbook"],
    steps: [
      "Open a space and tap **Playbook**.",
      "Change any part, or ask {agent} in that space’s chat.",
    ],
    keywords: ["playbook", "rules", "settings", "preferences", "goals"],
    related: ["spaces-overview"],
  },

  // Apps and connections
  {
    id: "connect-apps",
    group: "apps",
    title: "Connect your apps",
    summary:
      "Gmail, Outlook, Google Calendar, Slack and 1,000 more: sign in once and {agent} can use them.",
    shot: "apps",
    place: "apps",
    steps: [
      "Open **Apps**, or just say “Connect my Gmail.”",
      "Search for the app.",
      "Tap **Connect** and sign in on the app’s own page.",
      "Come back to Neato_Muse. It shows **Connected**.",
    ],
    body: [
      "On a call or in the chat, a **Connect** card appears right where you are. Signing in happens on the app’s own page; {agent} never sees your password.",
    ],
    say: [
      { text: "Connect my Gmail.", send: true },
      { text: "Which apps are connected?", send: true },
    ],
    keywords: ["connect", "gmail", "outlook", "slack", "integrations", "sign in", "apps"],
    related: ["app-permissions", "fix-reconnect", "gmail-two"],
  },
  {
    id: "gmail-two",
    group: "apps",
    title: "Your email and calendar apps",
    summary: "{agent} uses the Gmail, Outlook or Google Calendar you connect under Apps.",
    place: "apps",
    body: [
      "Connect your email and calendar under **Apps** (see “Connect your apps”). That’s the connection {agent} uses, in the chat, on calls and in jobs.",
      "If {agent} ever says it can’t reach an app you connected, see “{agent} says it can’t reach an app I connected”.",
      "Ask “Do I have any emails I need to respond to?” {agent} checks every mailbox you’ve connected (Gmail, Outlook or both) and what you’ve already sent. It tells you what needs action, including security alerts and failed payments, and what doesn’t.",
    ],
    say: [{ text: "Do I have any emails I need to respond to?", send: true }],
    keywords: [
      "gmail",
      "google",
      "outlook",
      "email",
      "calendar",
      "mailbox",
      "respond",
      "reply",
      "needs a reply",
      "inbox",
      "unanswered",
      "need me",
      "important emails",
      "did I reply",
      "respond to",
    ],
    related: ["connect-apps", "fix-no-access"],
  },
  {
    id: "own-apps",
    group: "apps",
    title: "Connect your own app",
    summary:
      "Add any app that offers an MCP server (a web address made for AI assistants), like your note-taking app.",
    place: "apps",
    steps: [
      "Say “Connect my notes app at https://…”, or open **Apps › Your own apps › Add an app**.",
      "Give it a name and its https address, and a key if it uses one.",
      "Tap **Connect**, and sign in on the app’s page if it asks.",
    ],
    body: [
      "It must be reachable on the internet over https; home and private addresses don’t work.",
    ],
    keywords: ["mcp", "own app", "custom", "server", "add app"],
    related: ["connect-apps"],
  },
  {
    id: "app-permissions",
    group: "apps",
    title: "Read only or full access",
    summary: "Choose, app by app, whether {agent} can only look things up or also make changes.",
    place: "apps",
    steps: [
      "Open **Apps › App permissions**.",
      "Set an app to **Read only** and {agent} can look things up there but never send, create or change anything, even with your OK.",
    ],
    keywords: ["permissions", "read only", "access", "write", "safety"],
    related: ["always-allowed", "approvals"],
  },
  {
    id: "always-allowed",
    group: "apps",
    title: "Let small things go ahead",
    summary: "Skip the Approve step for chosen low-risk actions.",
    place: "apps",
    steps: [
      "When you approve something, you can choose to always allow that kind of action.",
      "See and undo them under **Apps › Always allowed**.",
    ],
    body: [
      "Purchases always ask.",
      "To stop the asking for just one job, tick **Let this job do its other … steps without asking** when you approve one of its steps. **Ask me each time** on the job’s page undoes it.",
    ],
    keywords: [
      "always allow",
      "auto approve",
      "skip approval",
      "trust",
      "rest of this job",
      "too many approvals",
      "stop asking",
      "keeps asking",
      "without asking",
    ],
    related: ["approvals", "app-permissions"],
  },
  {
    id: "agent-email",
    group: "apps",
    title: "{agent}’s own email address",
    summary:
      "Forward email to {agent} to hand it work: a bill, a trip confirmation, a thread to follow up.",
    place: "agent-settings",
    steps: [
      "Find the address under **Apps › Agent › Agent email** (and **Apps › Account**).",
      "Forward or send email to it; attachments included.",
      "Only senders you approve there can give it work; anything else is held.",
    ],
    keywords: ["agent email", "forward", "address", "inbox", "send to"],
    related: ["email-alerts"],
  },
  {
    id: "location",
    group: "control",
    title: "Share your location",
    summary:
      "Let {agent} know your location right now, for what’s nearby and help while you’re out. Off until you turn it on.",
    shot: "location",
    place: "account",
    steps: [
      "Open **Apps › Account › Your location** and tick **Share where I am while the app is open**. Your browser asks once; tap **Allow**.",
      "Ask “Where am I?” or “Find a coffee shop near me”, in the chat or on a call.",
      "To stop, untick it, or say “Turn off my location”.",
    ],
    body: [
      "It’s shared only while the app is open on your screen (when your phone locks, it stops until you open the app again). Only your latest spot is kept, never saved for good, and it’s forgotten after an hour or as soon as you turn it off. To name the street, your spot is sent to OpenStreetMap, a free map service.",
      "Weather and local news still use your home city (on the Feed). Live traffic isn’t included yet.",
    ],
    say: [{ text: "Where am I?", send: true }, "Turn off my location"],
    keywords: [
      "location",
      "gps",
      "my location",
      "current location",
      "near me",
      "nearby",
      "privacy",
    ],
    related: ["urgent-alerts", "live-call"],
  },
  {
    id: "urgent-alerts",
    group: "talk",
    title: "Urgent alerts on calls",
    summary:
      "During a call, {agent} speaks up straight away about what can’t wait: time to leave, security alerts, money problems, and people you choose.",
    shot: "urgent",
    place: "alerts",
    steps: [
      "Open **Apps › Alerts › Urgent alerts on calls**.",
      "Tick the kinds you want: **Time to leave**, **Security alerts**, **Money problems**, **People you choose**. All four are on to start with.",
      "Under **People you choose**, add an email address, or a name exactly as it shows on their emails; email from them counts as urgent.",
      "Or just say it: “Stop telling me about money alerts on calls”, or “Tell me straight away if Mom emails.”",
    ],
    body: [
      "Time to leave is said about 15 minutes before something on your calendar starts (it doesn’t know about traffic yet). Security, money and people alerts come from your connected email and app alerts, so email alerts need to be on.",
      "Everything else stays a normal notification. If {agent} can’t break in at once, it tells you first thing in its next answer. Alerts say who they’re from and the subject out loud, so keep that in mind on speakerphone; sign-in codes are never read out.",
    ],
    say: [
      { text: "What urgent alerts are on?", send: true },
      "Stop telling me about money alerts on calls",
    ],
    keywords: [
      "urgent",
      "alerts on calls",
      "interrupt me",
      "speak up",
      "time to leave",
      "security alert",
      "money alert",
      "important people",
      "vip",
    ],
    related: ["live-call", "email-alerts", "app-alerts"],
  },
  {
    id: "email-alerts",
    group: "apps",
    title: "New-email alerts and email rules",
    summary:
      "Hear about new email right away, and have {agent} act on email from people you choose.",
    place: "alerts",
    steps: [
      "Open **Apps › Alerts › Email alerts** and turn them on (Gmail or Outlook must be connected).",
      "Add a rule, or just say: “When Dana emails me, sum it up and draft a reply.”",
    ],
    say: ["Tell me when new email comes in.", "When my boss emails, sum it up for me."],
    keywords: ["email alerts", "rules", "new mail", "inbox", "automation"],
    related: ["app-alerts", "plans"],
  },
  {
    id: "app-alerts",
    group: "apps",
    title: "Alerts from your other apps",
    summary: "Hear about a new Calendly booking, a Slack message or a GitHub issue as it happens.",
    place: "alerts",
    steps: [
      "Ask: “Tell me when someone books a Calendly meeting.”",
      "{agent} finds the right alert for that app and turns it on. They’re listed under **Apps › Alerts › App alerts**.",
    ],
    keywords: ["app alerts", "calendly", "slack", "webhook", "trigger"],
    related: ["email-alerts"],
  },

  // Files and documents
  {
    id: "files",
    group: "files",
    title: "Files & media",
    summary: "Your photos, documents, mini apps and everything {agent} saved.",
    shot: "files",
    place: "files",
    steps: [
      "Open **Files** in the bottom bar.",
      "Tap a file to open it. Tap **List** for a compact list.",
      "**Mini apps** and **Saved by {agent}** are further down.",
    ],
    keywords: ["files", "documents", "photos", "media", "pdf", "storage"],
    related: ["make-documents", "saved-results", "share-files"],
  },
  {
    id: "make-documents",
    group: "files",
    title: "Make documents, spreadsheets and slides",
    summary: "{agent} writes Word documents, PDFs, spreadsheets and slide decks.",
    steps: [
      "Ask: “Write a one-page proposal as a Word document.”",
      "Tap the file in the chat to open it. It’s saved in **Files & media** too.",
    ],
    body: [
      "{agent} also reads PDFs, Word, Excel and PowerPoint files you send, and can work with numbers and charts.",
    ],
    say: [
      "Make a spreadsheet of my subscriptions.",
      { text: "Turn this into slides.", where: "after you add a file" },
    ],
    keywords: ["word", "pdf", "excel", "spreadsheet", "slides", "powerpoint", "document", "write"],
    related: ["files", "share-files"],
  },
  {
    id: "saved-results",
    group: "files",
    title: "Saved by {agent}",
    summary: "Every report, comparison, plan and finance tracker {agent} saved for you.",
    place: "saved",
    steps: ["Open **Files** and scroll to **Saved by {agent}**.", "Tap a title to open it."],
    keywords: ["reports", "saved", "comparisons", "results", "research"],
    related: ["files"],
  },
  {
    id: "share-files",
    group: "files",
    title: "Share a file or mini app by link",
    summary: "Send anyone a link to a file or a mini app.",
    steps: [
      "Open the file, choose how long the link works, and tap **Make a share link** (or ask “Share this with a link.”).",
      "Send the link. **Copy link** copies it again; **Stop sharing** turns it off.",
    ],
    body: [
      "Anyone with the link can see it, including changes made later, until the time you chose runs out.",
    ],
    keywords: ["share", "link", "send", "public"],
    related: ["files", "mini-apps"],
  },
  {
    id: "mini-apps",
    group: "files",
    title: "Mini apps",
    summary:
      "Small tools and dashboards {agent} builds for you: a planner, a checklist, a calculator.",
    steps: [
      "Ask: “Make me a packing checklist for our beach trip.”",
      "Open it from the chat, or later from **Files › Mini apps**.",
      "Ask for changes any time, or share it by link.",
    ],
    say: ["Make me a budget dashboard."],
    keywords: ["mini app", "tool", "dashboard", "calculator", "checklist", "planner"],
    related: ["share-files"],
  },
  {
    id: "import-files",
    group: "files",
    title: "Bring in files from Drive, OneDrive or Dropbox",
    summary: "Share a link and {agent} saves the file to Files.",
    steps: [
      "Copy a share link from Google Drive, OneDrive or Dropbox.",
      "Paste it in the chat: “Save this to my files.”",
    ],
    keywords: ["google drive", "onedrive", "dropbox", "import", "download"],
    related: ["files"],
  },

  // What the agent knows
  {
    id: "about-you",
    group: "you",
    title: "About you",
    summary: "What {agent} knows about you, by group, to check, change or forget.",
    shot: "about",
    place: "memory",
    steps: [
      "Open **Apps › About you**.",
      "Facts are grouped: You, Work, Home and family, Email and apps, How I help. Each says where it came from.",
      "Tap one to change it or forget it. A guess can be confirmed.",
      "Tap **Answer a few questions** and {agent} fills it in with you.",
    ],
    body: [
      "Your **Home address** lives here (under Home and family). {agent} uses it only when something you asked for needs it, like a delivery or directions; anything sent or bought still waits for your OK.",
      "It never keeps health conditions, religion, politics, account numbers or passwords here.",
    ],
    say: [
      "Remember my address is 123 Oak St, Houston.",
      { text: "What do you know about me?", send: true },
    ],
    keywords: [
      "about me",
      "my name",
      "change my name",
      "what you call me",
      "profile",
      "persona",
      "facts",
      "address",
      "personal",
      "forget",
    ],
    related: ["memories", "people-notes"],
  },
  {
    id: "memories",
    group: "you",
    title: "Memories and suggestions",
    summary: "{agent} suggests things to remember from your chats; you keep the right ones.",
    place: "memory",
    steps: [
      "Open **Apps › About you**. **Suggested from your chats** is at the top: tap **Keep** or **Dismiss**.",
      "**Other things I remember** lists everything else. Correct or forget any of them.",
      "Add one yourself under **Something else I should remember**.",
    ],
    say: ["Remember I prefer morning meetings.", "Forget that I like sushi."],
    keywords: ["memory", "remember", "forget", "suggestions", "preferences"],
    related: ["about-you"],
  },
  {
    id: "people-notes",
    group: "you",
    title: "People notes",
    summary:
      "A page on each person and group in your life, which {agent} reads before writing to them.",
    place: "agent-settings",
    steps: [
      "Mention people in the chat; {agent} adds what’s worth remembering.",
      "See them under **Apps › Agent › People & groups**.",
    ],
    say: ["Dana is my sister; her birthday is May 3."],
    keywords: ["people", "contacts", "family", "friends", "birthdays", "notes"],
    related: ["about-you"],
  },
  {
    id: "import-chatgpt",
    group: "you",
    title: "Bring your ChatGPT or Claude history",
    summary:
      "Upload your export so {agent} can search your old chats, and keep your ChatGPT memories.",
    place: "memory",
    steps: [
      "In ChatGPT or Claude, ask for a data export; you get a .zip by email.",
      "Open **Apps › About you**: under **Chats from ChatGPT and Claude**, tap **Upload a ChatGPT or Claude export** (from a web browser for big files).",
      "For ChatGPT memories, copy the list from ChatGPT’s **Settings › Personalization › Manage memories**, paste it under **Memories from ChatGPT** and tap **Import pasted memories**.",
    ],
    keywords: ["chatgpt", "claude", "import", "export", "history", "zip", "memories"],
    related: ["past-chats", "memories"],
  },

  // You're in control
  {
    id: "approvals",
    group: "control",
    title: "Approve before anything happens",
    summary:
      "Sending, buying, booking or changing things in your apps waits for you to tap Approve.",
    shot: "approve",
    place: "reviews",
    steps: [
      "An **Approve** card appears where you are: in the chat, on a call’s screen, in Activity, or on the job’s page (tap **Open** on its pop-up).",
      "It says what will happen. **See details** shows all of it, including which account.",
      "Tap **Approve** to go ahead (it may say **Approve & send**, **Approve & run** or **Approve purchase**). To say no, tap **Don’t proceed** (on a job’s page it’s on the card; elsewhere, open **See details**).",
    ],
    body: [
      "Approvals expire after a while; if one has, ask {agent} again. You can say “Show me what’s waiting for my OK” any time.",
      "**On a call, approve by voice:** say “approve it” or “what’s waiting?”. {agent} reads back exactly what each one is; say “yes, approve”, “approve all”, or which ones (“the email, not the calendar one”). Only your own yes counts. Anything involving money (purchases and payments) or a sign-in code still needs a tap.",
      "Anything you’ve marked as always allowed goes ahead without asking (see “Let small things go ahead”); purchases always ask.",
      "A job that needs several steps in one app: when you approve the first one, tick **Let this job do its other … steps without asking**, and its later steps in that app go ahead. Deleting, cancelling and paying still ask. To undo it, tap **Ask me each time** on the job’s page.",
    ],
    say: [{ text: "What’s waiting for my OK?", send: true }],
    keywords: [
      "approve",
      "approval",
      "confirm",
      "permission",
      "decline",
      "review",
      "my ok",
      "needs my ok",
      "waiting for my ok",
      "approve by voice",
      "approve all",
      "keeps asking",
      "asks again",
      "every time",
    ],
    related: ["always-allowed", "see-it", "fix-approval"],
  },
  {
    id: "spending",
    group: "control",
    title: "Spending limits",
    summary: "Purchases are off until you turn them on, then capped per purchase and per month.",
    shot: "money",
    place: "money",
    steps: [
      "Open **Apps › Money**.",
      "Turn on purchases and set the most for one purchase and the most per month.",
      "Every purchase still waits for your OK. This month’s purchases and a chart by month are below.",
    ],
    keywords: ["money", "spending", "limit", "buy", "purchase", "budget", "payments"],
    related: ["approvals", "usage"],
  },
  {
    id: "subscriptions",
    group: "control",
    title: "Find your subscriptions",
    summary: "{agent} finds the charges that repeat, totals them and says how to cancel each.",
    place: "goals",
    steps: [
      "Say “Find my subscriptions,” or tap **Find my subscriptions** on **Goals**.",
      "{agent} looks through your email receipts and any card app you connected (like Brex).",
      "You get a list with the total and how to cancel each one. Nothing is cancelled without you.",
    ],
    say: [{ text: "Find my subscriptions.", send: true }],
    keywords: ["subscriptions", "recurring", "charges", "cancel", "netflix", "save money"],
    related: ["spending", "goals"],
  },
  {
    id: "passwords",
    group: "control",
    title: "Website passwords",
    summary: "Save a site’s password so {agent} can sign in for you; it never sees it.",
    place: "account",
    steps: [
      "Open **Apps › Account › Passwords** and tap **Add a password**.",
      "Fill in the website, your username or email and the password, and save.",
      "Keep **Ask me before each sign-in** on, unless you want {agent} to sign in without asking.",
    ],
    body: [
      "Never share a password in the chat. The password is typed in only on that website.",
      "For sites with two-step sign-in, you can add the authenticator key so {agent} can enter the codes too.",
    ],
    keywords: ["password", "login", "vault", "2fa", "authenticator", "sign in", "security"],
    related: ["website-jobs"],
  },
  {
    id: "your-data",
    group: "control",
    title: "Download or delete your data",
    summary: "Take a copy of everything, or start fresh.",
    place: "account",
    steps: [
      "Open **Apps › Account › Your data**.",
      "**Download my data** gets a copy of your chats, memories, jobs, goals, routines, reminders, health log and files.",
      "**Reset my agent…** deletes them for good (type RESET to confirm). Your account, connected apps and email stay.",
    ],
    keywords: ["export", "download", "delete", "reset", "privacy", "data", "start over"],
    related: ["privacy"],
  },
  {
    id: "privacy",
    group: "control",
    title: "Your space is private",
    summary: "Your chats, memory, files and apps are yours alone.",
    body: [
      "Other people using this Neato_Muse can’t see your chats, memory, files, connected apps or spending.",
      "Email, web pages and documents are treated as information, never as instructions: an email can’t tell {agent} to do something.",
    ],
    keywords: ["privacy", "private", "security", "safe", "who can see"],
    related: ["your-data", "approvals"],
  },

  // Settings and alerts
  {
    id: "agent-settings",
    group: "settings",
    title: "Name, look and tone",
    summary: "Rename {agent}, pick its look and choose how it talks.",
    shot: "agent",
    place: "agent-settings",
    steps: [
      "Open **Apps › Agent**.",
      "Pick a character and colour; it saves straight away.",
      "Change the **Name** and **Tone** (Warm, Concise or Thoughtful).",
      "Tap **Save name and settings**.",
    ],
    keywords: ["name", "avatar", "look", "tone", "personality", "rename", "character"],
    related: ["appearance"],
  },
  {
    id: "backdrop",
    group: "settings",
    title: "Moving backdrop",
    summary:
      "A moving scene behind the app: a beach at sunset, mountains, a city at night, rain, a forest or the night sky. Pick one, hold it still, or turn it off.",
    shot: "backdrop",
    place: "backdrop",
    steps: [
      "Open **Menu (☰, top left) › Backdrop**.",
      "Tap a scene. It changes behind the app straight away, and every device you use follows.",
      "Tick **Hold still** to stop the movement and save battery.",
      "To go back to the plain look, tap **No backdrop** under **Plain**. The app reopens to switch.",
    ],
    body: [
      "The scene pauses by itself during calls, when you haven’t touched the app for a minute and a half, on low battery or data saver, and when your device is set to reduce motion. Backdrops play in the web app, on your phone or computer.",
      "While a backdrop is on, the app uses its dark look so text stays easy to read.",
    ],
    say: ["Change my backdrop to the city", "Hold the backdrop still", "Turn off the backdrop"],
    keywords: [
      "backdrop",
      "background",
      "wallpaper",
      "scene",
      "video",
      "beach",
      "city",
      "northern lights",
      "moving background",
      "battery",
    ],
    related: ["appearance"],
  },
  {
    id: "appearance",
    group: "settings",
    title: "Light or dark",
    summary: "Choose light, dark or match your device. With a backdrop on, the app stays dark.",
    place: "account",
    steps: ["Open **Apps › Account › Appearance** and choose."],
    keywords: ["dark mode", "light mode", "theme", "appearance", "colors", "colours"],
    related: ["backdrop", "agent-settings"],
  },
  {
    id: "notifications",
    group: "settings",
    title: "Notifications on your phone",
    summary: "Get notified about reminders, finished jobs and anything that needs you.",
    place: "alerts",
    steps: [
      "On iPhone, first add the app to your home screen and open it from there.",
      "Open **Apps › Alerts › Phone app & notifications** and turn them on.",
      "Allow notifications when your phone asks.",
    ],
    keywords: ["notifications", "push", "alerts", "phone", "iphone", "android"],
    related: ["home-screen", "fix-notifications", "job-alerts"],
  },
  {
    id: "job-alerts",
    group: "settings",
    title: "When a job is done",
    summary:
      "Choose how you hear when a job finishes or needs you: in the app, a notification, or an email.",
    place: "alerts",
    steps: ["Open **Apps › Alerts › Jobs you hand off** to choose how you hear about jobs."],
    keywords: ["job done", "finished", "email", "notification", "alerts"],
    related: ["notifications", "new-job"],
  },
  {
    id: "microphone",
    group: "settings",
    title: "Choose a microphone",
    summary: "Pick which microphone {agent} hears, like a headset instead of your laptop.",
    place: "agent-settings",
    steps: [
      "Open **Apps › Agent › Voice**, or, where live talk isn’t on, the arrow next to the mic in the chat.",
      "Speak: the bars move next to each microphone that hears you. Pick that one.",
    ],
    keywords: ["microphone", "mic", "headset", "audio", "input", "can't hear"],
    related: ["fix-call", "speak-and-listen"],
  },
  {
    id: "usage",
    group: "settings",
    title: "AI usage",
    summary: "What the AI behind {agent} has cost: today, the last 7 days, all time and by month.",
    place: "money",
    steps: [
      "Open **Apps › Money › Usage**.",
      "Three boxes at the top show **Today**, **Last 7 days** and **All time**. Each gives about what the AI cost, how many tokens it used, and how many AI calls it made.",
      "Under them are this month’s costs by kind of work and a chart by month. If more than one person uses {agent}, the admin also sees **Everyone together**.",
    ],
    body: [
      "A token is a small piece of text, about three-quarters of a word.",
      "Costs are estimates from the models’ published prices; the AI provider’s actual bill may differ a little. **Last 7 days** is today and the six days before, and starts short because day-by-day numbers began on the date shown under the boxes.",
    ],
    say: [{ text: "How much has the AI cost this week?", send: true }],
    keywords: [
      "usage",
      "cost",
      "tokens",
      "billing",
      "how much",
      "price",
      "is it free",
      "today",
      "this week",
      "last 7 days",
      "spent on ai",
    ],
    related: ["spending", "admin-models", "admin-usage"],
  },
  {
    id: "new-version",
    group: "settings",
    title: "Getting the newest version",
    summary: "When the app is updated, “A new version is ready” shows at the top.",
    steps: [
      "When “A new version is ready” shows at the top, tap **Reload**, or close and reopen the app.",
      "It never reloads during a call; it waits until the call is over.",
    ],
    keywords: ["update", "new version", "reload", "refresh", "latest"],
    related: ["fix-look"],
  },
  {
    id: "sign-out",
    group: "settings",
    title: "Sign out",
    summary: "Sign out of this device.",
    place: "account",
    steps: ["Open **Apps › Account** and tap **Sign out of this device**."],
    keywords: ["sign out", "log out", "logout"],
    related: ["sign-in"],
  },

  // Fix a problem
  {
    id: "fix-sign-in-link",
    group: "fix",
    title: "My sign-in link doesn’t work",
    summary: "Links work once and expire; ask for a new one.",
    body: [
      "Each link works once. Sign-in links last 15 minutes and invite links 3 days. Ask for a new one on the sign-in screen.",
      "Using the app from an iPhone home screen? Links open in Safari. Press and hold the link in the email, tap **Copy**, and paste it in the code box on the sign-in screen.",
    ],
    keywords: [
      "link",
      "expired",
      "sign in link",
      "link expired",
      "link doesnt work",
      "didnt get the email",
      "no email",
      "code doesnt work",
      "wrong code",
      "login",
      "invite",
    ],
    related: ["sign-in"],
  },
  {
    id: "fix-reconnect",
    group: "fix",
    title: "An app needs reconnecting",
    summary:
      "Apps sometimes sign you out. Ask {agent} to reconnect it, or tap Reconnect under Apps.",
    steps: [
      "Say “Reconnect my Gmail”, and tap **Connect** on the card.",
      "Or open **Apps**, find the app and tap **Reconnect**.",
    ],
    keywords: ["reconnect", "expired", "disconnected", "signed out", "app"],
    related: ["connect-apps"],
  },
  {
    id: "fix-no-access",
    group: "fix",
    title: "{agent} says it can’t reach an app I connected",
    summary: "Check the app is connected, then ask again.",
    steps: [
      "Ask “Which apps are connected?” or look under **Apps**.",
      "If the app shows **Reconnect**, tap it and sign in again.",
      "Ask again. If it still says no, tell {agent} “My Gmail is connected under Apps,” and tell the person who runs Neato_Muse what you asked.",
    ],
    keywords: ["can't access", "no access", "not connected", "gmail", "doesn't work", "job"],
    related: ["fix-reconnect", "gmail-two"],
  },
  {
    id: "fix-website-blocked",
    group: "fix",
    title: "A website turned {agent} away",
    summary: "Some sites block automated browsers; you can finish on your phone.",
    body: [
      "Some sites, like OpenTable, block automated browsers. {agent} gives you a link with the details filled in; tap it to finish on your phone.",
      "In a job, tap **Open browser** and do the step yourself, then answer “Done”.",
    ],
    keywords: ["blocked", "captcha", "robot", "website", "denied", "opentable"],
    related: ["website-jobs"],
  },
  {
    id: "fix-notifications",
    group: "fix",
    title: "I’m not getting notifications",
    summary: "Check the app’s setting and your phone’s.",
    steps: [
      "On iPhone, add Neato_Muse to your home screen and open it from there.",
      "Turn notifications on in **Apps › Alerts › Phone app & notifications**.",
      "Check that your phone’s settings allow notifications for it.",
    ],
    keywords: ["notifications", "not getting", "push", "silent", "alerts"],
    related: ["notifications"],
  },
  {
    id: "fix-call",
    group: "fix",
    title: "A call won’t start, or {agent} can’t hear me",
    summary: "Usually the microphone: allow it, or pick the right one.",
    steps: [
      "If your browser blocked the microphone, tap the icon beside the web address, allow the microphone, and try again.",
      "Pick the microphone you’re using under **Apps › Agent › Voice**.",
      "Check your internet connection. If there’s no headset button even with the message box empty, live talk isn’t turned on yet: ask the person who runs Neato_Muse.",
    ],
    keywords: ["call", "microphone", "can't hear", "no sound", "won't start", "headset", "voice"],
    related: ["microphone", "live-call"],
  },
  {
    id: "fix-nothing-on-screen",
    group: "fix",
    title: "{agent} said it’s on my screen, but I don’t see it",
    summary: "Look for See it on the call bar, or the card in the chat.",
    body: [
      "On a shrunk call, it’s behind **See it** on the bar at the top. Tap the bar to go back to the call screen.",
      "After a call, it’s in your chat with the saved call. Things waiting for your OK also come up when you say “What’s waiting for my OK?”",
    ],
    keywords: ["screen", "don't see", "missing", "card", "see it"],
    related: ["see-it", "approvals"],
  },
  {
    id: "fix-approval",
    group: "fix",
    title: "An Approve button doesn’t work",
    summary: "It may have expired, or been decided already.",
    body: [
      "Approvals expire after a while, and one can’t be approved twice. Ask {agent} to set it up again, then approve the new card.",
    ],
    keywords: ["approve", "expired", "doesn't work", "button"],
    related: ["approvals"],
  },
  {
    id: "fix-wrong",
    group: "fix",
    title: "{agent} got something wrong",
    summary: "Tell it, fix what it remembers, or retry a reply that didn’t go through.",
    body: [
      "Just say so: “No, I prefer morning meetings.” To fix something it remembers, open **Apps › About you**.",
      "If a reply didn’t finish (“I reached my step limit”), say “continue”.",
      "If a reply didn’t go through, tap **Retry response**. If it keeps happening in one chat, start a new chat (the chat button under {agent}’s name › **New chat**) and tell the person who runs Neato_Muse what the error said.",
    ],
    keywords: [
      "wrong",
      "mistake",
      "incorrect",
      "bad answer",
      "correct",
      "error",
      "undo",
      "didn't go through",
      "failed",
      "retry",
    ],
    related: ["about-you", "memories"],
  },
  {
    id: "fix-worker-offline",
    group: "fix",
    title: "It says the worker is offline",
    summary: "Background work pauses for a moment, often during an update.",
    body: [
      "Your saved work carries on by itself when it reconnects. Try again in a minute or two.",
    ],
    keywords: ["offline", "worker", "paused", "stuck", "not working"],
    related: ["new-version"],
  },
  {
    id: "fix-look",
    group: "fix",
    title: "The app looks old, or the icon didn’t change",
    summary: "Load the new version, or add the app to your home screen again.",
    body: [
      "Tap **Reload** on “A new version is ready”, or close and reopen the app. For a new home-screen icon, remove the app from your home screen and add it again.",
    ],
    keywords: ["old", "icon", "cache", "update", "refresh", "outdated"],
    related: ["new-version", "home-screen"],
  },
  {
    id: "fix-still-stuck",
    group: "fix",
    title: "Still stuck?",
    summary: "Ask {agent}, or the person who runs Neato_Muse.",
    body: [
      "Ask {agent} “How do I…?”: it answers from this guide.",
      "Or ask the person who runs Neato_Muse. Say what you tapped and what you saw.",
    ],
    keywords: ["help", "support", "contact", "stuck", "problem"],
    related: ["welcome"],
  },

  // For the admin
  {
    id: "admin-people",
    group: "admin",
    admin: true,
    title: "Invite people and answer access requests",
    summary: "Each person gets a private space and their own agent address.",
    place: "account",
    steps: [
      "Open **Apps › Account › People**.",
      "Fill in a name and email and tap **Send invite**; they get a sign-in email (needs email sign-in; see “Sign-in emails and the agent’s email address”).",
      "Requests from **Request access** on the sign-in screen are listed there to invite or decline.",
      "**Remove access** signs a person out everywhere and stops their routines; their data is kept so access can be restored.",
    ],
    keywords: ["invite", "people", "users", "accounts", "access requests", "remove"],
    related: ["admin-email"],
  },
  {
    id: "admin-models",
    group: "admin",
    admin: true,
    title: "Choose which AI model does which job",
    summary:
      "Chat, background jobs and simple jobs can each use a different model, to keep costs down.",
    shot: "models",
    place: "money",
    steps: [
      "Open **Apps › Money › AI models**.",
      "Tap **Change** next to a kind of work, pick a model and how hard it thinks, then tap **Save**. It applies to everyone: from the next message, and to jobs that start after it.",
      "**Claude, as before** puts that work back on the Claude model the server was using before. The **Back to … (recommended)** button under a kind of work returns it to the recommended pick. **Put everything back on Claude** and **Use the recommended picks** change all three at once.",
      "Or say it: “Put all the AI back on Claude”, or “Use DeepSeek for simple jobs”.",
    ],
    body: [
      "A model is the AI that does the work. Different models cost different amounts, and any model costs more the harder it thinks.",
      "Recommended: **GPT-6.1 Sol** thinking hard for chat, **GPT-6.1 Sol** with some thinking for background jobs, and the cheap, fast **DeepSeek V4.1 Flash** for simple jobs (summaries of long chats, Ideas, bookings found in emails). They’re picked for the best results per dollar.",
      "These run through OpenRouter, one account and one bill for models from many companies. Create a key at openrouter.ai and add some credit there. Then add the key as **OPENROUTER_API_KEY** under **Variables** on the api service in Railway, and choose **Deploy** on the banner. Until then everything uses Claude.",
      "**Another OpenRouter model** takes a model ID from its page at openrouter.ai. It’s checked with OpenRouter before it’s saved, and one that can’t use the app’s tools can’t do chat or background jobs.",
      "If OpenRouter can’t answer (no credit left, or it’s down), Claude answers instead, and the card says so under that kind of work. Live voice calls use their own voice model, which isn’t changed here. See what it all costs under **Usage**.",
    ],
    say: [{ text: "Which AI model is doing what?", send: true }, "Put all the AI back on Claude"],
    keywords: [
      "model",
      "models",
      "openrouter",
      "gpt",
      "deepseek",
      "claude",
      "cheaper",
      "ai cost",
      "switch model",
      "change model",
      "which model",
      "chat model",
      "thinking",
      "api key",
      "openrouter key",
      "out of credit",
      "credit",
      "didn't work",
      "answered instead",
      "key refused",
    ],
    related: ["usage", "admin-usage"],
  },
  {
    id: "admin-voice-key",
    group: "admin",
    admin: true,
    title: "Turn on live talk",
    summary: "Live talk needs an OpenAI key on the api service in Railway.",
    steps: [
      "In Railway, open the **api** service (not **web**), then **Variables**.",
      "Add **OPENAI_VOICE_API_KEY** with your OpenAI key.",
      "Choose **Deploy** on the banner Railway shows; nothing changes until you do.",
      "In the api’s **Deploy Logs**, look for “Live voice on”. “Live voice off: …” says what’s missing.",
    ],
    body: ["The key stays on the server; the browser never sees it."],
    keywords: ["voice", "openai", "key", "live talk", "headset", "railway"],
    related: ["admin-railway", "admin-logs"],
  },
  {
    id: "admin-railway",
    group: "admin",
    admin: true,
    title: "Changing a Railway setting",
    summary: "Railway stages changes: nothing happens until you choose Deploy.",
    steps: [
      "Change the variable under the service’s **Variables**.",
      "Choose **Deploy** on the banner at the top. The service restarts with the change.",
    ],
    body: [
      "A restart of the api ends any call in progress, so pick a quiet moment.",
      "The api, web and browser are separate services; the browser (worker) only redeploys when its own code changes.",
    ],
    keywords: ["railway", "variables", "deploy", "settings", "environment"],
    related: ["admin-deploys"],
  },
  {
    id: "admin-composio",
    group: "admin",
    admin: true,
    title: "Apps that need their own setup (like Brex)",
    summary: "A few apps need an auth config in Composio before Connect works.",
    steps: [
      "In the Composio dashboard, create an auth config for the app (for Brex, choose API Key).",
      "**Connect** then uses it and asks for the key on Composio’s page. Until it exists, Connect says what to set up.",
    ],
    body: ["Connected apps run through Composio (COMPOSIO_API_KEY on the api)."],
    keywords: ["composio", "brex", "auth config", "connect fails", "integrations"],
    related: ["connect-apps"],
  },
  {
    id: "admin-email",
    group: "admin",
    admin: true,
    title: "Sign-in emails and the agent’s email address",
    summary: "Email sign-in links and each agent’s address come from Resend.",
    body: [
      "**ADMIN_EMAIL** (your email) turns on email sign-in links and inviting people; it needs **RESEND_API_KEY**.",
      "**AGENT_EMAIL** is the agent’s address; each person gets their own name@ that domain. Mail to it reaches the agent through Resend’s inbound webhook.",
    ],
    keywords: ["resend", "email", "sign-in email", "agent email", "domain"],
    related: ["admin-people", "agent-email"],
  },
  {
    id: "admin-usage",
    group: "admin",
    admin: true,
    title: "What each person costs",
    summary: "Today, the last 7 days, all time and each person’s costs.",
    place: "money",
    steps: [
      "Open **Apps › Money › Usage**. As the admin you see **Everyone together** too: their totals for today, the last 7 days and all time, then each person’s cost this month.",
    ],
    say: [{ text: "What has the AI cost everyone together?", send: true }],
    keywords: ["usage", "cost", "billing", "per person", "everyone"],
    related: ["usage", "admin-models"],
  },
  {
    id: "admin-backups",
    group: "admin",
    admin: true,
    title: "Backups and restoring",
    summary: "A copy of every record is saved to the bucket each night (14 kept).",
    body: [
      "With the S3 bucket set up, a nightly copy goes to **backups/records-YYYY-MM-DD.jsonl.gz**.",
      "To put one back, from a checkout with the api’s database and bucket settings: **pnpm restore-backup backups/records-2026-09-29.jsonl.gz** shows what it holds, and adding **--yes** restores it. Records made since are kept.",
    ],
    keywords: ["backup", "restore", "database", "bucket", "recovery"],
    related: ["admin-railway"],
  },
  {
    id: "admin-deploys",
    group: "admin",
    admin: true,
    title: "Updates and deploys",
    summary: "New versions deploy to Railway; open apps offer to load them.",
    body: [
      "A new version deploys the api and web services. Open apps show “A new version is ready” with **Reload**, and never reload during a call.",
      "A deploy restarts the api, which ends any live call, so updates are best pushed when no one is talking with their agent.",
    ],
    keywords: ["deploy", "update", "release", "version", "push"],
    related: ["admin-railway", "new-version"],
  },
  {
    id: "admin-browser",
    group: "admin",
    admin: true,
    title: "The agent’s browser (worker)",
    summary: "Website jobs and the agent’s browser run on a separate browser service.",
    body: [
      "At startup the api logs “Agent browser reachable” when it can reach the browser service. If jobs say the browser is offline, check that service in Railway.",
      "Terminal and Linux files need a Docker computer on the server, which isn’t set up on Railway, so the app hides them.",
    ],
    keywords: ["browser", "worker", "offline", "agent computer", "terminal"],
    related: ["agent-computer", "admin-logs"],
  },
  {
    id: "admin-logs",
    group: "admin",
    admin: true,
    title: "Reading the server logs",
    summary: "Railway’s Deploy Logs show what the api is doing and what went wrong.",
    steps: [
      "In Railway, open the **api** service, then **Deployments › Deploy Logs**.",
      "At startup look for “Live voice on”, “Agent browser reachable” and “Connected apps ready (Composio)”.",
      "Errors from connected apps and live talk name the provider’s own reason.",
    ],
    keywords: ["logs", "railway", "errors", "debug", "server"],
    related: ["admin-voice-key", "admin-browser"],
  },
];

/** The agent's name in the guide's words; "your agent" (signed out) starts a sentence capitalised. */
export function helpText(text: string, agent: string) {
  const Agent = agent.charAt(0).toUpperCase() + agent.slice(1);
  return text.replace(/\{agent\}/g, (_match, offset: number) => {
    const before = text.slice(0, offset).trimEnd();
    return !before || /[.!?“"]$/.test(before) || /(^|[.!?]\s*)\*\*$/.test(before) ? Agent : agent;
  });
}

/** A phrase as search compares it: lower case, no apostrophes or punctuation, single spaces. */
const phrase = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9$]+/g, " ")
    .trim();

/** Words for search: lower case, no punctuation, no tiny words. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/\*\*/g, "")
    .replace(/[’']/g, "")
    .split(/[^a-z0-9$]+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
const STOP = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "my",
  "me",
  "is",
  "it",
  "do",
  "how",
  "can",
  "what",
  "where",
  "why",
  "for",
  "with",
  "i",
  "you",
  "your",
  "agent",
  "neddy",
  "does",
  "be",
  "or",
  "at",
  "this",
  "that",
]);

/** The topics best matching a question, best first, without admin topics unless asked. */
export function searchHelp(query: string, options: { admin?: boolean; limit?: number } = {}) {
  const asked = words(query);
  const plain = ` ${phrase(query)} `;
  if (!plain.trim()) return [];
  const scored = HELP_TOPICS.filter((topic) => options.admin || !topic.admin).map((topic) => {
    const title = words(topic.title);
    const keys = (topic.keywords ?? []).flatMap(words);
    const summary = words(topic.summary);
    const rest = [
      ...(topic.steps ?? []),
      ...(topic.body ?? []),
      ...(topic.say ?? []).map(sayText),
    ].flatMap(words);
    let score = 0;
    for (const word of asked) {
      const hit = (list: string[]) =>
        list.some((other) => other === word || (word.length > 3 && other.startsWith(word)));
      if (hit(title)) score += 5;
      if (hit(keys)) score += 4;
      if (hit(summary)) score += 2;
      if (hit(rest)) score += 1;
    }
    // A keyword phrase ("dark mode", "what can it do") counts for more than its words apart, the
    // more so the longer it is, and finds questions made only of small words.
    for (const key of topic.keywords ?? []) {
      const said = phrase(key);
      if (plain.includes(` ${said} `)) score += 3 * said.split(" ").length;
    }
    return { topic, score };
  });
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? 8)
    .map((item) => item.topic);
}

export const helpTopic = (id: string) => HELP_TOPICS.find((topic) => topic.id === id);
