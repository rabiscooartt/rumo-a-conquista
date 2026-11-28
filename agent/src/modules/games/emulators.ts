export type EmulatorDef = { id: string; name: string; exe: RegExp };

/** Emuladores reconhecidos pelo nome do executável (minúsculas). */
export const EMULATORS: EmulatorDef[] = [
  { id: "retroarch", name: "RetroArch", exe: /^retroarch\.exe$/ },
  { id: "pcsx2", name: "PCSX2", exe: /^pcsx2(-qt|-avx2)?.*\.exe$/ },
  { id: "duckstation", name: "DuckStation", exe: /^duckstation.*\.exe$/ },
  { id: "dolphin", name: "Dolphin", exe: /^dolphin\.exe$/ },
  { id: "rpcs3", name: "RPCS3", exe: /^rpcs3\.exe$/ },
  { id: "ppsspp", name: "PPSSPP", exe: /^ppsspp.*\.exe$/ },
  { id: "cemu", name: "Cemu", exe: /^cemu\.exe$/ },
  { id: "ryujinx", name: "Ryujinx", exe: /^ryujinx\.exe$/ },
  { id: "yuzu", name: "yuzu", exe: /^(yuzu|suyu|sudachi|citron)\.exe$/ },
  { id: "xenia", name: "Xenia", exe: /^xenia(_canary)?\.exe$/ },
  { id: "citra", name: "Citra/Azahar", exe: /^(citra-qt|lime3ds|azahar)\.exe$/ },
  { id: "melonds", name: "melonDS", exe: /^melonds\.exe$/ },
  { id: "mgba", name: "mGBA", exe: /^mgba\.exe$/ },
  { id: "snes9x", name: "Snes9x", exe: /^snes9x.*\.exe$/ },
  { id: "project64", name: "Project64", exe: /^project64\.exe$/ },
  { id: "bizhawk", name: "BizHawk", exe: /^emuhawk\.exe$/ },
  { id: "flycast", name: "Flycast", exe: /^flycast\.exe$/ },
  { id: "mesen", name: "Mesen", exe: /^mesen\.exe$/ },
];

export function findEmulator(exeName: string): EmulatorDef | null {
  const name = exeName.toLowerCase();
  return EMULATORS.find((emulator) => emulator.exe.test(name)) ?? null;
}

const NOISE = /\b(fps|vps|speed|jit|vulkan|opengl|direct3d|d3d1[12]|dx1[12]|software|interpreter|recompiler|paused|pausado)\b|%|\bv?\d+(\.\d+)+\b|\bbuild\b|\bnightly\b|\bdev\b/i;

/**
 * Extrai o nome do conteúdo do título da janela do emulador, descartando o nome do
 * emulador, versão, contadores de FPS e informações de renderização.
 * Retorna null quando não sobra um nome plausível (ex.: emulador no menu).
 */
export function contentFromWindowTitle(title: string | null, emulator: EmulatorDef): string | null {
  if (!title) return null;
  const emulatorName = emulator.name.toLowerCase();
  const parts = title
    .split(/\s+(?:\|\|?|[•·])\s+|\s+[-–—]\s+/)
    .map((part) => part.replace(/\[[^\]]*\]|\([A-Z0-9]{4,}\)/g, "").trim())
    .filter((part) => part.length >= 2)
    .filter((part) => !part.toLowerCase().includes(emulatorName) && !part.toLowerCase().includes(emulator.id))
    .filter((part) => !NOISE.test(part));
  if (!parts.length) return null;
  return parts.sort((a, b) => b.length - a.length)[0];
}
