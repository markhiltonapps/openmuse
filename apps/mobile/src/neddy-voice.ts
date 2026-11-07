import { Platform } from "react-native";
import type { MuseApi } from "./api";
import { setLiveSpeaking } from "./voice";

/**
 * Lines said in the agent's own voice outside a call (the setup questions): the server makes
 * each one with the voice this person's calls use, so the first voice they hear is the one that
 * will talk to them. When calls aren't on our own voice (the server answers 503), or anything
 * else goes wrong, the caller falls back to the device's own speech.
 */
const web = () => Platform.OS === "web" && typeof window !== "undefined" && "Audio" in window;
/** Audio already fetched, by line, so going back to a question doesn't fetch it again. */
const urls = new Map<string, string>();
let playing: HTMLAudioElement | undefined;
let generation = 0;

/** True when the device can play a fetched line at all. */
export const ownVoiceAvailable = () => web();

/**
 * Says the line in the agent's call voice; resolves true once it has been said, false if it
 * couldn't be (then say it another way). Cut off by `stopSaying()` or a newer line (true, so the
 * caller doesn't say it again another way).
 */
export async function sayAsNeddy(api: Pick<MuseApi, "url" | "token">, text: string) {
  if (!web()) return false;
  const current = ++generation;
  stopSaying(false);
  try {
    let url = urls.get(text);
    if (!url) {
      const response = await fetch(
        api.url(`/api/call-voices/say?text=${encodeURIComponent(text)}`),
        { headers: { Authorization: `Bearer ${api.token}` } },
      );
      if (!response.ok) return false;
      const blob = await response.blob();
      if (!blob.type.startsWith("audio/")) return false;
      url = URL.createObjectURL(blob);
      urls.set(text, url);
    }
    if (current !== generation) return true;
    const sound = new Audio(url);
    playing = sound;
    return await new Promise<boolean>((resolve) => {
      const done = (said: boolean) => {
        if (playing === sound) {
          playing = undefined;
          setLiveSpeaking(false);
        }
        resolve(said);
      };
      sound.onended = () => done(true);
      sound.onpause = () => done(true);
      sound.onerror = () => done(false);
      setLiveSpeaking(true);
      sound.play().catch(() => done(false));
    });
  } catch {
    return false;
  }
}

/** Stops a line part-way (a tap, a new step, closing the sheet). */
export function stopSaying(bump = true) {
  if (bump) generation++;
  const sound = playing;
  playing = undefined;
  if (sound) {
    sound.onended = sound.onpause = sound.onerror = null;
    sound.pause();
    setLiveSpeaking(false);
  }
}

let unlocked = false;
/**
 * iPhones only play sound after a tap, so the tap that starts setup plays a silent moment first;
 * the fetched lines then play on their own.
 */
export function unlockAudio() {
  if (unlocked || !web()) return;
  unlocked = true;
  try {
    const silent = new Audio(
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
    );
    silent.volume = 0;
    void silent.play().catch(() => undefined);
  } catch {
    // Nothing to unlock here.
  }
}
