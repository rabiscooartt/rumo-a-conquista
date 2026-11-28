/*
 * Tela de revisão (Parte B), servida pelo agente em /modules/moments/ e aberta pelo aplicativo ou
 * pelo dock. Mesma origem da API local, sem token: as ações usam as rotas de mesma origem.
 * Texto sempre via textContent; vídeos só do próprio agente.
 */
export const REVIEW_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' https: data:; media-src 'self'; base-uri 'none'; form-action 'none'";

export const REVIEW_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rumo à Conquista — Revisão</title>
<link rel="stylesheet" href="./review.css">
</head>
<body>
<header>
  <a class="back" href="/modules/dock/">← Painel</a>
  <h1>Revisão</h1>
  <nav>
    <button type="button" class="tab" id="tab-moments" aria-selected="true">Momentos <b id="count">0</b></button>
    <button type="button" class="tab" id="tab-checklist" aria-selected="false">Checklist</button>
  </nav>
</header>
<main>
  <section id="moments">
    <p class="hint">Cada momento marcado com o atalho aparece aqui. Escolha a conquista e confirme, ou descarte. Nada vai ao site sem a sua confirmação, e a revisão não mostra alerta na live.</p>
    <div id="moment-list"></div>
    <p class="empty" id="moments-empty" hidden>Nenhum momento para revisar.</p>
    <details id="recent-box" hidden><summary>Revisados recentemente</summary><ul id="recent"></ul></details>
  </section>
  <section id="checklist" hidden>
    <p class="hint">Para conquistas que você fez sem marcar o momento (ex.: "pegue 5 peças"). Marque as que concluiu.</p>
    <select id="check-game" aria-label="Jogo"></select>
    <input id="check-search" type="search" placeholder="Buscar conquista…" aria-label="Buscar conquista no checklist">
    <div id="check-list"></div>
    <fieldset class="date">
      <label><input type="radio" name="check-date" value="today" checked> Data de hoje</label>
      <label><input type="radio" name="check-date" value="undated"> Sem data</label>
    </fieldset>
    <button type="button" class="action" id="check-apply">Registrar marcadas</button>
    <div class="msg" id="check-msg" role="status"></div>
  </section>
</main>
<template id="moment-tpl">
  <article class="moment">
    <div class="head"><time></time><span class="game"></span><span class="note"></span></div>
    <div class="clip"></div>
    <select class="game-pick" aria-label="Jogo do momento" hidden></select>
    <input class="search" type="search" placeholder="Buscar conquista… (ex.: tesouro)" aria-label="Buscar conquista">
    <select class="pick" aria-label="Conquista"></select>
    <fieldset class="date">
      <label><input type="radio" value="moment" checked> Data do momento</label>
      <label><input type="radio" value="undated"> Sem data</label>
    </fieldset>
    <div class="row">
      <button type="button" class="action confirm">Confirmar</button>
      <button type="button" class="secondary discard">Descartar</button>
      <label class="check"><input type="checkbox" class="del"> apagar o clip</label>
    </div>
    <div class="msg" role="status"></div>
  </article>
