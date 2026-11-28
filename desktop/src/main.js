// Aplicativo Rumo à Conquista — Parte A do plano de captura híbrida.
// Casca de desktop sobre o agente atual: bandeja, janela principal (o painel servido pelo agente),
// configurações, atalho global "Marcar momento" e início com o Windows.
import { app, BrowserWindow, ipcMain, Menu, Notification, shell, Tray } from "electron";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng, loadTrophy, trayImage, windowImage } from "./app-icons.js";
import { Indicator } from "./indicator-window.js";
import { GlobalHotkey, momentSoundWav } from "./hotkey.js";
import { AgentSupervisor } from "./supervisor.js";
import { CONFIG_FIELDS, readAgentConfig, validateSettings, writeAgentConfig } from "./settings-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const APP_NAME = "Rumo à Conquista";
const APP_ID = "br.rumoaconquista.desktop";
const LOGIN_ITEM_NAME = "RumoAConquista";
/** Padrão: a tecla Pause sozinha (qualquer tecla pode ser escolhida nas configurações). */
const DEFAULT_HOTKEY = "Pause";

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  // Segunda instância: entrega os argumentos (ex.: --quit do desinstalador) à primeira e sai.
  app.quit();
} else if (process.argv.includes("--quit")) {
  // Pedido para fechar, mas nenhuma outra instância aberta: não há o que fechar — sai sem iniciar nada
  // (sem isso, o próprio --quit viraria o aplicativo e o desinstalador/atualização ficaria esperando).
  app.exit(0);
} else {
  void boot();
}

function dataDir() {
  if (process.env.RUMO_AGENT_DATA_DIR) return process.env.RUMO_AGENT_DATA_DIR;
  const base = process.env.LOCALAPPDATA || join(app.getPath("home"), "AppData", "Local");
  return join(base, "RumoAConquista", "agent");
}
const agentDir = () => (app.isPackaged ? join(process.resourcesPath, "agent") : resolve(here, "..", "..", "agent"));
const desktopSettingsPath = () => join(dataDir(), "desktop.json");

function readDesktopSettings() {
  try {
    return { hotkey: DEFAULT_HOTKEY, ...JSON.parse(readFileSync(desktopSettingsPath(), "utf8")) };
  } catch {
    return { hotkey: DEFAULT_HOTKEY };
  }
}
function writeDesktopSettings(settings) {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(desktopSettingsPath(), JSON.stringify(settings, null, 2));
}

let tray = null;
let mainWindow = null;
let settingsWindow = null;
let supervisor = null;
let overall = "idle";
let lastGame = null;
let hotkeyError = null;
let quitting = false;

// Ícone: o troféu de Maestria do site — simplificado na bandeja (legível em 16 px), detalhado nos
// tamanhos grandes. Na bandeja, um ponto no canto mostra o estado (ok = sem ponto).
let trophy = null;
const trophyImage = () => (trophy ??= loadTrophy(join(here, "..", "assets", "maestria.png")));
let windowIcon = null;
const appIcon = () => (windowIcon ??= windowImage(trophyImage()));
const icons = {};
const trayIcon = (state) => (icons[state] ??= trayImage(trophyImage(), state));

// Diário do aplicativo (diagnóstico): <dados>/logs/desktop-AAAA-MM-DD.log
function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(`[desktop] ${line}`);
  try {
    mkdirSync(join(dataDir(), "logs"), { recursive: true });
    appendFileSync(join(dataDir(), "logs", `desktop-${line.slice(0, 10)}.log`), `${line}\n`);
  } catch {
    // diagnóstico é opcional
  }
}

