#!/usr/bin/env python3
"""Generate assets/weights.json from the X algorithm's param.rs.

The published page can't reach xai-org/x-algorithm, so the table is built
here at author time and stamped with the commit it came from. Re-run this
after pulling the algorithm repo and the table (and its provenance line)
update themselves -- three of these weights changed inside the August
release window alone, so hand-maintaining them is how the article goes stale.

  usage: python3 tools/gen_weights.py [path-to-x-algorithm-checkout]
"""
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(sys.argv[1] if len(sys.argv) > 1
            else "/Users/yushanli/Desktop/CompSci/cs294/x-recsys-2026")
SRC  = REPO / "home-mixer/params/param.rs"
OUT  = Path(__file__).resolve().parent.parent / "assets/weights.json"

# param name -> how a person would say it
LABEL = {
    "ShareViaCopyLinkWeight": "Share via copy link", "ReplyWeight": "Reply",
    "ShareViaDmWeight": "Share via DM", "QuoteWeight": "Quote",
    "FollowAuthorWeight": "Follow author", "ShareWeight": "Share",
    "RetweetWeight": "Repost", "FavoriteWeight": "Like", "ClickWeight": "Click",
    "OpenLinkWeight": "Open link", "PostUnexploredWeight": "Post unexplored",
    "VideoOpenWeight": "Video open", "PhotoExpandWeight": "Photo expand",
    "QuotedClickWeight": "Quoted click", "DwellWeight": "Dwell",
    "ContDwellTimeWeight": "Continuous dwell time",
    "ProfileClickWeight": "Profile click", "VqvWeight": "Video quality view",
    "QuotedVqvWeight": "Quoted video quality view",
    "ContClickDwellTimeWeight": "Continuous click dwell time",
    "ContActiveSecs5mResidualNormWeight": "Active seconds (5m residual)",
    "NotDwelledWeight": "Did not dwell", "BlockAuthorWeight": "Block author",
    "NotInterestedWeight": "Not interested", "MuteAuthorWeight": "Mute author",
    "ReportWeight": "Report",
}

text = SRC.read_text()
pat = re.compile(r'param!\(\s*([A-Za-z0-9_]+)\s*,\s*f64\s*,\s*"[^"]+"\s*,\s*(-?[0-9.]+)\s*,?\s*\)', re.S)
found = {n: float(v) for n, v in pat.findall(text)}

missing = [k for k in LABEL if k not in found]
if missing:
    sys.exit(f"param.rs no longer defines: {', '.join(missing)}")

rows = [{"param": k, "label": LABEL[k], "weight": found[k]} for k in LABEL]
rows.sort(key=lambda r: -r["weight"])

git = lambda *a: subprocess.check_output(["git", "-C", str(REPO), *a], text=True).strip()
data = {
    "source": "xai-org/x-algorithm home-mixer/params/param.rs",
    "commit": git("rev-parse", "--short", "HEAD"),
    "commit_date": git("log", "-1", "--date=short", "--format=%ad"),
    "positive_sum": round(sum(r["weight"] for r in rows if r["weight"] > 0), 4),
    "negative_sum": round(sum(r["weight"] for r in rows if r["weight"] < 0), 4),
    "weights": rows,
}
OUT.write_text(json.dumps(data, indent=2) + "\n")
print(f"{OUT.name}: {len(rows)} weights @ {data['commit']} ({data['commit_date']})")
print(f"  positives +{data['positive_sum']}   negatives {data['negative_sum']}")
