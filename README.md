# Portfolio Prep

Flashcards, plain and deep guides, and a narration trainer for every project and
role on [tanaypratapsingh.github.io](https://tanaypratapsingh.github.io), and nothing
else. General interview material lives in
[ml-interview-prep](https://github.com/TanayPratapSingh/ml-interview-prep); this site is
only about what Tanay built.

**Site:** https://tanaypratapsingh.github.io/portfolio-prep/

## What is in it

- **A deck per project and per role.** Each one covers the problem, the data, every
  method with its math, every design decision and the rejected alternative, the code,
  the tests, every result, what broke, what would break at scale, and the pushback an
  interviewer will throw. Every card has a plain answer, a deeper answer, and often a
  spoken version.
- **Two guides per deck,** plain and deep, with matching sections, so switching depth
  mid read keeps your place.
- **A narration ladder for every project:** a 30 second pitch, a 2 minute walkthrough,
  a 5 minute deep dive, a version for a recruiter, a whiteboard script, the follow ups
  that come next, and hostile pushbacks, each with keypoints.
- **A narration course** on how to tell a technical story, and a deck on the story that
  runs across the whole portfolio: tell me about yourself in three lengths and three
  framings, which project to lead with for which role, and every behavioral prompt mapped
  to a real project.
- **A narration trainer** that times you, records you (the audio never leaves the tab),
  optionally transcribes you in Chrome, counts words per minute and filler words, and
  ticks the keypoints you hit.
- **Spaced repetition** with a daily new card budget and an "in my path" switch per deck.
  Progress stays in the browser and exports to a file.

## Keeping it in step with the portfolio

Nothing here runs on a schedule. The day's drill (five questions and one story) is picked in
the browser from the date. When the portfolio or a project repository changes, run the
**Sync with portfolio** workflow from the Actions tab: it re-scrapes both and reports any
project added or rewritten, any project with no deck yet, any repository pushed since the
last check, and any card whose quoted number no longer matches its source. The report shows
on the run page and on the Today tab.

## How the numbers stay honest

Every result quoted from a project carries an `evidence` field: a verbatim quote from
the portfolio text (`sources/`) or from a file in the project's public repository. On
every push, `python scraper/build.py --evidence` string matches each quote against its
source and fails the deploy if any one is missing. Partial or single seed results say so
in the same sentence as the number.

## Layout

```
index.html, assets/      the site (plain ES module, no build step; theme shared with ml-interview-prep)
decks/*.json             one deck per project, role, or narration topic
scraper/plan.json        every deck the site should have, in portfolio order
scraper/build.py         deck validation, evidence check, data/manifest.json
scraper/sync.py          the on demand portfolio sync
sources/                 portfolio text that evidence quotes are checked against
data/                    manifest and the latest sync report
```

## Run it locally

```bash
python3 scraper/build.py --evidence
python3 -m http.server 8000
```
