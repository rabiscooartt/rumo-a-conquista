import type { CatalogCache } from "./catalog.ts";
import { contentFromWindowTitle, findEmulator } from "./emulators.ts";
import type { GameRepository } from "./repository.ts";
import type { SystemSignals } from "./signals.ts";
import type { SteamLibrary } from "./steamLibrary.ts";
import { matchCatalog, normalizeTitle } from "./titles.ts";

export type DetectionSource = "steam" | "process" | "emulator";

/** Algo que está rodando e parece um jogo. */
export type Detection = {
  /** Chave estável usada nos mapeamentos: steam:<appid>, exe:<nome.exe>, emulator:<id>. */
  key: string;
  source: DetectionSource;
  label: string;
  pid: number | null;
  exe: string | null;
  appId?: number;
  emulator?: string;
  /** Conteúdo identificado no título da janela do emulador. */
  content?: string | null;
};

/** Detecção já resolvida contra o catálogo do site. */
export type ResolvedGame = Detection & {
  /** Identidade da sessão: game:<slug> quando resolvido; senão a própria chave de detecção. */
  identity: string;
  slug: string | null;
  title: string;
  resolvedBy: "manual" | "auto" | "unresolved";
  /** Chave de mapeamento usada/sugerida (emuladores: emulator:<id>|<conteúdo>). */
  mappingKey: string;
};

export type ScanResult = {
  at: number;
  current: ResolvedGame | null;
  detections: ResolvedGame[];
  ignored: string[];
  warnings: string[];
  durationMs: number;
};

const PRIORITY: Record<DetectionSource, number> = { steam: 0, process: 1, emulator: 2 };
const TITLE_TTL_MS = 30_000;

export class GameDetector {
  private readonly signals: SystemSignals;
  private readonly repo: GameRepository;
  private readonly catalog: CatalogCache;
  private readonly steamLibrary: () => SteamLibrary | null;
  private readonly titles = new Map<number, { title: string | null; at: number }>();

  constructor(options: {
    signals: SystemSignals;
    repo: GameRepository;
    catalog: CatalogCache;
    steamLibrary: () => SteamLibrary | null;
  }) {
    this.signals = options.signals;
    this.repo = options.repo;
    this.catalog = options.catalog;
    this.steamLibrary = options.steamLibrary;
  }

  private async windowTitle(pid: number, now: number) {
    const cached = this.titles.get(pid);
    if (cached && now - cached.at < TITLE_TTL_MS) return cached.title;
    const title = await this.signals.windowTitle(pid);
    this.titles.set(pid, { title, at: now });
    return title;
  }

  async detect(now = Date.now()): Promise<{ detections: Detection[]; warnings: string[] }> {
    const warnings: string[] = [];
    const detections: Detection[] = [];

    const [appId, processes] = await Promise.all([
      this.signals.steamRunningAppId(),
      this.signals.listProcesses().catch((error) => {
        warnings.push(`lista de processos indisponível: ${(error as Error).message}`);
        return [];
      }),
    ]);

    if (appId === null) warnings.push("Steam não encontrada no registro (RunningAppID)");
    else if (appId > 0) {
      const info = this.steamLibrary()?.appInfo(appId) ?? null;
      detections.push({
        key: `steam:${appId}`,
        source: "steam",
        label: info?.name ?? `Steam app ${appId}`,
        pid: null,
        exe: null,
        appId,
      });
    }

    const seenPids = new Set<number>();
    for (const proc of processes) {
      const exe = proc.name.toLowerCase();
      const mapping = this.repo.mapping(`exe:${exe}`);
      if (mapping && !mapping.ignored) {
        detections.push({ key: `exe:${exe}`, source: "process", label: mapping.title ?? proc.name, pid: proc.pid, exe: proc.name });
        seenPids.add(proc.pid);
        continue;
      }
      const emulator = findEmulator(exe);
      if (emulator) {
        const content = contentFromWindowTitle(await this.windowTitle(proc.pid, now), emulator);
        detections.push({
          key: `emulator:${emulator.id}`,
          source: "emulator",
          label: content ?? emulator.name,
          pid: proc.pid,
          exe: proc.name,
          emulator: emulator.id,
          content,
        });
        seenPids.add(proc.pid);
      }
    }
    for (const pid of this.titles.keys()) if (!seenPids.has(pid)) this.titles.delete(pid);
    return { detections, warnings };
  }

  /** Aplica mapeamento manual, depois casamento automático com o catálogo. */
  resolve(detection: Detection): ResolvedGame | "ignored" {
    const mappingKey =
      detection.source === "emulator" && detection.content
        ? `${detection.key}|${normalizeTitle(detection.content)}`
        : detection.key;
    const mapping = this.repo.mapping(mappingKey) ?? (mappingKey !== detection.key ? this.repo.mapping(detection.key) : null);
    if (mapping?.ignored) return "ignored";

    const base = { ...detection, mappingKey };
    if (mapping?.slug) {
      const game = this.catalog.bySlug(mapping.slug);
      return {
        ...base,
        identity: `game:${mapping.slug}`,
        slug: mapping.slug,
        title: game?.title ?? mapping.title ?? detection.label,
        resolvedBy: mapping.origin,
      };
    }

    const canAutoMatch = detection.source !== "emulator" || Boolean(detection.content);
    const match = canAutoMatch ? matchCatalog(detection.label, this.catalog.games()) : null;
    if (match) {
      // Fixa o casamento para que a identificação não mude se o catálogo mudar de nome.
      this.repo.setMapping({ detectionKey: mappingKey, slug: match.slug, title: match.title, origin: "auto" });
      return { ...base, identity: `game:${match.slug}`, slug: match.slug, title: match.title, resolvedBy: "auto" };
    }
    return { ...base, identity: detection.key, slug: null, title: detection.label, resolvedBy: "unresolved" };
  }

  async scan(now = Date.now()): Promise<ScanResult> {
    const started = Date.now();
    const { detections, warnings } = await this.detect(now);
    const resolved: ResolvedGame[] = [];
    const ignored: string[] = [];
    for (const detection of detections) {
      const result = this.resolve(detection);
      if (result === "ignored") ignored.push(detection.key);
      else resolved.push(result);
    }
    resolved.sort((a, b) => PRIORITY[a.source] - PRIORITY[b.source]);
    return { at: now, current: resolved[0] ?? null, detections: resolved, ignored, warnings, durationMs: Date.now() - started };
  }
}
