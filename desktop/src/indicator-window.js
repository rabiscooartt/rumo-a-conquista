// Janela do indicador na tela (canto da tela, estilo "gravando" da NVIDIA).
//  - Sempre por cima, transparente, sem foco e sem receber cliques: não atrapalha o jogo.
//  - Protegida contra captura (Windows): o OBS não grava o indicador na live.
//  - Aparece sobre jogos em janela e em tela cheia sem bordas. Em tela cheia exclusiva nenhum
//    programa desenha por cima sem se injetar no jogo (o que não fazemos).
import { BrowserWindow, screen } from "electron";

const SIZE = { width: 300, height: 52 };
const MARGIN = 16;

export class Indicator {
  constructor({ htmlPath, icon, log = () => {} }) {
    this.htmlPath = htmlPath;
    this.icon = icon;
    this.log = log;
    this.win = null;
    this.ready = null;
    this.settings = { mode: "on-mark", corner: "bottom-right" };
    this.keepOnTop = null;
  }

  /** mode: "always" (sempre visível) | "on-mark" (só ao marcar) | "off"; corner: "bottom-right" etc. */
  apply(settings) {
    this.settings = { ...this.settings, ...settings };
    if (this.settings.mode === "off") return this.close();
    if (!this.win || this.win.isDestroyed()) this.create();
    this.place();
    void this.call("configure", { icon: this.icon, corner: this.settings.corner, alwaysVisible: this.settings.mode === "always" });
  }

  create() {
    const win = new BrowserWindow({
      ...SIZE,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    win.setIgnoreMouseEvents(true);
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setContentProtection(true); // fora da captura da live
    this.ready = win.loadFile(this.htmlPath).then(() => win.showInactive());
    // Alguns jogos tomam o "sempre por cima": reafirma de tempos em tempos (sem roubar o foco).
    this.keepOnTop = setInterval(() => {
      if (!win.isDestroyed()) {
        win.setAlwaysOnTop(true, "screen-saver");
        win.moveTop();
      }
    }, 3_000);
    this.keepOnTop.unref?.();
    this.win = win;
  }

  place() {
    if (!this.win || this.win.isDestroyed()) return;
    const { bounds } = screen.getPrimaryDisplay();
    const corner = this.settings.corner;
    const x = corner.endsWith("left") ? bounds.x + MARGIN : bounds.x + bounds.width - SIZE.width - MARGIN;
    const y = corner.startsWith("top") ? bounds.y + MARGIN : bounds.y + bounds.height - SIZE.height - MARGIN;
    this.win.setBounds({ x, y, ...SIZE });
  }

  async call(fn, ...args) {
    if (!this.win || this.win.isDestroyed()) return;
    try {
      await this.ready;
      await this.win.webContents.executeJavaScript(`window.rumoIndicator && window.rumoIndicator.${fn}(...${JSON.stringify(args)})`);
    } catch (error) {
      this.log(`indicador: ${error.message}`);
    }
  }

  /** state: "marking" | "ok" | "error"; ms = tempo até voltar ao normal (0 = fica). */
  show(state, title, detail, ms) {
    if (this.settings.mode === "off") return;
    if (!this.win || this.win.isDestroyed()) this.apply({});
    void this.call("show", state, title, detail, ms);
  }

  close() {
    if (this.keepOnTop) clearInterval(this.keepOnTop);
    this.keepOnTop = null;
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
  }
}
