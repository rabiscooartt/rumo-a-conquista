// Auditoria dos salvamentos em massa (Etapa 5.1): toda gravação administrativa que pode trocar
// referências de imagem de um jogo passa por aqui.
//   1. lê o estado anterior do escopo (jogo, conquistas, progresso);
//   2. calcula o estado desejado aplicando o plano da rota ao estado anterior;
//   3. compara e separa só as referências de imagem do Storage que mudam (local exato);
//   4. registra a intenção ANTES da gravação (storage_lifecycle_begin_reference_sync);
//   5. a rota grava como sempre gravou;
//   6/7. o banco relê cada local e só confirma quando todos mostram o valor novo
//        (storage_lifecycle_finish_reference_sync). Sem prova, a operação fica pendente.
// Nada aqui grava em tabelas do site nem no Storage; campos que não são imagem não são tocados.
import { createHash } from "node:crypto";
import { objectKeyFromReference } from "./references.ts";
import type { LifecycleRpc } from "./tracked.ts";

export const REFERENCE_SYNC_CHUNK = 150;
const GAME_JSON_COLUMNS = ["final_badge", "emblem", "trophies", "review"] as const;
const GAME_TEXT_COLUMNS = ["image", "card_image"] as const;
type GameJsonColumn = (typeof GAME_JSON_COLUMNS)[number];
type GameTextColumn = (typeof GAME_TEXT_COLUMNS)[number];

export type ScopeGame = Partial<Record<GameTextColumn, string | null> & Record<GameJsonColumn, unknown>>;
export type ScopeAchievement = { id: string; legacy_id: string; image: string | null; official_image: string | null };
export type ScopeProgress = { achievement_id: string; owner_key: string; image_override: string | null };
export type GameScopeState = {
  slug: string;
  game: ScopeGame | null;
  achievements: ScopeAchievement[];
  progress: ScopeProgress[];
};

/** O que a rota vai gravar. Só as chaves presentes mudam; o resto do estado anterior se mantém. */
export type GameWritePlan = {
  /** Colunas do jogo gravadas (upsert/update). Ausente = a linha do jogo não é tocada. */
  game?: ScopeGame;
  /** Conquistas apagadas pelo id (o progresso delas, de todos os donos, também sai). */
  deleteAchievementIds?: string[];
  /** Conquistas gravadas por (game_slug, legacy_id); só as colunas presentes mudam. */
  upsertAchievements?: Array<{ legacy_id: string; image?: string | null; official_image?: string | null }>;
  /** Conquistas alteradas pelo id (update), só as colunas presentes. */
  updateAchievementsById?: Array<{ id: string; image?: string | null; official_image?: string | null }>;
  /** Progresso gravado por (dono, legacy_id da conquista); só image_override presente muda. */
  upsertProgress?: Array<{ legacy_id: string; owner_key: string; image_override?: string | null }>;
  /** Progresso apagado por dono e id da conquista. */
  deleteProgress?: Array<{ achievement_id: string; owner_key?: string }>;
};

export type ReferenceSyncItem = {
  table: "games" | "achievements" | "achievement_progress";
  column: string;
  row: Record<string, string>;
  path: string[] | null;
  old: string | null;
  new: string | null;
};

type QueryClient = {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): PromiseLike<{ data: unknown; error: { message: string } | null }> & {
        maybeSingle(): PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
      in(column: string, values: string[]): PromiseLike<{ data: unknown; error: { message: string } | null }>;
    };
  };
};