</template>
<script src="./review.js"></script>
</body>
</html>
`;

export const REVIEW_CSS = `
:root { color-scheme: dark; --accent: #fb2c36; --text: #f4f5f7; --muted: rgba(244,245,247,.6); --line: rgba(255,255,255,.1); --panel: #101218; }
[hidden] { display: none !important; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0c10; color: var(--text); font: 14px "Segoe UI", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: #0b0c10; border-bottom: 1px solid var(--line); padding: 10px 14px 0; }
header h1 { margin: 2px 0 8px; font-size: 18px; }
.back { color: var(--muted); text-decoration: none; font-size: 12px; }
nav { display: flex; gap: 4px; }
.tab { background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted); padding: 8px 10px; font: inherit; cursor: pointer; }
.tab[aria-selected="true"] { color: var(--text); border-color: var(--accent); }
.tab b { display: inline-block; min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: #fff; font-size: 11px; }
main { padding: 12px 14px 30px; max-width: 760px; margin: 0 auto; }
.hint, .empty { color: var(--muted); font-size: 12px; }
.moment { border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 12px; margin-bottom: 12px; display: grid; gap: 8px; }
.head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.head time { font-weight: 700; }
.head .game { color: var(--accent); font-weight: 600; }
.head .note { color: var(--muted); font-style: italic; }
.clip video { width: 100%; max-height: 320px; border-radius: 6px; background: #000; }
.clip .state { color: var(--muted); font-size: 12px; }
input[type=search] { width: 100%; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--line); background: #0b0c10; color: var(--text); font: inherit; }
#check-search { margin-top: 8px; }
select, .moment select { width: 100%; padding: 7px 8px; border-radius: 6px; border: 1px solid var(--line); background: #0b0c10; color: var(--text); font: inherit; }
fieldset.date { border: 0; padding: 0; margin: 0; display: flex; gap: 14px; color: var(--muted); font-size: 13px; }
.row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.check { color: var(--muted); font-size: 12px; display: flex; gap: 6px; align-items: center; }
button.action { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(251,44,54,.6); background: rgba(251,44,54,.15); color: var(--text); font: inherit; font-weight: 600; cursor: pointer; }
button.secondary { padding: 7px 12px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--text); font: inherit; cursor: pointer; }
button[disabled] { opacity: .5; cursor: default; }
.msg { font-size: 12px; min-height: 1em; }
.msg[data-kind="ok"] { color: #34d399; }
.msg[data-kind="error"] { color: #f87171; }
#check-list { margin: 10px 0; display: grid; gap: 4px; }
#check-list label { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 6px; background: var(--panel); border: 1px solid var(--line); }
#check-list small { display: block; color: var(--muted); }
#recent { color: var(--muted); font-size: 12px; padding-left: 18px; }
`;

export const REVIEW_JS = `"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  let data = null;
  const fmt = (ms) => new Date(ms).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const option = (value, label, disabled) => { const o = document.createElement("option"); o.value = value; o.textContent = label; if (disabled) o.disabled = true; return o; };
  const say = (el, kind, text) => { el.setAttribute("data-kind", kind); el.textContent = text; };
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || ("HTTP " + r.status));
    return json;
  }
  async function getJson(path) { const r = await fetch(path, { cache: "no-store" }); return r.json(); }
  function confirmFirst(button) {
    if (button.getAttribute("data-confirm") === "1") { button.removeAttribute("data-confirm"); button.textContent = button.getAttribute("data-label"); return true; }
    button.setAttribute("data-label", button.textContent);
    button.setAttribute("data-confirm", "1");
    button.textContent = "Confirmar?";
    setTimeout(() => { if (button.getAttribute("data-confirm") === "1") { button.removeAttribute("data-confirm"); button.textContent = button.getAttribute("data-label"); } }, 4000);
    return false;
  }
  const norm = (t) => String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Preenche a lista de conquistas; a busca filtra pelo nome e pela descrição (sem acentos).
  function fillAchievements(select, list, filter) {
    select._all = list;
    const f = norm(filter);
    const shown = f ? list.filter((a) => norm(a.title + " " + (a.description || "")).includes(f)) : list;
    const empty = !list.length ? "Nenhuma conquista pendente publicada para este jogo" : !shown.length ? "Nada encontrado na busca" : f ? shown.length + " encontrada(s) — escolha" : "Qual conquista foi?";
    select.replaceChildren(option("", empty, true));
    shown.forEach((a) => select.append(option(a.id, a.title + (a.isCustom ? " (CUSTOM)" : "") + (a.description ? " — " + a.description : ""))));
    select.value = "";
  }
  function clipView(container, m) {
    container.replaceChildren();
    if (!m.clip) { const s = document.createElement("span"); s.className = "state"; s.textContent = "Sem clip (clips desligados ou buffer do OBS desligado)."; return container.append(s); }
    if (m.clip.status === "completed") {
      const v = document.createElement("video");
      v.controls = true; v.preload = "metadata"; v.src = "/modules/clips/video?id=" + encodeURIComponent(m.clip.id);
      return container.append(v);
    }
    const s = document.createElement("span"); s.className = "state";
    s.textContent = m.clip.status === "pending" || m.clip.status === "saving" ? "Clip sendo salvo…" : "Clip não gerado: " + (m.clip.lastError || m.clip.status);
    container.append(s);
  }
  function renderMoment(m) {
    const node = $("moment-tpl").content.firstElementChild.cloneNode(true);
    const q = (sel) => node.querySelector(sel);
    q("time").textContent = fmt(m.markedAt);
    q(".game").textContent = m.gameTitle || "Jogo não identificado";
    q(".note").textContent = m.note ? "“" + m.note + "”" : "";
    clipView(q(".clip"), m);
    const radios = node.querySelectorAll("fieldset.date input");
    radios.forEach((r) => (r.name = "date-" + m.id));
    const pick = q(".pick");
    const gamePick = q(".game-pick");
    const search = q(".search");
    search.addEventListener("input", () => fillAchievements(pick, pick._all || [], search.value));
    if (m.gameSlug) fillAchievements(pick, data.suggestions[m.gameSlug] || []);
    else {
      gamePick.hidden = false;
      gamePick.replaceChildren(option("", "De qual jogo foi?", true));
      data.games.forEach((g) => gamePick.append(option(g.slug, g.title)));
      gamePick.value = data.currentGame || "";
      pick.replaceChildren(option("", "Escolha o jogo primeiro", true));
      pick.value = "";
      const loadGame = async () => { if (!gamePick.value) return; const r = await getJson("/modules/moments/achievements?slug=" + encodeURIComponent(gamePick.value)); search.value = ""; fillAchievements(pick, r.pending || []); };
      gamePick.addEventListener("change", loadGame);
      if (gamePick.value) loadGame();
    }
    const msg = q(".msg");
    q(".confirm").addEventListener("click", async (event) => {
      if (!pick.value) return say(msg, "error", "Escolha a conquista.");
      if (!confirmFirst(event.currentTarget)) return;
      const dateMode = node.querySelector("fieldset.date input:checked").value;
      try {
        const r = await post("/modules/moments/resolve", { momentId: m.id, achievementId: pick.value, slug: m.gameSlug || gamePick.value, dateMode });
        say(msg, "ok", (r.alreadyRegistered ? "Já estava registrada no agente: " : "Registrada: ") + r.moment.achievementTitle + (dateMode === "undated" ? " (sem data)" : " (" + fmt(m.markedAt) + ")"));
        setTimeout(load, 1200);
      } catch (e) { say(msg, "error", e.message); }
    });
    q(".discard").addEventListener("click", async (event) => {
      if (!confirmFirst(event.currentTarget)) return;
      try {
        const r = await post("/modules/moments/discard", { momentId: m.id, deleteClip: q(".del").checked });
        say(msg, "ok", "Descartado" + (r.clipDeleted ? " e clip apagado." : "."));
        setTimeout(load, 900);
      } catch (e) { say(msg, "error", e.message); }
    });
    return node;
  }
  async function load() {
    data = await getJson("/modules/moments/review");
    $("count").textContent = String(data.pending.length);
    $("moment-list").replaceChildren(...data.pending.map(renderMoment));
    $("moments-empty").hidden = data.pending.length > 0;
    $("recent-box").hidden = !data.recent.length;
    $("recent").replaceChildren(...data.recent.map((m) => {
      const li = document.createElement("li");
      li.textContent = fmt(m.markedAt) + " · " + (m.gameTitle || "?") + " · " + (m.status === "resolved" ? (m.achievementTitle || "") + (m.dateMode === "undated" ? " (sem data)" : "") : "descartado");
      return li;
    }));
    const g = $("check-game");
    if (!g.options.length) {
      g.append(option("", "Jogo…", true));
      data.games.forEach((x) => g.append(option(x.slug, x.title)));
      g.value = data.currentGame || "";
      if (g.value) loadChecklist();
    }
  }
  let checkAll = [];
  async function loadChecklist() {
    const slug = $("check-game").value;
    if (!slug) return;
    const r = await getJson("/modules/moments/achievements?slug=" + encodeURIComponent(slug));
    checkAll = r.pending || [];
    $("check-search").value = "";
    renderChecklist();
  }
  function renderChecklist() {
    const f = norm($("check-search").value);
    const marked = new Set([...document.querySelectorAll("#check-list input:checked")].map((b) => b.value));
    const shown = f ? checkAll.filter((a) => marked.has(a.id) || norm(a.title + " " + (a.description || "")).includes(f)) : checkAll;
    $("check-list").replaceChildren(...shown.map((a) => {
      const label = document.createElement("label");
      const box = document.createElement("input"); box.type = "checkbox"; box.value = a.id; box.checked = marked.has(a.id);
      const text = document.createElement("span"); text.textContent = a.title + (a.isCustom ? " (CUSTOM)" : "");
      if (a.description) { const s = document.createElement("small"); s.textContent = a.description; text.append(s); }
      label.append(box, text);
      return label;
    }));
    if (!shown.length) { const p = document.createElement("p"); p.className = "empty"; p.textContent = checkAll.length ? "Nada encontrado na busca." : "Nenhuma conquista pendente publicada para este jogo."; $("check-list").append(p); }
  }
  $("check-game").addEventListener("change", loadChecklist);
  $("check-search").addEventListener("input", renderChecklist);
  $("check-apply").addEventListener("click", async (event) => {
    const ids = [...document.querySelectorAll("#check-list input:checked")].map((b) => b.value);
    if (!ids.length) return say($("check-msg"), "error", "Marque ao menos uma conquista.");
    if (!confirmFirst(event.currentTarget)) return;
    const dateMode = document.querySelector("input[name=check-date]:checked").value;
    try {
      const r = await post("/modules/moments/checklist", { slug: $("check-game").value, achievementIds: ids, dateMode });
      const novas = r.results.filter((x) => x.created).length;
      say($("check-msg"), "ok", novas + " registrada(s)" + (r.results.length - novas ? ", " + (r.results.length - novas) + " já estavam registradas" : "") + ".");
      loadChecklist();
    } catch (e) { say($("check-msg"), "error", e.message); }
  });
  const show = (tab) => {
    $("tab-moments").setAttribute("aria-selected", String(tab === "moments"));
    $("tab-checklist").setAttribute("aria-selected", String(tab === "checklist"));
    $("moments").hidden = tab !== "moments";
    $("checklist").hidden = tab !== "checklist";
  };
  $("tab-moments").addEventListener("click", () => show("moments"));
  $("tab-checklist").addEventListener("click", () => show("checklist"));
  if (location.hash === "#checklist") show("checklist");
  load();
})();
`;
