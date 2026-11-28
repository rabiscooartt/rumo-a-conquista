import type { ConnectionStatus } from "../../connections/managedConnection.ts";
import type { EventStatus } from "../../events/eventStore.ts";
import type { GamesStatus } from "../games/index.ts";
import type { AlertsSummary } from "../alerts/index.ts";
import type { ClipsSummary } from "../clips/index.ts";

/** verde = normal; âmbar = degradado/atenção; vermelho = falha importante; cinza = inativo/não se aplica. */
export type Level = "ok" | "warn" | "error" | "idle";

export type DockItem = { level: Level; label: string; detail: string | null };

export type DockState = {
  generatedAt: string;
  overall: Level;
  game: {
    level: Level;
    title: string | null;
    slug: string | null;
    sessionLabel: string;
    sessionStartedAt: string | null;
    detail: string | null;
  };
  agent: DockItem & { version: string; uptimeSeconds: number };
  obs: DockItem;
  site: DockItem;
  sync: DockItem;
  alerts: DockItem;
  clips: DockItem;
  /** Momentos marcados com o atalho e ainda não revisados. */
  momentsPending: number;
};

export type DockInput = {
  now: number;
  version: string;
  uptimeSeconds: number;
  games: GamesStatus | null;
  obs: ConnectionStatus;
  site: ConnectionStatus;
  sync: { tokenConfigured: boolean; counts: Partial<Record<EventStatus, number>>; lastError: string | null };
  alerts?: AlertsSummary | null;
  clips?: ClipsSummary | null;
  momentsPending?: number;
};

const RANK: Record<Level, number> = { idle: 0, ok: 1, warn: 2, error: 3 };
/** Falhas seguidas a partir das quais uma conexão em reconexão passa de atenção para falha. */
const FAILURES_FOR_ERROR = 3;

function connectionItem(status: ConnectionStatus, names: { connected: string }): DockItem {
  switch (status.state) {
    case "connected":
      return { level: "ok", label: names.connected, detail: null };
    case "disabled":
      return { level: "idle", label: "Desativado", detail: "Desligado na configuração do agente" };
    case "stopped":
    case "idle":
      return { level: "idle", label: "Inativo", detail: null };
    case "connecting":
      return { level: "warn", label: "Conectando…", detail: status.lastError };
    case "reconnecting": {
      const failing = status.consecutiveFailures >= FAILURES_FOR_ERROR;
      return {
        level: failing ? "error" : "warn",
        label: failing ? "Sem conexão" : "Reconectando…",
        detail: status.lastError,
      };
    }
  }
}

function gameItem(games: GamesStatus | null): DockState["game"] {
  if (!games || !games.enabled) {
    return { level: "idle", title: null, slug: null, sessionLabel: "Identificação desativada", sessionStartedAt: null, detail: null };
  }
  const session = games.activeSession;
  const current = games.current;
  if (session) {
    // Sessão corrigida manualmente: o executável detectado continua o mesmo, só a identidade mudou.
    const seenNow =
      current?.identity === session.identity || Boolean(session.manualSlug && current?.key === session.detectionKey);
    return {
      level: seenNow ? (session.slug ? "ok" : "warn") : "warn",
      title: session.title,
      slug: session.slug,
      sessionLabel: seenNow ? "Sessão ativa" : "Sessão ativa (jogo fora de vista)",
      sessionStartedAt: new Date(session.startedAt).toISOString(),
      detail: session.slug ? null : "Jogo fora do catálogo do site: conquistas não serão sincronizadas",
    };
  }
  if (current) {
    return {
      level: "warn",
      title: current.title,
      slug: current.slug,
      sessionLabel: games.pendingStart ? "Confirmando sessão…" : "Detectado",
      sessionStartedAt: null,
      detail: current.slug ? null : "Jogo fora do catálogo do site",
    };
  }
  return {
    level: games.lastScanError ? "error" : "idle",
    title: null,
    slug: null,
    sessionLabel: "Nenhum jogo em execução",
    sessionStartedAt: null,
    detail: games.lastScanError ? `Falha na detecção: ${games.lastScanError}` : null,
  };
}

