#!/usr/bin/env python3
"""
Clipforge media service — the real render core (Milestone 1).

One canonical EditDecisionList (EDL) drives a deterministic FFmpeg render:
  trim -> crop (16:9 -> 9:16) -> optional facecam band -> scale to 1080x1920
  -> burn karaoke captions (libass) -> encode H.264/AAC, yuv420p, +faststart.

Subcommands:
  fixture  : synthesize a 16:9 test source with a visible frame counter + tone
  probe    : ffprobe -> normalized metadata JSON (orientation, rational fps, etc.)
  render   : EDL JSON -> real MP4 (optionally --platform yt|tt|ig)

The EDL may also carry the GTA build's original layer: `hook` {text, dur},
`note` {text}, `loopSeam` (last 0.35 s fades into the first frame) and
`audio.mutes` [[a, b]] (radio music ducked to 12%).

Design rules honored here:
  * argument arrays, never a shell (no interpolation)
  * rational frame rate preserved from probe; integer, even pixel dimensions
  * preview and export read the SAME EDL (apps/web renders the same model)
  * synthetic fixtures carry an honest "SYNTHETIC FIXTURE" label + frame counter
"""
import argparse, json, subprocess, sys, os, tempfile, shutil

# ---------- small helpers ----------

def run(cmd, **kw):
    """Run an argv array with no shell. Raise on failure with captured stderr."""
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
    if p.returncode != 0:
        sys.stderr.write(p.stderr.decode("utf-8", "replace"))
        raise SystemExit(f"command failed ({p.returncode}): {' '.join(cmd[:6])} ...")
    return p

def even(n):
    n = int(round(n))
    return n - (n % 2)

def hex_to_ass(hexstr):
    """#RRGGBB -> &H00BBGGRR (opaque) for ASS."""
    h = hexstr.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()

def ff():
    return shutil.which("ffmpeg") or "ffmpeg"

def fp():
    return shutil.which("ffprobe") or "ffprobe"

# ---------- fixture ----------

def cmd_fixture(args):
    """Synthesize an honest 16:9 test clip: gradient bg, a moving subject, a
    facecam box, a HUD, a burned frame counter + timecode, and a tone."""
    W, H, fps, dur = 1920, 1080, args.fps, args.duration
    out = args.out
    # Build filter graph: background + moving subject (overlay) + HUD text.
    vf = (
        # background gradient-ish base
        f"color=c=0x0a0e18:s={W}x{H}:r={fps}:d={dur}[bg];"
        # subject: soft violet block that moves (known, deterministic motion)
        f"color=c=0xa99bff:s=150x150:r={fps}:d={dur}[sub];"
        # facecam placeholder: dark panel
        f"color=c=0x16203a:s=360x220:r={fps}:d={dur}[fc];"
        f"[bg][sub]overlay=x='(W-w)/2+360*sin(t*1.15)':y='(H-h)/2+150*sin(t*1.7)'[m1];"
        f"[m1][fc]overlay=x=W-w-40:y=40[m2];"
        # HUD: scene label, frame counter, timecode, honesty label
        f"[m2]drawtext=fontfile={args.font}:text='FINAL CIRCLE':x=(w-text_w)/2:y=40:"
        f"fontsize=34:fontcolor=white@0.55:box=0,"
        f"drawtext=fontfile={args.font}:text='SYNTHETIC FIXTURE — frame %{{n}}':"
        f"x=40:y=h-60:fontsize=30:fontcolor=white@0.5,"
        f"drawtext=fontfile={args.fontmono}:timecode='00\\:00\\:00\\:00':rate={fps}:"
        f"x=w-360:y=h-60:fontsize=30:fontcolor=0x2fd4e3@0.9[v]"
    )
    cmd = [
        ff(), "-y",
        "-f", "lavfi", "-i", f"sine=frequency=220:sample_rate=48000:duration={dur}",
        "-filter_complex", vf,
        "-map", "[v]", "-map", "0:a",
        "-r", str(fps),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        out,
    ]
    run(cmd)
    print(json.dumps({"ok": True, "out": out, "width": W, "height": H, "fps": fps, "duration": dur}))

# ---------- probe ----------

