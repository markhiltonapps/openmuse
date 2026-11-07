/**
 * The last tagged answer the server gave for each address, so the next ask can say "only if it
 * changed" (If-None-Match) and a 304 hands back the very same object. React sees the same object
 * as no change, so a screen that asks every few seconds redraws only when something is new.
 */
export class AnswerTags {
  private readonly kept = new Map<string, { tag: string; payload: unknown }>();
  constructor(private readonly limit = 40) {}
  /** The tag to send with the next ask for this address, if the server tagged its last answer. */
  tag(path: string): string | undefined {
    return this.kept.get(path)?.tag;
  }
  /** Keeps a tagged answer; an answer without a tag forgets the address. */
  keep(path: string, tag: string | null | undefined, payload: unknown) {
    this.kept.delete(path);
    if (!tag) return;
    this.kept.set(path, { tag, payload });
    if (this.kept.size > this.limit) this.kept.delete(this.kept.keys().next().value as string);
  }
  /** The kept answer, for a 304: the same object as before. */
  unchanged<T>(path: string): T | undefined {
    return this.kept.get(path)?.payload as T | undefined;
  }
}