/** Lê o estado de imagens do escopo (jogo + conquistas + progresso de todos os donos). */
export async function readGameScope(client: unknown, slug: string): Promise<GameScopeState> {
  const db = client as QueryClient;
  const game = await db.from("games").select("image, card_image, final_badge, emblem, trophies, review").eq("slug", slug).maybeSingle();
  if (game.error) throw new Error(`Leitura do jogo para auditoria falhou: ${game.error.message}`);
  const achievements = await db.from("achievements").select("id, legacy_id, image, official_image").eq("game_slug", slug);
  if (achievements.error) throw new Error(`Leitura das conquistas para auditoria falhou: ${achievements.error.message}`);
  const rows = (achievements.data ?? []) as ScopeAchievement[];
  let progress: ScopeProgress[] = [];
  if (rows.length > 0) {
    const ids = rows.map((row) => String(row.id));
    for (let index = 0; index < ids.length; index += 200) {
      const part = await db.from("achievement_progress").select("achievement_id, owner_key, image_override").in("achievement_id", ids.slice(index, index + 200));
      if (part.error) throw new Error(`Leitura do progresso para auditoria falhou: ${part.error.message}`);
      progress = progress.concat((part.data ?? []) as ScopeProgress[]);
    }
  }
  return {
    slug,
    game: (game.data as ScopeGame | null) ?? null,
    achievements: rows.map((row) => ({ ...row, id: String(row.id) })),
    progress: progress.map((row) => ({ ...row, achievement_id: String(row.achievement_id) })),
  };
}

/** Colunas de um registro de jogo que podem guardar imagem, exatamente como serão gravadas. */
export function pickGameImageColumns(game: Record<string, unknown>): ScopeGame {
  const picked: Record<string, unknown> = {};
  for (const column of [...GAME_TEXT_COLUMNS, ...GAME_JSON_COLUMNS]) if (column in game) picked[column] = game[column];
  return picked as ScopeGame;
}

/** Aplica o plano ao estado anterior, sem efeito colateral. */
export function applyWritePlan(before: GameScopeState, plan: GameWritePlan): GameScopeState {
  let game = before.game ? { ...before.game } : null;
  if (plan.game) game = { ...(game ?? {}), ...plan.game };

  const deleted = new Set(plan.deleteAchievementIds ?? []);
  let achievements = before.achievements.filter((row) => !deleted.has(row.id)).map((row) => ({ ...row }));
  let progress = before.progress.filter((row) => !deleted.has(row.achievement_id)).map((row) => ({ ...row }));
  for (const removal of plan.deleteProgress ?? []) {
    progress = progress.filter((row) => !(row.achievement_id === removal.achievement_id && (removal.owner_key === undefined || row.owner_key === removal.owner_key)));
  }
  for (const update of plan.updateAchievementsById ?? []) {
    const row = achievements.find((item) => item.id === update.id);
    if (!row) continue;
    if ("image" in update) row.image = update.image ?? null;
    if ("official_image" in update) row.official_image = update.official_image ?? null;
  }
  let synthetic = 0;
  for (const upsert of plan.upsertAchievements ?? []) {
    let row = achievements.find((item) => item.legacy_id === upsert.legacy_id);
    if (!row) {
      row = { id: `novo:${++synthetic}:${upsert.legacy_id}`, legacy_id: upsert.legacy_id, image: null, official_image: null };
      achievements = [...achievements, row];
    }
    if ("image" in upsert) row.image = upsert.image ?? null;
    if ("official_image" in upsert) row.official_image = upsert.official_image ?? null;
  }
  for (const upsert of plan.upsertProgress ?? []) {
    const achievement = achievements.find((item) => item.legacy_id === upsert.legacy_id);
    if (!achievement) throw new Error(`Progresso sem conquista no plano (${upsert.legacy_id}).`);
    let row = progress.find((item) => item.achievement_id === achievement.id && item.owner_key === upsert.owner_key);
    if (!row) {
      row = { achievement_id: achievement.id, owner_key: upsert.owner_key, image_override: null };
      progress = [...progress, row];
    }
    if ("image_override" in upsert) row.image_override = upsert.image_override ?? null;
  }
  return { slug: before.slug, game, achievements, progress };
}

