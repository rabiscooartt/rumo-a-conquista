/*
 * Dock do OBS (Docks > Docks de navegador personalizados). Página estática servida pelo próprio
 * agente: mesma origem da API local, sem token (só lê estado), sem dependências e sem nada
 * que altere o OBS. O script só consulta GET ./state e escreve com textContent (nunca HTML).
 */
export const DOCK_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'";

export const DOCK_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rumo à Conquista</title>
<link rel="stylesheet" href="./dock.css">
</head>
<body>
<main class="dock" data-overall="idle" data-online="unknown">
  <header class="brand">
    <span class="brand-mark" aria-hidden="true"></span>
    <span class="brand-name">RUMO À CONQUISTA</span>
    <span class="overall" id="overall" role="status" aria-live="polite" title="Estado geral"><span class="dot"></span></span>
  </header>

  <section class="game" aria-label="Jogo atual">
    <div class="game-label">Jogo</div>
    <div class="game-title" id="game-title">—</div>
    <div class="session" id="session-row"><span class="dot"></span><span id="session-label">Aguardando o agente…</span><span class="timer" id="session-timer"></span></div>
    <div class="note" id="game-detail" hidden></div>
  </section>

  <button class="toggle" id="toggle" type="button" aria-expanded="false" aria-controls="details">Detalhes</button>

  <section class="details" id="details" hidden aria-label="Estado operacional">
    <div class="row" id="row-agent"><span class="dot"></span><span class="name">Agente</span><span class="value"></span><span class="sub"></span></div>
    <div class="row" id="row-obs"><span class="dot"></span><span class="name">OBS</span><span class="value"></span><span class="sub"></span></div>
    <div class="row" id="row-site"><span class="dot"></span><span class="name">Site</span><span class="value"></span><span class="sub"></span></div>
    <div class="row" id="row-sync"><span class="dot"></span><span class="name">Sincronização</span><span class="value"></span><span class="sub"></span></div>
    <div class="row" id="row-alerts"><span class="dot"></span><span class="name">Alertas</span><span class="value"></span><span class="sub"></span></div>
    <div class="row" id="row-clips"><span class="dot"></span><span class="name">Clips</span><span class="value"></span><span class="sub"></span></div>
    <div class="updated" id="updated"></div>
  </section>

  <div class="app-hotkey" id="app-hotkey" hidden>Atalho de captura: <b id="app-hotkey-key">—</b> <button type="button" id="app-hotkey-change">Trocar</button><span id="app-hotkey-error"></span></div>
  <a class="review-link" id="review-link" href="/modules/moments/">Revisar momentos <b id="review-count">0</b></a>
  <button class="toggle" id="toggle-controls" type="button" aria-expanded="false" aria-controls="controls">Controles</button>
  <section class="controls" id="controls" hidden aria-label="Controles operacionais">
    <form class="panel" id="form-game" autocomplete="off">
      <div class="panel-title">Corrigir jogo da sessão</div>
      <select id="game-select" aria-label="Jogo correto"></select>
      <label class="check"><input type="checkbox" id="game-remember"> Lembrar para este executável</label>
      <button type="submit" class="action" id="game-apply" disabled>Aplicar</button>
      <div class="msg" id="game-msg" role="status"></div>
    </form>
    <form class="panel" id="form-custom" autocomplete="off">
      <div class="panel-title">Conquista CUSTOM</div>
      <select id="custom-game" aria-label="Jogo da conquista"></select>
      <select id="custom-pick" aria-label="Conquista publicada no site"></select>
      <input id="custom-name" maxlength="120" placeholder="ou nome de uma CUSTOM nova">
      <input id="custom-desc" maxlength="500" placeholder="Descrição (opcional)">
      <label class="check"><input type="checkbox" id="custom-test"> Teste (não envia ao site)</label>
      <button type="submit" class="action" id="custom-apply">Desbloquear</button>
      <div class="msg" id="custom-msg" role="status"></div>
    </form>
    <form class="panel" id="form-clip" autocomplete="off">
      <div class="panel-title">Clips</div>
      <button type="submit" class="action" id="clip-test">Testar clip</button>
      <div class="msg" id="clip-msg" role="status">Salva um replay real na subpasta "testes", sem evento nem conquista.</div>
    </form>
    <form class="panel" id="form-mastery" autocomplete="off">
      <div class="panel-title">Maestria</div>
      <button type="submit" class="action" id="mastery-test">Testar apresentação</button>
      <div class="msg" id="mastery-msg" role="status">Teste isolado: não altera progresso nem envia ao site.</div>
    </form>
  </section>

  <div class="offline" id="offline" hidden>
    <strong>Agente indisponível</strong>
    <span>Inicie com <code>npm run agent -- start</code>. O dock reconecta sozinho.</span>
  </div>
