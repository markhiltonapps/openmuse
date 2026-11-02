import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** One recorded part: the file as the phone made it (WebM, M4A or Ogg). */
export interface AudioPart {
  bytes: Uint8Array;
  mime: string;
}
/** Joins the parts, in order, into one MP3. */
export type Mp3Encoder = (parts: AudioPart[], title?: string) => Promise<Uint8Array>;

/** An hour of speech is about 30 MB at this size, and it sounds fine for voices. */
const BITRATE = "64k";
const SAMPLE_RATE = "44100";
/** Long enough for many hours of audio, short enough that a stuck ffmpeg doesn't hang on. */
const TIMEOUT_MS = 15 * 60_000;

const extensionOf = (mime: string) =>
  /mp4|m4a|aac/.test(mime)
    ? "m4a"
    : /ogg/.test(mime)
      ? "ogg"
      : /mpeg|mp3/.test(mime)
        ? "mp3"
        : "webm";

function run(command: string, args: string[]) {
  return new Promise<{ code: number | null; error: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let error = "";
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-1500);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    // A long wait mustn't hold up shutdown.
    timer.unref();
    child.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, error });
    });
  });
}

let present: Promise<boolean> | undefined;
/** Whether ffmpeg, with its MP3 encoder, works here: a tenth of a second of silence, asked once. */
export function ffmpegAvailable() {
  present ??= run("ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=8000:cl=mono",
    "-t",
    "0.1",
    "-c:a",
    "libmp3lame",
    "-f",
    "null",
    "-",
  ])
    .then((probe) => probe.code === 0)
    .catch(() => false);
  return present;
}

/**
 * The parts become one mono MP3. Each is brought to the same rate and layout first, so parts made
 * after a pause (the phone locked, the app was away) still join cleanly.
 */
export const ffmpegMp3: Mp3Encoder = async (parts, title) => {
  if (!parts.length) throw new Error("There is no audio to convert");
  const directory = await mkdtemp(join(tmpdir(), "openmuse-mp3-"));
  try {
    const inputs: string[] = [];
    for (const [index, part] of parts.entries()) {
      const path = join(directory, `part-${index}.${extensionOf(part.mime)}`);
      await writeFile(path, part.bytes);
      inputs.push("-i", path);
    }
    const graph = `${parts
      .map(
        (_, index) =>
          `[${index}:a]aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=mono[a${index}]`,
      )
      .join(
        ";",
      )};${parts.map((_, index) => `[a${index}]`).join("")}concat=n=${parts.length}:v=0:a=1[out]`;
    const output = join(directory, "meeting.mp3");
    const result = await run("ffmpeg", [
      "-hide_banner",
      "-nostdin",
      "-y",
      ...inputs,
      "-filter_complex",
      graph,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      BITRATE,
      ...(title ? ["-metadata", `title=${title.slice(0, 200)}`] : []),
      output,
    ]);
    if (result.code !== 0) {
      // ffmpeg's own words go to the log (they hold file names, never the person's words).
      console.warn(`[OpenMuse] MP3 conversion failed (${result.code}): ${result.error.trim()}`);
      throw new Error("The audio couldn’t be turned into an MP3");
    }
    return new Uint8Array(await readFile(output));
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
};
