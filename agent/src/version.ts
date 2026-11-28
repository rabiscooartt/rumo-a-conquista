import { readFileSync } from "node:fs";

// A versão do agente vem do agent/package.json: um único lugar para atualizar.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
  version: string;
};

export const AGENT_NAME = "rumo-agent";
export const AGENT_VERSION: string = pkg.version;
export const USER_AGENT = `RumoAConquistaAgent/${AGENT_VERSION}`;
