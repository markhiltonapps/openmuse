import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * A depth map for a picture, made once on this server (owner, 2026-11-07: every picture
 * animates, for free). Depth Anything v2 small, run on the CPU with onnxruntime (about 0.6 s a
 * picture); the app draws a slow drift and zoom with near and far parts moving apart, so a still
 * picture looks like a slow camera move. No account, no per-picture cost.
 *
 * The model file (27 MB) is baked into the api's image; if it's missing it is fetched once from
 * Hugging Face into the data folder. Without it pictures are still made, just not animated.
 */
export const DEPTH_MODEL_URL =
  "https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/main/onnx/model_quantized.onnx";
/** The model's input size; the map it gives is this big too. */
const SIDE = 518;
/** The map kept beside a picture: small, as a grey PNG. */
export const DEPTH_SIZE = 256;

type Session = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};
type Ort = {
  InferenceSession: { create(path: string, options?: unknown): Promise<Session> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
};

export class Depth {
  private session?: Promise<Session | undefined>;
  private busy: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly modelPath: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  /** The model is on disk, or can be fetched: say so at start. */
  get present() {
    return existsSync(this.modelPath);
  }
  private async load(): Promise<Session | undefined> {
    try {
      if (!this.present) {
        const response = await this.fetcher(DEPTH_MODEL_URL, {
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) throw new Error(`the model download answered ${response.status}`);
        await mkdir(dirname(this.modelPath), { recursive: true });
        await writeFile(this.modelPath, new Uint8Array(await response.arrayBuffer()));
      }
      const ort = (await import("onnxruntime-node")) as unknown as Ort;
      return await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
      });
    } catch (error) {
      console.warn(
        `[OpenMuse] Depth maps off: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
  /**
   * The picture's depth as a square grey PNG (near is light), or undefined when it can't be made.
   * One at a time: the model holds the CPU for half a second.
   */
  async map(picture: Uint8Array): Promise<Uint8Array | undefined> {
    const run = this.busy.then(() => this.mapNow(picture));
    this.busy = run.catch(() => undefined);
    return run;
  }
  private async mapNow(picture: Uint8Array) {
    this.session ??= this.load();
    const session = await this.session;
    if (!session) return undefined;
    const { default: sharp } = await import("sharp");
    const { data } = await sharp(picture)
      .removeAlpha()
      .resize(SIDE, SIDE, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const pixels = new Float32Array(3 * SIDE * SIDE);
    for (let i = 0; i < SIDE * SIDE; i++)
      for (let c = 0; c < 3; c++)
        pixels[c * SIDE * SIDE + i] =
          ((data[i * 3 + c] ?? 0) / 255 - (mean[c] ?? 0)) / (std[c] ?? 1);
    const ort = (await import("onnxruntime-node")) as unknown as Ort;
    const name = session.inputNames[0] ?? "pixel_values";
    const out = await session.run({
      [name]: new ort.Tensor("float32", pixels, [1, 3, SIDE, SIDE]),
    });
    const depth = out[session.outputNames[0] ?? "predicted_depth"]?.data;
    if (!depth) return undefined;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const v of depth) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const span = hi - lo || 1;
    const grey = Buffer.alloc(SIDE * SIDE);
    for (let i = 0; i < SIDE * SIDE; i++)
      grey[i] = Math.round((((depth[i] ?? lo) - lo) / span) * 255);
    return new Uint8Array(
      await sharp(grey, { raw: { width: SIDE, height: SIDE, channels: 1 } })
        .resize(DEPTH_SIZE, DEPTH_SIZE)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    );
  }
}

/** Where the model lives: next to the built server in the image, else the data folder. */
export function depthModelPath(dataDir: string) {
  const baked = join(process.cwd(), "models", "depth-anything-v2-small.onnx");
  return existsSync(baked) ? baked : join(dataDir, "models", "depth-anything-v2-small.onnx");
}
