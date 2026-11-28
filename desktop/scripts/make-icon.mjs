// Gera o .ico do aplicativo a partir do troféu de Maestria do site: versão simplificada até 32 px
// (legível), troféu detalhado nos tamanhos maiores. Roda pelo Electron: electron scripts/make-icon.mjs <saida.ico>
import { app } from "electron";
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iconPng, loadTrophy } from "../src/app-icons.js";
import { icoFromPngs } from "../src/icon.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv.at(-1));

app.whenReady().then(() => {
  const trophy = loadTrophy(join(here, "..", "assets", "maestria.png"));
  const entries = [16, 20, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: iconPng(trophy, size) }));
  writeFileSync(out, icoFromPngs(entries));
  console.log(`Ícone gerado: ${out}`);
  app.exit(0);
});
