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
    failure = event.error instanceof Error ? event.error : new Error(String(event.error));
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
export function replyFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot send event type|already errored/i.test(message))
    return "That reply didn't go through. Tap Retry response to try again.";
  return /"message":"((?:[^"\\]|\\.)*)"/.exec(message)?.[1] ?? message;
}
