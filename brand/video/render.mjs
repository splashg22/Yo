// Renders the walkthrough: H.264 MP4, 60 fps, AAC track (silent until a licensed track is supplied), at 2× the
// 1920×1080 composition = 3840×2160.   node render.mjs [--scale 2] [--frames 0-119] [--out out/x.mp4]
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : d; };
const scale = Number(arg("scale", "2"));
const frames = arg("frames", null);
const out = arg("out", join(here, "out", scale >= 2 ? "dacity-walkthrough-4k.mp4" : `dacity-walkthrough-${1080 * scale}p.mp4`));
const concurrency = Number(arg("concurrency", "2"));
mkdirSync(join(here, "out"), { recursive: true });

const serveUrl = await bundle({ entryPoint: join(here, "src", "index.tsx"), publicDir: join(here, "public") });
const composition = await selectComposition({ serveUrl, id: "Walkthrough" });
let last = -1;
await renderMedia({
  composition, serveUrl, codec: "h264", outputLocation: out, scale, crf: 17, encodingMaxRate: "18M", encodingBufferSize: "36M", x264Preset: "medium", pixelFormat: "yuv420p",
  imageFormat: "png", concurrency, enforceAudioTrack: true, audioCodec: "aac",
  frameRange: frames ? frames.split("-").map(Number) : null,
  offthreadVideoCacheSizeInBytes: 1_200_000_000,
  chromiumOptions: { gl: "angle" }, timeoutInMilliseconds: 180000,
  onProgress: ({ renderedFrames, encodedFrames, progress }) => { const p = Math.floor(progress * 100); if (p !== last) { last = p; console.log(`${p}% rendered ${renderedFrames} encoded ${encodedFrames}`); } },
});
console.log("wrote", out, `${composition.width * scale}x${composition.height * scale} @ ${composition.fps} fps`);