function syncItem(sync: DockInput["sync"], site: DockItem): DockItem {
  const failed = sync.counts.failed ?? 0;
  const waiting = (sync.counts.pending ?? 0) + (sync.counts.retry_wait ?? 0) + (sync.counts.processing ?? 0);
  if (!sync.tokenConfigured) {
    return { level: "warn", label: "Não configurada", detail: "Defina siteAgentToken para enviar conquistas ao site" };
  }
  if (failed > 0) {
    return { level: "warn", label: `${failed} com falha`, detail: sync.lastError ?? "Veja: npm run agent -- achievements" };
  }
  if (waiting > 0) {
    return site.level === "ok"
      ? { level: "ok", label: `Enviando ${waiting}`, detail: null }
      : { level: "warn", label: `${waiting} aguardando`, detail: "Guardadas no agente; serão enviadas quando o site voltar" };
  }
  return { level: "ok", label: "Em dia", detail: null };
}

function alertsItem(alerts: AlertsSummary | null | undefined): DockItem {
  if (!alerts) return { level: "idle", label: "—", detail: null };
  const c = alerts.counts;
  const waiting = c.pending + c.retry_wait;
  if (c.failed > 0) return { level: "warn", label: `${c.failed} com falha`, detail: "Veja: npm run agent -- alerts" };
  if (alerts.current || c.processing > 0) {
    const mastery = alerts.currentKind === "mastery";
    const detail = [alerts.currentTitle, waiting ? `${waiting} na fila` : null].filter(Boolean).join(" · ");
    return { level: "ok", label: mastery ? "Apresentando Maestria" : "Apresentando", detail: detail || null };
  }
  if (alerts.masteryWaiting) {
    return {
      level: alerts.presenter ? "ok" : "warn",
      label: "Maestria na fila",
      detail: alerts.presenter ? "Sequência protegida: alertas comuns aguardam" : "Aguardando o overlay conectar",
    };
  }
  if (!alerts.presenter) {
    return { level: "idle", label: waiting ? `${waiting} na fila` : "Fila vazia", detail: "Overlay desconectado" };
  }
  return { level: "ok", label: waiting ? `${waiting} na fila` : "Fila vazia", detail: "Overlay conectado" };
}

function clipsItem(clips: ClipsSummary | null | undefined): DockItem {
  if (!clips || !clips.enabled) return { level: "idle", label: "Desativados", detail: null };
  const c = clips.counts;
  if (!clips.obs) return { level: "warn", label: "Sem OBS", detail: "Clips dependem do buffer de replay do OBS" };
  if (!clips.bufferAvailable) return { level: "warn", label: "Buffer desabilitado", detail: "OBS: Configurações > Saída > Buffer de replay" };
  if (!clips.bufferActive) return { level: "warn", label: "Buffer desligado", detail: "Inicie o buffer de replay no OBS" };
  if (c.failed > 0) return { level: "warn", label: `${c.failed} com falha`, detail: clips.lastError ?? "Veja: npm run agent -- clips list" };
  if (c.pending + c.saving > 0) return { level: "ok", label: c.saving ? "Salvando clip…" : `${c.pending} agendado${c.pending > 1 ? "s" : ""}`, detail: clips.dir };
  const wanted = clips.preSeconds + clips.postSeconds;
  if (clips.bufferSeconds !== null && clips.bufferSeconds < wanted) {
    return { level: "warn", label: "Buffer curto", detail: `OBS guarda ${clips.bufferSeconds}s; o clip pede ${wanted}s` };
  }
  return { level: "ok", label: "Buffer ativo", detail: [clips.bufferSeconds ? `${clips.bufferSeconds}s` : null, clips.dir].filter(Boolean).join(" · ") || null };
}

/** Resumo do estado real do agente para o dock. Só usa dados comprovados pelo agente. */
export function buildDockState(input: DockInput): DockState {
  const obs = connectionItem(input.obs, { connected: "Conectado" });
  if (obs.level === "ok" && typeof input.obs.detail.obsVersion === "string") obs.detail = `OBS ${input.obs.detail.obsVersion}`;
  const site = connectionItem(input.site, { connected: "Online" });
  const sync = syncItem(input.sync, site);
  const game = gameItem(input.games);
  const agent: DockState["agent"] = {
    level: "ok",
    label: "Em execução",
    detail: null,
    version: input.version,
    uptimeSeconds: input.uptimeSeconds,
  };
  const alerts = alertsItem(input.alerts);
  const clips = clipsItem(input.clips);
  const overall = [agent, obs, site, sync, alerts, clips].reduce<Level>((worst, item) => (RANK[item.level] > RANK[worst] ? item.level : worst), "ok");
  return { generatedAt: new Date(input.now).toISOString(), overall, game, agent, obs, site, sync, alerts, clips, momentsPending: input.momentsPending ?? 0 };
}
