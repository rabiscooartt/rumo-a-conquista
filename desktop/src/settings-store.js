// Leitura e escrita do config.json do agente, restrita aos campos que a janela de configurações
// expõe. Todos os outros campos (inclusive segredos como a senha do OBS e o token do site) são
// preservados como estão e nunca são enviados à janela.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseHotkey } from "./hotkey.js";

export const CONFIG_FIELDS = [
  { key: "clipsEnabled", label: "Clips automáticos", type: "boolean", default: true },
  { key: "clipsDir", label: "Pasta dos clips", type: "folder", default: "", help: "Vazio = pasta de gravação do OBS + \"Clips Rumo à Conquista\"" },
  { key: "clipPreSeconds", label: "Segundos antes do evento", type: "integer", min: 0, max: 3600, default: 240 },
  { key: "clipPostSeconds", label: "Segundos depois do evento", type: "integer", min: 0, max: 600, default: 30 },
  { key: "clipMinFreeMb", label: "Espaço livre mínimo (MB)", type: "integer", min: 0, max: 10_000_000, default: 2048 },
  { key: "alertDisplaySeconds", label: "Duração do alerta na tela (s)", type: "integer", min: 3, max: 20, default: 7 },
  { key: "controlPort", label: "Porta local do agente", type: "integer", min: 1024, max: 65535, default: 47821, help: "Mudar exige atualizar a URL do dock e do overlay no OBS" },
];

const configPath = (dataDir) => join(dataDir, "config.json");

function readRaw(dataDir) {
  try {
    return JSON.parse(readFileSync(configPath(dataDir), "utf8"));
  } catch {
    return {};
  }
}

export function readAgentConfig(dataDir) {
  const raw = readRaw(dataDir);
  return Object.fromEntries(CONFIG_FIELDS.map((f) => [f.key, raw[f.key] ?? f.default]));
}

export function validateSettings(input) {
  const problems = [];
  for (const f of CONFIG_FIELDS) {
    const v = input?.agent?.[f.key];
    if (f.type === "integer" && (!Number.isInteger(v) || v < f.min || v > f.max)) problems.push(`${f.label}: inteiro entre ${f.min} e ${f.max}`);
    if (f.type === "boolean" && typeof v !== "boolean") problems.push(`${f.label}: valor inválido`);
    if (f.type === "folder" && typeof v !== "string") problems.push(`${f.label}: valor inválido`);
  }
  const hotkey = String(input?.desktop?.hotkey ?? "").trim();
  if (hotkey && !parseHotkey(hotkey)) problems.push("Atalho inválido: escolha outra tecla (ex.: Pause, F9, Control+Alt+M)");
  return problems;
}

/** Grava só os campos conhecidos que mudaram; retorna true se algo mudou. Escrita atômica. */
export function writeAgentConfig(dataDir, values) {
  const raw = readRaw(dataDir);
  let changed = false;
  for (const f of CONFIG_FIELDS) {
    const next = f.type === "folder" ? String(values[f.key] ?? "").trim() : values[f.key];
    const current = raw[f.key] ?? f.default;
    if (next === current) continue;
    changed = true;
    if (f.type === "folder" && !next) delete raw[f.key];
    else raw[f.key] = next;
  }
  if (!changed) return false;
  const path = configPath(dataDir);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(raw, null, 2));
  renameSync(tmp, path);
  return true;
}
