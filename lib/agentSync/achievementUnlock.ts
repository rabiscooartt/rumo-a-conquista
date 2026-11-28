// Sincronização de conquistas desbloqueadas enviadas pelo agente Windows.
//
// Sem dependência do Next nem do Supabase: a rota injeta o armazenamento real e os testes, um
// simulado. O servidor não confia no agente: valida formato, jogo, conquista e vínculo; é
// idempotente (uma conquista já concluída nunca é regravada) e nunca cria conquistas nem vínculos.
import { createHash, timingSafeEqual } from "node:crypto";

export const AGENT_TOKEN_HEADER = "authorization";
const MAX_BODY_BYTES = 16 * 1024;
const MIN_TOKEN_LENGTH = 32;
const SITE_TIME_ZONE = "America/Sao_Paulo";

/**
 * Provedores aceitos e como cada um aponta para a conquista canônica do site:
 *  - "steam": achievements.source = 'steam' e achievements.external_id = apiname da Steam;
 *  - "site":  identificador canônico do próprio site (legacy_id ou id), usado pelo operador;
 *  - "custom": conquista CUSTOM (is_custom) do jogo cujo título normalizado é igual ao informado.
 *    Nunca cria a conquista: se não existir exatamente uma, responde unmatched/ambiguous.
 */
export const AGENT_PROVIDERS = ["steam", "site", "custom"] as const;
export type AgentProvider = (typeof AGENT_PROVIDERS)[number];

export type UnlockRequest = {
  eventId: string;
  provider: AgentProvider;
  gameSlug: string;
  externalId: string;
  name: string | null;
  /** Momento do desbloqueio. Com timestampKind "detected", é o momento em que o agente percebeu. */
  unlockedAt: string | null;
  timestampKind: "source" | "detected";
  detectedLive: boolean;
};

export type AchievementRow = { id: string; legacy_id: string; title: string; game_slug: string };
export type ProgressRow = { status: string; earned_at: string | null };

/** Operações mínimas sobre o modelo existente (achievements, achievement_progress, games). */
export interface AchievementSyncStore {
  gameExists(slug: string): Promise<boolean>;
  findBySiteId(slug: string, id: string): Promise<AchievementRow[]>;
  findSiteIdElsewhere(id: string): Promise<AchievementRow[]>;
  findByExternal(slug: string, source: string, externalId: string): Promise<AchievementRow[]>;
  findExternalElsewhere(source: string, externalId: string): Promise<AchievementRow[]>;
  /** Conquistas CUSTOM do jogo (para casar pelo título). */
  findCustom(slug: string): Promise<AchievementRow[]>;
  getProgress(achievementId: string): Promise<ProgressRow | null>;
  /** Marca como concluída só se ainda não estiver; retorna false se outra gravação venceu a corrida. */
  completeProgress(achievementId: string, earnedAt: string | null, hadRow: boolean): Promise<boolean>;
}

export type SyncDeps = {
  /** Armazenamento, ou fábrica criada só depois da autenticação (evita tocar no banco sem token). */
  store: AchievementSyncStore | (() => AchievementSyncStore);
  /** Token esperado (variável AGENT_SYNC_TOKEN do servidor). */
  expectedToken: string | undefined;
  invalidate?: () => void;
  now?: () => number;
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type SyncResult =
  | "unlocked"
  | "already_completed"
  | "invalid"
  | "unauthorized"
  | "not_configured"
  | "unknown_game"
  | "unmatched"
  | "game_mismatch"
  | "ambiguous"
  | "temporarily_unavailable";

function json(status: number, result: SyncResult, body: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: result === "unlocked" || result === "already_completed", result, ...body }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function tokensMatch(given: string, expected: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;
const EXTERNAL_ID = /^[\x21-\x7E -￿][^\u0000-\u001F]{0,199}$/;

/** Valida o corpo; nunca confia em tipos ou datas enviados pelo agente. */
export function parseUnlockRequest(raw: unknown, now: number): { ok: true; value: UnlockRequest } | { ok: false; problems: string[] } {
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!body) return { ok: false, problems: ["corpo deve ser um objeto JSON"] };
  const problems: string[] = [];
  const str = (key: string) => (typeof body[key] === "string" ? (body[key] as string).trim() : "");

  const eventId = str("eventId");
  if (!UUID.test(eventId)) problems.push("eventId deve ser um UUID");
  const provider = str("provider") as AgentProvider;
  if (!AGENT_PROVIDERS.includes(provider)) problems.push(`provider deve ser um de: ${AGENT_PROVIDERS.join(", ")}`);
  const gameSlug = str("gameSlug");
  if (!SLUG.test(gameSlug)) problems.push("gameSlug inválido");
  const externalId = str("externalId");
  if (!EXTERNAL_ID.test(externalId)) problems.push("externalId inválido (1 a 200 caracteres visíveis)");
  const name = str("name").slice(0, 300) || null;

  const timestampKind = str("timestampKind");
  if (timestampKind !== "source" && timestampKind !== "detected") problems.push('timestampKind deve ser "source" ou "detected"');
  const detectedLive = body.detectedLive === true;

  let unlockedAt: string | null = null;
  if (body.unlockedAt !== null && body.unlockedAt !== undefined) {
    const parsed = Date.parse(str("unlockedAt"));
    if (!Number.isFinite(parsed)) problems.push("unlockedAt deve ser uma data ISO");
    else if (parsed > now + 5 * 60_000) problems.push("unlockedAt no futuro");
    else if (parsed < Date.UTC(2003, 0, 1)) problems.push("unlockedAt anterior a 2003");
    else unlockedAt = new Date(parsed).toISOString();
  }
  if (timestampKind === "source" && !unlockedAt) problems.push('timestampKind "source" exige unlockedAt');

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: { eventId, provider, gameSlug, externalId, name, unlockedAt, timestampKind: timestampKind as UnlockRequest["timestampKind"], detectedLive },
  };
}

