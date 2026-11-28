/*
 * Browser Source do OBS (1920x1080, fundo transparente) servida pelo agente.
 * Mesma origem da API local; sem token. Recebe apresentações por SSE (./events) e confirma
 * início/fim por POST ./ack com o nonce da apresentação. Texto sempre via textContent.
 * ?demo=1 repete um alerta de exemplo só na página (sem falar com a fila), para posicionar;
 * ?demo=mastery faz o mesmo com a apresentação de Maestria.
 */
export const OVERLAY_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: https:; base-uri 'none'; form-action 'none'";

export const OVERLAY_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Rumo à Conquista — Alertas</title>
<link rel="stylesheet" href="./overlay.css">
</head>
<body>
<div class="stage">
  <article class="alert" id="alert" data-state="hidden" aria-live="polite">
    <div class="emblem" aria-hidden="true">
      <img id="art" alt="" hidden>
      <svg id="trophy" viewBox="0 0 64 64" width="46" height="46">
        <path class="cup" d="M20 10h24v14a12 12 0 0 1-24 0z"/>
        <path class="handle" d="M20 14H12v4a9 9 0 0 0 9 9M44 14h8v4a9 9 0 0 1-9 9"/>
        <path class="stem" d="M32 36v9M24 54h16M27 45h10l2 9H25z"/>
      </svg>
    </div>
    <div class="body">
      <div class="kicker"><span id="kicker">Conquista desbloqueada</span><b class="test" id="test" hidden>Teste</b></div>
      <h1 class="name" id="name"></h1>
      <p class="desc" id="desc"></p>
      <div class="game" id="game"></div>
    </div>
    <div class="progress" aria-hidden="true"><span></span></div>
  </article>
  <section class="mastery" id="mastery" data-state="hidden" aria-live="polite">
    <div class="m-flare" aria-hidden="true"></div>
    <div class="m-announce" aria-hidden="true"><span class="m-word">Maestria</span><span class="m-sub">Conclusão integral</span></div>
    <div class="m-card">
      <div class="m-emblem" aria-hidden="true">
        <img id="m-art" alt="" hidden>
        <svg id="m-gem" viewBox="0 0 64 64" width="64" height="64">
          <path class="gem" d="M18 10h28l12 14-26 32L6 24z"/>
          <path class="facet" d="M6 24h52M18 10l7 14 7-14 7 14 7-14M25 24l7 32 7-32"/>
        </svg>
      </div>
      <div class="m-body">
        <div class="m-kicker"><span>Maestria alcançada</span><b class="test" id="m-test" hidden>Teste</b></div>
        <h1 class="m-game" id="m-game"></h1>
        <p class="m-line"><strong>100%</strong> das conquistas concluídas</p>
        <div class="m-stats" id="m-stats"></div>
      </div>
      <div class="m-progress" aria-hidden="true"><span></span></div>
    </div>
  </section>
</div>
<script src="./overlay.js"></script>
</body>
</html>
`;

export const OVERLAY_CSS = `
:root { --enter: 700ms; --hold: 7000ms; --exit: 600ms; --accent: #fb2c36; --text: #f4f5f7; --muted: rgba(244,245,247,.66); }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; overflow: hidden; }
body { font-family: Inter, "Segoe UI", system-ui, sans-serif; color: var(--text); -webkit-font-smoothing: antialiased; }
.stage { position: absolute; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: 56px; }

.alert {
  position: relative; width: 660px; min-height: 128px; display: flex; gap: 22px; align-items: center;
  padding: 22px 28px 26px 22px; border-radius: 16px; overflow: hidden;
  background: linear-gradient(180deg, rgba(16,18,24,.95), rgba(7,8,11,.95));
  border: 1px solid rgba(255,255,255,.08);
  box-shadow: 0 22px 60px rgba(0,0,0,.55), inset 0 1px 0 rgba(255,255,255,.05);
  opacity: 0; transform: translateY(-28px) scale(.985);
}
.alert::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--accent); }

