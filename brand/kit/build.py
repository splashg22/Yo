#!/usr/bin/env python3
"""Builds the Dacity Strategy brand kit: vector first (SVG), then PNG exports rendered by headless Chrome.

Run from the repository root:  python3 brand/kit/build.py
Needs: fontTools (pip3 install --user fonttools), Google Chrome, DM Sans 500 and 800 TTFs (downloaded on first run).

Everything here is derived from the site's own tokens in web/ui.css:
  pink #ff2d95, pink-hi #ff5fae, pink-deep #d10070, violet #b65cff, cyan #3ee8ff,
  ink #0b0308, card #140811, text #fff4fa, pale pink #ffe1f3 / #1c0713.
"""
import json, os, pathlib, shutil, subprocess, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
KIT = ROOT / "brand" / "kit"
LOGO = KIT / "logo"; PNG = KIT / "png"; X = KIT / "x"; SHEET = KIT / "brand-sheet"; TMP = KIT / ".build"
for d in (LOGO, PNG, X, SHEET, TMP): d.mkdir(parents=True, exist_ok=True)
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

C = dict(pink="#ff2d95", pink_hi="#ff5fae", pink_deep="#d10070", pink_soft="#ffd1e8", violet="#b65cff", cyan="#3ee8ff", cyan_soft="#8ff3ff",
         ink="#0b0308", card="#140811", text="#fff4fa", primary="#ffe1f3", primary_ink="#1c0713", muted="rgba(255,228,243,.72)")

# ---------- fonts -> paths ----------
def fetch_fonts():
    for w in (500, 800):
        dst = TMP / f"DMSans-{w}.ttf"
        if dst.exists(): continue
        css = urllib.request.urlopen(urllib.request.Request(f"https://fonts.googleapis.com/css2?family=DM+Sans:wght@{w}", headers={"User-Agent": ""})).read().decode()
        url = css.split("url(")[1].split(")")[0]
        urllib.request.urlretrieve(url, dst)

def text_path(ttf, text, size, tracking_em=0.0):
    from fontTools.ttLib import TTFont
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    f = TTFont(ttf); gs = f.getGlyphSet(); cmap = f.getBestCmap(); upm = f["head"].unitsPerEm; hmtx = f["hmtx"]
    scale = size / upm; x = 0.0; parts = []
    for ch in text:
        g = cmap[ord(ch)]
        pen = SVGPathPen(gs); gs[g].draw(TransformPen(pen, (scale, 0, 0, -scale, x, 0)))
        parts.append(pen.getCommands()); x += hmtx[g][0] * scale + tracking_em * size
    return " ".join(parts), x - tracking_em * size

# ---------- the mark: a D sliced 40 / 20 / 40 ----------
# The D spans y 6..58 (52 units). Two gaps of 2.6 leave 46.8 for the bands: 18.72 / 9.36 / 18.72.
D_PATH = "M12 6h18a26 26 0 0 1 0 52H12z"
BANDS = [(6.0, 18.72), (27.32, 9.36), (39.28, 18.72)]

def mark_svg(uid="m", with_xmlns=True):
    top, mid, bot = BANDS
    return f'''<svg{' xmlns="http://www.w3.org/2000/svg"' if with_xmlns else ''} viewBox="0 0 64 64" role="img" aria-label="Dacity Strategy">
  <defs>
    <clipPath id="{uid}-d"><path d="{D_PATH}"/></clipPath>
    <linearGradient id="{uid}-top" x1="0" y1="{top[0]}" x2="0" y2="{top[0]+top[1]}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{C['pink_soft']}"/><stop offset=".62" stop-color="{C['pink']}"/><stop offset="1" stop-color="{C['pink']}"/></linearGradient>
    <linearGradient id="{uid}-bot" x1="0" y1="{bot[0]}" x2="0" y2="{bot[0]+bot[1]}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{C['cyan']}"/><stop offset="1" stop-color="{C['cyan_soft']}"/></linearGradient>
  </defs>
  <g clip-path="url(#{uid}-d)">
    <rect x="0" y="{top[0]}" width="64" height="{top[1]}" fill="url(#{uid}-top)"/>
    <rect x="0" y="{mid[0]}" width="64" height="{mid[1]}" fill="{C['violet']}"/>
    <rect x="0" y="{bot[0]}" width="64" height="{bot[1]}" fill="url(#{uid}-bot)"/>
  </g>
</svg>'''

