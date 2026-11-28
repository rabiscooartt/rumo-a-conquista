import { createHash, randomUUID } from "node:crypto";
import type { ConnectionDriver, ConnectionHandle } from "./managedConnection.ts";

/*
 * Cliente mínimo do protocolo obs-websocket v5 (embutido no OBS 28+), usando o
 * WebSocket nativo do Node — sem dependências.
 *
 * Fase 1: conecta, autentica, identifica a versão do OBS e expõe request() para os
 * módulos futuros. Nenhuma cena ou fonte é alterada aqui. Restrição permanente: a
 * webcam (dimensões, posição, escala, crop, enquadramento, imagem) nunca é tocada.
 */
export const OBS_RPC_VERSION = 1;
const OP = { Hello: 0, Identify: 1, Identified: 2, Request: 6, RequestResponse: 7 } as const;

export type ObsSocket = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (event: unknown) => void): void;
};

export type ObsSocketFactory = (url: string, protocol: string) => ObsSocket;

export type ObsDriverOptions = {
  url: string;
  password: string;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
  socketFactory?: ObsSocketFactory;
};

export class ObsRequestError extends Error {
  readonly code: number | null;
  constructor(message: string, code: number | null) {
    super(message);
    this.name = "ObsRequestError";
    this.code = code;
  }
}

/** Autenticação do obs-websocket v5: base64(sha256(base64(sha256(senha + salt)) + challenge)). */
export function obsAuthString(password: string, salt: string, challenge: string) {
  const secret = createHash("sha256").update(password + salt).digest("base64");
  return createHash("sha256").update(secret + challenge).digest("base64");
}

const CLOSE_REASONS: Record<number, string> = {
  1006: "OBS inacessível (fechado ou servidor WebSocket desativado em Ferramentas > Configurações do Servidor WebSocket)",
  4009: "senha do OBS incorreta",
  4010: "versão RPC do obs-websocket incompatível",
  4011: "sessão removida pelo OBS",
};

type PendingRequest = {
  resolve: (data: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const defaultFactory: ObsSocketFactory = (url, protocol) => new WebSocket(url, protocol) as unknown as ObsSocket;

export class ObsDriver implements ConnectionDriver {
  private readonly options: Required<ObsDriverOptions>;
  private socket: ObsSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private info: { obsVersion: string | null; obsWebSocketVersion: string | null; rpcVersion: number | null } = {
    obsVersion: null,
    obsWebSocketVersion: null,
    rpcVersion: null,
  };

  constructor(options: ObsDriverOptions) {
    this.options = {
      handshakeTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
      socketFactory: defaultFactory,
      ...options,
    };
  }

  open(handle: ConnectionHandle, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let identified = false;
      let settled = false;
      const socket = this.options.socketFactory(this.options.url, "obswebsocket.json");
      this.socket = socket;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(() => {
        finish(new Error(`OBS não concluiu a identificação em ${this.options.handshakeTimeoutMs} ms`));
        socket.close();
      }, this.options.handshakeTimeoutMs);
      signal.addEventListener("abort", () => {
        finish(new Error("Conexão cancelada"));
        socket.close();
      });

      socket.addEventListener("message", (event) => {
        let message: { op?: number; d?: Record<string, unknown> };
        try {
          message = JSON.parse(String((event as { data: unknown }).data));
        } catch {
          return;
        }
        const d = message.d ?? {};
        if (message.op === OP.Hello) {
          const auth = d.authentication as { challenge?: string; salt?: string } | undefined;
          const identify: Record<string, unknown> = { rpcVersion: OBS_RPC_VERSION, eventSubscriptions: 0 };
          if (auth?.challenge && auth.salt) {
            if (!this.options.password) {
              finish(new Error("OBS exige senha e nenhuma foi configurada (obsPassword ou RUMO_AGENT_OBS_PASSWORD)"));
              socket.close();
              return;
            }
            identify.authentication = obsAuthString(this.options.password, auth.salt, auth.challenge);
          }
          this.info.obsWebSocketVersion = typeof d.obsWebSocketVersion === "string" ? d.obsWebSocketVersion : null;
          socket.send(JSON.stringify({ op: OP.Identify, d: identify }));
        } else if (message.op === OP.Identified) {
          identified = true;
          this.info.rpcVersion = Number(d.negotiatedRpcVersion ?? OBS_RPC_VERSION);
          this.request("GetVersion")
            .then((version) => {
              this.info.obsVersion = typeof version.obsVersion === "string" ? version.obsVersion : null;
            })
            .catch(() => undefined)
            .finally(() => finish());
        } else if (message.op === OP.RequestResponse) {
          const id = String(d.requestId ?? "");
          const request = this.pending.get(id);
          if (!request) return;
          this.pending.delete(id);
          clearTimeout(request.timer);
          const status = (d.requestStatus ?? {}) as { result?: boolean; code?: number; comment?: string };
          if (status.result) request.resolve((d.responseData as Record<string, unknown>) ?? {});
          else request.reject(new ObsRequestError(status.comment || `Requisição recusada pelo OBS`, status.code ?? null));
        }
      });

      socket.addEventListener("close", (event) => {
        const code = Number((event as { code?: number }).code ?? 0);
        const reason = CLOSE_REASONS[code] ?? `conexão encerrada (código ${code || "desconhecido"})`;
        const error = new Error(`OBS: ${reason}`);
        this.failPending(error);
        if (this.socket === socket) this.socket = null;
        if (identified && settled) handle.lost(error);
        else finish(error);
      });

      socket.addEventListener("error", () => {
        // O evento "close" sempre vem em seguida e carrega o motivo.
      });
    });
  }

  /** Envia uma requisição ao OBS. Usada pelos módulos das próximas fases. */
  request(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return Promise.reject(new Error("OBS não está conectado"));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`OBS não respondeu ${requestType} em ${this.options.requestTimeoutMs} ms`));
      }, this.options.requestTimeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      socket.send(JSON.stringify({ op: OP.Request, d: { requestType, requestId, ...(requestData ? { requestData } : {}) } }));
    });
  }

  private failPending(error: Error) {
    for (const [id, request] of this.pending) {
      clearTimeout(request.timer);
      request.reject(error);
      this.pending.delete(id);
    }
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.failPending(new Error("Conexão com o OBS fechada"));
    if (socket && socket.readyState <= 1) socket.close(1000, "agent closing");
  }

  detail() {
    return { url: this.options.url, ...this.info };
  }
}
