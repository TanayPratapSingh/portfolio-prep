// Portfolio Prep: flashcards, guides, and a narration trainer built only from Tanay's own work.
// Plain ES module, no build step. Progress lives in this browser's localStorage and can be exported.

const GROUPS = [["Portfolio", "Projects"], ["Experience", "Experience"], ["Narration", "Narration"]];
const KIND = {
  pitch_30s: ["30 second pitch", 30], walkthrough_2min: ["2 minute walkthrough", 120], deep_dive_5min: ["5 minute deep dive", 300],
  nontechnical_60s: ["For a recruiter or PM", 60], whiteboard: ["Whiteboard it", 150], followup: ["Follow up", 45],
  pushback: ["Pushback", 45], drill: ["Drill", 25], deep_dive: ["Deep dive", 75], tell_me_30s: ["Tell me about yourself, 30 seconds", 30],
  tell_me_90s: ["Tell me about yourself, 90 seconds", 90], tell_me_3min: ["Tell me about yourself, 3 minutes", 180],
  resume_walkthrough: ["Walk me through your resume", 150],
};
const kindName = (k) => (KIND[k] ? KIND[k][0] : String(k).replace(/_/g, " "));
const kindSecs = (k) => (KIND[k] ? KIND[k][1] : 60);
const TYPE_SECTIONS = [
  ["Concepts and math", ["concept", "define", "formula"]], ["How it is built", ["how", "code"]],
  ["Decisions and tradeoffs", ["why", "compare"]], ["Results", ["number"]], ["Limits and next steps", ["case"]],
  ["Pushback", ["pushback"]], ["Say it", ["narrate", "behavioral"]],
];
const FILLERS = ["um", "uh", "basically", "actually", "you know", "kind of", "sort of", "i mean", "literally"];
const STOP = new Set("about above after again against because been before being below between both could does doing down during each from further have having here into itself just more most other over same should some such than that their them then there these they this those through under until very what when where which while will with would your shows show using used uses make made also only".split(" "));

// ---------- storage ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: progress lasts this visit */ } },
};

const S = {
  manifest: null, decks: new Map(), cards: [],
  srs: store.get("pp.srs", {}), narr: store.get("pp.narr", {}),
  path: store.get("pp.path", null), perDay: store.get("pp.newPerDay", 20), newLog: store.get("pp.newLog", {}),
  sync: null, session: null, rec: null, guideAnchor: null,
};
const $main = document.getElementById("main");

// ---------- helpers ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const TODAY = localDate();
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return localDate(d); };
const key = (c) => `${c._deck}:${c.id}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const getJSON = async (url, cache = "no-cache") => { const r = await fetch(url, { cache }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

// Markdown with KaTeX. Code is shielded first so a "$" in SQL or Python is never read as math.
function md(text, inline = false) {
  if (!text) return "";
  const code = [], math = [];
  let t = String(text).replace(/```[\s\S]*?```|`[^`\n]+`/g, (m) => { code.push(m); return `CDEPH${code.length - 1}CDEPH`; });
  t = t.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => { math.push([m, true]); return `KTXPH${math.length - 1}KTXPH`; });
  t = t.replace(/\$(?![\s\d.,]*\s)(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, m) => { math.push([m, false]); return `KTXPH${math.length - 1}KTXPH`; });
  t = t.replace(/CDEPH(\d+)CDEPH/g, (_, i) => code[+i]);
  const html = window.marked ? (inline ? marked.parseInline(t) : marked.parse(t)) : esc(t).replace(/\n/g, "<br>");
  return html.replace(/KTXPH(\d+)KTXPH/g, (_, i) => {
    const [m, display] = math[+i];
    try { return window.katex ? katex.renderToString(m, { displayMode: display, throwOnError: false }) : esc(m); } catch { return esc(m); }
  });
}
function highlight() { if (window.hljs) $main.querySelectorAll("pre code").forEach((el) => window.hljs.highlightElement(el)); }

function page(route, html, { focus = false } = {}) {
  document.body.classList.toggle("focus", focus);
  document.querySelectorAll("[data-route]").forEach((a) => a.classList.toggle("on", a.dataset.route === route));
  $main.innerHTML = html;
  highlight();
}

// ---------- theme ----------
const $theme = document.getElementById("theme");
const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
function applyTheme(t) { if (t) document.documentElement.dataset.theme = t; $theme.textContent = isDark() ? "Light" : "Dark"; }
applyTheme(store.get("pp.theme", null));
$theme.addEventListener("click", () => { const t = isDark() ? "light" : "dark"; store.set("pp.theme", t); applyTheme(t); });

