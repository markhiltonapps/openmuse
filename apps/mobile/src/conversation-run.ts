type RunError = { error: unknown; context?: { agentId?: string } };

/** CopilotKit emits run failures through onError even when runAgent resolves. */
export async function runConversationTurn(
  agentId: string,
  execute: () => Promise<unknown>,
  subscribe: (listener: (event: RunError) => void) => { unsubscribe: () => void },
) {
  let failure: Error | undefined;
  const subscription = subscribe((event) => {
    if (event.context?.agentId && event.context.agentId !== agentId) return;
    const error = event.error instanceof Error ? event.error : new Error(String(event.error));
    // The first real reason wins: the chat's own bookkeeping error that follows it says nothing.
    if (!failure || (bookkeeping(failure.message) && !bookkeeping(error.message))) failure = error;
  });
  try {
    await execute();
    if (failure) throw failure;
  } finally {
    subscription.unsubscribe();
  }
}

/**
 * What the person reads when a reply fails. The chat's own bookkeeping errors ("Cannot send event
 * type…") say nothing useful; a model error keeps its message without the JSON around it.
 */
const bookkeeping = (message: string) => /Cannot send event type|already errored/i.test(message);

export function replyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (bookkeeping(message)) return "That reply didn't go through. Tap Retry response to try again.";
  return /"message":"((?:[^"\\]|\\.)*)"/.exec(message)?.[1] ?? message;
}
