// Monta o aplicativo instalável:
//   dist/stage/                      ← runtime do Electron (renomeado para "Rumo a Conquista.exe")
//   dist/stage/resources/app/        ← casca de desktop (desktop/src)
//   dist/stage/resources/agent/      ← agente atual, sem mudanças (agent/src)
//   dist/stage/icon.ico              ← ícone dos atalhos (troféu de Maestria do site)
// e, se o Inno Setup estiver instalado, gera dist/RumoAConquista-Setup-<versão>.exe.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(desktop, "..");
const dist = join(desktop, "dist");
const stage = join(dist, "stage");
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const agentPkg = JSON.parse(readFileSync(join(root, "agent", "package.json"), "utf8"));
const EXE = "Rumo a Conquista.exe";

const electronDist = join(desktop, "node_modules", "electron", "dist");
if (!existsSync(join(electronDist, "electron.exe"))) throw new Error("Electron não encontrado: rode npm install em desktop/");

rmSync(dist, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

cpSync(electronDist, stage, { recursive: true });
renameSync(join(stage, "electron.exe"), join(stage, EXE));
rmSync(join(stage, "resources", "default_app.asar"), { force: true });

const app = join(stage, "resources", "app");
cpSync(join(desktop, "src"), join(app, "src"), { recursive: true });
cpSync(join(desktop, "assets"), join(app, "assets"), { recursive: true });
writeFileSync(
  join(app, "package.json"),
  JSON.stringify({ name: pkg.name, productName: "Rumo à Conquista", version: pkg.version, type: "module", main: "src/main.js" }, null, 2),
);

const agent = join(stage, "resources", "agent");
cpSync(join(root, "agent", "src"), join(agent, "src"), { recursive: true });
writeFileSync(join(agent, "package.json"), JSON.stringify(agentPkg, null, 2));

// Ícone dos atalhos e do instalador: troféu de Maestria do site, gerado pelo Electron.
execFileSync(join(electronDist, "electron.exe"), [join(desktop, "scripts", "make-icon.mjs"), join(stage, "icon.ico")], { stdio: "inherit" });
console.log(`Estrutura pronta em ${stage} (app ${pkg.version}, agente ${agentPkg.version})`);

const iscc = [
  join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
  "C:/Program Files (x86)/Inno Setup 6/ISCC.exe",
  "C:/Program Files/Inno Setup 6/ISCC.exe",
].find((p) => existsSync(p));
if (!iscc) {
  console.log("Inno Setup não encontrado: instalador não gerado (a pasta stage pode ser usada diretamente).");
} else {
  execFileSync(iscc, [`/DAppVersion=${pkg.version}`, `/DStageDir=${stage}`, `/DOutDir=${dist}`, join(desktop, "installer", "RumoAConquista.iss")], { stdio: "inherit" });
}
