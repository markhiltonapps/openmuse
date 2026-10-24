import { createContext, useContext } from "react";
import type {
  ActionProposal,
  Artifact,
  BrowserSession,
  CalendarEvent,
  EmailDraft,
  EventDraft,
  Mail,
  Section,
  Workspace,
} from "../../../packages/domain/src";
import type { AgentArtifact } from "../../../packages/domain/src/agent";
import type { RehearsalAsk } from "../../../packages/domain/src/voice";
import type { MuseApi } from "./api";
import type { EmailItem } from "./email-cards";
import type { ReceiptInfo } from "./receipt-ui";
export type Detail =
  | { type: "mail"; mail: Mail }
  | { type: "email"; draft?: Partial<EmailDraft> & { id?: string } }
  | { type: "event"; event?: CalendarEvent; draft?: EventDraft; neighbors?: CalendarEvent[] }
  | { type: "file"; file: Artifact }
  | { type: "appEmail"; email: EmailItem }
  | { type: "browser"; browser: BrowserSession }
  | { type: "review"; action: ActionProposal; restOfJob?: boolean }
  | { type: "task"; taskId: string }
  /** Delegate task; `prompt` arrives filled in (from a ?delegate= link), as a General task. */
  | { type: "delegate"; prompt?: string }
  | { type: "notifications" }
  /** The help guide, at a group or topic when given (packages/domain/src/help.ts). */
  | { type: "help"; topic?: string }
  | { type: "food"; log?: boolean }
  | { type: "computer" }
  /** Plans & bookings: everything being kept track of, coming up or past. */
  | { type: "commitments"; tab?: "upcoming" | "past" }
  /** Every reminder: coming up, and sent in the last 7 days. */
  | { type: "reminders" }
  /** A report, comparison, plan or tracker the agent saved. */
  | { type: "saved"; artifact: AgentArtifact }
  /** The moving backdrop's picker. */
  | { type: "backdrop" }
  /** A recorded meeting: its notes, audio and words. */
  | { type: "meeting"; id: string }
  /** What an answer used (receipt-ui.tsx). */
  | { type: "receipt"; info: ReceiptInfo }
  /** Rehearse a hard conversation: who Neddy plays and what it's about (rehearsal-ui.tsx). */
  | { type: "rehearse" }
  /** How a rehearsal went, by the call's id. */
  | { type: "rehearsalScore"; id: string; ask: RehearsalAsk }
  | { type: "menu" };
export interface WorkspaceContextValue {
  workspace: Workspace;
  api: MuseApi;
  section: Section;
  navigate: (section: Section) => void;
  refresh: () => Promise<void>;
  open: (detail: Detail) => void;
  close: () => void;
  notify: (message: string) => void;
  ask: (prompt: string) => void;
  /** Opens the chat with this in the message box, not sent, for them to finish. */
  draft: (prompt: string) => void;
  /** A panel (sheet) is open over the page. */
  panelOpen?: boolean;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace is unavailable");
  return context;
}