async function boot() {
  await app.whenReady();
  mkdirSync(dataDir(), { recursive: true });

  supervisor = new AgentSupervisor({
    agentDir: agentDir(),
    dataDir: dataDir(),
    nodeExecutable: process.execPath,
    log,
    onChange: () => {
      refreshTray();
      if (mainWindow && !mainWindow.isDestroyed()) loadMain();
    },
  });

  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--quit")) return void quit();
    showMain();
  });
  // Mantém o app vivo na bandeja quando todas as janelas fecham.
  app.on("window-all-closed", () => {});
  app.on("before-quit", () => {
    quitting = true;
  });

  tray = new Tray(trayIcon("idle"));
  tray.setToolTip(APP_NAME);
  tray.on("click", () => showMain());
  refreshTray();

  indicator = new Indicator({
    htmlPath: join(here, "indicator.html"),
    icon: `data:image/png;base64,${iconPng(trophyImage(), 52).toString("base64")}`,
    log,
  });
  applyIndicator();
  void registerHotkey(readDesktopSettings().hotkey);
  registerIpc();

  await supervisor.ensure();
  setInterval(() => void pollState(), 5_000).unref?.();
  void pollState();

  // Sempre inicia minimizado na bandeja (a janela abre pelo ícone da bandeja ou abrindo o app de
  // novo). Aberto à mão, avisa onde está; iniciado com o Windows (--hidden), fica em silêncio.
  if (!process.argv.includes("--hidden")) {
    const key = readDesktopSettings().hotkey;
    notify("Rumo à Conquista está na bandeja", key ? `${key.split("+").join(" + ")} marca momentos · clique no troféu para abrir` : "Clique no troféu para abrir");
  }
}

const RUN_KEY = String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`;
/** Estado real de "Iniciar com o Windows": a entrada no registro (criada pelo app ou pelo instalador). */
function loginItemEnabled() {
  if (!app.isPackaged) return false;
  try {
    execFileSync("reg", ["query", RUN_KEY, "/v", LOGIN_ITEM_NAME], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/** Só é chamado quando você muda a opção (nunca na abertura, para não desfazer a escolha do instalador). */
function applyLoginItem(enabled) {
  // Só o aplicativo instalado se registra para iniciar com o Windows (nunca o de desenvolvimento).
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: ["--hidden"], name: LOGIN_ITEM_NAME });
}

/** Indicador na tela: padrão só ao marcar (do aperto até o clip salvo), no canto inferior direito. */
let indicator = null;
function applyIndicator() {
  const s = readDesktopSettings();
  indicator?.apply({ mode: s.indicatorMode ?? "on-mark", corner: s.indicatorCorner ?? "bottom-right" });
}

function momentSoundPath() {
  const path = join(dataDir(), "momento.wav");
  try {
    writeFileSync(path, momentSoundWav());
    return path;
  } catch {
    return null;
  }
}

// Registro do Windows (RegisterHotKey) num auxiliar: aceita qualquer tecla, inclusive Pause, e
// funciona com o jogo em tela cheia.
const hotkey = new GlobalHotkey(log);
async function registerHotkey(accelerator) {
  hotkeyError = null;
  hotkey.stop();
  if (!accelerator) return refreshTray();
  // Som de confirmação tocado pelo auxiliar no instante do aperto (padrão: ligado).
  const sound = readDesktopSettings().captureSound === false ? null : momentSoundPath();
  const result = await hotkey.start(accelerator, () => void markMoment("atalho"), { soundPath: sound });
  if (!result.ok) {
    hotkeyError = result.error;
    log(hotkeyError);
    notify("Atalho de captura indisponível", `${hotkeyError}. Troque em Configurações.`);
  } else if (result.warning) {
    // A captura funciona (leitura direta da tecla); só informa que outro programa também a usa.
    hotkeyError = result.warning;
    log(result.warning);
  }
  refreshTray();
}

async function markMoment(source) {
  log(`marcar momento (origem: ${source})`);
  // Sinal imediato na tela, antes da resposta do agente.
  indicator?.show("marking", "Marcando momento…", "", 0);
  let result;
  try {
    result = await supervisor.request("POST", "/modules/moments/mark", { source });
  } catch (error) {
    indicator?.show("error", "Momento NÃO marcado", error.message, 4_000);
    notify("Não foi possível marcar o momento", error.message);
    return;
  }
  const game = result.moment?.gameTitle ?? "jogo não identificado";
  if (!result.created) return void indicator?.show("ok", "Já marcado", "Aperto repetido em menos de 3 s", 2_000);
  void followClip(result.moment, game);
}

/**
 * Indicador do aperto até o fim da gravação: "Gravando momento" com contagem regressiva do trecho
 * posterior, "Salvando clip…", e então "Clip salvo" (some) + notificação. Sem buffer: avisa na hora.
 */
let followToken = 0;
async function followClip(moment, game) {
  const token = ++followToken; // um aperto novo assume o indicador
  const done = (state, title, detail, ms, note) => {
    if (token !== followToken) return;
    indicator?.show(state, title, detail, ms);
    if (note) notify(note.title, note.body);
  };
  const clips = await supervisor.request("GET", "/modules/clips/status").catch(() => null);
  if (!moment.clipId || !clips?.enabled || !clips.bufferActive) {
    const why = !clips?.enabled ? "clips desativados" : !clips?.obs ? "OBS desconectado" : "buffer de replay desligado no OBS";
    return done("error", "Momento marcado, SEM clip", why, 5_000, { title: "Momento marcado sem clip", body: `${game} · ${why}` });
  }
  const limit = Date.now() + 10 * 60_000;
  while (Date.now() < limit) {
    if (token !== followToken) return;
    const clip = await supervisor.request("GET", `/modules/clips/item?id=${encodeURIComponent(moment.clipId)}`).catch(() => null);
    if (!clip) break;
    if (clip.status === "completed") {
      return done("ok", "✓ Clip salvo", game, 2_500, { title: "Clip salvo", body: `${game} · revise em Bandeja > Revisar momentos` });
    }
    if (clip.status === "failed" || clip.status === "expired") {
      return done("error", "Clip NÃO salvo", clip.lastError ?? clip.status, 6_000, { title: "Clip não salvo", body: `${game} · ${clip.lastError ?? clip.status}` });
    }
    const left = Math.max(0, Math.ceil((clip.dueAt - clip.now) / 1000));
    if (clip.status === "pending" && left > 0) {
      indicator?.show("recording", "● Gravando momento", `${game} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, 0);
    } else {
      indicator?.show("recording", "● Salvando clip…", game, 0);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  done("error", "Clip sem confirmação", "Veja em Revisar momentos", 5_000);
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, silent: false, icon: appIcon() }).show();
}

