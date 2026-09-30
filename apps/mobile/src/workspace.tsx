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
import type { MuseApi } from "./api";
export type Detail =
  | { type: "mail"; mail: Mail }
  | { type: "email"; draft?: Partial<EmailDraft> & { id?: string } }
  | { type: "event"; event?: CalendarEvent; draft?: EventDraft; neighbors?: CalendarEvent[] }
  | { type: "file"; file: Artifact }
  | { type: "browser"; browser: BrowserSession }
  | { type: "review"; action: ActionProposal }
  | { type: "task"; taskId: string }
  | { type: "delegate" }
  | { type: "notifications" }
  | { type: "food"; log?: boolean }
  | { type: "computer" }
  /** Plans & bookings: everything being kept track of, coming up or past. */
  | { type: "commitments"; tab?: "upcoming" | "past" }
  /** Every reminder: coming up, and sent in the last 7 days. */
  | { type: "reminders" }
  /** A report, comparison, plan or tracker the agent saved. */
  | { type: "saved"; artifact: AgentArtifact }
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
  /** A panel (sheet) is open over the page. */
  panelOpen?: boolean;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace is unavailable");
  return context;
}
