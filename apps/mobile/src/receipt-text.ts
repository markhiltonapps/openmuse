/**
 * "What I used": the places an answer looked things up, in plain words, from the tools it
 * called. Only reads are listed (what it saved or sent shows as its own card).
 */
const LOOKUPS: Record<string, string> = {
  search_mail: "Your email",
  read_mail_thread: "Your email",
  check_agent_inbox: "Mail sent to my address",
  look_at_calendar: "Your calendar",
  list_app_events: "Your calendar",
  search_web: "The web",
  web_search: "The web",
  look_at_page: "A web page",
  browse_web: "A website in my browser",
  get_weather: "The weather",
  list_files: "Your files",
  read_file: "Your files",
  list_reminders: "Your reminders",
  list_commitments: "Your plans and bookings",
  get_food_log: "Your food log",
  get_weight_history: "Your weight history",
  search_earlier_chat: "Your earlier chats",
  search_past_chats: "Your earlier chats",
  read_past_chat: "Your earlier chats",
  look_up_person: "Your notes on a person",
  get_about_person: "Your About you page",
  brief_me: "Your email, calendar and the weather",
  delegate_task: "A background job I started",
  use_page: "A web page",
  open_page: "A web page",
  run_code: "A calculation I ran",
  code_execution: "A calculation I ran",
  meetings: "Your recorded meetings",
  list_connected_apps: "Your connected apps",
  find_app_actions: "An app you connected",
  use_app: "An app you connected",
  move_gmail_to_folder: "Your Gmail",
  get_help: "The Help guide",
  where_am_i: "Where you are",
  look_at_image: "A picture you sent",
};

/** Tools that only draw a card, save or change something: they look nothing up. */
const SILENT =
  /^(show_|save_|set_|create_|log_|cancel_|change_|update_|delete_|stop_|forget_|remember|suggest_|schedule_|share_|note_|manage_|tidy_|enter_|connect_|approve_|mark_|remove_|send_|email_|write_|make_|track_|add_|call_|live_)/;

/**
 * Each place once, in the order it was first looked at. A tool that isn't listed and isn't a plain
 * save or card adds "Other tools I used", so the list never claims less than happened.
 */
export function lookedAt(toolNames: string[]): string[] {
  const seen: string[] = [];
  let other = false;
  for (const name of toolNames) {
    const label = LOOKUPS[name];
    if (label) {
      if (!seen.includes(label)) seen.push(label);
    } else if (!SILENT.test(name)) other = true;
  }
  if (other) seen.push("Other tools I used");
  return seen;
}