async function pollState() {
  try {
    const state = await supervisor.request("GET", "/modules/dock/state");
    overall = state.overall ?? "idle";
    lastGame = state.game?.title ?? null;
  } catch {
    overall = supervisor.state === "starting" ? "idle" : "error";
  }
  refreshTray();
}

const STATE_LABEL = {
  stopped: "Agente parado",
  starting: "Iniciando o agente…",
  running: "Agente em execução",
  attached: "Conectado ao agente já em execução",
  crashed: "O agente caiu — reiniciando",
};

function refreshTray() {
  if (!tray) return;
  const settings = readDesktopSettings();
  tray.setImage(trayIcon(overall in { ok: 1, warn: 1, error: 1 } ? overall : "idle"));
  tray.setToolTip(`${APP_NAME}\n${STATE_LABEL[supervisor?.state ?? "stopped"]}${lastGame ? `\nJogo: ${lastGame}` : ""}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Abrir", click: () => showMain() },
      { label: "Revisar momentos", click: () => showMain("/modules/moments/") },
      { label: `Marcar momento${settings.hotkey ? `  (${settings.hotkey.replace(/\+/g, " + ")})` : ""}`, click: () => void markMoment("bandeja") },
      { label: "Trocar atalho de captura…", click: () => showSettings() },
      { type: "separator" },
      { label: STATE_LABEL[supervisor?.state ?? "stopped"], enabled: false },
      ...(hotkeyError ? [{ label: hotkeyError, enabled: false }] : []),
      { type: "separator" },
      { label: "Configurações…", click: () => showSettings() },
      {
        label: "Iniciar com o Windows",
        type: "checkbox",
        checked: loginItemEnabled(),
        enabled: app.isPackaged,
        click: (item) => {
          applyLoginItem(item.checked);
          refreshTray();
        },
      },
      { label: "Abrir pasta de dados", click: () => void shell.openPath(dataDir()) },
      { type: "separator" },
      { label: "Sair", click: () => void quit() },
    ]),
  );
}

const WAITING_PAGE = (message) =>
  `data:text/html;charset=utf-8,${encodeURIComponent(
    `<!doctype html><meta charset="utf-8"><style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0b0c10;color:#f4f5f7;font:15px Segoe UI,sans-serif}p{opacity:.7}</style><div><h2>${APP_NAME}</h2><p>${message}</p></div>`,
  )}`;

let mainPath = "/modules/dock/";
function loadMain() {
  const base = supervisor.baseUrl();
  const ready = base && (supervisor.state === "running" || supervisor.state === "attached");
  const target = ready ? `${base}${mainPath}` : WAITING_PAGE(STATE_LABEL[supervisor.state] ?? "Aguardando o agente…");
  if (mainWindow.webContents.getURL() !== target) void mainWindow.loadURL(target);
}

function showMain(path) {
  if (path) mainPath = path;
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (path) loadMain();
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 480,
    height: 860,
    minWidth: 360,
    title: APP_NAME,
    icon: appIcon(),
    backgroundColor: "#0b0c10",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(here, "main-preload.cjs") },
  });
  // Links externos abrem no navegador; a janela só navega no próprio agente.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1:") && !url.startsWith("data:")) event.preventDefault();
  });
  // Fechar a janela só esconde: o aplicativo continua na bandeja.
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  loadMain();
}

function showSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow.focus();
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 720,
    title: `${APP_NAME} — Configurações`,
    icon: appIcon(),
    backgroundColor: "#0b0c10",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: join(here, "preload.cjs") },
  });
  void settingsWindow.loadFile(join(here, "settings.html"));
}

function registerIpc() {
  // Janela principal: linha "Atalho de captura" com botão para trocar.
  ipcMain.handle("app:hotkey", () => ({ hotkey: readDesktopSettings().hotkey || "", error: hotkeyError }));
  ipcMain.handle("app:open-settings", () => void showSettings());
  ipcMain.handle("settings:get", () => ({
    agent: readAgentConfig(dataDir()),
    desktop: { ...readDesktopSettings(), startWithWindows: loginItemEnabled() },
    fields: CONFIG_FIELDS,
    packaged: app.isPackaged,
    dataDir: dataDir(),
    hotkeyError,
    defaultHotkey: DEFAULT_HOTKEY,
  }));
  ipcMain.handle("settings:save", async (_event, input) => {
    const problems = validateSettings(input);
    if (problems.length) return { ok: false, problems };
    const desktop = { ...readDesktopSettings(), hotkey: String(input.desktop.hotkey ?? "").trim(), captureSound: input.desktop.captureSound !== false,
      indicatorMode: ["always", "on-mark", "off"].includes(input.desktop.indicatorMode) ? input.desktop.indicatorMode : "on-mark",
      indicatorCorner: ["bottom-right", "bottom-left", "top-right", "top-left"].includes(input.desktop.indicatorCorner) ? input.desktop.indicatorCorner : "bottom-right" };
    delete desktop.startWithWindows;
    writeDesktopSettings(desktop);
    applyIndicator();
    if (Boolean(input.desktop.startWithWindows) !== loginItemEnabled()) applyLoginItem(Boolean(input.desktop.startWithWindows));
    await registerHotkey(desktop.hotkey);
    const changed = writeAgentConfig(dataDir(), input.agent);
    if (changed) {
      const ok = await supervisor.restart();
      if (!ok) return { ok: false, problems: ["O agente não voltou com a nova configuração.", ...supervisor.lastOutput.slice(-5)] };
    }
    return { ok: true, restarted: changed, hotkeyError };
  });
  ipcMain.handle("settings:pick-folder", async () => {
    const { dialog } = await import("electron");
    const result = await dialog.showOpenDialog(settingsWindow, { properties: ["openDirectory", "createDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
}

async function quit() {
  if (quitting && !supervisor) return;
  quitting = true;
  hotkey.stop();
  indicator?.close();
  tray?.setToolTip(`${APP_NAME}\nEncerrando…`);
  await supervisor?.stop();
  app.exit(0);
}

app.on("will-quit", () => hotkey.stop());
