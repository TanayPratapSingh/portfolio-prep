"""Portfolio sync, run on demand.

Re-scrapes tanaypratapsingh.github.io and the project repositories, then reports
what changed against the decks:

  - projects added, removed, or rewritten on the portfolio site
  - portfolio projects that have no deck yet
  - cards whose evidence quote no longer matches its source (a number changed)
  - project repositories pushed since the last sync (the deck may be stale)

Writes sources/portfolio_*.txt (when the site changed), data/sync.json,
and a summary on the Actions run page. Run it by hand from the Actions tab after the
portfolio changes. Standard library only.
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402  (shared evidence checker)

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://tanaypratapsingh.github.io"
NOW = dt.datetime.now(dt.timezone.utc)
TODAY = NOW.date().isoformat()
PLAN = json.loads((ROOT / "scraper" / "plan.json").read_text())["decks"]

# Entity handling matches the extraction the decks' evidence quotes were taken from.
ENTITIES = {"&nbsp;": " ", "&middot;": "/", "&amp;": "&", "&epsilon;": "ε", "&minus;": "-", "&delta;": "δ",
            "&lt;": "<", "&gt;": ">", "&times;": "x", "&rarr;": "->", "&asymp;": "≈", "&le;": "<=", "&ge;": ">=",
            "&sigma;": "σ", "&mu;": "μ", "&lambda;": "λ", "&alpha;": "α", "&beta;": "β", "&plusmn;": "±"}


def fetch(url: str) -> str:
    headers = {"User-Agent": "portfolio-prep-sync"}
    token = os.environ.get("GITHUB_TOKEN")
    if token and url.startswith("https://api.github.com/"):
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=30) as r:
        return r.read().decode("utf8", "replace")


def strip_body(s: str) -> str:
    s = s.replace("<h4>", "\n\n## ").replace("</h4>", "\n").replace("<li>", "\n- ")
    s = re.sub(r"<br\s*/?>", "\n", s).replace("</p>", "\n")
    s = re.sub(r"<[^>]+>", "", s)
    for a, b in ENTITIES.items():
        s = s.replace(a, b)
    return s


def portfolio_projects() -> tuple[str, list[dict]]:
    js = fetch(f"{SITE}/site/data/projects.js")
    decoder = json.JSONDecoder()  # decode from each "const NAME=" so comment lines between arrays do not matter
    arrays = {m.group(1): decoder.raw_decode(js, m.end())[0] for m in re.finditer(r"const (\w+)=", js)}
    projects, repos = arrays["PROJECTS"], arrays.get("REPOS", [])
    out, items = "", []
    for i, p in enumerate(projects):
        title = strip_body(p["title"])
        out += (f"\n\n==================== PROJECT {i}: {title}\nMETA: {strip_body(p.get('meta', ''))}\n"
                f"BADGE: {strip_body(p.get('badge', ''))}\nTAGS: {', '.join(p.get('tags', []))}\n"
                f"REPO: {json.dumps(repos[i] if i < len(repos) else '')}\n{strip_body(p.get('body', ''))}")
        items.append({"title": title, "repo": repos[i] if i < len(repos) else "", "body": strip_body(p.get("body", ""))})
    return out, items


def portfolio_profile() -> str:
    out = ""
    for part in ("rail", "experience", "education", "skills"):
        s = fetch(f"{SITE}/site/partials/{part}.html")
        s = re.sub(r"<[^>]*>", " ", s).replace("&nbsp;", " ").replace("&amp;", "&").replace("&middot;", ",")
        s = re.sub(r" +", " ", s)
        s = re.sub(r"\n+", "\n", s)
        out += f"=== {part}\n{s}\n"
    return out


def deck_for(title: str) -> dict | None:
    for d in PLAN:
        if d["project"] and title.startswith(d["project"]):
            return d
    return None


def load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def save(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")


def split_projects(text: str) -> dict[str, str]:
    parts = re.split(r"\n==================== PROJECT \d+: ", text)
    return {p.split("\n", 1)[0]: p for p in parts[1:]}


def main() -> int:
    prev = load(ROOT / "data/sync.json", {})
    report = {"checked_at": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"), "changes": [], "missing_decks": [],
              "broken_evidence": [], "repo_updates": [], "repos": prev.get("repos", {}), "errors": []}

    # 1. The portfolio itself
    try:
        projects_txt, items = portfolio_projects()
        profile_txt = portfolio_profile()
        old_projects = (ROOT / "sources/portfolio_projects.txt").read_text() if (ROOT / "sources/portfolio_projects.txt").exists() else ""
        old_profile = (ROOT / "sources/portfolio_profile.txt").read_text() if (ROOT / "sources/portfolio_profile.txt").exists() else ""
        before, after = split_projects(old_projects), split_projects(projects_txt)
        report["changes"] += [{"kind": "added", "project": t} for t in after if t not in before]
        report["changes"] += [{"kind": "removed", "project": t} for t in before if t not in after]
        report["changes"] += [{"kind": "rewritten", "project": t} for t in after if t in before and build.norm(after[t]) != build.norm(before[t])]
        if build.norm(old_profile) != build.norm(profile_txt):
            report["changes"].append({"kind": "rewritten", "project": "Experience, education, or skills section"})
        if build.norm(old_projects) != build.norm(projects_txt):
            (ROOT / "sources/portfolio_projects.txt").write_text(projects_txt)
        if build.norm(old_profile) != build.norm(profile_txt):
            (ROOT / "sources/portfolio_profile.txt").write_text(profile_txt)
        report["missing_decks"] = [p["title"] for p in items if not deck_for(p["title"])]
    except Exception as e:  # noqa: BLE001, reported in the brief
        report["errors"].append(f"portfolio fetch failed: {e!r}"[:300])
        items = []

    # 2. Evidence: does every quoted number still match its source?
    portfolio = build.norm(" ".join(p.read_text(encoding="utf8") for p in build.SOURCES if p.exists()))
    decks = {}
    for f in sorted((ROOT / "decks").glob("*.json")):
        d = json.loads(f.read_text(encoding="utf8"))
        decks[d["deck_id"]] = d
        for c in d.get("cards", []):
            for problem in build.check_evidence(d["deck_id"], c, portfolio):
                report["broken_evidence"].append({"deck": d["deck_id"], "card": c["id"], "problem": problem})

    # 3. Repositories pushed since the last sync
    for d in PLAN:
        deck = decks.get(d["id"])
        repo = (deck or {}).get("repo", "")
        m = re.search(r"github\.com/TanayPratapSingh/([^/]+)", repo or "")
        if not m:
            continue
        name = m.group(1)
        try:
            pushed = json.loads(fetch(f"https://api.github.com/repos/TanayPratapSingh/{name}"))["pushed_at"]
        except Exception as e:  # noqa: BLE001
            report["errors"].append(f"repo {name}: {e!r}"[:200])
            continue
        last = report["repos"].get(name)
        if last and pushed > last:
            report["repo_updates"].append({"repo": name, "deck": d["id"], "pushed_at": pushed})
        report["repos"][name] = pushed

    summary = (f"{len(report['changes'])} portfolio changes, {len(report['missing_decks'])} projects without a deck, "
               f"{len(report['broken_evidence'])} broken evidence quotes, {len(report['repo_updates'])} repos updated")
    report["history"] = ([{"date": TODAY, "summary": summary}] + [h for h in prev.get("history", []) if h["date"] != TODAY])[:60]
    save(ROOT / "data/sync.json", report)

    # 4. A readable summary for the Actions run page
    lines = [f"## Portfolio sync, {TODAY}", "", summary + "."]
    lines += [f"- {c['kind'].capitalize()}: {c['project']}" for c in report["changes"]]
    lines += [f"- No deck yet: {t}" for t in report["missing_decks"]]
    lines += [f"- Repository {r['repo']} pushed at {r['pushed_at']}; review {r['deck']}" for r in report["repo_updates"]]
    lines += [f"- Broken evidence: {b['problem']}" for b in report["broken_evidence"]]
    lines += [f"- Sync error: {e}" for e in report["errors"]]
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as fh:
            fh.write("\n".join(lines) + "\n")
    print(summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
