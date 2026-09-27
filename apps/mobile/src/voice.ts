import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { SpokenReply, speakableChunks } from "./speakable";

// Spoken replies use the device's own voices (Web Speech API): free, and private to the device.
export interface VoiceSettings {
  /** Read each new reply aloud. */
  readAloud: boolean;
  /** voiceURI of the chosen voice; the best-sounding local voice when unset. */
  voice?: string;
  rate: number;
  /** deviceId of the chosen microphone; the device default when unset. */
  microphone?: string;
}
export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
}
const KEY = "openmuse.voice";
const DEFAULTS: VoiceSettings = { readAloud: false, rate: 1 };
const web = () => Platform.OS === "web" && typeof window !== "undefined";
export const speechAvailable = () =>
  web() && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

function load(): VoiceSettings {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    return {
      readAloud: saved.readAloud === true,
      voice: typeof saved.voice === "string" ? saved.voice : undefined,
      microphone: typeof saved.microphone === "string" ? saved.microphone : undefined,
      rate: typeof saved.rate === "number" && saved.rate >= 0.5 && saved.rate <= 2 ? saved.rate : 1,
    };
  } catch {
    return DEFAULTS;
  }
}
let settings = load();
const listeners = new Set<() => void>();
export function updateVoiceSettings(patch: Partial<VoiceSettings>) {
  settings = { ...settings, ...patch };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private browsing: the choice lasts until the page closes.
  }
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const snapshot = () => settings;
export const voiceSettings = snapshot;
export function useVoiceSettings() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

const NATURAL = /natural|neural|premium|enhanced|online|google|siri/i;
/** Voices in the person's language, the most natural-sounding first. */
function ranked() {
  if (!speechAvailable()) return [];
  const language = (navigator.language || "en-US").slice(0, 2).toLowerCase();
  const all = window.speechSynthesis.getVoices();
  const mine = all.filter((v) => v.lang.toLowerCase().startsWith(language));
  return (mine.length ? mine : all).sort(
    (a, b) =>
      Number(NATURAL.test(b.name)) - Number(NATURAL.test(a.name)) ||
      Number(b.lang === navigator.language) - Number(a.lang === navigator.language) ||
      a.name.localeCompare(b.name),
  );
}
export function listVoices(): Promise<VoiceOption[]> {
  if (!speechAvailable()) return Promise.resolve([]);
  const format = () => ranked().map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }));
  if (window.speechSynthesis.getVoices().length) return Promise.resolve(format());
  // Chrome loads voices asynchronously.
  return new Promise((resolve) => {
    const done = () => resolve(format());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

let generation = 0;
// Whether the agent is speaking right now, so the avatar can move its mouth.
let speakingNow = false;
const speakingListeners = new Set<() => void>();
function setSpeaking(value: boolean) {
  if (speakingNow === value) return;
  speakingNow = value;
  for (const listener of speakingListeners) listener();
}
export function useSpeaking() {
  return useSyncExternalStore(
    (listener) => {
      speakingListeners.add(listener);
      return () => {
        speakingListeners.delete(listener);
      };
    },
    () => speakingNow,
    () => false,
  );
}
/** Reads text aloud; resolves when it finishes or is interrupted. */
export function speak(text: string, override?: Partial<VoiceSettings>): Promise<void> {
  if (!speechAvailable()) return Promise.resolve();
  const synth = window.speechSynthesis;
  const current = ++generation;
  synth.cancel();
  const chunks = speakableChunks(text);
  const { voice, rate } = { ...settings, ...override };
  const voices = ranked();
  const chosen = voices.find((v) => v.voiceURI === voice) ?? voices[0];
  return new Promise((resolve) => {
    let index = 0;
    const next = () => {
      const chunk = chunks[index++];
      if (current !== generation || chunk === undefined) {
        if (current === generation) setSpeaking(false);
        return resolve();
      }
      setSpeaking(true);
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang;
      }
      utterance.rate = rate;
      utterance.onend = next;
      utterance.onerror = () => {
        if (current === generation) setSpeaking(false);
        resolve();
      };
      synth.speak(utterance);
    };
    next();
  });
}
export interface ReplyReader {
  /** The reply so far: each sentence is read out as soon as it's finished. */
  update(markdown: string): void;
  /** The finished reply; resolves true once all of it has been said, false if it was cut off. */
  finish(markdown: string): Promise<boolean>;
}
/**
 * Reads a reply aloud while it's still being written, starting with its first sentence instead
 * of waiting for the whole reply. `onSpeaking` tells when it is audible, not between sentences.
 */
export function readAsWritten(onSpeaking?: (speaking: boolean) => void): ReplyReader {
  if (!speechAvailable()) return { update: () => undefined, finish: async () => true };
  const synth = window.speechSynthesis;
  const current = ++generation;
  synth.cancel();
  const reply = new SpokenReply();
  const voices = ranked();
  const chosen = voices.find((v) => v.voiceURI === settings.voice) ?? voices[0];
  const { rate } = settings;
  let speaking = false;
  let audible = false;
  let finished = false;
  let result: boolean | undefined;
  const waiting: ((complete: boolean) => void)[] = [];
  const setAudible = (value: boolean) => {
    if (audible === value) return;
    audible = value;
    if (current === generation) setSpeaking(value);
    onSpeaking?.(value);
  };
  const end = (complete: boolean) => {
    if (result !== undefined) return;
    result = complete;
    setAudible(false);
    for (const resolve of waiting) resolve(complete);
  };
  const play = () => {
    if (speaking || result !== undefined) return;
    if (current !== generation) return end(false);
    const chunk = reply.next();
    if (chunk === undefined) {
      if (finished) end(true);
      else setAudible(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(chunk);
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang;
    }
    utterance.rate = rate;
    // An error, such as being cut off, ends this piece; play() then stops if it was cut off.
    utterance.onend = utterance.onerror = () => {
      speaking = false;
      play();
    };
    speaking = true;
    setAudible(true);
    synth.speak(utterance);
  };
  return {
    update(markdown) {
      if (result !== undefined || current !== generation) return;
      reply.update(markdown);
      play();
    },
    finish(markdown) {
      if (current !== generation) end(false);
      if (result === undefined) {
        reply.update(markdown, true);
        finished = true;
        play();
      }
      if (result !== undefined) return Promise.resolve(result);
      return new Promise((resolve) => waiting.push(resolve));
    },
  };
}
export function stopSpeaking() {
  generation++;
  setSpeaking(false);
  if (speechAvailable()) window.speechSynthesis.cancel();
}
let primed = false;
/** iPhone only lets a page speak after a tap, so the tap that turns voice on unlocks it. */
export function primeSpeech() {
  if (primed || !speechAvailable()) return;
  primed = true;
  const silent = new SpeechSynthesisUtterance(" ");
  silent.volume = 0;
  window.speechSynthesis.speak(silent);
}
