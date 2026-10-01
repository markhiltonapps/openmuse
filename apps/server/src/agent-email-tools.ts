import { z } from "zod";
import type { AgentEmail } from "../../../packages/domain/src/index.ts";

export const agentEmailInstructions =
  " To email someone from your own email address (not the person's Gmail), such as answering mail sent to you, call email_from_agent. It waits for the person's approval before anything is sent.";

/** Lets an agent prepare an email from its own address; the person approves it in the app. */
export function agentEmailToolSpecs(
  owner: string,
  mail: { address(owner: string): Promise<string | undefined> },
  propose: (email: AgentEmail) => Promise<{ id: string }>,
) {
  return [
    {
      name: "email_from_agent",
      description:
        "Prepare an email from your own agent email address. Use it to reply to email sent to you or to send something the person asked for. The person reviews and approves it before it is sent. Pass inReplyTo with the original Message-ID to reply in the same thread.",
      parameters: z.object({
        to: z.array(z.email()).min(1).max(10),
        subject: z.string().trim().min(1).max(300),
        body: z.string().min(1).max(20000),
        inReplyTo: z.string().max(998).optional(),
      }),
      execute: async (args: Omit<AgentEmail, "from">) => {
        const from = await mail.address(owner);
        if (!from) return { error: "Your agent doesn't have an email address yet." };
        const action = await propose({ ...args, from });
        return {
          status: "awaiting_review",
          actionId: action.id,
          from,
          message: "Prepared. It is sent only when the person taps Approve.",
        };
      },
    },
  ];
}