# ---------- wordmark ----------
def wordmark_parts():
    d1, w1 = text_path(TMP / "DMSans-800.ttf", "Dacity", 100, -0.04)
    d2, w2 = text_path(TMP / "DMSans-500.ttf", "STRATEGY", 100, 0.34)
    return d1, w1, d2, w2

def wordmark_svg(ink, label, uid="w", with_xmlns=True):
    d1, w1, d2, w2 = wordmark_parts()
    s = 0.3235  # label size relative to the name, as on the site (11px / 34px)
    W = round(max(w1, w2 * s) + 2, 1); H = 118
    return f'''<svg{' xmlns="http://www.w3.org/2000/svg"' if with_xmlns else ''} viewBox="0 0 {W} {H}" role="img" aria-label="Dacity Strategy">
  <path fill="{ink}" transform="translate(1 72)" d="{d1}"/>
  <path fill="{label}" transform="translate(1 112) scale({s})" d="{d2}"/>
</svg>''', W, H

def lockup_svg(ink, label, uid="l"):
    wm, W, H = wordmark_svg(ink, label, uid, with_xmlns=False)
    k = 56 / H; ww = W * k
    total = round(64 + 18 + ww, 1)
    inner_mark = mark_svg(uid, with_xmlns=False).replace('<svg viewBox="0 0 64 64" role="img" aria-label="Dacity Strategy">', '<svg x="0" y="0" width="64" height="64" viewBox="0 0 64 64">')
    inner_wm = wm.replace(f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="Dacity Strategy">', f'<svg x="82" y="4" width="{ww:.1f}" height="56" viewBox="0 0 {W} {H}">')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total} 64" role="img" aria-label="Dacity Strategy">
  {inner_mark}
  {inner_wm}
</svg>''', total

def write(p, s): p.write_text(s); print("wrote", p.relative_to(ROOT))

def build_svgs():
    write(LOGO / "mark.svg", mark_svg())
    wm_dark, _, _ = wordmark_svg(C["text"], C["cyan"], "wd"); write(LOGO / "wordmark-on-dark.svg", wm_dark)
    wm_light, _, _ = wordmark_svg(C["primary_ink"], C["pink_deep"], "wl"); write(LOGO / "wordmark-on-light.svg", wm_light)
    lk_dark, _ = lockup_svg(C["text"], C["cyan"], "ld"); write(LOGO / "lockup-on-dark.svg", lk_dark)
    lk_light, _ = lockup_svg(C["primary_ink"], C["pink_deep"], "ll"); write(LOGO / "lockup-on-light.svg", lk_light)

# ---------- PNG exports via headless Chrome ----------
def shot(html, out, w, h, transparent=False, extra=()):
    page = TMP / (out.stem + ".html"); page.write_text(html)
    args = [CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", "--virtual-time-budget=4000", f"--window-size={w},{h}", f"--screenshot={out}"]
    if transparent: args.append("--default-background-color=00000000")
    args += list(extra) + [f"file://{page}"]
    subprocess.run(args, capture_output=True)

def export_pngs():
    for name, svg_file in (("mark", "mark.svg"), ("wordmark", None), ("lockup", None)):
        for bg in ("transparent", "light", "dark"):
            on_light = bg == "light"
            src = svg_file or f"{name}-on-{'light' if on_light else 'dark'}.svg"
            svg = (LOGO / src).read_text()
            vb = svg.split('viewBox="')[1].split('"')[0].split(); ar = float(vb[2]) / float(vb[3])
            for size in (512, 1024):
                pad = int(size * 0.1)
                if name == "mark": w = h = size; iw = ih = size - 2 * pad
                else: w = size; iw = size - 2 * pad; ih = int(iw / ar); h = ih + 2 * pad
                color = {"transparent": "transparent", "light": C["primary"], "dark": C["ink"]}[bg]
                inner = svg.replace("<svg ", '<svg style="width:100%;height:100%;display:block" ', 1)
                html = f'<!doctype html><html><body style="margin:0;background:{color};width:{w}px;height:{h}px;display:grid;place-items:center"><div style="width:{iw}px;height:{ih}px">{inner}</div></body></html>'
                out = PNG / f"{name}-{size}-{bg}.png"
                shot(html, out, w, h, transparent=(bg == "transparent")); print("png", out.name)

# ---------- X assets ----------
WALL = ("linear-gradient(#0b0308 2px, transparent 2px) 0 0 / 10px 10px, linear-gradient(90deg, #0b0308 2px, transparent 2px) 0 0 / 10px 10px, "
        "radial-gradient(56% 52% at 50% -6%, rgba(255,45,149,.5) 0%, rgba(255,45,149,.2) 45%, rgba(255,45,149,.05) 75%, rgba(255,45,149,0) 100%), "
        "linear-gradient(rgba(255,225,243,.022), rgba(255,225,243,.022)), #0b0308")
FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,200..900&display=swap">'

def export_x():
    mark = (LOGO / "mark.svg").read_text().replace("<svg ", '<svg style="width:100%;height:100%;display:block" ', 1)
    avatar = f'''<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;width:400px;height:400px;background:{WALL};display:grid;place-items:center;overflow:hidden">
<div style="width:224px;height:224px;filter:drop-shadow(0 0 22px rgba(255,45,149,.45))">{mark}</div></body></html>'''
    shot(avatar, X / "profile-400.png", 400, 400); print("png profile-400.png")
    lockup = (LOGO / "lockup-on-dark.svg").read_text().replace("<svg ", '<svg style="height:100%;width:auto;display:block" ', 1)
    banner = f'''<!doctype html><html><head><meta charset="utf-8">{FONT}</head><body style="margin:0;width:1500px;height:500px;background:{WALL};overflow:hidden;font-family:'DM Sans',sans-serif;color:{C['text']}">
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px;padding-bottom:30px">
  <div style="height:112px;filter:drop-shadow(0 0 24px rgba(255,45,149,.35))">{lockup}</div>
  <div style="font-size:30px;font-weight:300;letter-spacing:-.03em">Every fee works <b style="font-weight:800">for holders.</b></div>
  <div style="font-size:16px;font-weight:500;letter-spacing:.02em;color:{C['muted']}">splashg22.github.io/Yo</div>
</div></body></html>'''
    shot(banner, X / "banner-1500x500.png", 1500, 500); print("png banner-1500x500.png")

# ---------- brand sheet ----------
def export_sheet():
    mark = (LOGO / "mark.svg").read_text().replace("<svg ", '<svg style="width:100%;height:100%;display:block" ', 1)
    lk_dark = (LOGO / "lockup-on-dark.svg").read_text().replace("<svg ", '<svg style="height:100%;width:auto;display:block" ', 1)
    lk_light = (LOGO / "lockup-on-light.svg").read_text().replace("<svg ", '<svg style="height:100%;width:auto;display:block" ', 1)
    sw = lambda hexv, name, role: f'<div class="sw"><i style="background:{hexv}"></i><b>{name}</b><code>{hexv}</code><span>{role}</span></div>'
    palette = "".join([sw("#ff2d95", "Pink", "burn, primary accent, active states"), sw("#b65cff", "Violet", "buyback"), sw("#3ee8ff", "Cyan", "holders, links, label"),
                       sw("#0b0308", "Plum", "page background"), sw("#140811", "Card", "frames and panels"), sw("#fff4fa", "Text", "headlines and body"),
                       sw("#ffe1f3", "Pale pink", "primary button fill"), sw("#1c0713", "Button ink", "text on pale pink"), sw("#d10070", "Deep pink", "hover fills, label on light")])
    html = f'''<!doctype html><html><head><meta charset="utf-8">{FONT}<style>
@page {{ size: 1600px 1140px; margin: 0; }}
html,body{{margin:0;background:{C['ink']};color:{C['text']};font-family:'DM Sans',sans-serif;-webkit-font-smoothing:antialiased}}
.sheet{{width:1600px;height:1140px;padding:44px 56px;box-sizing:border-box;display:grid;grid-template-columns:1.05fr .95fr;grid-template-rows:auto 1fr;gap:28px 40px}}
h1{{grid-column:1/-1;margin:0;font-weight:300;font-size:34px;letter-spacing:-.03em}} h1 b{{font-weight:800}} h1 span{{color:{C['muted']};font-size:16px;letter-spacing:0;margin-left:18px;font-weight:400}}
h2{{margin:0 0 12px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:{C['muted']};font-weight:600}}
.col{{display:flex;flex-direction:column;gap:22px;min-height:0}}
.box{{border:1px solid rgba(255,225,243,.12);border-radius:18px;background:{C['card']};padding:20px 22px}}
.logos{{display:grid;grid-template-columns:150px 1fr 1fr;gap:18px;align-items:center}}
.logos .mark{{width:150px;height:150px;background:{WALL};border-radius:16px;display:grid;place-items:center}} .logos .mark div{{width:92px;height:92px}}
.lk{{height:64px;border-radius:14px;display:flex;align-items:center;padding:0 22px}} .lk.dark{{background:{C['ink']};border:1px solid rgba(255,225,243,.12)}} .lk.light{{background:#fff4fa}} .lk>div{{height:36px}}
.rules{{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:14px;line-height:1.45;color:{C['muted']}}} .rules b{{color:{C['text']};font-weight:600;white-space:nowrap}}
.clear{{width:132px;height:132px;margin:4px auto 0;border:1px dashed rgba(62,232,255,.6);border-radius:8px;display:grid;place-items:center;box-sizing:border-box}} .clear .m{{width:66px;height:66px}}
.pal{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}} .sw{{display:grid;grid-template-columns:40px 1fr auto;grid-template-rows:auto auto;gap:2px 10px;align-items:center;font-size:13px}} .sw i{{grid-row:1/3;width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,225,243,.12)}} .sw b{{font-weight:600}} .sw code{{font-size:12px;color:{C['muted']}}} .sw span{{grid-column:2/4;color:{C['muted']};font-size:12px}}
.type{{display:grid;gap:10px}} .type .l{{display:flex;align-items:baseline;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(255,225,243,.08);padding-bottom:8px}} .type small{{color:{C['muted']};font-size:12px;white-space:nowrap}}
.dd{{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}} .d{{border-radius:12px;padding:12px;background:{C['ink']};border:1px solid rgba(255,225,243,.1);font-size:12px;color:{C['muted']};display:flex;flex-direction:column;gap:8px;align-items:flex-start}} .d .v{{height:44px;display:flex;align-items:center}} .d .v>div{{height:40px;width:40px}} .d b{{font-weight:700}} .ok{{color:#4ade80}} .no{{color:#fb7185}}
.sizes{{display:flex;align-items:flex-end;gap:18px}} .sizes div{{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:11px;color:{C['muted']}}}
</style></head><body><div class="sheet">
<h1>Dacity Strategy, <b>brand sheet.</b><span>One page. Everything is taken from the site's own tokens.</span></h1>
<div class="col">
  <div class="box"><h2>Logo</h2><div class="logos"><div class="mark"><div>{mark}</div></div><div class="lk dark"><div>{lk_dark}</div></div><div class="lk light"><div>{lk_light}</div></div></div>
    <div style="display:grid;grid-template-columns:1fr 160px;gap:18px;margin-top:18px;align-items:center">
      <div class="rules"><b>The mark</b><span>A capital D sliced into three bands, 40 / 20 / 40 of its height: pink for the DCTY burn, violet for the buyback, cyan for holders. The bands are the rule; never change their order, colours or proportions.</span>
      <b>Clear space</b><span>Keep a margin of half the mark's height on every side free of other elements (dashed box).</span>
      <b>Minimum size</b><span>24 px on screen, 8 mm in print for the mark; 120 px / 30 mm for the lockup. The gaps still read at 16 px (favicon).</span>
      <b>Wordmark</b><span>"Dacity" in DM Sans 800, tracking −4%; "STRATEGY" in DM Sans 500, tracking +34%, in cyan on dark and deep pink on light.</span></div>
      <div class="clear"><div class="m">{mark}</div></div></div>
    <div class="sizes" style="margin-top:14px"><div><div style="width:64px;height:64px">{mark}</div>64</div><div><div style="width:32px;height:32px">{mark}</div>32</div><div><div style="width:24px;height:24px">{mark}</div>24</div><div><div style="width:16px;height:16px">{mark}</div>16</div></div>
  </div>
  <div class="box"><h2>Do and don't</h2><div class="dd">
    <div class="d"><div class="v"><div>{mark}</div></div><b class="ok">Do</b> use the mark on plum, on the wall texture, or on pale pink.</div>
    <div class="d"><div class="v"><div style="filter:grayscale(1)">{mark}</div></div><b class="no">Don't</b> recolour, flatten to one colour, or swap the band colours.</div>
    <div class="d"><div class="v"><div style="transform:rotate(-14deg) scaleX(1.35)">{mark}</div></div><b class="no">Don't</b> rotate, stretch or skew.</div>
    <div class="d"><div class="v"><div style="filter:drop-shadow(0 0 10px rgba(255,45,149,.5))">{mark}</div></div><b class="ok">Do</b> allow one soft pink drop-shadow on dark; never a halo on light.</div>
    <div class="d"><div class="v" style="background:url(../../art/miami-hero.jpg) center/cover;width:100%;border-radius:8px;padding:0 8px"><div>{mark}</div></div><b class="no">Don't</b> place it on a busy photo without a dark scrim.</div>
    <div class="d"><div class="v"><div style="width:auto;height:30px">{lk_dark}</div></div><b class="ok">Do</b> use the lockup above 120 px; below that use the mark alone.</div>
  </div></div>
</div>
<div class="col">
  <div class="box"><h2>Colour</h2><div class="pal">{palette}</div></div>
  <div class="box"><h2>Type: DM Sans only</h2><div class="type">
    <div class="l"><span style="font-weight:300;font-size:34px;letter-spacing:-.04em">Every fee works <b style="font-weight:800">for holders.</b></span><small>Headline, 300 with one 800 phrase, −4%</small></div>
    <div class="l"><span style="font-weight:800;font-size:22px;letter-spacing:-.03em">Dacity</span><small>Wordmark, 800, −4%</small></div>
    <div class="l"><span style="font-weight:500;font-size:12px;letter-spacing:.34em;color:{C['cyan']}">STRATEGY</span><small>Label, 500, +34%, cyan</small></div>
    <div class="l"><span style="font-weight:400;font-size:15px;color:{C['muted']}">Read from a public Solana RPC in your browser, nothing taken on trust.</span><small>Body, 400, 15 px, 72% text</small></div>
    <div class="l"><span style="font-weight:800;font-size:30px;letter-spacing:-.03em;font-variant-numeric:tabular-nums">945,628,348 <small style="font-size:13px;font-weight:500;letter-spacing:0">DCTY</small></span><small>Numbers, 800, tabular, unit in 500</small></div>
  </div></div>
  <div class="box" style="font-size:13px;color:{C['muted']};line-height:1.5"><h2>Voice</h2>Short sentences. One rule, said plainly: 40% burns DCTY, 20% buys the coin back, 40% is paid to holders in TTWO. Never a figure that is not on the chain. No badges, stamps or "LIVE" readouts. Independent project, not affiliated with Take-Two Interactive, the TTWO issuer or pump.fun.</div>
</div>
</div></body></html>'''
    page = SHEET / "brand-sheet.html"; page.write_text(html)
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", "--virtual-time-budget=6000", "--window-size=1600,1140", f"--screenshot={SHEET / 'brand-sheet.png'}", f"file://{page}"], capture_output=True)
    subprocess.run([CHROME, "--headless=new", "--virtual-time-budget=6000", "--no-pdf-header-footer", f"--print-to-pdf={SHEET / 'brand-sheet.pdf'}", f"file://{page}"], capture_output=True)
    print("sheet png + pdf")

if __name__ == "__main__":
    if "--sheet" in sys.argv: fetch_fonts(); export_sheet(); sys.exit()
    fetch_fonts(); build_svgs(); export_pngs(); export_x(); export_sheet()
    shutil.rmtree(TMP, ignore_errors=True)
