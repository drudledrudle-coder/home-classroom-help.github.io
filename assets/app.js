/* DropRadar UK — frontend renderer.
   Reads the JSON the Actions bot publishes and paints the page.
   Pure vanilla JS, no build step, no dependencies. */

const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 52; // r=52 in the SVG
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (e) {
    console.warn(`Could not load ${path}:`, e);
    return fallback;
  }
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00Z" : iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function relTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

/* ---------- verdict / gauge ---------- */
function renderPrediction(p) {
  const body = document.body;
  body.setAttribute("data-status", p.status || "no");

  const words = { live: "YES", likely: "LIKELY", maybe: "MAYBE", no: "NO" };
  document.getElementById("verdict-word").textContent = words[p.status] || "—";
  document.getElementById("verdict-sub").textContent = p.verdict || "";

  // gauge
  const num = document.getElementById("prob-num");
  const fill = document.getElementById("gauge-fill");
  animateNumber(num, p.probability ?? 0);
  const offset = GAUGE_CIRCUMFERENCE * (1 - (p.probability ?? 0) / 100);
  requestAnimationFrame(() => { fill.style.strokeDashoffset = offset; });

  // countdown
  const cd = document.getElementById("cd-value");
  if (p.status === "live") {
    cd.textContent = "Happening now 🔴";
  } else if (p.next_drop_estimate) {
    const days = Math.round((new Date(p.next_drop_estimate + "T00:00:00Z") - Date.now()) / 86400000);
    const when = fmtDate(p.next_drop_estimate);
    cd.textContent = days <= 0 ? `${when} (due)` : `${when} · in ~${days} day${days === 1 ? "" : "s"}`;
  } else {
    cd.textContent = "not enough history yet";
  }

  // reasons
  const ul = document.getElementById("reasons");
  ul.innerHTML = "";
  (p.reasons || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    ul.appendChild(li);
  });
  if (!(p.reasons || []).length) {
    ul.innerHTML = "<li>No signals available yet — waiting on the next scrape.</li>";
  }

  document.getElementById("base-rate").textContent = `${p.base_rate ?? "–"}%`;
  document.getElementById("live-boost").textContent = `+${p.live_boost ?? 0}`;
  document.getElementById("updated").textContent =
    `Last updated ${relTime(p.generated_at)} · ${fmtDate(p.date)}`;
}

function animateNumber(el, target) {
  const start = performance.now();
  const from = 0;
  function step(now) {
    const t = Math.min(1, (now - start) / 900);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (target - from) * eased);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- sources ---------- */
function renderSignals(status) {
  const s = status.signals || {};
  const health = status.source_health || {};

  setSource("pokemoncenter", health.pokemoncenter, buildPCDetail(s.pokemoncenter));
  setSource("x", health.x, buildXDetail(s.x));
  setSource("isthereadroptoday", health.isthereadroptoday, buildItadtDetail(s.isthereadroptoday));

  renderTicker(s.x);
}

function setSource(key, ok, detail) {
  const el = document.querySelector(`.source[data-key="${key}"]`);
  if (!el) return;
  el.classList.toggle("ok", !!ok);
  el.classList.toggle("down", !ok);
  const id = { pokemoncenter: "src-pc", x: "src-x", isthereadroptoday: "src-itadt" }[key];
  document.getElementById(id).textContent = detail;
}

function buildPCDetail(pc) {
  if (!pc || !pc.ok) return "Backend unreachable right now (blocked or offline).";
  return `${pc.available_now} watched SKU(s) available · ${pc.total_products} matching products · checked ${relTime(pc.checked_at)}.`;
}
function buildXDetail(x) {
  if (!x || !x.ok) return x && x.note ? x.note : "No live X feed (token not configured).";
  return `${x.volume} recent posts · ${x.drop_mentions} live-drop mention(s) · checked ${relTime(x.checked_at)}.`;
}
function buildItadtDetail(i) {
  if (!i || !i.ok) return "Reference site unreachable (Cloudflare) — using stored history.";
  return `Reference status: "${i.status}" · ${i.past_drops?.length || 0} historical dates parsed · checked ${relTime(i.checked_at)}.`;
}

function renderTicker(x) {
  const wrap = document.getElementById("ticker-wrap");
  const ul = document.getElementById("ticker");
  const posts = (x && x.posts) || [];
  if (!posts.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  ul.innerHTML = "";
  posts.slice(0, 8).forEach((post) => {
    const li = document.createElement("li");
    if (post.live_signal) li.classList.add("live");
    li.textContent = post.text;
    if (post.created_at) {
      const t = document.createElement("time");
      t.textContent = relTime(post.created_at);
      li.appendChild(t);
    }
    ul.appendChild(li);
  });
}

/* ---------- history ---------- */
function renderHistory(history) {
  const drops = (history.drops || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  document.getElementById("hist-count").textContent = drops.length ? `(${drops.length} logged)` : "";

  // weekday distribution
  const counts = [0, 0, 0, 0, 0, 0, 0];
  drops.forEach((d) => {
    const day = new Date(d.date + "T00:00:00Z").getUTCDay(); // 0=Sun
    const idx = (day + 6) % 7; // → 0=Mon
    counts[idx]++;
  });
  const max = Math.max(1, ...counts);
  const todayIdx = (new Date().getUTCDay() + 6) % 7;
  const bars = document.getElementById("weekday-bars");
  bars.innerHTML = "";
  counts.forEach((c, i) => {
    const div = document.createElement("div");
    div.className = "wd" + (i === todayIdx ? " today" : "");
    div.innerHTML =
      `<div class="wd-count">${c}</div>` +
      `<div class="bar-wrap"><div class="bar" style="height:0"></div></div>` +
      `<div class="wd-name">${DAYS[i]}</div>`;
    bars.appendChild(div);
    requestAnimationFrame(() => {
      div.querySelector(".bar").style.height = `${(c / max) * 100}%`;
    });
  });

  // list
  const list = document.getElementById("history-list");
  list.innerHTML = "";
  drops.slice(0, 60).forEach((d) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="h-date">${fmtDate(d.date)}</span>` +
      `<span class="h-title">${escapeHtml(d.title || "Drop")}</span>`;
    list.appendChild(li);
  });
  if (!drops.length) list.innerHTML = "<li>No history yet.</li>";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- boot ---------- */
async function boot() {
  const [status, history] = await Promise.all([
    loadJSON("data/status.json", null),
    loadJSON("data/history.json", { drops: [] }),
  ]);

  if (status && status.prediction) {
    renderPrediction(status.prediction);
    renderSignals(status);
  } else {
    document.getElementById("verdict-word").textContent = "…";
    document.getElementById("verdict-sub").textContent =
      "No prediction data yet — the bot hasn't published its first run.";
  }
  renderHistory(history);
}

boot();
// Refresh in place every 5 minutes so an open tab stays current.
setInterval(boot, 5 * 60 * 1000);
