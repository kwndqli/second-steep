(() => {
  "use strict";

  const TEAS = window.TEAS;
  const TYPES = window.TEA_TYPES;
  const byId = Object.fromEntries(TEAS.map(t => [t.id, t]));
  const app = document.getElementById("app");
  const toastEl = document.querySelector(".toast");

  // ---------- storage (never throws) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    }
  };

  const prefs = Object.assign({ unit: "C", vessel: 100, tea: "tieguanyin" }, store.get("ss.prefs", {}));
  if (!byId[prefs.tea]) prefs.tea = "tieguanyin";
  let journal = store.get("ss.journal", []);
  if (!Array.isArray(journal)) journal = [];
  const savePrefs = () => store.set("ss.prefs", prefs);
  const saveJournal = () => {
    if (!store.set("ss.journal", journal)) toast("Couldn't save. This browser is blocking storage, so the journal will clear when you close the tab.");
  };

  // ---------- helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = sec => { sec = Math.max(0, Math.ceil(sec)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; };
  const temp = c => prefs.unit === "F" ? `${Math.round(c * 9 / 5 + 32)}°F` : `${c}°C`;
  const leaf = (tea, ml) => Math.max(0.5, Math.round(tea.ratio * ml / 100 * 2) / 2);
  const baseTime = (tea, n) => Math.max(5, tea.first + tea.add * (n - 1));
  const schedule = tea => Array.from({ length: tea.steeps }, (_, i) => baseTime(tea, i + 1));
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  let toastTimer;
  function toast(msg, action) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = `<span>${esc(msg)}</span>`;
    if (action) {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = action.label;
      b.addEventListener("click", () => { toastEl.hidden = true; action.run(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 7000 : 4000);
  }

  // ---------- sound ----------
  let audio;
  function wakeAudio() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); }
    catch { audio = null; }
  }
  function chime() {
    if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
    if (!audio) return;
    const now = audio.currentTime;
    [659.3, 830.6, 987.8].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + i * 0.22);
      g.gain.exponentialRampToValueAtTime(0.25, now + i * 0.22 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 1.4);
      o.connect(g).connect(audio.destination);
      o.start(now + i * 0.22); o.stop(now + i * 0.22 + 1.5);
    });
  }

  // ---------- brewing session ----------
  // status: idle (steep not started) | running | paused | done (steep finished)
  const session = { teaId: prefs.tea, steep: 1, status: "idle", endAt: 0, left: 0, total: 0, brewed: 0, nudge: {} };
  let ticker = null;

  const sTea = () => byId[session.teaId];
  const steepLength = n => Math.max(5, baseTime(sTea(), n) + (session.nudge[n] || 0));
  const active = () => session.status === "running" || session.status === "paused";

  function resetSession(teaId) {
    stopTick();
    Object.assign(session, { teaId: teaId || session.teaId, steep: 1, status: "idle", endAt: 0, left: 0, total: 0, brewed: 0, nudge: {} });
    document.title = "Second Steep";
  }
  function startSteep() {
    wakeAudio();
    if (session.status === "done") {
      if (session.steep >= sTea().steeps) return;
      session.steep += 1;
    }
    const len = session.status === "paused" ? session.left : steepLength(session.steep);
    if (session.status !== "paused") session.total = steepLength(session.steep);
    session.endAt = Date.now() + len * 1000;
    session.status = "running";
    startTick();
    refresh();
  }
  function pauseSteep() {
    session.left = Math.max(0, (session.endAt - Date.now()) / 1000);
    session.status = "paused";
    stopTick();
    refresh();
  }
  function resetSteep() {
    stopTick();
    session.status = "idle"; session.left = 0;
    document.title = "Second Steep";
    refresh();
  }
  function skipSteep() {
    if (session.steep >= sTea().steeps) return;
    stopTick();
    session.steep += 1; session.status = "idle"; session.left = 0;
    refresh();
  }
  function nudge(delta) {
    const n = session.status === "done" ? session.steep + 1 : session.steep;
    if (n > sTea().steeps || session.status === "running") return;
    const cur = session.nudge[n] || 0;
    const next = Math.max(5 - baseTime(sTea(), n), cur + delta);
    session.nudge[n] = next;
    if (session.status === "paused") {
      session.left = Math.max(1, session.left + (next - cur));
      session.total = Math.max(5, session.total + (next - cur));
    }
    refresh();
  }
  function startTick() { stopTick(); ticker = setInterval(tick, 200); tick(); }
  function stopTick() { clearInterval(ticker); ticker = null; }
  function tick() {
    const left = (session.endAt - Date.now()) / 1000;
    if (left <= 0) {
      stopTick();
      session.status = "done"; session.left = 0;
      session.brewed = Math.max(session.brewed, session.steep);
      document.title = `Pour now · Second Steep`;
      chime();
      refresh(true);
      return;
    }
    session.left = left;
    document.title = `${fmt(left)} · ${sTea().name}`;
    updateStage();
    updateNav();
  }
  function remaining() {
    if (session.status === "running") return Math.max(0, (session.endAt - Date.now()) / 1000);
    if (session.status === "paused") return session.left;
    if (session.status === "done") return 0;
    return steepLength(session.steep);
  }

  // ---------- router ----------
  let currentView = "";
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    const [page, id] = parts;
    if (!page) return viewBrew();
    if (page === "brew") return id ? brewTea(id) : viewBrew();
    if (page === "teas") return viewTeas();
    if (page === "tea") return viewTea(id);
    if (page === "journal") return viewJournal();
    return viewMissing("That page doesn't exist", "The link may be mistyped. Go back to brewing, or browse the teas.");
  }
  function show(view, html, focus = true) {
    currentView = view;
    app.innerHTML = html;
    document.querySelectorAll("[data-nav]").forEach(a => {
      if (a.dataset.nav === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    updateNav();
    if (focus) { app.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }
  function refresh(rang) {
    if (currentView === "brew") { renderBrew(false); if (rang) app.querySelector(".stage")?.classList.add("ringing"); }
    updateNav();
  }
  function updateNav() {
    const link = document.querySelector('[data-nav="brew"]');
    let dot = link.querySelector(".live-dot");
    const showDot = currentView !== "brew" && (active() || session.status === "done");
    if (!showDot) { dot?.remove(); return; }
    if (!dot) { dot = document.createElement("span"); dot.className = "live-dot"; link.appendChild(dot); }
    dot.textContent = session.status === "done" ? "pour" : fmt(remaining());
    document.documentElement.style.setProperty("--liquor", sTea().liquor);
  }

  function brewTea(id) {
    if (!byId[id]) return viewMissing("That tea isn't in the library", "It may have been renamed. Pick one from the library instead.");
    if (id !== session.teaId) {
      if (active()) {
        toast(`Finish or reset your ${sTea().name} steep before switching teas.`);
      } else {
        prefs.tea = id; savePrefs(); resetSession(id);
      }
    }
    history.replaceState(null, "", "#/");
    viewBrew();
  }

  // ---------- views ----------
  function viewBrew() { renderBrew(true); }

  function renderBrew(focus) {
    const tea = sTea();
    const ml = prefs.vessel;
    const times = schedule(tea).map((_, i) => steepLength(i + 1));
    const lastDone = session.status === "done" && session.steep >= tea.steeps;
    document.documentElement.style.setProperty("--liquor", tea.liquor);

    const options = Object.entries(TYPES).map(([k, label]) =>
      `<optgroup label="${label}">${TEAS.filter(t => t.type === k).map(t =>
        `<option value="${t.id}" ${t.id === tea.id ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</optgroup>`).join("");

    const stepItems = times.map((s, i) => {
      const n = i + 1;
      let cls = "";
      if (n < session.steep || (n === session.steep && session.status === "done")) cls = "done";
      else if (n === session.steep) cls = "now";
      return `<li class="${cls}"><span>${n}</span>${fmt(s)}</li>`;
    }).join("");

    let primary;
    if (session.status === "running") primary = `<button class="btn primary" data-act="pause" type="button">Pause</button>`;
    else if (session.status === "paused") primary = `<button class="btn primary" data-act="start" type="button">Resume</button>`;
    else if (lastDone) primary = `<button class="btn primary" type="button" disabled>All ${tea.steeps} steeps done</button>`;
    else {
      const n = session.status === "done" ? session.steep + 1 : session.steep;
      primary = `<button class="btn primary" data-act="start" type="button">Start steep ${n}</button>`;
    }
    const canReset = session.status !== "idle";
    const canSkip = (session.status === "idle" || session.status === "paused") && session.steep < tea.steeps;
    const nudgeTarget = session.status === "done" ? session.steep + 1 : session.steep;
    const canNudge = session.status !== "running" && nudgeTarget <= tea.steeps;

    let which;
    if (session.status === "done") which = lastDone ? "Last steep done. Pour it all out." : `Steep ${session.steep} done. Pour it out.`;
    else which = `Steep ${session.steep} of ${tea.steeps}${session.status === "paused" ? ", paused" : ""}`;

    const finish = session.brewed > 0 ? `
      <form class="finish" id="finish" novalidate>
        <h3>Log this session</h3>
        <p class="hint">${plural(session.brewed, "steep")} of ${esc(tea.name)} brewed so far.</p>
        <fieldset class="rating">
          <legend>How was it?</legend>
          ${[1, 2, 3, 4, 5].map(n => `<input type="radio" name="rating" id="r${n}" value="${n}"><label for="r${n}" title="${n} of 5">${n}</label>`).join("")}
        </fieldset>
        <div class="field">
          <label for="note">Tasting note <span class="hint">(optional)</span></label>
          <textarea id="note" name="note" maxlength="500" placeholder="What changed between steeps? Would you brew it differently?"></textarea>
          <p class="error-text" id="finish-error" hidden></p>
        </div>
        <div class="controls" style="justify-content:flex-start;margin-top:0">
          <button class="btn primary" type="submit">Save to journal</button>
          <button class="btn quiet" type="button" data-act="discard">Start over</button>
        </div>
      </form>` : "";

    // keep any half-written note when re-rendering mid-session
    const prevNote = app.querySelector("#note")?.value || "";
    const prevRating = app.querySelector('input[name="rating"]:checked')?.value;

    show("brew", `
      <h1>Brew</h1>
      <p class="lede">Pick a tea and the size of your pot. Second Steep works out the leaf and water, then times each steep for you.</p>
      <div class="brew">
        <section class="setup" aria-label="Brewing setup">
          <div class="field">
            <label for="tea">Tea</label>
            <select id="tea" ${active() ? "disabled" : ""}>${options}</select>
            ${active() ? `<p class="hint">Reset the current steep to change tea.</p>` : `<p class="hint"><a href="#/tea/${tea.id}">About ${esc(tea.name)}</a></p>`}
          </div>
          <div class="field">
            <label for="vessel">Pot or gaiwan size (ml)</label>
            <div class="stepper">
              <button type="button" data-act="ml-" aria-label="Decrease size by 10 ml">−</button>
              <input id="vessel" type="number" inputmode="numeric" min="30" max="1000" step="10" value="${ml}">
              <button type="button" data-act="ml+" aria-label="Increase size by 10 ml">+</button>
            </div>
            <p class="error-text" id="vessel-error" hidden>Enter a size between 30 and 1000 ml.</p>
          </div>
          <div class="unit-row">
            <h2>You'll need</h2>
            <div class="seg" role="group" aria-label="Temperature unit">
              <button type="button" data-unit="C" aria-pressed="${prefs.unit === "C"}">°C</button>
              <button type="button" data-unit="F" aria-pressed="${prefs.unit === "F"}">°F</button>
            </div>
          </div>
          <dl class="facts">
            <div><dt>Leaf</dt><dd id="leaf">${leaf(tea, ml)}<small>g</small></dd></div>
            <div><dt>Water</dt><dd>${temp(tea.temp)}</dd></div>
            <div><dt>Steeps</dt><dd>${tea.steeps}</dd></div>
          </dl>
          <h3>Steep times</h3>
          <ol class="schedule" aria-label="Steep times">${stepItems}</ol>
          <p class="hint">${esc(tea.tip)}</p>
        </section>

        <section class="stage" aria-label="Timer">
          <div class="tea-name">${esc(tea.name)}</div>
          ${cupSvg(tea)}
          <div class="count" id="count" aria-hidden="true">${fmt(remaining())}</div>
          <div class="which" id="which" aria-live="polite">${which}</div>
          <div class="controls">
            ${primary}
            <button class="btn quiet" data-act="reset" type="button" ${canReset ? "" : "disabled"}>Reset steep</button>
            <button class="btn quiet" data-act="skip" type="button" ${canSkip ? "" : "disabled"}>Skip steep</button>
          </div>
          <div class="nudge">
            ${canNudge ? `<span>Steep ${nudgeTarget}:</span>
              <button type="button" data-act="nudge-" aria-label="Make steep ${nudgeTarget} 5 seconds shorter">−5s, lighter</button>
              <button type="button" data-act="nudge+" aria-label="Make steep ${nudgeTarget} 5 seconds longer">+5s, stronger</button>` : `<span>You can adjust the time between steeps.</span>`}
          </div>
          <p class="kbd">Press Space to start or pause.</p>
          ${finish}
        </section>
      </div>`, focus);

    if (prevNote && app.querySelector("#note")) app.querySelector("#note").value = prevNote;
    if (prevRating) { const r = app.querySelector(`#r${prevRating}`); if (r) r.checked = true; }
    updateStage();
  }

  function cupSvg(tea) {
    return `<svg class="cup" viewBox="0 0 240 170" role="img" aria-label="Cup of ${esc(tea.name)}">
      <defs><clipPath id="bowl"><path d="M28 48h184c0 64-38 100-92 100S28 112 28 48z"/></clipPath></defs>
      <ellipse cx="120" cy="158" rx="78" ry="7" fill="currentColor" opacity=".08"/>
      <g clip-path="url(#bowl)">
        <rect x="20" y="40" width="200" height="120" fill="currentColor" opacity=".05"/>
        <rect class="liquor" id="liquor" x="20" y="56" width="200" height="110" fill="${tea.liquor}" fill-opacity=".1"/>
      </g>
      <path d="M28 48h184c0 64-38 100-92 100S28 112 28 48z" fill="none" stroke="currentColor" stroke-width="3"/>
      <ellipse cx="120" cy="48" rx="92" ry="9" fill="none" stroke="currentColor" stroke-width="3"/>
    </svg>`;
  }

  function updateStage() {
    if (currentView !== "brew") return;
    const count = app.querySelector("#count"), liq = app.querySelector("#liquor");
    if (count) count.textContent = fmt(remaining());
    if (!liq) return;
    let p = 0;
    if (session.status === "done") p = 1;
    else if (active() && session.total) p = 1 - remaining() / session.total;
    liq.setAttribute("fill-opacity", (0.1 + 0.9 * p).toFixed(3));
  }

  function viewTeas(q = teasState.q, type = teasState.type) {
    teasState.q = q; teasState.type = type;
    const needle = q.trim().toLowerCase();
    const list = TEAS.filter(t => (type === "all" || t.type === type) &&
      (!needle || [t.name, t.origin, t.taste, TYPES[t.type]].join(" ").toLowerCase().includes(needle)));
    const chips = [["all", "All"], ...Object.entries(TYPES)].map(([k, l]) =>
      `<button type="button" data-type="${k}" aria-pressed="${type === k}">${l}</button>`).join("");
    const rows = list.map(t => `<li><a href="#/tea/${t.id}">
        <span class="swatch" style="background:${t.liquor}" aria-hidden="true"></span>
        <span><span class="nm">${esc(t.name)}</span><br><span class="meta">${TYPES[t.type]} from ${esc(t.origin)}</span></span>
        <span class="num">${temp(t.temp)}, ${t.ratio} g per 100 ml</span></a></li>`).join("");
    const empty = `<div class="empty"><h2>No teas match</h2><p>Nothing in the library matches “${esc(q)}”${type !== "all" ? ` among ${TYPES[type].toLowerCase()} teas` : ""}. Try a flavour like “honey” or a place like “Fujian”.</p><button class="btn" type="button" data-act="clear">Clear search and filters</button></div>`;
    const keepFocus = document.activeElement?.id === "q";
    show("teas", `
      <h1>Teas</h1>
      <p class="lede">${TEAS.length} teas, ordered from green to dark. Each colour dot is roughly the colour of the brewed cup.</p>
      <div class="filters">
        <div class="search"><label for="q">Search by name, place or flavour</label>
        <input id="q" type="search" value="${esc(q)}" autocomplete="off" placeholder="e.g. orchid, Yunnan, roasted"></div>
      </div>
      <div class="chips" role="group" aria-label="Filter by type">${chips}</div>
      <p class="count-line" aria-live="polite">${list.length === TEAS.length ? "Showing all teas" : `Showing ${plural(list.length, "tea")}`}</p>
      ${list.length ? `<ul class="tea-list">${rows}</ul>` : empty}`, !keepFocus);
    if (keepFocus) { const i = app.querySelector("#q"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }
  const teasState = { q: "", type: "all" };

  function viewTea(id) {
    const t = byId[id];
    if (!t) return viewMissing("That tea isn't in the library", "It may have been renamed. Pick one from the library instead.");
    const times = schedule(t);
    const logged = journal.filter(e => e.teaId === t.id).length;
    show("teas", `
      <a class="back" href="#/teas">‹ All teas</a>
      <div class="detail">
        <div>
          <p class="type">${TYPES[t.type]} tea from ${esc(t.origin)}</p>
          <h1>${esc(t.name)}</h1>
          <p class="taste">${esc(t.taste)}</p>
          <p class="tip">${esc(t.tip)}</p>
          <p><a class="btn primary" href="#/brew/${t.id}">Brew ${esc(t.name)}</a></p>
          ${logged ? `<p class="hint"><a href="#/journal">${plural(logged, "session")} in your journal</a></p>` : ""}
        </div>
        <div>
          <div class="pour" style="background:${t.liquor}">Brewed colour</div>
          <dl class="params">
            <div><dt>Water</dt><dd>${temp(t.temp)}</dd></div>
            <div><dt>Leaf</dt><dd>${t.ratio} g per 100 ml</dd></div>
            <div><dt>First steep</dt><dd>${fmt(t.first)}</dd></div>
            <div><dt>Each later steep</dt><dd>${t.add >= 0 ? "+" : "−"}${Math.abs(t.add)}s</dd></div>
            <div><dt>Steeps</dt><dd>${t.steeps}</dd></div>
          </dl>
          <ol class="schedule" aria-label="Steep times">${times.map((s, i) => `<li><span>${i + 1}</span>${fmt(s)}</li>`).join("")}</ol>
        </div>
      </div>`);
  }

  function viewJournal() {
    const items = [...journal].sort((a, b) => b.at.localeCompare(a.at));
    const fmtDate = iso => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return iso; } };
    const rows = items.map(e => `<li class="entry">
        <span class="bar" style="background:${esc(e.liquor)}" aria-hidden="true"></span>
        <div>
          <h3>${byId[e.teaId] ? `<a href="#/tea/${esc(e.teaId)}">${esc(e.name)}</a>` : esc(e.name)}</h3>
          <p class="when">${fmtDate(e.at)}. ${plural(e.steeps, "steep")}, ${e.leaf} g in ${e.vessel} ml.</p>
          ${e.rating ? `<span class="stars">Rated ${e.rating} of 5</span>` : ""}
          ${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}
        </div>
        <div class="actions"><button class="btn danger" type="button" data-del="${esc(e.id)}" aria-label="Delete ${esc(e.name)} entry from ${fmtDate(e.at)}">Delete</button></div>
      </li>`).join("");
    show("journal", `
      <div class="journal-head">
        <div><h1>Journal</h1>
        <p class="lede">${items.length ? `${plural(items.length, "session")} logged. Entries are kept in this browser only.` : "Your brewing sessions will show up here."}</p></div>
      </div>
      ${items.length ? `<ul class="entries">${rows}</ul>` : `<div class="empty"><h2>No sessions yet</h2><p>Brew at least one steep, then use “Save to journal” under the timer to keep your notes.</p><a class="btn primary" href="#/">Start brewing</a></div>`}`);
  }

  function viewMissing(title, body) {
    show("", `<div class="empty"><h2>${esc(title)}</h2><p>${esc(body)}</p>
      <a class="btn primary" href="#/">Go to Brew</a> <a class="btn" href="#/teas">Browse teas</a></div>`);
  }

  // ---------- events ----------
  function setVessel(v, fromInput) {
    const err = app.querySelector("#vessel-error"), input = app.querySelector("#vessel");
    const n = Number(v);
    if (!Number.isFinite(n) || n < 30 || n > 1000 || v === "") {
      err.hidden = false; input.setAttribute("aria-invalid", "true");
      return;
    }
    err.hidden = true; input.removeAttribute("aria-invalid");
    prefs.vessel = Math.round(n); savePrefs();
    if (!fromInput) input.value = prefs.vessel;
    app.querySelector("#leaf").innerHTML = `${leaf(sTea(), prefs.vessel)}<small>g</small>`;
  }

  app.addEventListener("click", e => {
    const t = e.target.closest("button");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "start") startSteep();
    else if (act === "pause") pauseSteep();
    else if (act === "reset") resetSteep();
    else if (act === "skip") skipSteep();
    else if (act === "nudge+") nudge(5);
    else if (act === "nudge-") nudge(-5);
    else if (act === "ml+" || act === "ml-") {
      const cur = Number(app.querySelector("#vessel").value) || prefs.vessel;
      setVessel(Math.min(1000, Math.max(30, cur + (act === "ml+" ? 10 : -10))));
    }
    else if (act === "discard") { resetSession(); renderBrew(false); toast("Session cleared."); }
    else if (act === "clear") viewTeas("", "all");
    else if (t.dataset.unit) { prefs.unit = t.dataset.unit; savePrefs(); route(); }
    else if (t.dataset.type) viewTeas(teasState.q, t.dataset.type);
    else if (t.dataset.del) {
      const idx = journal.findIndex(x => x.id === t.dataset.del);
      if (idx < 0) return;
      const [removed] = journal.splice(idx, 1);
      saveJournal(); viewJournal();
      toast(`Deleted ${removed.name} entry.`, { label: "Undo", run: () => { journal.push(removed); saveJournal(); if (currentView === "journal") viewJournal(); } });
    }
  });

  app.addEventListener("change", e => {
    if (e.target.id === "tea") { prefs.tea = e.target.value; savePrefs(); resetSession(e.target.value); renderBrew(false); app.querySelector("#tea").focus(); }
    if (e.target.id === "vessel") setVessel(e.target.value);
  });
  app.addEventListener("input", e => {
    if (e.target.id === "vessel") setVessel(e.target.value, true);
    if (e.target.id === "q") viewTeas(e.target.value, teasState.type);
  });

  app.addEventListener("submit", e => {
    if (e.target.id !== "finish") return;
    e.preventDefault();
    const tea = sTea();
    const note = app.querySelector("#note").value.trim();
    const err = app.querySelector("#finish-error");
    if (note.length > 500) { err.textContent = "Keep the note under 500 characters."; err.hidden = false; return; }
    const rating = Number(app.querySelector('input[name="rating"]:checked')?.value) || null;
    journal.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      teaId: tea.id, name: tea.name, liquor: tea.liquor, vessel: prefs.vessel, leaf: leaf(tea, prefs.vessel),
      steeps: session.brewed, rating, note, at: new Date().toISOString()
    });
    saveJournal();
    resetSession();
    renderBrew(false);
    toast("Saved to journal.", { label: "View", run: () => { location.hash = "#/journal"; } });
  });

  document.addEventListener("keydown", e => {
    if (e.code !== "Space" || currentView !== "brew") return;
    if (e.target.closest("input, textarea, select, button, a")) return;
    e.preventDefault();
    if (session.status === "running") pauseSteep();
    else if (!(session.status === "done" && session.steep >= sTea().steeps)) startSteep();
  });

  window.addEventListener("hashchange", route);
  // catch up immediately when a backgrounded tab comes back
  document.addEventListener("visibilitychange", () => { if (!document.hidden && session.status === "running") tick(); });

  route();
})();