</main>
<script src="./dock.js"></script>
</body>
</html>
`;

export const DOCK_CSS = `
:root {
  color-scheme: dark;
  --bg: #050609; --raised: #090b0f; --border: rgba(255,255,255,.085); --text: #f4f5f7; --muted: rgba(255,255,255,.62);
  --accent: #fb2c36; --ok: #22c55e; --warn: #f59e0b; --error: #ef4444; --idle: #6b7280;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text); }
body { font: 13px/1.35 Inter, "Segoe UI", system-ui, sans-serif; overflow-x: hidden; }
.dock { padding: 10px 12px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.brand-mark { width: 4px; height: 14px; border-radius: 2px; background: var(--accent); flex: none; }
.brand-name { font-weight: 800; letter-spacing: .14em; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.overall { margin-left: auto; display: inline-flex; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--idle); flex: none; display: inline-block; }
[data-level="ok"] > .dot, .overall[data-level="ok"] .dot { background: var(--ok); }
[data-level="warn"] > .dot, .overall[data-level="warn"] .dot { background: var(--warn); }
[data-level="error"] > .dot, .overall[data-level="error"] .dot { background: var(--error); }
.overall .dot { width: 10px; height: 10px; box-shadow: 0 0 0 3px rgba(255,255,255,.04); }
.game { background: var(--raised); border: 1px solid var(--border); border-radius: 8px; padding: 9px 10px; min-width: 0; }
.game-label { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .1em; }
.game-title { font-weight: 700; font-size: 15px; margin: 2px 0 6px; overflow-wrap: anywhere; }
.session { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
.session[data-level="ok"] { color: var(--ok); }
.session[data-level="warn"] { color: var(--warn); }
.session[data-level="error"] { color: var(--error); }
.session[data-level="idle"] { color: var(--muted); }
.timer { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; text-transform: none; letter-spacing: 0; font-weight: 600; }
.note { margin-top: 6px; color: var(--warn); font-size: 11px; }
.app-hotkey { align-self: stretch; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; color: var(--muted); padding: 6px 8px; border: 1px solid rgba(255,255,255,.1); border-radius: 6px; }
.app-hotkey b { color: var(--text); }
.app-hotkey button { margin-left: auto; padding: 3px 10px; border-radius: 5px; border: 1px solid rgba(251,44,54,.6); background: rgba(251,44,54,.15); color: var(--text); font: inherit; cursor: pointer; }
.app-hotkey span { flex-basis: 100%; color: #f59e0b; }
.app-hotkey span:empty { display: none; }
.review-link { align-self: flex-start; font-size: 12px; color: var(--muted); text-decoration: none; }
.review-link b { display: inline-block; min-width: 16px; padding: 0 5px; border-radius: 8px; background: rgba(255,255,255,.12); color: var(--text); font-size: 11px; text-align: center; }
.review-link[data-pending="1"] { color: var(--text); }
.review-link[data-pending="1"] b { background: #fb2c36; color: #fff; }
.toggle { align-self: flex-start; background: none; border: 0; color: var(--muted); font: inherit; font-size: 11px; padding: 0; cursor: pointer; }
.toggle::before { content: "▸ "; }
.toggle[aria-expanded="true"]::before { content: "▾ "; }
.toggle:hover, .toggle:focus-visible { color: var(--text); }
.details { display: flex; flex-direction: column; gap: 6px; }
.row { display: grid; grid-template-columns: 8px auto 1fr; column-gap: 8px; align-items: center; min-width: 0; }
.row .name { color: var(--muted); }
.row .value { text-align: right; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .sub { grid-column: 2 / 4; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.row .sub:empty { display: none; }
.updated { color: var(--muted); font-size: 10px; margin-top: 2px; }
.offline { border: 1px solid rgba(239,68,68,.35); background: rgba(239,68,68,.08); border-radius: 8px; padding: 8px 10px; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
.offline strong { color: var(--error); font-size: 12px; }
.controls { display: flex; flex-direction: column; gap: 8px; }
.panel { background: var(--raised); border: 1px solid var(--border); border-radius: 8px; padding: 8px 9px; display: flex; flex-direction: column; gap: 6px; margin: 0; }
.panel-title { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--muted); }
.panel select, .panel input:not([type]) { width: 100%; background: #0d0f14; color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 5px 6px; font: inherit; font-size: 12px; }
.check { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--muted); }
.action { background: rgba(251,44,54,.14); color: var(--text); border: 1px solid rgba(251,44,54,.45); border-radius: 6px; padding: 6px 8px; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.action[data-confirm="1"] { background: var(--accent); }
.action:disabled { opacity: .4; cursor: default; }
.msg { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.msg[data-kind="ok"] { color: var(--ok); }
.msg[data-kind="error"] { color: var(--error); }
code { font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
@media (max-width: 220px) { .brand-name { letter-spacing: .06em; } .timer { display: none; } }
`;

export const DOCK_JS = `"use strict";
(() => {
  const POLL_MS = 3000, MAX_BACKOFF_MS = 15000, TIMEOUT_MS = 2500, STALE_MS = 10000;
  const $ = (id) => document.getElementById(id);
  const dock = document.querySelector(".dock");
  let delay = POLL_MS, timer = null, lastOk = 0, state = null;

  const setLevel = (el, level) => el.setAttribute("data-level", level || "idle");
  const text = (el, value) => { el.textContent = value == null ? "" : String(value); };

  function row(id, item, extra) {
    const el = $(id);
    setLevel(el, item.level);
    text(el.querySelector(".value"), item.label);
    text(el.querySelector(".sub"), [item.detail, extra].filter(Boolean).join(" · "));
  }

  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + "h" + String(m).padStart(2, "0") : m + "min";
  }

  function render() {
    const online = state && Date.now() - lastOk < STALE_MS;
    dock.setAttribute("data-online", online ? "yes" : "no");
    $("offline").hidden = Boolean(online) || !lastOk && state === null && Date.now() < bootAt + 1500;
    if (!online) {
      setLevel($("overall"), "error");
      $("overall").title = "Agente indisponível";
      setLevel($("session-row"), "idle");
      text($("session-label"), state ? "Sem atualização do agente" : "Agente indisponível");
      text($("session-timer"), "");
      ["row-agent"].forEach((id) => row(id, { level: "error", label: "Indisponível", detail: null }));
      ["row-obs", "row-site", "row-sync", "row-alerts", "row-clips"].forEach((id) => row(id, { level: "idle", label: "—", detail: null }));
      text($("updated"), lastOk ? "Última atualização: " + new Date(lastOk).toLocaleTimeString("pt-BR") : "");
      return;
    }
    const g = state.game;
    setLevel($("overall"), state.overall);
    $("overall").title = { ok: "Tudo funcionando", warn: "Atenção necessária", error: "Falha em um serviço", idle: "Inativo" }[state.overall];
    text($("game-title"), g.title || "—");
    setLevel($("session-row"), g.level);
    text($("session-label"), g.sessionLabel);
    text($("session-timer"), g.sessionStartedAt ? duration(Date.now() - Date.parse(g.sessionStartedAt)) : "");
    $("game-detail").hidden = !g.detail;
    text($("game-detail"), g.detail);
    row("row-agent", state.agent, "v" + state.agent.version + " · ativo há " + duration(state.agent.uptimeSeconds * 1000));
    row("row-obs", state.obs);
    row("row-site", state.site);
    row("row-sync", state.sync);
    if (state.alerts) row("row-alerts", state.alerts);
    if (state.clips) row("row-clips", state.clips);
    $("review-count").textContent = String(state.momentsPending || 0);
    $("review-link").setAttribute("data-pending", state.momentsPending ? "1" : "0");
    text($("updated"), "Atualizado às " + new Date(lastOk).toLocaleTimeString("pt-BR"));
  }

  async function poll() {
    clearTimeout(timer);
    const controller = new AbortController();
    const abort = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch("./state", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("HTTP " + response.status);
      state = await response.json();
      lastOk = Date.now();
      delay = POLL_MS;
    } catch (error) {
      delay = Math.min(MAX_BACKOFF_MS, Math.round(delay * 1.6));
    } finally {
      clearTimeout(abort);
      render();
      timer = setTimeout(poll, document.hidden ? Math.max(delay, 10000) : delay);
    }
  }

  const bootAt = Date.now();
  const toggle = $("toggle"), details = $("details");
  const expanded = localStorage.getItem("rac-dock-expanded") === "1";
  details.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.addEventListener("click", () => {
    const open = details.hidden;
    details.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    localStorage.setItem("rac-dock-expanded", open ? "1" : "0");
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  setInterval(render, 1000);

  // ---------- Controles operacionais (mesma origem; nenhuma credencial na página) ----------
  const controls = $("controls"), toggleControls = $("toggle-controls");
  let catalog = [], lastSessionKey = "";
  const option = (value, label, disabled) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    if (disabled) o.disabled = true;
    return o;
  };
  const say = (id, kind, message) => { const el = $(id); el.setAttribute("data-kind", kind); text(el, message); };
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || ("HTTP " + r.status));
    return json;
  }
  // Ações que alteram dados pedem um segundo clique em até 4 s.
  function confirmFirst(button) {
    if (button.getAttribute("data-confirm") === "1") { button.removeAttribute("data-confirm"); button.textContent = button.getAttribute("data-label"); return true; }
    button.setAttribute("data-label", button.textContent);
    button.setAttribute("data-confirm", "1");
    button.textContent = "Confirmar?";
    setTimeout(() => {
      if (button.getAttribute("data-confirm") === "1") { button.removeAttribute("data-confirm"); button.textContent = button.getAttribute("data-label"); }
    }, 4000);
    return false;
  }
  async function loadAchievements() {
    const slug = $("custom-game").value, pick = $("custom-pick");
    if (!slug) return pick.replaceChildren(option("", "Escolha o jogo", true));
    pick.replaceChildren(option("", "Carregando conquistas…", true));
    try {
      const data = await (await fetch("/modules/achievements/site?slug=" + encodeURIComponent(slug), { cache: "no-store" })).json();
      const list = (data.achievements || []).filter((a) => a.isCustom);
      pick.replaceChildren(option("", list.length ? "Escolher CUSTOM publicada…" : "Nenhuma CUSTOM publicada para este jogo"));
      list.forEach((a) => pick.append(option(a.id, a.title + (a.completed ? " (já concluída)" : ""), a.completed)));
    } catch (e) {
      pick.replaceChildren(option("", "Conquistas do site indisponíveis"));
    }
  }
  async function loadControls(force) {
    const session = state && state.game && state.game.sessionStartedAt ? state.game : null;
    const key = session ? session.slug + "|" + session.sessionStartedAt : "-";
    if (!force && key === lastSessionKey) return;
    lastSessionKey = key;
    try {
      catalog = (await (await fetch("/modules/dock/controls", { cache: "no-store" })).json()).games || [];
    } catch (e) { catalog = []; }
    const gameSelect = $("game-select"), customGame = $("custom-game");
    gameSelect.replaceChildren(option("", session ? "Jogo correto para a sessão…" : "Sem sessão ativa", true));
    customGame.replaceChildren(option("", "Jogo da conquista…", true));
    catalog.forEach((g) => { gameSelect.append(option(g.slug, g.title)); customGame.append(option(g.slug, g.title)); });
    gameSelect.value = "";
    gameSelect.disabled = !session;
    $("game-apply").disabled = !session;
    if (session && session.slug) customGame.value = session.slug;
    await loadAchievements();
  }
  $("custom-game").addEventListener("change", loadAchievements);
  $("form-game").addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = $("game-select").value;
    if (!slug) return say("game-msg", "error", "Escolha o jogo correto.");
    if (!confirmFirst($("game-apply"))) return;
    try {
      const r = await post("/modules/games/session/correct", { slug, remember: $("game-remember").checked });
      say("game-msg", "ok", "Sessão corrigida para " + r.session.title + (r.remembered ? " (lembrado)" : ""));
      poll();
    } catch (e) { say("game-msg", "error", e.message); }
  });
  $("form-custom").addEventListener("submit", async (event) => {
    event.preventDefault();
    const slug = $("custom-game").value, achievementId = $("custom-pick").value, name = $("custom-name").value.trim();
    if (!slug) return say("custom-msg", "error", "Escolha o jogo.");
    if (!achievementId && name.length < 2) return say("custom-msg", "error", "Escolha uma CUSTOM publicada ou digite o nome.");
    if (!confirmFirst($("custom-apply"))) return;
    const isTest = $("custom-test").checked;
    try {
      const r = await post("/modules/achievements/custom", {
        slug,
        achievementId: achievementId || undefined,
        name: achievementId ? undefined : name,
        description: achievementId ? undefined : ($("custom-desc").value.trim() || undefined),
        isTest,
      });
      say("custom-msg", "ok", r.created ? "Desbloqueio registrado" + (isTest ? " (teste)" : "") + "." : "Esta conquista já tinha sido registrada.");
      $("custom-name").value = "";
      $("custom-desc").value = "";
      loadAchievements();
    } catch (e) { say("custom-msg", "error", e.message); }
  });
  $("form-clip").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirmFirst($("clip-test"))) return;
    try {
      const r = await post("/modules/clips/test", {});
      say("clip-msg", "ok", "Clip de teste em ~5 s, em: " + (r.dir || "pasta de gravação do OBS") + " (subpasta testes)");
      poll();
    } catch (e) { say("clip-msg", "error", e.message); }
  });
  $("form-mastery").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!confirmFirst($("mastery-test"))) return;
    const slug = state && state.game && state.game.sessionStartedAt && state.game.slug ? state.game.slug : undefined;
    try {
      await post("/modules/mastery/test", { slug });
      say("mastery-msg", "ok", "Maestria de teste na fila do overlay.");
      poll();
    } catch (e) { say("mastery-msg", "error", e.message); }
  });
  toggleControls.addEventListener("click", () => {
    const open = controls.hidden;
    controls.hidden = !open;
    toggleControls.setAttribute("aria-expanded", String(open));
    if (open) loadControls(true);
  });
  setInterval(() => { if (!controls.hidden && state) loadControls(false); }, 3000);

  // Só no aplicativo de desktop (no dock do OBS a ponte não existe e a linha fica escondida).
  if (window.rumoApp) {
    const showHotkey = async () => {
      const h = await window.rumoApp.hotkey();
      $("app-hotkey-key").textContent = h.hotkey ? h.hotkey.split("+").join(" + ") : "desativado";
      $("app-hotkey-error").textContent = h.error ? " · " + h.error : "";
      $("app-hotkey").hidden = false;
    };
    $("app-hotkey-change").addEventListener("click", () => window.rumoApp.openSettings());
    window.addEventListener("focus", showHotkey);
    setInterval(showHotkey, 5000);
    showHotkey();
  }
  poll();
})();
`;