const blank = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
/** Texto que é (ou tenta ser) referência ao Storage. Inválidas entram para o banco recusar. */
export function isStorageLike(value: string | null) {
  return value !== null && (objectKeyFromReference(value) !== null || /\/storage\/v1\//.test(value));
}

/** Folhas de texto de um JSON, com o caminho exato (índices de lista como texto). */
function jsonLeaves(value: unknown, path: string[] = [], out = new Map<string, { path: string[]; value: string }>(), depth = 0) {
  if (depth > 20) return out;
  if (typeof value === "string") out.set(JSON.stringify(path), { path, value });
  else if (Array.isArray(value)) value.forEach((child, index) => jsonLeaves(child, [...path, String(index)], out, depth + 1));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) jsonLeaves(child, [...path, key], out, depth + 1);
  return out;
}

/** Locais por estado: "tabela|coluna|linha|caminho" → valor (só referências de imagem). */
function trackedLocations(state: GameScopeState) {
  const locations = new Map<string, Omit<ReferenceSyncItem, "old" | "new"> & { value: string | null }>();
  const add = (item: Omit<ReferenceSyncItem, "old" | "new">, value: string | null) =>
    locations.set(JSON.stringify([item.table, item.column, item.row, item.path]), { ...item, value });
  if (state.game) {
    for (const column of GAME_TEXT_COLUMNS) add({ table: "games", column, row: { slug: state.slug }, path: null }, blank(state.game[column]));
    for (const column of GAME_JSON_COLUMNS) {
      for (const leaf of jsonLeaves(state.game[column]).values()) {
        if (leaf.path.length === 0) continue;
        add({ table: "games", column, row: { slug: state.slug }, path: leaf.path }, blank(leaf.value));
      }
    }
  }
  const legacyById = new Map(state.achievements.map((row) => [row.id, row.legacy_id]));
  for (const row of state.achievements) {
    for (const column of ["image", "official_image"] as const) {
      add({ table: "achievements", column, row: { game_slug: state.slug, legacy_id: row.legacy_id }, path: null }, blank(row[column]));
    }
  }
  for (const row of state.progress) {
    const legacyId = legacyById.get(row.achievement_id);
    if (!legacyId) continue;
    add({ table: "achievement_progress", column: "image_override", row: { owner_key: row.owner_key, game_slug: state.slug, legacy_id: legacyId }, path: null }, blank(row.image_override));
  }
  return locations;
}

/** Só referências de imagem do Storage que mudam, em ordem estável. */
export function diffGameScope(before: GameScopeState, desired: GameScopeState): ReferenceSyncItem[] {
  const oldLocations = trackedLocations(before);
  const newLocations = trackedLocations(desired);
  const items: ReferenceSyncItem[] = [];
  for (const key of new Set([...oldLocations.keys(), ...newLocations.keys()])) {
    const base = oldLocations.get(key) ?? newLocations.get(key)!;
    const oldValue = oldLocations.get(key)?.value ?? null;
    const newValue = newLocations.get(key)?.value ?? null;
    if (oldValue === newValue) continue;
    if (!isStorageLike(oldValue) && !isStorageLike(newValue)) continue;
    items.push({ table: base.table, column: base.column, row: base.row, path: base.path, old: oldValue, new: newValue });
  }
  return items.sort((a, b) => JSON.stringify([a.table, a.column, a.row, a.path]).localeCompare(JSON.stringify([b.table, b.column, b.row, b.path])));
}

/** Chave-base do pedido: SHA-256 do estado DESEJADO das referências (não da diferença). */
export function referenceSyncBaseKey(desired: GameScopeState) {
  const tracked = [...trackedLocations(desired).entries()]
    .filter(([, location]) => location.value !== null && isStorageLike(location.value))
    .map(([key, location]) => [key, location.value])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return `refsync:${createHash("sha256").update(JSON.stringify([desired.slug, tracked])).digest("hex")}`;
}

/** Salvamento sem prova: a operação continua aberta no banco (repetir o mesmo pedido ou reconciliar). */
export class ReferenceSyncPendingError extends Error {
  readonly pending = true;
  readonly operationIds: string[];
  constructor(message: string, operationIds: string[]) {
    super(message);
    this.name = "ReferenceSyncPendingError";
    this.operationIds = operationIds;
  }
}

