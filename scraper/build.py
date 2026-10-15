"""Validate every deck and write data/manifest.json.

    python scraper/build.py              schema and style checks, then the manifest
    python scraper/build.py --evidence   also string match every evidence quote against its source

Evidence quotes are how the numbers stay honest: a quote prefixed "portfolio:" or
"profile:" must appear in sources/portfolio_*.txt (the text of
tanaypratapsingh.github.io), and a quote prefixed "repo:<name>/<path>:" must appear
in that file of the public repository on GitHub. Any failure exits non zero, so a
deck with an untraceable number never deploys.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DECKS = ROOT / "decks"
SOURCES = [ROOT / "sources" / "portfolio_projects.txt", ROOT / "sources" / "portfolio_profile.txt"]

GROUPS = ["Portfolio", "Experience", "Narration", "Behavioral", "ML Fundamentals", "Deep Learning",
          "Statistics and Experimentation", "LLMs and GenAI", "RAG and Retrieval", "Evals and Safety", "Agents",
          "ML System Design", "SQL", "Analytics and Product", "Data Engineering", "Python and Coding", "Daily"]
TYPES = {"concept", "how", "why", "number", "pushback", "compare", "define", "formula", "code", "case",
         "behavioral", "narrate"}
DASH = re.compile("[\u2014\u2013]")
HYPHEN = re.compile(r"\b(real-time|end-to-end|open-source|fine-tun\w*|state-of-the-art|human-in-the-loop|zero-shot|long-tail|high-level|post-train\w*)\b", re.I)
BANNED = re.compile(r"\b(delve|leverage|utilize|robust|seamless|crucial|pivotal|showcase|meticulous|intricate|foster|facilitate|empower|streamline|tapestry|realm|beacon|multifaceted|paramount|transformative|elevate|embark|supercharge|harness|testament|game changer|paradigm shift|cutting-edge|ever-evolving)\b", re.I)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def strip_code(text: str) -> str:
    text = re.sub(r"```.*?```", "", text, flags=re.S)
    text = re.sub(r"`[^`]*`", "", text)
    return re.sub(r"\$\$.*?\$\$|\$[^$\n]*\$", "", text, flags=re.S)


def texts(d: dict):
    yield "summary", d.get("summary_easy", "") + " " + d.get("summary_deep", "")
    yield "sheet", d.get("sheet", {}).get("easy", "") + " " + d.get("sheet", {}).get("deep", "")
    for n in d.get("narration", []):
        yield f"narration {n.get('kind')}", " ".join([n.get("prompt", ""), n.get("script", ""), *n.get("keypoints", [])])
    for c in d.get("cards", []):
        yield c.get("id", "?"), " ".join(str(c.get(k, "")) for k in ("q", "easy", "deep", "say"))


_raw_cache: dict[str, str | None] = {}


def repo_file(repo: str, path: str) -> str | None:
    url = f"https://raw.githubusercontent.com/TanayPratapSingh/{repo}/HEAD/{path}"
    if url not in _raw_cache:
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "interview-prep-build"}), timeout=30) as r:
                _raw_cache[url] = r.read().decode("utf8", "replace")
        except Exception:  # noqa: BLE001, reported as a missing file below
            _raw_cache[url] = None
    return _raw_cache[url]


def check_evidence(deck_id: str, c: dict, portfolio: str) -> list[str]:
    errs = []
    for e in c.get("evidence", []):
        m = re.match(r"(portfolio|profile): (.*)$", e, re.S)
        if m:
            if norm(m.group(2)) not in portfolio:
                errs.append(f"{deck_id}/{c['id']}: portfolio quote not found: {m.group(2)[:80]!r}")
            continue
        m = re.match(r"repo:([^/]+)/(.+?): (.*)$", e, re.S)
        if not m:
            errs.append(f"{deck_id}/{c['id']}: evidence has no recognised prefix: {e[:60]!r}")
            continue
        text = repo_file(m.group(1), m.group(2))
        if text is None:
            errs.append(f"{deck_id}/{c['id']}: could not load {m.group(1)}/{m.group(2)}")
        elif norm(m.group(3)) not in norm(text):
            errs.append(f"{deck_id}/{c['id']}: quote not in {m.group(1)}/{m.group(2)}: {m.group(3)[:80]!r}")
    return errs


def validate(d: dict, path: Path) -> list[str]:
    errs = []
    did = d.get("deck_id", path.stem)
    for k in ("deck_id", "title", "group", "summary_easy", "summary_deep", "sheet", "cards"):
        if k not in d:
            errs.append(f"{did}: missing {k}")
    if d.get("deck_id") != path.stem:
        errs.append(f"{did}: deck_id does not match file name {path.name}")
    if d.get("group") not in GROUPS:
        errs.append(f"{did}: unknown group {d.get('group')!r}")
    ids = set()
    for c in d.get("cards", []):
        for k in ("id", "type", "level", "q", "easy", "deep"):
            if not c.get(k):
                errs.append(f"{did}/{c.get('id')}: missing {k}")
        if c.get("id") in ids:
            errs.append(f"{did}: duplicate card id {c.get('id')}")
        ids.add(c.get("id"))
        if c.get("type") not in TYPES:
            errs.append(f"{did}/{c.get('id')}: unknown type {c.get('type')!r}")
        if c.get("type") in ("narrate", "behavioral") and not c.get("say"):
            errs.append(f"{did}/{c.get('id')}: {c['type']} card needs a say field")
    for where, t in texts(d):
        if DASH.search(t):
            errs.append(f"{did} {where}: em or en dash")
        prose = strip_code(t)
        for m in HYPHEN.finditer(prose):
            errs.append(f"{did} {where}: hyphenated compound {m.group(0)!r}")
        for m in BANNED.finditer(prose):
            errs.append(f"{did} {where}: banned word {m.group(0)!r}")
    return errs


def main() -> int:
    evidence = "--evidence" in sys.argv
    portfolio = norm(" ".join(p.read_text(encoding="utf8") for p in SOURCES if p.exists()))
    errs, decks = [], []
    all_ids: dict[str, str] = {}
    for path in sorted(DECKS.glob("*.json")):
        try:
            d = json.loads(path.read_text(encoding="utf8"))
        except json.JSONDecodeError as e:
            errs.append(f"{path.name}: invalid JSON: {e}")
            continue
        errs += validate(d, path)
        for c in d.get("cards", []):
            if c.get("id") in all_ids and all_ids[c["id"]] != d["deck_id"]:
                errs.append(f"card id {c['id']} is used in both {all_ids[c['id']]} and {d['deck_id']}")
            all_ids[c.get("id")] = d.get("deck_id")
            if evidence:
                errs += check_evidence(d.get("deck_id", path.stem), c, portfolio)
        types: dict[str, int] = {}
        for c in d.get("cards", []):
            types[c.get("type")] = types.get(c.get("type"), 0) + 1
        decks.append({
            "id": d.get("deck_id"), "title": d.get("title"), "group": d.get("group"), "file": f"decks/{path.name}",
            "count": len(d.get("cards", [])), "narrations": len(d.get("narration", [])), "types": types,
            "summary_easy": d.get("summary_easy", ""), "repo": d.get("repo", ""),
        })
    # Planned decks keep portfolio order; a planned deck with no file yet is listed as being written.
    plan = json.loads((ROOT / "scraper" / "plan.json").read_text())["decks"]
    built = {x["id"]: x for x in decks}
    for x in decks:
        x["ready"] = True
    decks = [{**built[p["id"]], "blurb": p["blurb"]} if p["id"] in built else
             {"id": p["id"], "title": p["title"], "group": p["group"], "blurb": p["blurb"], "ready": False,
              "count": 0, "narrations": 0, "types": {}, "file": "", "summary_easy": "", "repo": ""}
             for p in plan] + [x for x in decks if x["id"] not in {p["id"] for p in plan}]
    order = {g: i for i, g in enumerate(GROUPS)}
    decks.sort(key=lambda x: order.get(x["group"], 99))  # stable: plan order within each group
    manifest = {
        "generated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "totals": {"decks": sum(1 for x in decks if x["ready"]), "planned": len(decks), "cards": sum(x["count"] for x in decks),
                   "narrations": sum(x["narrations"] for x in decks)},
        "decks": decks,
    }
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False) + "\n")
    print(f"{manifest['totals']['decks']} of {manifest['totals']['planned']} decks, {manifest['totals']['cards']} cards, {manifest['totals']['narrations']} narration scripts"
          + (", evidence checked" if evidence else ""))
    for e in errs:
        print("ERROR", e)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