.emblem {
  flex: none; width: 88px; height: 88px; border-radius: 14px; display: grid; place-items: center;
  background: radial-gradient(circle at 50% 38%, rgba(251,44,54,.32), rgba(251,44,54,.06) 62%, transparent 70%), #0d0f14;
  border: 1px solid rgba(251,44,54,.38);
}
.emblem img { width: 100%; height: 100%; object-fit: cover; border-radius: 13px; }
.emblem svg { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.emblem .cup { stroke: #fff; fill: rgba(251,44,54,.22); }
.emblem .handle, .emblem .stem { stroke: rgba(255,255,255,.86); }

.body { min-width: 0; flex: 1; }
.kicker { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 800; letter-spacing: .22em; text-transform: uppercase; color: var(--accent); }
.test { font-size: 11px; letter-spacing: .14em; color: #0b0c10; background: #f59e0b; padding: 2px 7px; border-radius: 4px; }
.name { margin: 6px 0 0; font-size: 30px; line-height: 1.15; font-weight: 800; letter-spacing: -.01em; overflow-wrap: anywhere; }
.desc { margin: 6px 0 0; font-size: 17px; line-height: 1.35; color: var(--muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.game { margin-top: 10px; font-size: 13px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: rgba(244,245,247,.5); }
.name:empty, .desc:empty, .game:empty { display: none; }

.progress { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: rgba(255,255,255,.06); }
.progress span { display: block; height: 100%; width: 100%; background: var(--accent); transform-origin: left; transform: scaleX(1); }

.alert[data-state="enter"] { animation: alert-in var(--enter) cubic-bezier(.2,.8,.2,1) forwards; }
.alert[data-state="enter"] .emblem { animation: emblem-in calc(var(--enter) * 1.1) cubic-bezier(.2,.9,.3,1.2) both; }
.alert[data-state="hold"] { opacity: 1; transform: none; }
.alert[data-state="hold"] .progress span { animation: drain var(--hold) linear forwards; }
.alert[data-state="exit"] { animation: alert-out var(--exit) cubic-bezier(.4,0,.6,1) forwards; }
.alert[data-state="exit"] .progress span { transform: scaleX(0); }

@keyframes alert-in { from { opacity: 0; transform: translateY(-28px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes emblem-in { from { transform: scale(.6) rotate(-8deg); opacity: 0; } 60% { opacity: 1; } to { transform: none; opacity: 1; } }
@keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@keyframes alert-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-18px); } }

/* Maestria (Fase 4.5): anúncio dourado, depois o cartão com o jogo e a conclusão integral. */
.mastery { --m-enter: 2600ms; --m-hold: 9000ms; --m-exit: 1000ms; --gold: #f5c451; --gold-deep: #b7791f;
  position: absolute; top: 64px; left: 50%; width: 940px; margin-left: -470px; height: 230px; opacity: 0; pointer-events: none; }
.mastery[data-state="hidden"] { display: none; }
.m-flare { position: absolute; left: -120px; right: -120px; top: 40px; height: 150px; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(245,196,81,.55), rgba(245,196,81,.12) 45%, transparent 70%); filter: blur(6px); }
.m-announce { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; opacity: 0; }
.m-word { font-size: 92px; line-height: 1; font-weight: 900; text-transform: uppercase; letter-spacing: .32em; padding-left: .32em;
  background: linear-gradient(180deg, #fff7dc 10%, var(--gold) 55%, var(--gold-deep)); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 6px 24px rgba(245,196,81,.45)); }
.m-sub { margin-top: 14px; font-size: 18px; font-weight: 800; letter-spacing: .5em; padding-left: .5em; text-transform: uppercase; color: rgba(255,247,220,.85); }

.m-card { position: absolute; inset: 0; display: flex; gap: 28px; align-items: center; padding: 26px 34px 30px 28px; border-radius: 20px; overflow: hidden; opacity: 0;
  background: linear-gradient(135deg, rgba(36,27,8,.96), rgba(10,9,7,.96) 55%, rgba(30,22,6,.96));
  border: 1px solid rgba(245,196,81,.55);
  box-shadow: 0 0 0 1px rgba(245,196,81,.12), 0 26px 80px rgba(0,0,0,.6), 0 0 60px rgba(245,196,81,.22), inset 0 1px 0 rgba(255,247,220,.12); }
.m-card::after { content: ""; position: absolute; top: 0; bottom: 0; width: 160px; left: -200px; transform: skewX(-18deg);
  background: linear-gradient(90deg, transparent, rgba(255,247,220,.22), transparent); }
.m-emblem { flex: none; width: 150px; height: 150px; border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 50% 40%, rgba(245,196,81,.45), rgba(245,196,81,.08) 62%, transparent 72%), #120f08;
  border: 2px solid rgba(245,196,81,.7); box-shadow: 0 0 40px rgba(245,196,81,.35); }
.m-emblem img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
.m-emblem svg { width: 84px; height: 84px; fill: none; stroke-linejoin: round; stroke-linecap: round; }
.m-emblem .gem { fill: rgba(245,196,81,.28); stroke: #fff7dc; stroke-width: 2.5; }
.m-emblem .facet { stroke: rgba(255,247,220,.75); stroke-width: 1.6; }
.m-body { min-width: 0; flex: 1; }
.m-kicker { display: flex; align-items: center; gap: 12px; font-size: 15px; font-weight: 900; letter-spacing: .3em; text-transform: uppercase; color: var(--gold); }
.m-game { margin: 8px 0 0; font-size: 42px; line-height: 1.08; font-weight: 900; letter-spacing: -.01em; color: #fffaf0; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.m-line { margin: 10px 0 0; font-size: 20px; color: rgba(255,247,220,.82); }
.m-line strong { color: var(--gold); font-weight: 900; }
.m-stats { margin-top: 10px; font-size: 14px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: rgba(255,247,220,.55); }
.m-stats:empty { display: none; }
.m-progress { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: rgba(245,196,81,.12); }
.m-progress span { display: block; height: 100%; background: linear-gradient(90deg, var(--gold-deep), var(--gold), #fff7dc); transform-origin: left; transform: scaleX(1); }

.mastery[data-state="enter"] { opacity: 1; }
.mastery[data-state="enter"] .m-flare { animation: m-flare var(--m-enter) ease-out forwards; }
.mastery[data-state="enter"] .m-announce { animation: m-announce var(--m-enter) cubic-bezier(.2,.8,.2,1) forwards; }
.mastery[data-state="enter"] .m-card { animation: m-card-in calc(var(--m-enter) * .4) cubic-bezier(.2,.9,.3,1.1) calc(var(--m-enter) * .6) forwards; }
.mastery[data-state="hold"] { opacity: 1; }
.mastery[data-state="hold"] .m-card { opacity: 1; transform: none; }
.mastery[data-state="hold"] .m-card::after { animation: m-shine 2.6s ease-in-out .2s 2; }
.mastery[data-state="hold"] .m-emblem { animation: m-glow 2.4s ease-in-out infinite alternate; }
.mastery[data-state="hold"] .m-progress span { animation: drain var(--m-hold) linear forwards; }
.mastery[data-state="exit"] { opacity: 1; }
.mastery[data-state="exit"] .m-card { opacity: 1; animation: m-out var(--m-exit) cubic-bezier(.4,0,.6,1) forwards; }
.mastery[data-state="exit"] .m-progress span { transform: scaleX(0); }

@keyframes m-flare { 0% { opacity: 0; transform: scaleX(.2); } 30% { opacity: 1; transform: scaleX(1); } 70% { opacity: .8; } 100% { opacity: 0; transform: scaleX(1.15); } }
@keyframes m-announce { 0% { opacity: 0; transform: scale(1.35); letter-spacing: .6em; } 22% { opacity: 1; transform: scale(1); } 58% { opacity: 1; transform: scale(1); } 75% { opacity: 0; transform: scale(.92); } 100% { opacity: 0; } }
@keyframes m-card-in { from { opacity: 0; transform: translateY(-20px) scale(.96); } to { opacity: 1; transform: none; } }
@keyframes m-shine { from { left: -200px; } to { left: 1040px; } }
@keyframes m-glow { from { box-shadow: 0 0 30px rgba(245,196,81,.28); } to { box-shadow: 0 0 56px rgba(245,196,81,.55); } }
@keyframes m-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-24px) scale(.98); } }
`;

export const OVERLAY_JS = `"use strict";
(() => {
  const demo = new URLSearchParams(location.search).has("demo");
  const el = document.getElementById("alert");
  const $ = (id) => document.getElementById(id);
  let timing = { enterMs: 700, holdMs: 7000, exitMs: 600 };
  let current = null;

  function setText(id, value) { $(id).textContent = value || ""; }

  const mastery = document.getElementById("mastery");

  function clear() {
    if (current) current.timers.forEach(clearTimeout);
    current = null;
    el.setAttribute("data-state", "hidden");
    mastery.setAttribute("data-state", "hidden");
  }

  // Anima um elemento: enter → hold → exit → hidden, confirmando início e fim.
  function run(target, prefix, nonce, onStarted, onEnded) {
    target.style.setProperty(prefix + "enter", timing.enterMs + "ms");
    target.style.setProperty(prefix + "hold", timing.holdMs + "ms");
    target.style.setProperty(prefix + "exit", timing.exitMs + "ms");
    const me = { nonce, timers: [] };
    current = me;
    target.setAttribute("data-state", "hidden");
    void target.offsetWidth; // reinicia as animações
    target.setAttribute("data-state", "enter");
    onStarted();
    me.timers.push(setTimeout(() => target.setAttribute("data-state", "hold"), timing.enterMs));
    me.timers.push(setTimeout(() => target.setAttribute("data-state", "exit"), timing.enterMs + timing.holdMs));
    me.timers.push(setTimeout(() => {
      if (current !== me) return;
      current = null;
      target.setAttribute("data-state", "hidden");
      onEnded();
    }, timing.enterMs + timing.holdMs + timing.exitMs));
  }

  function showMastery(presentation, nonce, onStarted, onEnded) {
    clear();
    setText("m-game", presentation.gameTitle);
    const parts = [];
    if (presentation.total) {
      parts.push(presentation.total + (presentation.total === 1 ? " conquista" : " conquistas"));
      if (presentation.custom) parts.push(presentation.official + " oficiais · " + presentation.custom + " CUSTOM");
    }
    if (presentation.badgeTitle) parts.push(presentation.badgeTitle);
    setText("m-stats", parts.join(" · "));
    const art = $("m-art");
    art.hidden = true;
    $("m-gem").style.display = "";
    if (presentation.image) {
      art.onload = () => { art.hidden = false; $("m-gem").style.display = "none"; };
      art.onerror = () => { art.hidden = true; $("m-gem").style.display = ""; };
      art.src = presentation.image;
    } else {
      art.removeAttribute("src");
    }
    $("m-test").hidden = !presentation.isTest;
    run(mastery, "--m-", nonce, onStarted, onEnded);
  }

  function show(presentation, nonce, onStarted, onEnded) {
    if (presentation.kind === "mastery") return showMastery(presentation, nonce, onStarted, onEnded);
    clear();
    // Sem o nome da conquista no alerta, o título genérico sobe e o rótulo não se repete.
    setText("name", presentation.name || "Conquista desbloqueada");
    $("kicker").hidden = !presentation.name;
    $("kicker").textContent = presentation.isCustom ? "Conquista CUSTOM desbloqueada" : "Conquista desbloqueada";
    const art = $("art");
    art.hidden = true;
    $("trophy").style.display = "";
    if (presentation.image) {
      art.onload = () => { art.hidden = false; $("trophy").style.display = "none"; };
      art.onerror = () => { art.hidden = true; $("trophy").style.display = ""; };
      art.src = presentation.image;
    } else {
      art.removeAttribute("src");
    }
    setText("desc", presentation.description);
    setText("game", presentation.gameTitle);
    $("test").hidden = !presentation.isTest;
    run(el, "--", nonce, onStarted, onEnded);
  }

  async function ack(nonce, phase) {
    for (let i = 0; i < 3; i += 1) {
      try {
        const r = await fetch("./ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce, phase }) });
        if (r.ok || r.status === 409) return;
      } catch (e) { /* tenta de novo */ }
      await new Promise((r) => setTimeout(r, 300 * (i + 1)));
    }
  }

  if (demo && new URLSearchParams(location.search).get("demo") === "mastery") {
    timing = { enterMs: 2600, holdMs: 9000, exitMs: 1000 };
    const sample = { kind: "mastery", gameTitle: "Hollow Knight", total: 63, official: 63, custom: 0, badgeTitle: null, image: null, isTest: true };
    const loop = () => show(sample, null, () => {}, () => setTimeout(loop, 1500));
    loop();
    return;
  }
  if (demo) {
    const sample = { name: "Guardião de Hallownest", description: "Exemplo de posicionamento. Nada é enviado ao agente.", gameTitle: "Hollow Knight", isTest: true };
    const loop = () => show(sample, null, () => {}, () => setTimeout(loop, 1500));
    loop();
    return;
  }

  const source = new EventSource("./events");
  source.addEventListener("hello", (e) => { timing = JSON.parse(e.data).timing; });
  source.addEventListener("present", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.timing) timing = msg.timing;
    show(msg.presentation, msg.nonce, () => ack(msg.nonce, "started"), () => ack(msg.nonce, "ended"));
  });
  source.addEventListener("cancel", (e) => {
    const msg = JSON.parse(e.data);
    if (current && current.nonce === msg.nonce) clear();
  });
  // Ao reconectar, nada da tentativa antiga continua na tela: a fila decide o que reapresentar.
  source.addEventListener("error", () => clear());
})();
`;
