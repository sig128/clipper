/**
 * Clipforge canonical EditDecisionList (EDL).
 *
 * This is the single source of truth for BOTH the browser preview (apps/web)
 * and the FFmpeg export (services/media/render.py). The Python renderer reads
 * the JSON this schema validates — preview and export must never diverge.
 *
 * Times are seconds (clip-relative after trim). Crop is expressed as fractions
 * of the source frame so it is resolution-independent; the renderer converts to
 * even integer pixels. Frame rate is kept rational (e.g. "30000/1001") and is
 * never silently collapsed to 30.
 */
import { z } from "zod";

export const RationalFps = z
  .string()
  .regex(/^\d+(\/\d+)?$/, 'fps must be an integer or rational like "30000/1001"');

export const CropZ = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
});

export const FacecamZ = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  dst_h: z.number().min(0).max(1).default(0.19),
});

export const CaptionWordZ = z.object({
  t: z.number().min(0), // start, clip-relative seconds
  d: z.number().min(0), // duration seconds
  w: z.string(),        // the on-screen token
  conf: z.number().min(0).max(1).optional(),
});

export const CaptionLineZ = z.object({
  words: z.array(CaptionWordZ).min(1),
});

export const CaptionStyleZ = z.object({
  font: z.string().default("Inter"),
  size: z.number().int().positive().default(60),
  primary: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#2fd4e3"),
  secondary: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/).default("#ffffff"),
  outline: z.number().int().min(0).max(12).default(5),
  shadow: z.number().int().min(0).max(8).default(1),
  bold: z.boolean().default(true),
  pos: z.number().min(0).max(1).default(0.72), // vertical position, fraction from top
});

export const LayoutZ = z.enum([
  "full",
  "gameplay_facecam",
  "split_speakers",
  "landscape_fit",
]);

export const EdlZ = z.object({
  schemaVersion: z.literal("1.0"),
  revisionId: z.string(),
  title: z.string().optional(),
  source: z.object({
    path: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: RationalFps,
  }),
  output: z.object({
    width: z.number().int().positive().default(1080),
    height: z.number().int().positive().default(1920),
    fps: z.number().int().positive().default(30),
  }),
  trim: z.object({ in: z.number().min(0), out: z.number().min(0) }),
  crop: CropZ,
  layout: LayoutZ.default("full"),
  facecam: FacecamZ.optional(),
  captions: z
    .object({ style: CaptionStyleZ, lines: z.array(CaptionLineZ) })
    .optional(),
  audio: z
    .object({
      gain_db: z.number().default(0),
      loudnorm: z.boolean().default(true),
      /** output-time ranges where in-game radio music is ducked to 12% */
      mutes: z.array(z.tuple([z.number().min(0), z.number().min(0)])).default([]),
    })
    .default({ gain_db: 0, loudnorm: true, mutes: [] }),
  /** the original layer: on-screen hook first, then one line of commentary */
  hook: z.object({ text: z.string().max(70), dur: z.number().min(1).max(5).default(2.5) }).optional(),
  note: z.object({ text: z.string().max(90), start: z.number().min(0).optional(), dur: z.number().positive().optional() }).optional(),
  /** last 0.35 s fades into the first frame so replays feel continuous */
  loopSeam: z.boolean().default(false),
  /** set by `render --platform`: yt, tt (runs past 61 s for Creator Rewards) or ig */
  platform: z.enum(["yt", "tt", "ig"]).optional(),
});

export type Edl = z.infer<typeof EdlZ>;
export type Crop = z.infer<typeof CropZ>;
export type CaptionStyle = z.infer<typeof CaptionStyleZ>;

/** Half-open interval helper — the renderer and the UI must agree on rounding. */
export function cropToPixels(src: { width: number; height: number }, crop: Crop) {
  const even = (n: number) => Math.round(n) - (Math.round(n) % 2);
  const w = even(src.width * crop.w);
  const h = even(src.height * crop.h);
  const x = Math.max(0, Math.min(even(src.width * crop.x), src.width - w));
  const y = Math.max(0, Math.min(even(src.height * crop.y), src.height - h));
  return { w, h, x, y };
}

/** Parse a rational fps string to a float without losing the exact ratio. */
export function fpsToFloat(fps: string): number {
  const [n, d = "1"] = fps.split("/");
  return Number(n) / Number(d);
}
