import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { EVENT_STATUSES, EventValidationError, type EventStatus, type NewEvent } from "../events/eventStore.ts";
import type { AgentEvent, EventAttempt, RecordResult } from "../events/eventStore.ts";
import type { Logger } from "../logger.ts";

export const TOKEN_HEADER = "x-agent-token";
const MAX_BODY_BYTES = 300 * 1024;

/** Token local (aleatório, gerado na primeira execução) exigido nas operações que alteram estado. */
export function loadOrCreateControlToken(path: string) {
  if (existsSync(path)) {
    const token = readFileSync(path, "utf8").trim();
    if (token.length >= 32) return token;
  }
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token, { encoding: "utf8", mode: 0o600 });
  return token;
}

export type ControlApi = {
  health(): Record<string, unknown>;
  status(): Record<string, unknown>;
  listEvents(filter: { status?: EventStatus; type?: string; limit?: number }): AgentEvent[];
  getEvent(id: string): { event: AgentEvent; attempts: EventAttempt[] } | null;
  recordEvent(input: NewEvent): RecordResult;
  retryEvent(id: string): boolean;
  shutdown(reason: string): void;
};

export type RouteRequest = { query: URLSearchParams; body: unknown };
/**
 * body vira JSON; com contentType, body é enviado como texto (ex.: página e script do dock);
 * com raw, a rota assume a resposta (ex.: fluxo Server-Sent Events do overlay).
 */
export type RouteResponse = {
  status?: number;
  body: unknown;
  contentType?: string;
  headers?: Record<string, string>;
  raw?: (req: IncomingMessage, res: ServerResponse) => void;
};
export type RouteHandler = (request: RouteRequest) => RouteResponse | Promise<RouteResponse>;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(json);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Corpo da requisição grande demais");
    chunks.push(chunk as Buffer);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "JSON inválido");
  }
}

/**
 * API HTTP local (somente 127.0.0.1) para estado, diagnóstico e operação do agente.
 * É a base que o CLI usa hoje e que o dock do OBS usará na Fase 4.
 * Proteções: escuta só em loopback, recusa Host diferente de localhost (DNS rebinding)
 * e exige token local nas operações que alteram estado.
 */
export class ControlServer {
  private readonly api: ControlApi;
  private readonly token: string;
  private readonly log: Logger;
  private server: Server | null = null;
  private port: number | null = null;
  private readonly routes = new Map<string, { handler: RouteHandler; requireToken: boolean }>();

  constructor(api: ControlApi, token: string, log: Logger) {
    this.api = api;
    this.token = token;
    this.log = log;
  }

  /**
   * Rota de módulo. POST exige o token local por padrão. Um POST sem token (requireToken: false,
   * ex.: confirmação do overlay) só é aceito da própria origem: outro site aberto no navegador
   * não consegue chamá-lo.
   */
  addRoute(method: "GET" | "POST", path: string, handler: RouteHandler, requireToken?: boolean) {
    const key = `${method} ${path}`;
    if (this.routes.has(key)) throw new Error(`Rota duplicada: ${key}`);
    this.routes.set(key, { handler, requireToken: requireToken ?? method === "POST" });
  }

  listen(port: number, host = "127.0.0.1"): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handle(req, res).catch((error) => {
          const status = error instanceof HttpError ? error.status : error instanceof EventValidationError ? 400 : 500;
          if (status === 500) this.log.error("Erro na API local", { error, url: req.url });
          send(res, status, { error: (error as Error).message });
        });
      });
      server.once("error", (error: NodeJS.ErrnoException) => {
        reject(
          error.code === "EADDRINUSE"
            ? new Error(`Porta de controle ${port} já está em uso por outro programa (ajuste controlPort no config.json)`)
            : error,
        );
      });
      server.listen(port, host, () => {
        this.server = server;
        this.port = (server.address() as AddressInfo).port;
        resolve(this.port);
      });
    });
  }

  private authorized(req: IncomingMessage) {
    const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? ""));
    const expected = Buffer.from(this.token);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const host = String(req.headers.host ?? "").replace(/:\d+$/, "");
    if (host !== "127.0.0.1" && host !== "localhost") throw new HttpError(403, "Host não permitido");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method ?? "GET";
    const requireToken = () => {
      if (!this.authorized(req)) throw new HttpError(401, `Token ausente ou inválido (cabeçalho ${TOKEN_HEADER})`);
    };

    if (method === "GET" && url.pathname === "/health") return send(res, 200, this.api.health());
    if (method === "GET" && url.pathname === "/status") return send(res, 200, this.api.status());

    if (parts[0] === "events") {
      if (method === "GET" && parts.length === 1) {
        const status = url.searchParams.get("status") ?? undefined;
        if (status && !EVENT_STATUSES.includes(status as EventStatus)) throw new HttpError(400, "status inválido");
        const limit = Number(url.searchParams.get("limit") ?? 50);
        return send(res, 200, {
          events: this.api.listEvents({
            status: status as EventStatus | undefined,
            type: url.searchParams.get("type") ?? undefined,
            limit: Number.isFinite(limit) ? limit : 50,
          }),
        });
      }
      if (method === "GET" && parts.length === 2) {
        const found = this.api.getEvent(decodeURIComponent(parts[1]));
        return found ? send(res, 200, found) : send(res, 404, { error: "Evento não encontrado" });
      }
      if (method === "POST" && parts.length === 1) {
        requireToken();
        const body = (await readJson(req)) as NewEvent;
        const result = this.api.recordEvent({ ...body, source: body.source ?? "control-api" });
        return send(res, result.created ? 201 : 200, result);
      }
      if (method === "POST" && parts.length === 3 && parts[2] === "retry") {
        requireToken();
        const ok = this.api.retryEvent(decodeURIComponent(parts[1]));
        return ok ? send(res, 200, { ok }) : send(res, 409, { error: "Só eventos em failed podem ser reenfileirados" });
      }
    }

    const route = this.routes.get(`${method} ${url.pathname}`);
    if (route) {
      if (route.requireToken) requireToken();
      else if (method === "POST") {
        const origin = req.headers.origin;
        const site = req.headers["sec-fetch-site"];
        if ((origin && origin !== `http://${req.headers.host}`) || (site && site !== "same-origin" && site !== "none")) {
          throw new HttpError(403, "Origem não permitida");
        }
      }
      const body = method === "POST" ? await readJson(req) : undefined;
      const result = await route.handler({ query: url.searchParams, body });
      if (result.raw) return result.raw(req, res);
      if (result.contentType) {
        res.writeHead(result.status ?? 200, {
          "content-type": result.contentType,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          ...(result.headers ?? {}),
        });
        res.end(String(result.body));
        return;
      }
      return send(res, result.status ?? 200, result.body);
    }

    if (method === "POST" && url.pathname === "/shutdown") {
      requireToken();
      send(res, 202, { ok: true, message: "Encerrando o agente" });
      setImmediate(() => this.api.shutdown("pedido pela API local"));
      return;
    }

    throw new HttpError(404, "Rota não encontrada");
  }

  address() {
    return this.port;
  }

  close(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
  }
}