// ---------- spaced repetition ----------
function schedule(prev, g) {
  const s = { ivl: 0, ease: 2.5, reps: 0, lapses: 0, ...(prev || {}) };
  if (g === 1) { s.reps = 0; s.lapses += 1; s.ease = Math.max(1.3, s.ease - 0.2); s.ivl = 0; }
  else if (g === 2) { s.ivl = Math.max(1, Math.round(s.ivl * 1.2)); s.ease = Math.max(1.3, s.ease - 0.15); s.reps += 1; }
  else if (g === 3) { s.ivl = s.reps === 0 ? 1 : s.reps === 1 ? 3 : Math.max(s.ivl + 1, Math.round(s.ivl * s.ease)); s.reps += 1; }
  else { s.ivl = s.reps === 0 ? 3 : Math.max(s.ivl + 2, Math.round(Math.max(s.ivl, 1) * s.ease * 1.3)); s.ease += 0.15; s.reps += 1; }
  s.due = addDays(TODAY, s.ivl); s.last = TODAY;
  return s;
}
const ivlLabel = (n) => (n === 0 ? "today" : n === 1 ? "1 day" : n < 30 ? `${n} days` : `${Math.round(n / 30)} mo`);
const isDue = (c) => { const s = S.srs[key(c)]; return !!s && s.due <= TODAY; };
const isNew = (c) => !S.srs[key(c)];
const learned = (cards) => cards.filter((c) => !isNew(c)).length;

// ---------- data ----------
async function load() {
  S.manifest = await getJSON("data/manifest.json");
  const v = encodeURIComponent(S.manifest.generated_at || "");
  const ready = S.manifest.decks.filter((d) => d.ready && d.file);
  const decks = await Promise.all(ready.map((d) => getJSON(`${d.file}?v=${v}`, "default").catch(() => null)));
  decks.filter(Boolean).forEach((d) => {
    S.decks.set(d.deck_id, d);
    (d.cards || []).forEach((c) => { c._deck = d.deck_id; c._title = d.title; S.cards.push(c); });
  });
  if (!S.path) S.path = S.manifest.decks.map((d) => d.id);
}
const lazy = {
  async sync() { if (!S.sync) S.sync = await getJSON("data/sync.json").catch(() => null); return S.sync; },
};
const deckCards = (id) => S.cards.filter((c) => c._deck === id);
const findCard = (deck, id) => S.cards.find((c) => c._deck === deck && c.id === id);

// ---------- Learn ----------
const newToday = () => Math.max(0, S.perDay - (S.newLog[TODAY] || 0));
function todayQueue() {
  const pool = S.cards.filter((c) => S.path.includes(c._deck));
  const due = pool.filter(isDue).sort((a, b) => S.srs[key(a)].due.localeCompare(S.srs[key(b)].due));
  return [...due, ...pool.filter(isNew).slice(0, newToday())];
}
function viewLearn() {
  const pool = S.cards.filter((c) => S.path.includes(c._deck));
  const due = pool.filter(isDue).length;
  const fresh = Math.min(newToday(), pool.filter(isNew).length);
  const ready = S.manifest.decks.filter((d) => d.ready).length;
  let h = `<h1>Learn</h1>
    <p class="lede">${fresh} new ${fresh === 1 ? "card is" : "cards are"} lined up for today${due ? ` and ${plural(due, "review")} ${due === 1 ? "is" : "are"} due` : ""}. You have learned ${learned(S.cards)} of ${S.cards.length} cards from ${ready} of ${S.manifest.decks.length} decks. Every card comes from your own projects and roles: the methods, the code, the numbers, the decisions, and how to say them out loud.</p>
    <div class="row"><a class="btn primary" href="#/session">Start today's session</a>
      <label class="check">New cards a day <select id="perday">${[10, 20, 30, 50, 80].map((n) => `<option${n === S.perDay ? " selected" : ""}>${n}</option>`).join("")}</select></label></div>`;
  for (const [g, label] of GROUPS) {
    const decks = S.manifest.decks.filter((d) => d.group === g);
    if (decks.length) h += `<h2>${label}</h2><ul class="list">${decks.map(deckRow).join("")}</ul>`;
  }
  page("learn", h);
  document.getElementById("perday").addEventListener("change", (e) => { S.perDay = +e.target.value; store.set("pp.newPerDay", S.perDay); viewLearn(); });
  $main.querySelectorAll("[data-path]").forEach((cb) => cb.addEventListener("change", () => {
    const id = cb.dataset.path;
    S.path = cb.checked ? [...new Set([...S.path, id])] : S.path.filter((x) => x !== id);
    store.set("pp.path", S.path);
  }));
}
function deckRow(d) {
  if (!d.ready) return `<li class="deck waiting"><div><span class="item-title">${esc(d.title)}</span><div class="item-body">${esc(d.blurb || "")}</div><div class="meta">Being written</div></div></li>`;
  const cards = deckCards(d.id);
  const due = cards.filter(isDue).length;
  return `<li class="deck"><div><a class="item-title" href="#/guide/${esc(d.id)}/plain">${esc(d.title)}</a>
    <div class="item-body">${esc(d.blurb || d.summary_easy || "")}</div>
    <div class="meta">${cards.length} cards, ${learned(cards)} learned${due ? `, ${due} due` : ""}. <a href="#/guide/${esc(d.id)}/plain">Read the guide</a>, <a href="#/session/${esc(d.id)}">study these cards</a>${d.narrations ? `, <a href="#/narrate/${esc(d.id)}/0">drill aloud</a>` : ""}</div></div>
    <label class="check"><input type="checkbox" data-path="${esc(d.id)}"${S.path.includes(d.id) ? " checked" : ""}> in my path</label></li>`;
}

