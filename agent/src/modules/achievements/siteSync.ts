import type { ManagedConnection } from "../../connections/managedConnection.ts";
import type { AgentEvent } from "../../events/eventStore.ts";
import { DeferEventError, PermanentEventError, type HandlerContext } from "../../events/processor.ts";
import { USER_AGENT } from "../../version.ts";
import type { UnlockPayload } from "./watcher.ts";

export const SYNC_PATH = "/api/agent/achievements";

export type SyncOptions = {
  siteUrl: string;
  token: () => string;
  site: Pick<ManagedConnection, "isConnected"> | null;
  slugForKey: (sourceKey: string) => string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  offlineDeferMs?: number;
  notConfiguredDeferMs?: number;
};

export type SyncOutcome = {
  result: "unlocked" | "already_completed" | "skipped_test";
  achievement?: unknown;
  earnedAt?: string | null;
  httpStatus?: number;
  syncedAt: string;
};

/**
 * Handler de "achievement.unlocked": envia ao site e só conclui com a confirmação do servidor.
 *  - 200 unlocked / already_completed → concluído (idempotente: reenviar nunca duplica);
 *  - 400/409/422 (inválido, jogo errado, sem vínculo, ambíguo) → failed com o diagnóstico do site;
 *    depois de corrigir o vínculo no site: `npm run agent -- retry <id>`;
 *  - 401/503 de configuração → adiado sem gastar tentativa;
 *  - rede, 5xx, 429 → nova tentativa com backoff.
 */
export function createSiteSyncHandler(options: SyncOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  return async (event: AgentEvent, ctx: HandlerContext): Promise<SyncOutcome> => {
    const payload = event.payload as Partial<UnlockPayload>;
    if (event.isTest) {
      ctx.log.info("Evento de teste: não é enviado ao site", { id: event.id });
      return { result: "skipped_test", syncedAt: new Date().toISOString() };
    }
    if (!payload?.externalId || !payload.sourceKey || (payload.provider !== "steam" && payload.provider !== "site" && payload.provider !== "custom")) {
      throw new PermanentEventError("Payload de conquista incompleto");
    }
    // O vínculo jogo ↔ catálogo é resolvido no envio: mapear o jogo depois e dar retry funciona.
    const gameSlug = options.slugForKey(payload.sourceKey) ?? payload.gameSlug ?? null;
    if (!gameSlug) {
      throw new PermanentEventError(
        `Jogo da fonte ${payload.sourceKey} não está associado ao catálogo do site. Associe com "games map ${payload.sourceKey} <slug>" e depois "retry ${event.id}".`,
      );
    }
    const token = options.token();
    if (!token) throw new DeferEventError("Token de sincronização não configurado (siteAgentToken)", options.notConfiguredDeferMs ?? 300_000);
    if (options.site && !options.site.isConnected()) {
      throw new DeferEventError("Site indisponível no momento", options.offlineDeferMs ?? 60_000);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${options.siteUrl}${SYNC_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "user-agent": USER_AGENT },
        body: JSON.stringify({
          eventId: event.id,
          provider: payload.provider,
          gameSlug,
          externalId: payload.externalId,
          name: payload.name ?? null,
          unlockedAt: payload.unlockedAt ?? null,
          timestampKind: payload.timestampKind,
          detectedLive: payload.detectedLive === true,
        }),
        signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(options.timeoutMs ?? 15_000)]),
      });
    } catch (error) {
      throw new Error(`Falha de rede ao enviar ao site: ${(error as Error).message}`);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Resposta sem JSON (ex.: página de erro da hospedagem).
    }
    const result = String(body.result ?? "");
    const message = String(body.error ?? `HTTP ${response.status}`);

    if (response.ok && (result === "unlocked" || result === "already_completed")) {
      ctx.log.info(result === "unlocked" ? "Conquista registrada no site" : "Conquista já estava concluída no site", {
        id: event.id,
        gameSlug,
        externalId: payload.externalId,
      });
      return { result, achievement: body.achievement, earnedAt: (body.earnedAt as string | null) ?? null, httpStatus: response.status, syncedAt: new Date().toISOString() };
    }
    if (response.status === 401 || result === "not_configured") {
      throw new DeferEventError(`Site recusou a autenticação do agente: ${message}`, options.notConfiguredDeferMs ?? 300_000);
    }
    if (response.status === 404 && !result) {
      throw new DeferEventError("Endpoint de sincronização ainda não publicado no site", options.notConfiguredDeferMs ?? 300_000);
    }
    if ([400, 409, 413, 422].includes(response.status)) {
      throw new PermanentEventError(`Site recusou (${result || response.status}): ${message}`);
    }
    throw new Error(`Site indisponível (${response.status}${result ? ` ${result}` : ""}): ${message}`);
  };
}
