// Atalho global "Marcar momento" com qualquer tecla (inclusive Pause, que o Electron não aceita).
// Usa o registro de atalhos do próprio Windows (RegisterHotKey) num processo auxiliar do PowerShell:
// funciona com o jogo em tela cheia, não lê o que se digita (só recebe o aviso daquela combinação)
// e encerra sozinho se o aplicativo fechar.
import { spawn } from "node:child_process";

const MODS = { Alt: 0x1, Control: 0x2, Ctrl: 0x2, Shift: 0x4, Super: 0x8 };

/** Nomes de tecla (formato do Electron) → código virtual do Windows. */
export const KEY_CODES = (() => {
  const map = {
    Pause: 0x13, ScrollLock: 0x91, PrintScreen: 0x2c, Insert: 0x2d, Delete: 0x2e, Home: 0x24, End: 0x23,
    PageUp: 0x21, PageDown: 0x22, Up: 0x26, Down: 0x28, Left: 0x25, Right: 0x27, Space: 0x20, Tab: 0x09,
    Escape: 0x1b, Backspace: 0x08, Enter: 0x0d, Capslock: 0x14, Numlock: 0x90,
    numadd: 0x6b, numsub: 0x6d, nummult: 0x6a, numdiv: 0x6f, numdec: 0x6e,
  };
  for (let i = 1; i <= 24; i++) map[`F${i}`] = 0x6f + i;
  for (let i = 0; i <= 9; i++) {
    map[String(i)] = 0x30 + i;
    map[`num${i}`] = 0x60 + i;
  }
  for (let c = 65; c <= 90; c++) map[String.fromCharCode(c)] = c;
  return map;
})();

/** "Control+Alt+F9" → { mods, vk }; null se inválido. Aceita tecla sozinha (ex.: "Pause"). */
export function parseHotkey(text) {
  const parts = String(text ?? "").split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const key = parts.pop();
  const vk = KEY_CODES[key] ?? KEY_CODES[key.toUpperCase()];
  if (vk === undefined) return null;
  let mods = 0;
  for (const m of parts) {
    if (!(m in MODS)) return null;
    mods |= MODS[m];
  }
  return { mods, vk };
}

/**
 * Som curto de confirmação ("plim" em dois tons, ~0,2 s, volume moderado), em WAV PCM 16 bits.
 * Tocado pelo próprio auxiliar no instante do aperto: aparece dentro do jogo, em tela cheia ou não
 * (o Windows costuma segurar as notificações durante jogos em tela cheia).
 */
export function momentSoundWav(rate = 44_100) {
  const tones = [
    [988, 0.07],
    [1319, 0.13],
  ];
  const samples = [];
  for (const [freq, dur] of tones) {
    const n = Math.round(rate * dur);
    for (let i = 0; i < n; i++) {
      const attack = Math.min(1, i / (rate * 0.005));
      const release = Math.min(1, (n - i) / (rate * 0.04));
      samples.push(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * attack * release * 0.32 * 32767));
    }
  }
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

