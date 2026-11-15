#!/usr/bin/env python3
"""
Clipforge intake: a watch folder for capture-card recordings.

Point OBS, Elgato or the console's capture software at a folder. Every new
video that has stopped growing is scanned for moments (detect.py) and gets a
`<name>.moments.json` next to the results. Files already handled are
remembered in `.intake-state.json`, so restarting never scans twice.

    python3 services/media/intake.py --watch /captures --out /captures/clipforge
    python3 services/media/intake.py --watch /captures --out /captures/clipforge --once
"""
import argparse, json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect import scan  # noqa: E402

VIDEO = (".mp4", ".mov", ".mkv", ".webm", ".m4v", ".ts", ".flv")


def load_state(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"done": {}}


def save_state(path, st):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, path)


def candidates(folder):
    for name in sorted(os.listdir(folder)):
        p = os.path.join(folder, name)
        if name.startswith(".") or not name.lower().endswith(VIDEO) or not os.path.isfile(p):
            continue
        yield p


def run_once(watch, out, state_path, sizes, log=print):
    """One pass. A file is scanned once its size is the same on two passes in a row."""
    st = load_state(state_path)
    handled = 0
    for p in candidates(watch):
        key = os.path.abspath(p)
        size = os.path.getsize(p)
        if st["done"].get(key, {}).get("size") == size:
            continue
        if sizes.get(key) != size:
            sizes[key] = size  # still being written, or first sighting
            continue
        log(json.dumps({"event": "scan_start", "file": p, "bytes": size}))
        t0 = time.time()
        try:
            res = scan(p)
        except Exception as e:  # keep the watcher alive; report and move on
            log(json.dumps({"event": "scan_failed", "file": p, "error": str(e)[:300]}))
            st["done"][key] = {"size": size, "error": str(e)[:300], "at": time.time()}
            save_state(state_path, st)
            continue
        dest = os.path.join(out, os.path.splitext(os.path.basename(p))[0] + ".moments.json")
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=2)
        st["done"][key] = {"size": size, "moments": len(res["moments"]), "out": dest, "at": time.time()}
        save_state(state_path, st)
        handled += 1
        log(json.dumps({"event": "scan_done", "file": p, "moments": len(res["moments"]),
                        "letterbox": res["letterbox"], "seconds": round(time.time() - t0, 1), "out": dest}))
    return handled


def main():
    ap = argparse.ArgumentParser(prog="clipforge-intake")
    ap.add_argument("--watch", required=True, help="folder your capture software records into")
    ap.add_argument("--out", required=True, help="where .moments.json files go")
    ap.add_argument("--every", type=float, default=10.0, help="seconds between passes")
    ap.add_argument("--once", action="store_true", help="two quick passes, then exit (for tests and cron)")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    state = os.path.join(a.out, ".intake-state.json")
    sizes = {}
    if a.once:
        run_once(a.watch, a.out, state, sizes)
        time.sleep(1.0)
        n = run_once(a.watch, a.out, state, sizes)
        print(json.dumps({"event": "once_done", "scanned": n}))
        return
    print(json.dumps({"event": "watching", "folder": a.watch, "every": a.every}))
    while True:
        run_once(a.watch, a.out, state, sizes)
        time.sleep(a.every)


if __name__ == "__main__":
    main()