/** Data (AAAA-MM-DD) no fuso do canal, que é como o site guarda earned_at. */
export function siteDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * Data gravada em earned_at. Só usa datas confiáveis: a da fonte, ou a da detecção quando o
 * agente percebeu o desbloqueio ao vivo (durante a sessão). Uma detecção tardia, sem data da
 * fonte, não inventa data: a conquista fica concluída sem data.
 */
export function earnedDateFor(request: UnlockRequest) {
  if (!request.unlockedAt) return null;
  if (request.timestampKind === "source" || request.detectedLive) return siteDate(request.unlockedAt);
  return null;
}

export function normalizeAchievementTitle(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function resolveAchievement(store: AchievementSyncStore, request: UnlockRequest) {
  if (request.provider === "custom") {
    const target = normalizeAchievementTitle(request.externalId);
    const rows = (await store.findCustom(request.gameSlug)).filter((row) => normalizeAchievementTitle(row.title) === target);
    return { rows, elsewhere: [] as AchievementRow[] };
  }
  const rows =
    request.provider === "site"
      ? await store.findBySiteId(request.gameSlug, request.externalId)
      : await store.findByExternal(request.gameSlug, request.provider, request.externalId);
  if (rows.length) return { rows, elsewhere: [] as AchievementRow[] };
  const elsewhere =
    request.provider === "site"
      ? await store.findSiteIdElsewhere(request.externalId)
      : await store.findExternalElsewhere(request.provider, request.externalId);
  return { rows, elsewhere: elsewhere.filter((row) => row.game_slug !== request.gameSlug) };
}

export async function handleAgentAchievementUnlock(request: Request, deps: SyncDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => undefined);

  if (!deps.expectedToken || deps.expectedToken.length < MIN_TOKEN_LENGTH) {
    return json(503, "not_configured", { error: "Sincronização do agente não configurada no servidor (AGENT_SYNC_TOKEN)." });
  }
  const header = request.headers.get(AGENT_TOKEN_HEADER) ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !tokensMatch(token, deps.expectedToken)) {
    return json(401, "unauthorized", { error: "Token do agente ausente ou inválido." });
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return json(413, "invalid", { error: "Corpo grande demais." });
  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json(413, "invalid", { error: "Corpo grande demais." });
    raw = JSON.parse(text);
  } catch {
    return json(400, "invalid", { error: "JSON inválido." });
  }
  const parsed = parseUnlockRequest(raw, now());
  if (!parsed.ok) return json(400, "invalid", { error: "Dados inválidos.", problems: parsed.problems });
  const req = parsed.value;

  try {
    const store = typeof deps.store === "function" ? deps.store() : deps.store;
    if (!(await store.gameExists(req.gameSlug))) {
      return json(422, "unknown_game", { error: `O jogo "${req.gameSlug}" não existe no site.` });
    }
    const { rows, elsewhere } = await resolveAchievement(store, req);
    if (rows.length > 1) {
      log("Vínculo ambíguo", { gameSlug: req.gameSlug, provider: req.provider, externalId: req.externalId, rows: rows.length });
      return json(409, "ambiguous", {
        error: `Mais de uma conquista de "${req.gameSlug}" está vinculada a ${req.provider}:${req.externalId}. Corrija o vínculo no site.`,
      });
    }
    if (!rows.length) {
      if (elsewhere.length) {
        return json(409, "game_mismatch", {
          error: `${req.provider}:${req.externalId} pertence a outro jogo (${[...new Set(elsewhere.map((row) => row.game_slug))].join(", ")}), não a "${req.gameSlug}".`,
        });
      }
      return json(422, "unmatched", {
        error:
          req.provider === "custom"
            ? `O jogo "${req.gameSlug}" não tem conquista CUSTOM chamada "${req.externalId}". Crie-a no site e depois reenvie.`
            : req.provider === "site"
            ? `Nenhuma conquista de "${req.gameSlug}" tem o identificador "${req.externalId}".`
            : `Nenhuma conquista de "${req.gameSlug}" está vinculada a ${req.provider}:${req.externalId}. Vincule-a no site (origem e identificador externo).`,
        externalId: req.externalId,
        name: req.name,
      });
    }

    const achievement = rows[0];
    const summary = { id: achievement.legacy_id || achievement.id, title: achievement.title, gameSlug: achievement.game_slug };
    const progress = await store.getProgress(achievement.id);
    if (progress?.status === "completed") {
      return json(200, "already_completed", { achievement: summary, earnedAt: progress.earned_at, eventId: req.eventId });
    }

    const earnedAt = progress?.earned_at ?? earnedDateFor(req);
    const won = await store.completeProgress(achievement.id, earnedAt, Boolean(progress));
    if (!won) {
      const current = await store.getProgress(achievement.id);
      if (current?.status === "completed") {
        return json(200, "already_completed", { achievement: summary, earnedAt: current.earned_at, eventId: req.eventId });
      }
      return json(503, "temporarily_unavailable", { error: "Gravação não confirmada; tente novamente." });
    }
    deps.invalidate?.();
    log("Conquista desbloqueada pelo agente", { ...summary, provider: req.provider, externalId: req.externalId, eventId: req.eventId });
    return json(200, "unlocked", { achievement: summary, earnedAt, eventId: req.eventId });
  } catch (error) {
    log("Falha ao sincronizar conquista do agente", { error: error instanceof Error ? error.message : String(error) });
    return json(503, "temporarily_unavailable", { error: "Banco de dados indisponível no momento; tente novamente." });
  }
}
