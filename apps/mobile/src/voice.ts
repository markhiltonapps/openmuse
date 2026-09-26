import { useSyncExternalStore } from "react";
import { Platform } from "react-native";
import { speakableChunks } from "./speakable";

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
      if (current !== generation || chunk === undefined) return resolve();
      const utterance = new SpeechSynthesisUtterance(chunk);
      if (chosen) {
        utterance.voice = chosen;
        utterance.lang = chosen.lang;
      }
      utterance.rate = rate;
      utterance.onend = next;
      utterance.onerror = () => resolve();
      synth.speak(utterance);
    };
    next();
  });
}
export function stopSpeaking() {
  generation++;
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