// ---------- card session ----------
const closed = () => ({ answer: false, deep: false, say: false, ev: false });
function startSession(deckId) {
  let queue, label;
  if (deckId) {
    const cs = deckCards(deckId);
    queue = [...cs.filter(isDue), ...cs.filter(isNew), ...cs.filter((c) => !isNew(c) && !isDue(c))];
    label = S.decks.get(deckId)?.title || deckId;
  } else { queue = todayQueue(); label = "Today's session"; }
  S.session = { queue, total: queue.length, done: 0, label, again: new Set(), open: closed() };
  renderSession();
}
function renderSession() {
  const ses = S.session, c = ses.queue[0];
  if (!c) {
    page("learn", `<div class="session"><div class="session-head"><span>${esc(ses.label)}</span><span>done</span></div><div class="progress"><span style="width:100%"></span></div>
      <h1>Session complete</h1><p class="lede">${ses.done ? `You went through ${plural(ses.done, "card")}.` : "Nothing is due and no new cards are left for today."} Practice one story out loud next, or read a guide.</p>
      <div class="actions"><a class="btn primary" href="#/narrate">Narrate</a><a class="link" href="#/guides">Guides</a><a class="link" href="#/learn">Back to Learn</a></div></div>`, { focus: true });
    return;
  }
  const o = ses.open, prev = S.srs[key(c)];
  const toggles = `<button class="link" data-open="deep" aria-pressed="${o.deep}">Go deeper</button>${c.say ? `<button class="link" data-open="say" aria-pressed="${o.say}">Say it</button>` : ""}${(c.evidence || []).length ? `<button class="link" data-open="ev" aria-pressed="${o.ev}">Evidence</button>` : ""}`;
  let h = `<div class="session"><div class="session-head"><span>${esc(ses.label)}</span><span>${ses.done + 1} of ${ses.total}</span></div>
    <div class="progress"><span style="width:${ses.total ? ((100 * ses.done) / ses.total).toFixed(1) : 0}%"></span></div>
    <p class="context">${esc(c._title)}, ${esc(c.type)}${c.level ? `, level ${c.level}` : ""}</p>
    <h1 class="card-q">${md(c.q, true)}</h1>`;
  if (!o.answer) {
    h += `<div class="actions"><button class="btn primary" id="show">Show answer</button>${toggles}</div>`;
  } else {
    h += `<div class="answer">${md(c.easy)}</div>`;
    if (o.deep) h += `<div class="section"><h2>Deeper</h2><div class="answer">${md(c.deep)}</div></div>`;
    if (o.say && c.say) h += `<div class="section"><h2>Say it</h2><div class="spoken">${md(c.say)}</div><p class="meta"><a href="#/narrate/card/${esc(c._deck)}/${esc(c.id)}">Practice it with the timer</a></p></div>`;
    if (o.ev && c.evidence?.length) h += `<div class="section"><h2>Where the numbers come from</h2><ul class="ev">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>`;
    h += `<div class="actions">${toggles}</div>
      <div class="rate">${[[1, "Again"], [2, "Hard"], [3, "Good"], [4, "Easy"]].map(([g, l]) => `<button data-grade="${g}">${l}<kbd>${g}, ${ivlLabel(schedule(prev, g).ivl)}</kbd></button>`).join("")}</div>`;
  }
  h += `<p class="hint">Answer first, in your head or out loud. Space shows the answer, D goes deeper, S shows the spoken version, E shows the evidence, and 1 to 4 rates the card.</p></div>`;
  page("learn", h, { focus: true });
  document.getElementById("show")?.addEventListener("click", () => openPart("answer"));
  $main.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPart(b.dataset.open)));
  $main.querySelectorAll("[data-grade]").forEach((b) => b.addEventListener("click", () => grade(+b.dataset.grade)));
  $main.focus({ preventScroll: true });
}
function openPart(what) {
  const o = S.session.open;
  if (what === "answer") o.answer = true; else { o.answer = true; o[what] = !o[what]; }
  renderSession();
}
function grade(g) {
  const ses = S.session, c = ses.queue.shift(); if (!c) return;
  if (isNew(c)) { S.newLog = { [TODAY]: (S.newLog[TODAY] || 0) + 1 }; store.set("pp.newLog", S.newLog); }
  S.srs[key(c)] = schedule(S.srs[key(c)], g); store.set("pp.srs", S.srs);
  if (g === 1 && !ses.again.has(key(c))) { ses.again.add(key(c)); ses.queue.push(c); ses.total += 1; }
  ses.done += 1; ses.open = closed();
  renderSession(); window.scrollTo(0, 0);
}
function viewCard(deck, id) {
  const c = findCard(deck, id);
  if (!c) { page("", `<p class="empty">That card is not here yet. <a href="#/learn">Back to Learn</a></p>`); return; }
  S.session = { queue: [c], total: 1, done: 0, label: "One card", again: new Set(), open: closed() };
  renderSession();
}