def cmd_probe(args):
    cmd = [fp(), "-v", "quiet", "-print_format", "json",
           "-show_format", "-show_streams", args.input]
    out = run(cmd).stdout.decode("utf-8")
    data = json.loads(out)
    v = next((s for s in data.get("streams", []) if s.get("codec_type") == "video"), {})
    a = next((s for s in data.get("streams", []) if s.get("codec_type") == "audio"), {})
    # rational fps, do not collapse 30000/1001 to "30"
    rfr = v.get("r_frame_rate", "0/1")
    try:
        num, den = (int(x) for x in rfr.split("/"))
        fps_float = round(num / den, 4) if den else None
    except Exception:
        num, den, fps_float = None, None, None
    norm = {
        "container": data.get("format", {}).get("format_name"),
        "duration_s": float(data.get("format", {}).get("duration", 0) or 0),
        "size_bytes": int(data.get("format", {}).get("size", 0) or 0),
        "video": {
            "codec": v.get("codec_name"),
            "coded_w": v.get("coded_width"), "coded_h": v.get("coded_height"),
            "display_w": v.get("width"), "display_h": v.get("height"),
            "pix_fmt": v.get("pix_fmt"),
            "r_frame_rate": rfr, "fps": fps_float,
            "rotation": next((int(sd.get("rotation", 0))
                              for sd in v.get("side_data_list", []) if "rotation" in sd), 0),
            "sar": v.get("sample_aspect_ratio"), "dar": v.get("display_aspect_ratio"),
            "color_primaries": v.get("color_primaries"),
            "color_transfer": v.get("color_transfer"),
            "has_bframes": v.get("has_b_frames"),
        } if v else None,
        "audio": {
            "codec": a.get("codec_name"), "channels": a.get("channels"),
            "sample_rate": a.get("sample_rate"), "language": a.get("tags", {}).get("language"),
        } if a else None,
        "audio_present": bool(a),
    }
    print(json.dumps(norm, indent=2))

# ---------- ASS caption generation (karaoke) ----------

def ass_escape(text):
    """Plain text -> safe ASS text (no override tags, no line breaks from users)."""
    return str(text).replace("\\", "\\\\").replace("{", "(").replace("}", ")").replace("\n", " ").strip()