const helperScript = (mods, vk, parentPid, soundPath) => `
$ErrorActionPreference = 'Stop'
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public class RacHotkey : NativeWindow {
  [DllImport("user32.dll")] static extern bool RegisterHotKey(IntPtr h, int id, uint mods, uint vk);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  public event EventHandler Pressed;
  uint mods, vk; bool down; DateTime last = DateTime.MinValue;
  Timer poll = new Timer();
  System.Media.SoundPlayer sound;
  // Som de confirmação tocado aqui mesmo, no instante do aperto (sem esperar o aplicativo).
  public void SetSound(string path) { try { sound = new System.Media.SoundPlayer(path); sound.Load(); } catch { sound = null; } }
  public RacHotkey() { CreateHandle(new CreateParams()); }
  // Dois caminhos para o mesmo aperto (o que chegar primeiro dispara; o outro é ignorado):
  //  1) atalho registrado no Windows (WM_HOTKEY);
  //  2) leitura do estado só desta tecla a cada 25 ms (como os atalhos do OBS) — cobre jogos em
  //     tela cheia exclusiva ou que impeçam o WM_HOTKEY, e funciona mesmo se outro programa
  //     tiver reservado a tecla.
  public bool Register(uint m, uint v) {
    mods = m; vk = v;
    poll.Interval = 25; poll.Tick += (s, e) => Poll(); poll.Start();
    return RegisterHotKey(Handle, 1, m | 0x4000, v);
  }
  static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
  bool ModsDown() {
    if (((mods & 1) != 0) != Down(0x12)) return false;
    if (((mods & 2) != 0) != Down(0x11)) return false;
    if (((mods & 4) != 0) != Down(0x10)) return false;
    if ((mods & 8) != 0 && !(Down(0x5B) || Down(0x5C))) return false;
    return true;
  }
  void Poll() { bool k = Down((int)vk); if (k && !down) { Console.Out.WriteLine("SEEN poll mods=" + ModsDown()); Console.Out.Flush(); if (ModsDown()) Fire(); } down = k; }
  void Fire() {
    if ((DateTime.UtcNow - last).TotalMilliseconds < 400) return;
    last = DateTime.UtcNow;
    if (sound != null) { try { sound.Play(); } catch { } }
    if (Pressed != null) Pressed(this, EventArgs.Empty);
  }
  protected override void WndProc(ref Message m) { if (m.Msg == 0x0312) { Console.Out.WriteLine("SEEN wm"); Console.Out.Flush(); Fire(); } base.WndProc(ref m); }
}
"@
$hk = New-Object RacHotkey
${soundPath ? `$hk.SetSound(${psString(soundPath)})` : "# sem som de confirmação"}
$hk.add_Pressed({ [Console]::Out.WriteLine('HOTKEY'); [Console]::Out.Flush() })
# Se outro programa já reservou a tecla, a leitura direta continua funcionando (só avisa).
if (-not $hk.Register(${mods}, ${vk})) { [Console]::Out.WriteLine('WARN em uso'); [Console]::Out.Flush() }
$t = New-Object System.Windows.Forms.Timer
$t.Interval = 2000
$t.add_Tick({ if (-not (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue)) { [System.Windows.Forms.Application]::Exit() } })
$t.Start()
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
[System.Windows.Forms.Application]::Run()
`;

export class GlobalHotkey {
  constructor(log = () => {}) {
    this.log = log;
    this.child = null;
  }

  /** Registra o atalho. Resolve { ok, error }. Só um atalho por vez. */
  start(accelerator, onPress, options = {}) {
    this.stop();
    const parsed = parseHotkey(accelerator);
    if (!parsed) return Promise.resolve({ ok: false, error: `Tecla não suportada: ${accelerator}` });
    const encoded = Buffer.from(helperScript(parsed.mods, parsed.vk, process.pid, options.soundPath ?? null), "utf16le").toString("base64");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    return new Promise((resolve) => {
      let settled = false;
      const settle = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      let errors = "";
      let warning = null;
      child.stderr.on("data", (c) => (errors += String(c)));
      child.stdout.on("data", (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          if (line === "READY") settle({ ok: true, warning });
          else if (line.startsWith("WARN")) warning = `${accelerator} também está reservada por outro programa; a captura funciona, mas esse programa também recebe a tecla`;
          else if (line === "HOTKEY") onPress();
          else if (line.startsWith("SEEN")) this.log(`atalho: ${line.slice(5)}`);
        }
      });
      child.on("exit", (code) => {
        if (this.child === child) this.child = null;
        settle({ ok: false, error: code === 2 ? `O atalho ${accelerator} já está em uso por outro programa` : `Não foi possível registrar o atalho (${errors.trim().split(/\r?\n/)[0] || `código ${code}`})` });
      });
      setTimeout(() => settle({ ok: false, error: "O registro do atalho demorou demais" }), 20_000).unref?.();
    });
  }

  stop() {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }
}