// ---------- guides ----------
function viewGuides(q = "") {
  let h = `<h1>Guides</h1><p class="lede">Each project and role is written two ways with matching sections: a plain guide that explains it to a smart friend, and a deep guide that goes as far as an interviewer will push. Switch depth mid read and you land in the same place.</p>
    <div class="filters"><input type="search" id="q" placeholder="Search every card" value="${esc(q)}" aria-label="Search every card"></div>`;
  if (q.trim().length >= 2) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = S.cards.filter((c) => { const t = `${c.q} ${c.easy} ${c.deep} ${c.say || ""} ${(c.tags || []).join(" ")} ${c._title}`.toLowerCase(); return terms.every((w) => t.includes(w)); });
    h += `<p class="meta">${plural(hits.length, "card")} match.</p><ul class="list">${hits.slice(0, 100).map((c) => `<li><a class="item-title" href="#/card/${esc(c._deck)}/${esc(c.id)}">${md(c.q, true)}</a><div class="meta">${esc(c._title)}, ${esc(c.type)}</div></li>`).join("")}</ul>`;
  } else {
    for (const [g, label] of GROUPS) {
      const decks = S.manifest.decks.filter((d) => d.group === g);
      if (!decks.length) continue;
      h += `<h2>${label}</h2><ul class="list">${decks.map((d) => `<li><span class="item-title">${d.ready ? `<a href="#/guide/${esc(d.id)}/plain">${esc(d.title)}</a>` : esc(d.title)}</span>
        <div class="item-body">${esc(d.blurb || "")}</div>
        ${d.ready ? `<div class="item-links"><a href="#/guide/${esc(d.id)}/plain">Plain</a><a href="#/guide/${esc(d.id)}/deep">Deep</a><a href="#/session/${esc(d.id)}">${d.count} cards</a>${d.narrations ? `<a href="#/narrate/${esc(d.id)}/0">${d.narrations} scripts</a>` : ""}${d.repo ? `<a href="${esc(d.repo)}" target="_blank" rel="noopener">Repository</a>` : ""}</div>` : `<div class="meta">Being written</div>`}</li>`).join("")}</ul>`;
    }
  }
  page("guides", h);
  const $q = document.getElementById("q");
  let t = null;
  $q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { history.replaceState(null, "", `#/guides/${encodeURIComponent($q.value)}`); viewGuides($q.value); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250);
  });
}
function currentSection() {
  let cur = null;
  for (const h of $main.querySelectorAll(".prose h2[id], .prose h3[id]")) { if (h.getBoundingClientRect().top < 120) cur = h.id; }
  return cur;
}
function viewGuide(id, depth = "plain") {
  const d = S.decks.get(id);
  if (!d) { page("guides", `<p class="empty">This guide is being written. <a href="#/guides">All guides</a></p>`); return; }
  const deep = depth === "deep";
  const cards = deckCards(id);
  const secs = [["s-summary", "Summary", "h2"]];
  let body = `<h2 id="s-summary">Summary</h2>${md(deep ? d.summary_deep : d.summary_easy)}`;
  let n = 0;
  body += md(deep ? d.sheet?.deep : d.sheet?.easy).replace(/<h([23])>(.*?)<\/h\1>/g, (_, lvl, txt) => {
    const sid = `s-sh${n++}`; secs.push([sid, txt.replace(/<[^>]+>/g, ""), `h${lvl}`]); return `<h${lvl} id="${sid}">${txt}</h${lvl}>`;
  });
  if ((d.narration || []).length) {
    secs.push(["s-narration", "Say it out loud", "h2"]);
    body += `<h2 id="s-narration">Say it out loud</h2><p class="meta">Practice each rung with the timer before you read its model answer.</p>`;
    d.narration.forEach((x, i) => {
      body += `<h3 id="s-n${i}">${esc(kindName(x.kind))}: ${esc(x.prompt)}</h3><p class="meta"><a href="#/narrate/${esc(id)}/${i}">Practice with the timer</a></p>
        <details><summary>Model answer and keypoints</summary><div class="spoken">${md(x.script)}</div><ul>${(x.keypoints || []).map((k) => `<li>${esc(k)}</li>`).join("")}</ul></details>`;
    });
  }
  for (const [title, types] of TYPE_SECTIONS) {
    const cs = cards.filter((c) => types.includes(c.type));
    if (!cs.length) continue;
    const sid = `s-${types[0]}`;
    secs.push([sid, `${title} (${cs.length})`, "h2"]);
    body += `<h2 id="${sid}">${esc(title)}</h2>` + cs.map((c) => `<div class="qa"><h3>${md(c.q, true)}</h3>${md(deep ? c.deep : c.easy)}
      ${c.say ? `<details><summary>Say it</summary><div class="spoken">${md(c.say)}</div></details>` : ""}
      ${deep && c.evidence?.length ? `<details><summary>Where the numbers come from</summary><ul class="ev">${c.evidence.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></details>` : ""}</div>`).join("");
  }
  if (d.repo || (d.sources || []).length) {
    secs.push(["s-sources", "Sources", "h2"]);
    body += `<h2 id="s-sources">Sources</h2><ul>${d.repo ? `<li><a href="${esc(d.repo)}" target="_blank" rel="noopener">${esc(d.repo)}</a>, the code, tests, and run logs behind the numbers</li>` : ""}${(d.sources || []).map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title || s.url)}</a>${s.why ? `, ${esc(s.why)}` : ""}</li>`).join("")}</ul>`;
  }
  const anchor = S.guideAnchor === id ? currentSection() : null;
  page("guides", `<p class="meta"><a href="#/guides">Guides</a> / ${esc(d.group === "Portfolio" ? "Projects" : d.group)}</p><h1>${esc(d.title)}</h1>
    <div class="depth"><button class="link" data-depth="plain" aria-pressed="${!deep}">Plain</button><button class="link" data-depth="deep" aria-pressed="${deep}">Deep</button>
      <span class="spacer"></span><a href="#/session/${esc(id)}">Study these ${cards.length} cards</a>${(d.narration || []).length ? `<a href="#/narrate/${esc(id)}/0">Narrate it</a>` : ""}${d.repo ? `<a href="${esc(d.repo)}" target="_blank" rel="noopener">Repository</a>` : ""}</div>
    <div class="reader"><nav class="toc" aria-label="Sections">${secs.map(([sid, t, lvl]) => `<a class="${lvl}" href="#" data-jump="${sid}">${esc(t)}</a>`).join("")}</nav>
    <article class="prose">${body}</article></div>`);
  $main.querySelectorAll("[data-depth]").forEach((b) => b.addEventListener("click", () => { history.replaceState(null, "", `#/guide/${id}/${b.dataset.depth}`); viewGuide(id, b.dataset.depth); }));
  $main.querySelectorAll("[data-jump]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView(); }));
  if (anchor) document.getElementById(anchor)?.scrollIntoView(); else window.scrollTo(0, 0);
  S.guideAnchor = id;
}

// ---------- narration ----------
function ladder() {
  const out = [];
  for (const d of S.manifest.decks) {
    const deck = S.decks.get(d.id);
    if (deck) (deck.narration || []).forEach((n, i) => out.push({ deck: d.id, title: deck.title, idx: i, kind: n.kind, prompt: n.prompt, script: n.script, keypoints: n.keypoints || [] }));
  }
  return out;
}
const practiced = (deck, i) => (S.narr[`${deck}/${i}`] || []).length > 0;
function viewNarrateHub() {
  const all = ladder();
  const courses = S.manifest.decks.filter((d) => d.group === "Narration");
  const projects = S.manifest.decks.filter((d) => d.group !== "Narration");
  const h = `<h1>Narrate</h1><p class="lede">Knowing a project and saying it well are separate skills. Every project has a ladder: a 30 second pitch, a 2 minute walkthrough, a 5 minute deep dive, a version for a recruiter, a whiteboard script, the follow ups an interviewer asks next, and the hostile pushbacks. Start the timer, answer out loud, then compare against the model answer and its keypoints.</p>
    <h2>Learn the skill</h2><ul class="list">${courses.map((d) => `<li class="deck${d.ready ? "" : " waiting"}"><div>${d.ready ? `<a class="item-title" href="#/guide/${esc(d.id)}/plain">${esc(d.title)}</a>` : `<span class="item-title">${esc(d.title)}</span>`}
      <div class="item-body">${esc(d.blurb)}</div><div class="meta">${d.ready ? `${d.count} cards, ${d.narrations} scripts. <a href="#/session/${esc(d.id)}">Study the cards</a>${d.narrations ? `, <a href="#/narrate/${esc(d.id)}/0">start the drills</a>` : ""}` : "Being written"}</div></div></li>`).join("")}</ul>
    <h2>Every project, rung by rung</h2>
    <div class="table-wrap"><table class="ladder"><thead><tr><th>Project</th><th>Practiced</th><th>Rungs</th></tr></thead><tbody>
    ${projects.map((d) => {
      const rungs = all.filter((n) => n.deck === d.id);
      if (!rungs.length) return `<tr><td>${esc(d.title)}</td><td class="meta">${d.ready ? "no scripts" : "being written"}</td><td></td></tr>`;
      const firsts = [], seen = new Set();
      rungs.forEach((n) => { if (!seen.has(n.kind)) { seen.add(n.kind); firsts.push(n); } });
      return `<tr><td><a href="#/guide/${esc(d.id)}/plain">${esc(d.title)}</a></td><td class="nowrap">${rungs.filter((n) => practiced(n.deck, n.idx)).length} of ${rungs.length}</td>
        <td class="kinds">${firsts.map((n) => `<a href="#/narrate/${esc(n.deck)}/${n.idx}"${practiced(n.deck, n.idx) ? ' class="done"' : ""}>${esc(kindName(n.kind))}</a>`).join("")}</td></tr>`;
    }).join("")}</tbody></table></div>
    <p class="meta" style="margin-top:1rem"><a href="#" id="rand">Give me a random prompt</a></p>`;
  page("narrate", h);
  document.getElementById("rand").addEventListener("click", (e) => { e.preventDefault(); if (all.length) { const n = all[Math.floor(Math.random() * all.length)]; location.hash = `#/narrate/${n.deck}/${n.idx}`; } });
}
function keypointsFromCard(c) {
  return (c.deep || c.easy || "").replace(/```[\s\S]*?```/g, "").split(/(?<=[.!?])\s+/).filter((s) => s.length > 30).slice(0, 5).map((s) => s.replace(/[*_`$]/g, "").slice(0, 160));
}
function viewTrainer(item, histKey, nav) {
  const target = kindSecs(item.kind);
  const hist = (S.narr[histKey] || []).slice(-6).reverse();
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  page("narrate", `<div class="session"><div class="session-head"><span>${esc(item.title)}</span><span>${esc(nav.pos)}</span></div><div class="progress"><span style="width:${nav.pct}%"></span></div>
    <p class="context">${esc(kindName(item.kind))}</p><h1 class="card-q">${esc(item.prompt)}</h1>
    <p class="meta">Aim for about ${target} seconds, roughly ${Math.round(target * 2.4)} words at a calm pace.</p>
    <div class="timer" id="t">0:00</div>
    <div class="actions"><button class="btn primary" id="start">Start</button><button class="btn" id="stop" disabled>Stop</button>
      <label class="check"><input type="checkbox" id="audio" checked> Record audio</label>
      ${SR ? `<label class="check"><input type="checkbox" id="sr"> Live transcript (Chrome sends the audio to Google to transcribe it)</label>` : ""}</div>
    <div id="out"></div>
    <div class="section"><h2>Keypoints</h2><ul class="checklist" id="kp">${item.keypoints.map((k, i) => `<li><input type="checkbox" id="kp${i}"><label for="kp${i}"><span>${esc(k)}</span></label></li>`).join("")}</ul></div>
    <div class="section"><details id="model"><summary>Model answer (open after you finish)</summary><div class="spoken">${md(item.script)}</div></details></div>
    <div class="actions">${nav.prev ? `<a class="link" href="${nav.prev}">Previous rung</a>` : ""}<button class="btn" id="save">Save this attempt</button>${nav.next ? `<a class="btn primary" href="${nav.next}">Next rung</a>` : ""}</div>
    ${hist.length ? `<div class="section"><h2>Your attempts</h2><ul class="list">${hist.map((a) => `<li class="stat-line">${esc(a.date)}: ${a.secs} s${a.words ? `, ${a.words} words, ${a.wpm} words a minute, ${plural(a.fillers, "filler")}` : ""}, ${a.covered} of ${a.total} keypoints</li>`).join("")}</ul></div>` : ""}
    <p class="hint">Recording stays in this tab and is gone when you leave it. Escape exits.</p></div>`, { focus: true });
  wireRecorder(item, target, histKey);
}
function viewNarrate(a, b, c) {
  if (!a) return viewNarrateHub();
  if (a === "card") {
    const card = findCard(b, c);
    if (!card || !card.say) return viewNarrateHub();
    return viewTrainer({ title: card._title, kind: card.type === "behavioral" ? "tell_me_90s" : "followup", prompt: card.q, script: card.say, keypoints: keypointsFromCard(card) },
      `card/${b}/${c}`, { pos: "one card", pct: 100, prev: `#/card/${b}/${c}`, next: "" });
  }
  const rungs = ladder().filter((n) => n.deck === a);
  const i = rungs.findIndex((n) => String(n.idx) === String(b ?? 0));
  if (i < 0) return viewNarrateHub();
  const item = rungs[i];
  return viewTrainer(item, `${a}/${item.idx}`, {
    pos: `${i + 1} of ${rungs.length}`, pct: ((100 * (i + 1)) / rungs.length).toFixed(1),
    prev: i > 0 ? `#/narrate/${a}/${rungs[i - 1].idx}` : "", next: i < rungs.length - 1 ? `#/narrate/${a}/${rungs[i + 1].idx}` : "",
  });
}
const contentWords = (s) => (s.toLowerCase().match(/[a-z0-9.%]+/g) || []).filter((w) => (w.length >= 4 && !STOP.has(w)) || /\d/.test(w));
function coverage(keypoints, transcript) {
  const bag = new Set(contentWords(transcript).map((w) => w.slice(0, 5)));
  return keypoints.map((k) => { const ws = contentWords(k); return ws.length > 0 && ws.filter((w) => bag.has(w.slice(0, 5))).length / ws.length >= 0.5; });
}
function wireRecorder(item, target, histKey) {
  const $t = document.getElementById("t"), $start = document.getElementById("start"), $stop = document.getElementById("stop"), $out = document.getElementById("out");
  let t0 = 0, tick = null, rec = null, chunks = [], stream = null, sr = null, finalText = "", interim = "", running = false, secs = 0;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const show = () => { $out.innerHTML = `<p class="transcript">${esc(finalText + interim) || "Listening..."}</p>`; };
  $start.addEventListener("click", async () => {
    finalText = ""; interim = ""; chunks = []; $out.innerHTML = "";
    if (document.getElementById("audio")?.checked && navigator.mediaDevices?.getUserMedia) {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.start(); }
      catch { $out.innerHTML = `<p class="rec">The microphone is blocked, so this attempt is timed only.</p>`; }
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR && document.getElementById("sr")?.checked) {
      sr = new SR(); sr.continuous = true; sr.interimResults = true; sr.lang = "en-US";
      sr.onresult = (e) => { interim = ""; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += e.results[i][0].transcript + " "; else interim += e.results[i][0].transcript; } show(); };
      sr.onend = () => { if (running) { try { sr.start(); } catch { /* restarting */ } } };
      try { sr.start(); show(); } catch { sr = null; }
    }
    running = true; t0 = performance.now(); $start.disabled = true; $stop.disabled = false;
    tick = setInterval(() => { const s = (performance.now() - t0) / 1000; $t.textContent = fmt(s); $t.classList.toggle("over", s > target * 1.15); }, 200);
  });
  $stop.addEventListener("click", () => {
    running = false; clearInterval(tick); $start.disabled = false; $stop.disabled = true;
    secs = Math.round((performance.now() - t0) / 1000);
    if (sr) { try { sr.stop(); } catch { /* stopped */ } }
    const finish = () => {
      const text = (finalText + interim).trim();
      const words = text ? text.split(/\s+/).length : 0;
      const low = ` ${text.toLowerCase()} `;
      const fillers = FILLERS.reduce((n, f) => n + (low.match(new RegExp(`\\b${f}\\b`, "g")) || []).length, 0);
      const wpm = words ? Math.round((words / Math.max(secs, 1)) * 60) : 0;
      let h = chunks.length ? `<audio controls src="${URL.createObjectURL(new Blob(chunks, { type: chunks[0].type || "audio/webm" }))}"></audio>` : "";
      h += `<p class="stat-line">${secs} seconds against a ${target} second target${secs > target * 1.15 ? ": too long, cut a detail and keep the result" : secs < target * 0.6 ? ": short, add the result and one number" : ""}.${words ? ` ${words} words, ${wpm} words a minute (130 to 160 is easy to follow), ${plural(fillers, "filler word")}.` : ""}</p>`;
      if (text) h += `<p class="transcript">${esc(text)}</p>`;
      $out.innerHTML = h;
      if (text) coverage(item.keypoints, text).forEach((hit, i) => { if (hit) { const cb = document.getElementById(`kp${i}`); cb.checked = true; cb.closest("li").classList.add("hit"); } });
      document.getElementById("model").open = true;
      S.rec = { words, fillers, wpm };
    };
    if (rec && rec.state !== "inactive") { rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); finish(); }; rec.stop(); } else finish();
  });
  document.getElementById("save").addEventListener("click", () => {
    const boxes = [...document.querySelectorAll("#kp input")];
    (S.narr[histKey] = S.narr[histKey] || []).push({ date: TODAY, secs, covered: boxes.filter((b) => b.checked).length, total: boxes.length, ...(S.rec || {}) });
    store.set("pp.narr", S.narr); S.rec = null; route();
  });
}