def build_ass(edl, play_w=1080, play_h=1920):
    st = edl.get("captions", {}).get("style", {})
    font = st.get("font", "Inter")
    size = int(st.get("size", 60))
    primary = hex_to_ass(st.get("primary", "#2fd4e3"))     # spoken/highlight color
    secondary = hex_to_ass(st.get("secondary", "#ffffff")) # not-yet-spoken color
    outline = int(st.get("outline", 5))
    shadow = int(st.get("shadow", 1))
    bold = -1 if st.get("bold", True) else 0
    pos = float(st.get("pos", 0.72))           # fraction from top
    margin_v = even((1 - pos) * play_h)        # ASS alignment 2 = from bottom
    back = "&H64000000"                         # soft shadow bg
    # hook / commentary sit near the top, or just under the face cam band
    band = edl.get("facecam", {}).get("dst_h") if edl.get("layout") == "gameplay_facecam" else None
    hook_margin = even(play_h * (band + 0.03 if band else 0.1))

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {play_w}
PlayResY: {play_h}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,{font},{size},{primary},{secondary},&H00101010,{back},{bold},0,0,0,100,100,0,0,1,{outline},{shadow},2,80,80,{margin_v},1
Style: Hook,{font},{even(play_h * 0.04)},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,{max(4, even(play_h * 0.0042))},0,8,70,70,{hook_margin},1
Style: Note,{font},{even(play_h * 0.029)},&H00FFFFFF,&H00FFFFFF,&H59000000,&H59000000,-1,0,0,0,100,100,0,0,3,{even(play_h * 0.009)},0,8,90,90,{hook_margin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text
"""

    def ts(t):
        cs = int(round(t * 100))
        h = cs // 360000; cs -= h * 360000
        m = cs // 6000;   cs -= m * 6000
        s = cs // 100;    cs -= s * 100
        return f"{h}:{m:02d}:{s:02d}.{cs:02d}"

    events = []
    for line in edl.get("captions", {}).get("lines", []):
        words = line.get("words", [])
        if not words:
            continue
        l_start = words[0]["t"]
        l_end = max(w["t"] + w["d"] for w in words)
        parts = []
        prev_end = l_start
        for w in words:
            gap = max(0, w["t"] - prev_end)
            if gap > 0.001:
                parts.append("{\\k%d}\\h" % int(round(gap * 100)))
            dur_cs = max(1, int(round(w["d"] * 100)))
            parts.append("{\\k%d}%s" % (dur_cs, w["w"]))
            parts.append(" ")
            prev_end = w["t"] + w["d"]
        text = "".join(parts).strip()
        events.append(f"Dialogue: 0,{ts(l_start)},{ts(l_end)},Cap,,0,0,,{text}")

    # the original layer: a hook on screen first, then one line of commentary
    hook = edl.get("hook") or {}
    hdur = float(hook.get("dur", 2.5)) if hook.get("text") else 0.0
    if hook.get("text"):
        events.append(f"Dialogue: 1,{ts(0)},{ts(hdur)},Hook,,0,0,,{{\\q0\\fad(0,250)}}{ass_escape(hook['text']).upper()}")
    note = edl.get("note") or {}
    if note.get("text"):
        n0 = float(note.get("start", hdur + 0.15 if hdur else 0.3))
        n1 = n0 + float(note.get("dur", 3.45 if hdur else 3.3))
        events.append(f"Dialogue: 1,{ts(n0)},{ts(n1)},Note,,0,0,,{{\\q0\\fad(200,200)}}{ass_escape(note['text'])}")

    return header + "\n".join(events) + "\n"


# ---------- platform cuts: one edit, three lengths ----------

PLATFORM_MAX = {"yt": 60.0, "ig": 90.0, "tt": 180.0}


def apply_platform(edl, platform, src_dur):
    """Return a copy of the EDL cut for one platform. TikTok only pays Creator
    Rewards on videos over one minute, so its cut pulls lead-in (70%) and
    aftermath (30%) from the full recording until it passes 61 seconds. Caption,
    commentary and mute times move with the new start; the hook stays first."""
    e = json.loads(json.dumps(edl))
    tr = e.setdefault("trim", {})
    tin = float(tr.get("in", 0)); tout = float(tr.get("out", 0) or src_dur)
    pre = 0.0
    if platform == "tt" and tout - tin < 61:
        need = 61.5 - (tout - tin)
        pre = min(need * 0.7, tin)
        post = min(need - pre, max(0.0, src_dur - tout))
        pre = min(need - post, tin)
        tin -= pre; tout += post
    cap = PLATFORM_MAX.get(platform)
    if cap and tout - tin > cap:
        tout = tin + cap
    tr["in"], tr["out"] = round(tin, 3), round(tout, 3)
    if pre:
        for line in e.get("captions", {}).get("lines", []):
            for w in line.get("words", []):
                w["t"] = round(w["t"] + pre, 3)
        if e.get("note", {}).get("start") is not None:
            e["note"]["start"] = e["note"]["start"] + pre
        e.setdefault("audio", {})["mutes"] = [[a + pre, b + pre] for a, b in e.get("audio", {}).get("mutes", [])]
    e["platform"] = platform
    return e

# ---------- render ----------

def source_duration(path):
    p = run([fp(), "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path])
    return float(p.stdout.decode().strip())


def cmd_render(args):
    with open(args.edl, "r", encoding="utf-8") as f:
        edl = json.load(f)
    src_dur = None
    if getattr(args, "platform", None):
        src_dur = source_duration(edl["source"]["path"])
        edl = apply_platform(edl, args.platform, src_dur)

    src = edl["source"]["path"]
    sw = int(edl["source"]["width"]); sh = int(edl["source"]["height"])
    ow = int(edl["output"]["width"]); oh = int(edl["output"]["height"])
    ofps = edl["output"].get("fps", 30)
    trim = edl.get("trim", {})
    tin = float(trim.get("in", 0)); tout = float(trim.get("out", 0)) or None
    crop = edl.get("crop", {"x": 0, "y": 0, "w": 1, "h": 1})
    layout = edl.get("layout", "full")
    fc = edl.get("facecam")
    audio = edl.get("audio", {})

    # crop pixels (even)
    cw = even(sw * crop["w"]); ch = even(sh * crop["h"])
    cx = even(sw * crop["x"]); cy = even(sh * crop["y"])
    cx = max(0, min(cx, sw - cw)); cy = max(0, min(cy, sh - ch))

    # ASS captions
    tmpd = tempfile.mkdtemp(prefix="cf_render_")
    ass_path = os.path.join(tmpd, "captions.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(build_ass(edl, ow, oh))
    ass_ff = ass_path.replace("\\", "/").replace(":", "\\:")

    # video filter chain
    chains = []
    # trim + reset pts
    trim_expr = f"trim=start={tin}" + (f":end={tout}" if tout else "") + ",setpts=PTS-STARTPTS"
    chains.append(f"[0:v]{trim_expr},split=2[vraw][vface]" if (layout == "gameplay_facecam" and fc) else f"[0:v]{trim_expr}[vraw]")

    # main gameplay crop -> scale to output
    chains.append(f"[vraw]crop={cw}:{ch}:{cx}:{cy},scale={ow}:{oh}:flags=bicubic,setsar=1[vmain]")

    if layout == "gameplay_facecam" and fc:
        fcw = even(sw * fc["w"]); fch = even(sh * fc["h"])
        fcx = even(sw * fc["x"]); fcy = even(sh * fc["y"])
        band_h = even(oh * fc.get("dst_h", 0.19))
        # scale facecam to output width, cap its height to the band, crop to fit
        chains.append(
            f"[vface]crop={fcw}:{fch}:{fcx}:{fcy},scale={ow}:-2:flags=bicubic,"
            f"crop={ow}:{band_h}:0:0,setsar=1[vfc]"
        )
        chains.append(f"[vmain][vfc]overlay=0:0[vcomp]")
        # separator line under the facecam band
        chains.append(f"[vcomp]drawbox=x=0:y={band_h}:w={ow}:h=3:color=0x2fd4e3@0.6:t=fill[vbox]")
        vlast = "vbox"
    else:
        vlast = "vmain"

    # burn captions (plus hook and commentary)
    loop = bool(edl.get("loopSeam"))
    chains.append(f"[{vlast}]subtitles=filename='{ass_ff}'" + ("[vsub]" if loop else "[vout]"))

    # loop ending: the last moment fades into the first frame so a replay is seamless
    if loop:
        D = (tout if tout else (src_dur or source_duration(src))) - tin
        seam = max(0.1, min(0.35, D / 4))
        chains.append("[vsub]split=2[vm][vf]")
        chains.append(f"[vf]trim=end_frame=1,loop=loop=-1:size=1,setpts=N/{ofps}/TB,trim=duration={D:.3f},"
                      f"format=yuva420p,fade=t=in:st={D - seam:.3f}:d={seam:.3f}:alpha=1[vff]")
        chains.append("[vm][vff]overlay=0:0:shortest=1,format=yuv420p[vout]")

    # audio chain
    aexpr = f"atrim=start={tin}" + (f":end={tout}" if tout else "") + ",asetpts=PTS-STARTPTS"
    gain = float(audio.get("gain_db", 0))
    if gain:
        aexpr += f",volume={gain}dB"
    for a, b in audio.get("mutes", []):  # radio music: duck to 12% in these output ranges
        aexpr += f",volume=enable='between(t,{float(a):.3f},{float(b):.3f})':volume=0.12"
    if audio.get("loudnorm", False):
        aexpr += ",loudnorm=I=-14:TP=-1.5:LRA=11"
    aexpr += ",aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    chains.append(f"[0:a]{aexpr}[aout]")

    filter_complex = ";".join(chains)

    out = args.out
    cmd = [
        ff(), "-y", "-i", src,
        "-filter_complex", filter_complex,
        "-map", "[vout]", "-map", "[aout]",
        "-r", str(ofps),
        "-c:v", "libx264", "-preset", "medium", "-crf", "19",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.0",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart",
        "-metadata", "comment=Rendered by Clipforge media service from a canonical EDL",
        out,
    ]
    if args.print_cmd:
        print(" ".join(cmd))
    run(cmd)
    shutil.rmtree(tmpd, ignore_errors=True)
    print(json.dumps({"ok": True, "out": out, "output_w": ow, "output_h": oh,
                      "crop_px": {"w": cw, "h": ch, "x": cx, "y": cy},
                      "ass": "burned", "layout": layout, "platform": edl.get("platform"),
                      "trim": edl.get("trim"), "loop_seam": loop, "mutes": len(audio.get("mutes", []))}))

# ---------- cli ----------

def main():
    ap = argparse.ArgumentParser(prog="clipforge-media")
    sub = ap.add_subparsers(dest="cmd", required=True)

    f = sub.add_parser("fixture")
    f.add_argument("--out", required=True)
    f.add_argument("--duration", type=float, default=12.0)
    f.add_argument("--fps", type=int, default=30)
    f.add_argument("--font", default="/usr/share/fonts/opentype/inter/Inter-Bold.otf")
    f.add_argument("--fontmono", default="/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
    f.set_defaults(func=cmd_fixture)

    p = sub.add_parser("probe")
    p.add_argument("input")
    p.set_defaults(func=cmd_probe)

    r = sub.add_parser("render")
    r.add_argument("--edl", required=True)
    r.add_argument("--out", required=True)
    r.add_argument("--print-cmd", action="store_true")
    r.add_argument("--platform", choices=["yt", "tt", "ig"], help="cut for one platform (TikTok runs past 61 s)")
    r.set_defaults(func=cmd_render)

    args = ap.parse_args()
    args.func(args)

if __name__ == "__main__":
    main()
