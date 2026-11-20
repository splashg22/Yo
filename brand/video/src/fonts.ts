// DM Sans, the site's face, self-hosted (public/fonts, the variable latin file Google Fonts serves for
// `DM+Sans:opsz,wght@9..40,200..900`) so a render never waits on the network.
import { continueRender, delayRender, staticFile } from "remotion";

if (typeof document !== "undefined" && "fonts" in document) {
  const handle = delayRender("Loading DM Sans");
  const face = new FontFace("DM Sans", `url(${staticFile("fonts/DMSans-variable-latin.woff2")}) format("woff2")`, { weight: "200 900", style: "normal", display: "block" });
  face.load().then((f) => { (document.fonts as unknown as { add: (f: FontFace) => void }).add(f); continueRender(handle); }).catch((e) => { console.error("DM Sans failed to load", e); continueRender(handle); });
}