export type ReferenceSaveAudit = { items: number; operations: string[]; status: "nothing" | "succeeded" };

/**
 * Envolve a gravação de uma rota. `plan` descreve o que a rota vai gravar; `write` grava.
 * Erros de gravação são repassados depois de resolver a auditoria (falha antes de gravar
 * fica registrada como "nada gravado"; mistura fica pendente e vira ReferenceSyncPendingError).
 */
export async function auditedGameSave<T>(input: {
  rpc: LifecycleRpc;
  client: unknown;
  slug: string;
  actor: string;
  reason: string;
  plan: GameWritePlan | ((before: GameScopeState) => GameWritePlan);
  write: () => Promise<T>;
  /** Para testes: lê o escopo (padrão: readGameScope). */
  readScope?: (slug: string) => Promise<GameScopeState>;
}): Promise<{ result: T; audit: ReferenceSaveAudit }> {
  const { rpc, slug, actor, reason } = input;
  const before = await (input.readScope ?? ((s: string) => readGameScope(input.client, s)))(slug);
  const plan = typeof input.plan === "function" ? input.plan(before) : input.plan;
  const desired = applyWritePlan(before, plan);
  const items = diffGameScope(before, desired);
  const baseKey = referenceSyncBaseKey(desired);
  const scope = `game:${slug}`;
  const chunks: ReferenceSyncItem[][] = [];
  for (let index = 0; index < items.length; index += REFERENCE_SYNC_CHUNK) chunks.push(items.slice(index, index + REFERENCE_SYNC_CHUNK));
  if (chunks.length === 0) chunks.push([]);

  // Intenção antes de qualquer gravação. Pedido repetido retoma as partes pendentes (itens originais).
  const operations = new Map<string, number>();
  for (let index = 0; index < chunks.length; index += 1) {
    const begin = await rpc("storage_lifecycle_begin_reference_sync", {
      p_scope: scope, p_base_key: baseKey, p_chunk: index + 1, p_chunks: chunks.length,
      p_actor: actor, p_reason: reason, p_items: chunks[index],
    });
    if (begin.status === "started" || begin.status === "pending") {
      const items = Array.isArray(begin.items) ? begin.items.length : 0;
      operations.set(String(begin.operation_id), items);
    }
    for (const entry of (begin.resumable as Array<{ operation_id: string; items: unknown[] }> | undefined) ?? []) {
      operations.set(String(entry.operation_id), Array.isArray(entry.items) ? entry.items.length : 0);
    }
  }
  const total = [...operations.values()].reduce((sum, count) => sum + count, 0);

  let result: T;
  try {
    result = await input.write();
  } catch (writeError) {
    if (operations.size > 0) await settle([...operations.keys()], "settle", rpc, actor);
    throw writeError;
  }
  if (operations.size === 0) return { result, audit: { items: 0, operations: [], status: "nothing" } };
  await settle([...operations.keys()], "verify", rpc, actor);
  return { result, audit: { items: total, operations: [...operations.keys()], status: "succeeded" } };
}

async function settle(ids: string[], mode: "verify" | "settle", rpc: LifecycleRpc, actor: string) {
  const unproven: string[] = [];
  let lastMessage = "";
  for (const id of ids) {
    try {
      const finish = await rpc("storage_lifecycle_finish_reference_sync", { p_operation_id: id, p_actor: actor, p_mode: mode });
      if (finish.status === "already_finished" && finish.result !== "succeeded" && mode === "verify") {
        unproven.push(id);
        lastMessage = `operação ${id} já encerrada como ${String(finish.result)}`;
      }
    } catch (error) {
      unproven.push(id);
      lastMessage = error instanceof Error ? error.message : String(error);
    }
  }
  if (unproven.length > 0) {
    throw new ReferenceSyncPendingError(
      `As imagens deste salvamento não puderam ser comprovadas no banco (${lastMessage}). A auditoria ficou pendente.`,
      unproven
    );
  }
}