// ---------- today, progress ----------
// The day's drill is picked in the browser from a seed made of the date, so it is the same all day and needs no server.
function seeded(seed) { let h = 2166136261; for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; }
function todaysDrill() {
  const rnd = seeded(TODAY);
  const pool = S.cards.flatMap((c) => Array(c.level === 1 ? 3 : 1).fill(c));
  const picked = [];
  for (let tries = 0; pool.length && picked.length < 5 && tries < 500; tries++) { const c = pool[Math.floor(rnd() * pool.length)]; if (!picked.includes(c)) picked.push(c); }
  const rungs = ladder().filter((n) => ["pitch_30s", "walkthrough_2min", "deep_dive_5min", "whiteboard", "followup", "pushback"].includes(n.kind));
  return { cards: picked, narrate: rungs.length ? rungs[Math.floor(rnd() * rungs.length)] : null };
}
async function viewToday() {
  const sync = await lazy.sync();
  const { cards, narrate: n } = todaysDrill();
  let h = `<h1>Today</h1><p class="lede">Five questions and one story from your own work, a new set every day. Answer each out loud before you open it.</p>
    <h2>Drill</h2>${cards.length ? `<ol>${cards.map((c) => `<li><a href="#/card/${esc(c._deck)}/${esc(c.id)}">${md(c.q, true)}</a> <span class="meta">${esc(c._title)}</span></li>`).join("")}</ol>` : `<p class="empty">The drill appears once the first decks are published.</p>`}
    ${n ? `<h2>Narrate today</h2><p>${esc(n.title)}, ${esc(kindName(n.kind).toLowerCase())}: ${esc(n.prompt)}</p><p><a class="btn primary" href="#/narrate/${esc(n.deck)}/${n.idx}">Practice with the timer</a></p>` : ""}
    <h2>Portfolio sync</h2>`;
  if (!sync) h += `<p class="empty">No portfolio sync has run yet.</p>`;
  else {
    const items = [
      ...sync.changes.map((c) => `${esc(c.kind[0].toUpperCase() + c.kind.slice(1))} on the portfolio: ${esc(c.project)}`),
      ...sync.missing_decks.map((t) => `On the portfolio but no deck yet: ${esc(t)}`),
      ...sync.repo_updates.map((r) => `Repository ${esc(r.repo)} changed since the last check, so the <a href="#/guide/${esc(r.deck)}/deep">deck</a> may be stale`),
      ...sync.broken_evidence.map((b) => `A quoted number no longer matches its source: ${esc(b.problem)}`),
      ...(sync.errors || []).map((e) => `Sync error: ${esc(e)}`),
    ];
    h += `<p>Last checked ${esc(sync.checked_at.replace("T", " ").slice(0, 16))} UTC against tanaypratapsingh.github.io and every project repository. Run the Sync workflow on GitHub after you change the portfolio.</p>
      <ul>${items.length ? items.map((x) => `<li>${x}</li>`).join("") : "<li>Nothing changed. Every quoted number still matches its source.</li>"}</ul>`;
    if ((sync.history || []).length > 1) h += `<details><summary>Earlier checks</summary><ul>${sync.history.slice(1, 30).map((x) => `<li class="stat-line">${esc(x.date)}: ${esc(x.summary)}</li>`).join("")}</ul></details>`;
  }
  page("today", h);
}
function viewProgress() {
  const attempts = Object.values(S.narr).reduce((n, a) => n + a.length, 0);
  const rows = S.manifest.decks.filter((d) => d.ready).map((d) => {
    const cs = deckCards(d.id);
    const done = (S.decks.get(d.id)?.narration || []).filter((_, i) => practiced(d.id, i)).length;
    return `<tr><td><a href="#/guide/${esc(d.id)}/plain">${esc(d.title)}</a></td><td>${learned(cs)} of ${cs.length}</td><td>${cs.filter(isDue).length}</td><td>${done} of ${d.narrations}</td></tr>`;
  }).join("");
  page("progress", `<h1>Progress</h1><p class="lede">${learned(S.cards)} of ${S.cards.length} cards learned, ${S.cards.filter(isDue).length} due today, ${plural(attempts, "narration attempt")} saved. Progress lives in this browser only. Export it to keep a copy or to move it to another device.</p>
    <div class="row"><button class="btn" id="exp">Export progress</button><label class="btn">Import progress<input id="imp" type="file" accept="application/json" hidden></label></div>
    <h2>By deck</h2><div class="table-wrap"><table><thead><tr><th>Deck</th><th>Learned</th><th>Due</th><th>Scripts practiced</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  document.getElementById("exp").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ srs: S.srs, narr: S.narr, path: S.path, exported: new Date().toISOString() }, null, 1)], { type: "application/json" });
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `portfolio-prep-progress-${TODAY}.json` });
    a.click(); URL.revokeObjectURL(a.href);
  });
  document.getElementById("imp").addEventListener("change", async (e) => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      S.srs = { ...S.srs, ...(data.srs || {}) }; S.narr = { ...S.narr, ...(data.narr || {}) };
      store.set("pp.srs", S.srs); store.set("pp.narr", S.narr); viewProgress();
    } catch { alert("That file is not an exported progress file."); }
  });
}

// ---------- router and keys ----------
async function route() {
  const parts = decodeURIComponent(location.hash.replace(/^#\/?/, "")).split("/");
  const [r, a, b, c] = parts;
  try {
    if (!r || r === "learn") viewLearn();
    else if (r === "session") startSession(a);
    else if (r === "card") viewCard(a, b);
    else if (r === "guides") viewGuides(parts.slice(1).join("/"));
    else if (r === "guide") viewGuide(a, b);
    else if (r === "narrate") viewNarrate(a, b, c);
    else if (r === "today") await viewToday();
    else if (r === "progress") viewProgress();
    else viewLearn();
  } catch (e) { page("", `<p class="empty">Something failed to load: ${esc(e.message)}</p>`); }
  if (r !== "guide") window.scrollTo(0, 0);
}
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches("button, a, summary") && (e.key === " " || e.key === "Enter")) return;
  if (e.key === "Escape" && document.body.classList.contains("focus")) { location.hash = "#/learn"; return; }
  const inSession = document.body.classList.contains("focus") && S.session && /^#\/(session|card)/.test(location.hash);
  if (!inSession || !S.session.queue[0]) return;
  const k = e.key.toLowerCase();
  if (k === " " || k === "enter") { e.preventDefault(); openPart("answer"); }
  else if (k === "d") openPart("deep");
  else if (k === "s") openPart("say");
  else if (k === "e") openPart("ev");
  else if (S.session.open.answer && ["1", "2", "3", "4"].includes(k)) grade(+k);
});
window.addEventListener("hashchange", route);
load().then(route).catch((e) => page("", `<p class="empty">Could not load the decks: ${esc(e.message)}</p>`));
