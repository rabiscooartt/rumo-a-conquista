"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";
import { formatGameTitle, useSiteGames, type SiteGame } from "@/lib/useSiteGames";
import { GAME_GENRES } from "@/lib/gameGenres";
import NewGameAchievementsEditor from "@/components/admin/NewGameAchievementsEditor";
import FinalMasteryEditor from "@/components/admin/FinalMasteryEditor";
import GameEmblemEditor from "@/components/admin/GameEmblemEditor";

function statusLabel(status?: string) {
  const value = String(status || "").toLowerCase();
  if (["completed", "finalizado", "concluido", "concluida"].includes(value)) return "Finalizado";
  if (["planned", "backlog", "futuro", "planejado"].includes(value)) return "Próxima Maestria";
  return "Em progresso";
}

function statusTone(status?: string): "completed" | "planned" | "progress" {
  const value = String(status || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\\u0300-\\u036f]/g, "");

  if (["completed", "finalizado", "concluido", "concluida"].includes(value)) {
    return "completed";
  }

  if (["planned", "backlog", "futuro", "planejado", "na fila", "proxima maestria"].includes(value)) {
    return "planned";
  }

  return "progress";
}

function gameCardClass(status?: string, selected = false) {
  const tone = statusTone(status);
  const styles = {
    completed: selected
      ? "w-full rounded-xl border border-emerald-400/55 bg-emerald-500/[0.12] p-3 text-left"
      : "w-full rounded-xl border border-emerald-500/25 bg-emerald-500/[0.035] p-3 text-left hover:border-emerald-400/45",
    planned: selected
      ? "w-full rounded-xl border border-blue-400/55 bg-blue-500/[0.12] p-3 text-left"
      : "w-full rounded-xl border border-blue-500/25 bg-blue-500/[0.035] p-3 text-left hover:border-blue-400/45",
    progress: selected
      ? "w-full rounded-xl border border-red-400/55 bg-red-500/[0.12] p-3 text-left"
      : "w-full rounded-xl border border-red-500/25 bg-red-500/[0.035] p-3 text-left hover:border-red-400/45",
  };
  return styles[tone];
}

function statusBadgeClass(status?: string) {
  const styles = {
    completed: "rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-emerald-300",
    planned: "rounded-full border border-blue-500/30 bg-blue-500/[0.08] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-blue-300",
    progress: "rounded-full border border-red-500/30 bg-red-500/[0.08] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-red-300",
  };
  return styles[statusTone(status)];
}

function journeyActive(game: SiteGame) {
  return game.firstJourney?.status === "in_progress";
}

function reviewListFieldText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n");
  }
  if (typeof value === "string") return value;
  return "";
}

function reviewStringField(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function reviewFieldTone(value: unknown): string {
  const filled = String(value ?? "").trim().length > 0;
  return filled
    ? "border border-sky-400/55 bg-sky-500/[0.10] focus:border-sky-300 focus:bg-sky-500/[0.14]"
    : "border border-white/10 bg-black/30 focus:border-sky-500/55 focus:bg-sky-500/[0.04]";
}

export default function NewGamesAdminPage() {
  const { isLoaded, gamesList, updateGame, updateFinalMastery, updateEmblem } = useSiteGames();
  const [selectedSlug, setSelectedSlug] = useState("");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [generatingReview, setGeneratingReview] = useState(false);
  const [savingReviewDraft, setSavingReviewDraft] = useState(false);
  const [reviewDraftStatus, setReviewDraftStatus] = useState("");
  const [reviewGenerateError, setReviewGenerateError] = useState("");
  const [restoringMouse, setRestoringMouse] = useState(false);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, Record<string, string>>>({});
  const [journeyDraftIds, setJourneyDraftIds] = useState<string[]>([]);
  const [manualAchievementRecords, setManualAchievementRecords] = useState<
    Record<string, { episode?: string; earnedDate?: string }>
  >({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});

  function toggleAdminSection(sectionId: string) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = q
      ? gamesList.filter((game) =>
          [game.title, game.slug, game.subtitle].some((value) =>
            String(value || "").toLowerCase().includes(q)
          )
        )
      : gamesList;

    const statusOrder = (status?: string) => {
      const value = String(status || "").trim().toLowerCase();

      if (["completed", "finalizado", "concluido", "concluida"].includes(value)) {
        return 2;
      }

      if (["planned", "backlog", "futuro", "planejado", "na fila"].includes(value)) {
        return 1;
      }

      return 0;
    };

    // Stable grouping: in progress first, queue/next mastery second, completed last.
    return matches
      .map((game, index) => ({ game, index }))
      .sort((a, b) => statusOrder(a.game.status) - statusOrder(b.game.status) || a.index - b.index)
      .map(({ game }) => game);
  }, [gamesList, search]);

  const selectedGame = gamesList.find((game) => game.slug === selectedSlug) ?? gamesList[0];
  const values = selectedGame
    ? draft && draft.slug === selectedGame.slug
      ? draft
      : {
          slug: selectedGame.slug,
          title: selectedGame.title || "",
          subtitle: selectedGame.subtitle || "",
          status: selectedGame.status || "progress",
          platform: selectedGame.platform || "Steam",
          primaryGenre: (() => {
            const rawReview = selectedGame.review;
            if (!rawReview || typeof rawReview !== "object" || Array.isArray(rawReview)) return "";
            return String((rawReview as Record<string, unknown>).__primaryGenre || "");
          })(),
          hours: String(selectedGame.hours || "0h"),
          nextAchievement: selectedGame.currentObjective || selectedGame.objective || "",
          nextAchievementMode:
            selectedGame.currentObjective || selectedGame.objective
              ? "manual"
              : "automatic",
          youtubeFirstLiveEpisode: selectedGame.youtubeFirstLiveEpisode || "",
        }
    : null;

  const savedReview =
    selectedGame?.review &&
    typeof selectedGame.review === "object" &&
    !Array.isArray(selectedGame.review)
      ? (selectedGame.review as Record<string, unknown>)
      : {};

  const reviewValues = selectedGame
    ? reviewDrafts[selectedGame.slug]
      ? reviewDrafts[selectedGame.slug]
      : {
          slug: selectedGame.slug,
          status: reviewStringField(savedReview.status, "bloqueada"),
          nota: reviewStringField(savedReview.nota),
          titulo: reviewStringField(savedReview.titulo, "Análise da Jornada"),
          texto: reviewStringField(savedReview.texto),
          resumo: reviewStringField(savedReview.resumo).slice(0, 100),
          fraseCartao: reviewStringField(savedReview.fraseCartao).slice(0, 100),
          fichaNomeJogo: selectedGame.title || "",
          historia: "",
          jogabilidade: "",
          direcaoArtistica: "",
          trilhaSonora: "",
          progressaoConquistas: "",
          positivos: reviewListFieldText(savedReview.positivos ?? savedReview.pontosFortes),
          negativos: reviewListFieldText(savedReview.negativos ?? savedReview.pontosFracos),
          experienciaPessoal: "",
          recomendacao: "Depende",
          recomendacaoExplicacao: "",
          fraseExperiencia: "",
        }
    : null;

  function patchReviewDraft(patch: Record<string, string>) {
    if (!selectedGame || !reviewValues) return;
    const slug = selectedGame.slug;
    setReviewDraftStatus("Alterações ainda não salvas como rascunho.");
    setReviewDrafts((current) => ({
      ...current,
      [slug]: {
        ...(current[slug] ?? reviewValues),
        ...patch,
        slug,
      },
    }));
  }
  useEffect(() => {
    const slug = selectedGame?.slug ?? "";
    if (!slug) return;

    let cancelled = false;

    async function loadReviewDraft() {
      try {
        const response = await fetch(
          "/api/admin/game-review-draft?slug=" + encodeURIComponent(slug),
          { cache: "no-store" }
        );
        const payload = (await response.json().catch(() => null)) as
          | { found?: boolean; draft?: Record<string, unknown>; error?: string }
          | null;

        if (cancelled) return;

        if (response.status === 401) {
          setReviewDraftStatus("Entre no modo Admin para acessar os rascunhos salvos.");
          return;
        }

        if (!response.ok) {
          setReviewDraftStatus(payload?.error || "Não foi possível carregar o rascunho salvo.");
          return;
        }

        if (!payload?.found || !payload.draft) {
          setReviewDraftStatus("");
          return;
        }

        const saved = payload.draft;
        const recovered: Record<string, string> = { slug };
        Object.entries(saved).forEach(([key, value]) => {
          if (typeof value === "string" && key !== "gameSlug" && key !== "updatedAt") {
            recovered[key] = value;
          }
        });

        setReviewDrafts((current) => {
          if (current[slug]) return current;
          return { ...current, [slug]: recovered };
        });

        const updatedAt = typeof saved.updatedAt === "string" ? saved.updatedAt : "";
        const displayDate = updatedAt ? new Date(updatedAt).toLocaleString("pt-BR") : "";
        setReviewDraftStatus(
          displayDate
            ? "Rascunho recuperado — último salvamento: " + displayDate
            : "Rascunho recuperado."
        );
      } catch {
        if (!cancelled) setReviewDraftStatus("Não foi possível carregar o rascunho salvo.");
      }
    }

    void loadReviewDraft();
    return () => {
      cancelled = true;
    };
  }, [selectedGame?.slug]);

  useEffect(() => {
    const slug = selectedGame?.slug ?? "";

    if (!slug) {
      setJourneyDraftIds([]);
      setManualAchievementRecords({});
      return;
    }

    let cancelled = false;

    async function loadAchievementOrganization() {
      try {
        const response = await fetch(
          "/api/admin/achievement-prep-draft?slug=" + encodeURIComponent(slug),
          { cache: "no-store" }
        );

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.found || !payload?.draft) {
          if (!cancelled) {
            setJourneyDraftIds([]);
            setManualAchievementRecords({});
          }
          return;
        }

        const draft = payload.draft as {
          journeyIds?: unknown;
          episodeById?: unknown;
          earnedDateById?: unknown;
        };

        const draftJourneyIds = Array.isArray(draft.journeyIds)
          ? draft.journeyIds
              .map((value) => String(value).trim())
              .filter(Boolean)
          : [];

        const savedJourneyIds =
          Array.isArray(selectedGame?.firstJourney?.achievementIds)
            ? selectedGame.firstJourney.achievementIds
                .map((value) => String(value).trim())
                .filter(Boolean)
            : undefined;

        const journeyIds =
          journeyCompleted && savedJourneyIds
            ? savedJourneyIds
            : journeyCompleted
              ? []
              : draftJourneyIds;

        const journeySet = new Set(journeyIds);
        const episodeById =
          draft.episodeById &&
          typeof draft.episodeById === "object" &&
          !Array.isArray(draft.episodeById)
            ? (draft.episodeById as Record<string, unknown>)
            : {};
        const earnedDateById =
          draft.earnedDateById &&
          typeof draft.earnedDateById === "object" &&
          !Array.isArray(draft.earnedDateById)
            ? (draft.earnedDateById as Record<string, unknown>)
            : {};

        const ids = new Set([
          ...Object.keys(episodeById),
          ...Object.keys(earnedDateById),
        ]);
        const manualRecords: Record<
          string,
          { episode?: string; earnedDate?: string }
        > = {};

        ids.forEach((id) => {
          if (journeySet.has(id)) return;

          const episode = String(episodeById[id] ?? "").trim();
          const earnedDate = String(earnedDateById[id] ?? "").trim();

          if (episode || earnedDate) {
            manualRecords[id] = {
              episode: episode || undefined,
              earnedDate: earnedDate || undefined,
            };
          }
        });

        if (!cancelled) {
          setJourneyDraftIds(journeyIds);
          setManualAchievementRecords(manualRecords);
        }
      } catch {
        if (!cancelled) {
          setJourneyDraftIds([]);
          setManualAchievementRecords({});
        }
      }
    }

    void loadAchievementOrganization();

    return () => {
      cancelled = true;
    };
  }, [selectedGame?.slug]);

  const nextAchievementOptions = useMemo(() => {
    const achievements = Array.isArray(selectedGame?.achievementsList)
      ? selectedGame.achievementsList
      : [];

    return achievements.filter(
      (achievement) => String(achievement.title || "").trim().length > 0
    );
  }, [selectedGame]);

  const manualNextAchievementTitle =
    values?.nextAchievementMode === "manual" ? values.nextAchievement : "";

  const journeyCompleted =
    selectedGame?.firstJourney?.status === "completed" &&
    (Boolean(selectedGame.firstJourney.completedAt) ||
      Array.isArray(selectedGame.firstJourney.achievementIds));
  const journeySelectionFinalized =
    journeyCompleted && Array.isArray(selectedGame?.firstJourney?.achievementIds);

  async function restoreMouseData() {
    if (restoringMouse) return;

    const confirmed = window.confirm(
      "Restaurar os dados do Mouse P.I. para as 34 conquistas ligadas às artes 01-34? As 28 duplicatas extras serão removidas. Progresso, Jornada e artes serão preservados."
    );
    if (!confirmed) return;

    setRestoringMouse(true);

    try {
      const response = await fetch("/api/admin/recover-mouse", {
        method: "POST",
        cache: "no-store",
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível restaurar os dados.");
      }

      window.alert(
        "Restauração concluída: " +
          payload.restored.achievements +
          " conquistas, " +
          payload.restored.removedDuplicates +
          " duplicatas removidas e " +
          payload.restored.imagesPreserved +
          " artes preservadas."
      );

      window.location.reload();
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : "Não foi possível restaurar os dados."
      );
    } finally {
      setRestoringMouse(false);
    }
  }

  async function saveBasics() {
    if (!selectedGame || !values) return;
    setSaving(true);
    try {
      await updateGame(selectedGame.slug, {
        title: formatGameTitle(values.title) || selectedGame.title,
        subtitle: values.subtitle.trim(),
        status: values.status,
        platform: values.platform,
        hours: values.hours.trim() || "0h",
        currentObjective:
          values.nextAchievementMode === "manual"
            ? values.nextAchievement.trim()
            : "",
        objective:
          values.nextAchievementMode === "manual"
            ? values.nextAchievement.trim()
            : "",
        review: (() => {
          const review =
            selectedGame.review &&
            typeof selectedGame.review === "object" &&
            !Array.isArray(selectedGame.review)
              ? { ...(selectedGame.review as Record<string, unknown>) }
              : {};
          const firstLiveEpisode = String(
            values.youtubeFirstLiveEpisode || ""
          ).trim();
          const primaryGenre = String(values.primaryGenre || "").trim();

          if (primaryGenre) {
            review.__primaryGenre = primaryGenre;
          } else {
            delete review.__primaryGenre;
          }

          if (firstLiveEpisode) {
            review.__youtubeFirstLiveEpisode = firstLiveEpisode;
          } else {
            delete review.__youtubeFirstLiveEpisode;
          }

          return Object.keys(review).length > 0 ? review : null;
        })(),
      });
    } finally {
      setSaving(false);
    }
  }


  async function saveReviewDraft() {
    if (!selectedGame || !reviewValues) return;
    if (reviewValues.slug !== selectedGame.slug) {
      window.alert("O rascunho pertence a outro jogo. Selecione o jogo correto antes de salvar.");
      return;
    }

    setSavingReviewDraft(true);
    setReviewDraftStatus("");
    try {
      const response = await fetch("/api/admin/game-review-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ slug: selectedGame.slug, draft: reviewValues }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { saved?: boolean; updatedAt?: string; error?: string }
        | null;
      if (!response.ok || !payload?.saved) {
        throw new Error(payload?.error || "Não foi possível salvar o rascunho.");
      }
      const displayDate = payload.updatedAt
        ? new Date(payload.updatedAt).toLocaleString("pt-BR")
        : new Date().toLocaleString("pt-BR");
      setReviewDraftStatus("Rascunho salvo com segurança em " + displayDate + ".");
    } catch (error) {
      setReviewDraftStatus(
        error instanceof Error ? error.message : "Não foi possível salvar o rascunho. Tente novamente."
      );
    } finally {
      setSavingReviewDraft(false);
    }
  }

  async function generateReviewSummary() {
    if (!selectedGame || !reviewValues || generatingReview) return;

    const answers = {
      historia: reviewValues.historia,
      jogabilidade: reviewValues.jogabilidade,
      direcaoArtistica: reviewValues.direcaoArtistica,
      trilhaSonora: reviewValues.trilhaSonora,
      progressaoConquistas: reviewValues.progressaoConquistas,
      pontosPositivos: reviewValues.positivos,
      pontosNegativos: reviewValues.negativos,
      experienciaPessoal: reviewValues.experienciaPessoal,
      notaFinal: reviewValues.nota,
      recomendacao: reviewValues.recomendacao,
      recomendacaoExplicacao: reviewValues.recomendacaoExplicacao,
      resumoDaExperiencia: reviewValues.fraseExperiencia,
    };

    const descriptiveAnswers = [
      answers.historia,
      answers.jogabilidade,
      answers.direcaoArtistica,
      answers.trilhaSonora,
      answers.progressaoConquistas,
      answers.pontosPositivos,
      answers.pontosNegativos,
      answers.experienciaPessoal,
      answers.recomendacaoExplicacao,
      answers.resumoDaExperiencia,
    ];
    if (!descriptiveAnswers.some((value) => String(value || "").trim())) {
      setReviewGenerateError("Preencha pelo menos uma resposta da ficha antes de gerar o resumo.");
      return;
    }

    setGeneratingReview(true);
    setReviewGenerateError("");
    setReviewDraftStatus("");

    try {
      const response = await fetch("/api/admin/generate-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ gameTitle: selectedGame.title, answers }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { titulo?: string; resumoPrincipal?: string; fraseCartao?: string; resumo?: string; error?: string }
        | null;

      if (!response.ok || !payload?.titulo || !payload.resumoPrincipal) {
        throw new Error(payload?.error || "Não foi possível gerar o resumo.");
      }

      const nextValues: Record<string, string> = {
        ...reviewValues,
        titulo: payload.titulo,
        texto: payload.resumoPrincipal,
        fraseCartao: String(payload.fraseCartao || "").slice(0, 100),
        resumo: String(payload.resumo || "").slice(0, 100),
        slug: selectedGame.slug,
      };
      setReviewDrafts((current) => ({ ...current, [selectedGame.slug]: nextValues }));
      setReviewDraftStatus("Resumo gerado. Salvando a ficha automaticamente como rascunho...");

      try {
        const draftResponse = await fetch("/api/admin/game-review-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ slug: selectedGame.slug, draft: nextValues }),
        });
        const draftPayload = (await draftResponse.json().catch(() => null)) as
          | { saved?: boolean; updatedAt?: string; error?: string }
          | null;
        if (!draftResponse.ok || !draftPayload?.saved) {
          throw new Error(draftPayload?.error || "O resumo foi gerado, mas não foi possível salvar o rascunho automaticamente.");
        }
        setReviewDraftStatus(
          "Resumo gerado e rascunho salvo em " +
            new Date(draftPayload.updatedAt || Date.now()).toLocaleString("pt-BR") + "."
        );
      } catch {
        setReviewDraftStatus("Resumo gerado, mas ainda não foi salvo. Clique em “Salvar rascunho” para guardar.");
      }
    } catch (error) {
      setReviewGenerateError(
        error instanceof Error ? error.message : "Não foi possível gerar o resumo. Tente novamente."
      );
    } finally {
      setGeneratingReview(false);
    }
  }

  async function saveReview() {
    if (!selectedGame || !reviewValues) return;

    const review = {
      ...savedReview,
      status: reviewValues.status,
      nota: reviewValues.nota.trim(),
      titulo: reviewValues.titulo.trim() || "Análise da Jornada",
      resumo: reviewValues.resumo.trim().slice(0, 100),
      fraseCartao: reviewValues.fraseCartao.trim().slice(0, 100),
      texto: reviewValues.texto.trim(),
      recomendacao: reviewValues.recomendacao.trim(),
      recomendacaoExplicacao: reviewValues.recomendacaoExplicacao.trim(),
    };

    setSaving(true);
    try {
      if (reviewValues.slug !== selectedGame.slug) {
        window.alert("O rascunho pertence a outro jogo. Selecione o jogo correto antes de salvar.");
        return;
      }
      const ok = await updateGame(selectedGame.slug, { review }, reviewValues.slug);
      if (ok) {
        setReviewDrafts((current) => ({
          ...current,
          [selectedGame.slug]: {
            ...reviewValues,
            slug: selectedGame.slug,
            resumo: review.resumo,
          },
        }));
        window.alert("Review salva com sucesso.");
      } else {
        window.alert("Não foi possível salvar a review. Verifique os dados e tente novamente.");
      }
    } catch {
      window.alert("Não foi possível salvar a review. Tente novamente.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleJourney() {
    if (!selectedGame) return;
    setSaving(true);
    try {
      const activating = !journeyActive(selectedGame);

      await updateGame(selectedGame.slug, {
        firstJourney: activating
          ? { status: "in_progress" }
          : {
              status: "completed",
              completedAt: new Date().toISOString(),
            },
        ...(activating
          ? { status: "progress" }
          : {}),
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveJourneySelection() {
    if (!selectedGame || !journeyCompleted) return;

    const achievementIds = Array.from(
      new Set(journeyDraftIds.map((id) => String(id).trim()).filter(Boolean))
    );

    if (achievementIds.length === 0) {
      window.alert("Selecione pelo menos uma conquista para a Jornada de Estreia.");
      return;
    }

    setSaving(true);
    try {
      const ok = await updateGame(selectedGame.slug, {
        firstJourney: {
          status: "completed",
          completedAt:
            selectedGame.firstJourney?.completedAt || new Date().toISOString(),
          achievementIds,
        },
      });

      if (ok) {
        window.alert(
          "Jornada de Estreia definida com " +
            achievementIds.length +
            (achievementIds.length === 1 ? " conquista." : " conquistas.")
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#050505] text-white">
      <Navbar />
      <div className="mx-auto w-full max-w-[1500px] px-5 py-7 lg:px-8 lg:py-9">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-red-500">Admin • Jogos</p>
            <h1 className="mt-2 text-4xl font-black tracking-[-0.04em]">Central de Jogos</h1>
            <p className="mt-2 max-w-[780px] text-sm leading-relaxed text-white/40">
              Nova estrutura administrativa. O visual daqui para frente será a base para migrar as funções do Admin antigo.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedGame?.slug === "mouse-p-i-for-hire" &&
              (selectedGame.title === "Jogo sem nome" ||
                !selectedGame.image ||
                selectedGame.hours === "0h") && (
                <button
                  type="button"
                  onClick={() => void restoreMouseData()}
                  disabled={restoringMouse}
                  className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-amber-100 transition hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {restoringMouse
                    ? "Restaurando..."
                    : "Restaurar dados do Mouse"}
                </button>
              )}
            <Link
              href="/admin/preparar-jogo"
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-100 transition hover:bg-red-500/20"
            >
              Preparar novo jogo
            </Link>
            <Link
              href="/admin/jogos"
              className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-white/55 transition hover:border-white/20 hover:text-white"
            >
              Admin antigo
            </Link>
          </div>
        </div>

        <div className="mt-7 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/30">Jogos cadastrados</p>
                <p className="mt-1 text-xl font-black">{gamesList.length}</p>
              </div>
              <span className="rounded-full border border-red-500/20 bg-red-500/[0.06] px-2.5 py-1 text-[8px] font-black uppercase tracking-[0.14em] text-red-300">NOVO</span>
            </div>
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jogo..." className="mt-4 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-xs font-bold text-white outline-none placeholder:text-white/20 focus:border-red-500/40" />
            <div className="mt-4 max-h-[680px] space-y-2 overflow-y-auto pr-1">
              {filteredGames.map((game) => {
                const active = game.slug === selectedGame?.slug;
                return (
                  <button key={game.slug} type="button" onClick={() => { setSelectedSlug(game.slug); setDraft(null); }} className={gameCardClass(game.status, active)}>
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-9 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black">
                        <img src={game.cardImage || game.image} alt="" className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-black">{game.title}</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <span className={statusBadgeClass(game.status)}>{statusLabel(game.status)}</span>
                          <span className={journeyActive(game) ? "rounded-full border border-orange-500/35 bg-orange-500/[0.10] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-orange-300" : "rounded-full border border-white/10 bg-white/[0.02] px-1.5 py-0.5 text-[7px] font-black uppercase tracking-[0.12em] text-white/30"}>Estreia {journeyActive(game) ? "Ativa" : "Desativada"}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-5">
            {!isLoaded ? (
              <div className="rounded-[20px] border border-white/10 bg-[#090909] p-8 text-sm text-white/35">Carregando jogos...</div>
            ) : !selectedGame || !values ? (
              <div className="rounded-[20px] border border-white/10 bg-[#090909] p-8 text-sm text-white/35">Nenhum jogo encontrado.</div>
            ) : (
              <>
                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-500">Editor do jogo</p>
                      <h2 className="mt-1 text-2xl font-black">{selectedGame.title}</h2>
                      <p className="mt-1 text-xs text-white/30">{selectedGame.slug}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-white/45">{statusLabel(selectedGame.status)}</span>
                      <span className={journeyActive(selectedGame) ? "rounded-full border border-red-500/20 bg-red-500/[0.06] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-red-300" : "rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-white/35"}>Jornada {journeyActive(selectedGame) ? "Ativa" : "Desativada"}</span>
                      <Link href={`/admin/preparar-jogo?slug=${encodeURIComponent(selectedGame.slug)}`} className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-[9px] font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-500/20">Preparar conquistas</Link>
                    </div>
                  </div>
                </section>

                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
                  <button
                    type="button"
                    onClick={() => toggleAdminSection("01")}
                    aria-expanded={!collapsedSections["01"]}
                    className="group flex w-full items-center justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                  >
                    <span className="flex flex-col">
                      <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">01</span>
                      <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-red-100">Dados do jogo</span>
                    </span>
                    <span aria-hidden="true" className="text-lg font-black text-white/45 transition-colors group-hover:text-red-300">
                      {collapsedSections["01"] ? "+" : "−"}
                    </span>
                  </button>
                  {!collapsedSections["01"] && (
                    <>
                  <div className="mt-5 grid gap-4 md:grid-cols-2">
                    {(["title","subtitle","platform","hours"] as const).map((key) => {
                      const label =
                        key === "title"
                          ? "Nome"
                          : key === "subtitle"
                            ? "Subtítulo"
                            : key === "platform"
                              ? "Plataforma"
                              : "Horas";

                      return (
                        <label key={key}>
                          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                            {label}
                          </span>
                          <input
                            value={values[key]}
                            onChange={(event) =>
                              setDraft({ ...values, [key]: event.target.value })
                            }
                            onBlur={() => {
                              if (key === "title") {
                                const formattedTitle = formatGameTitle(values.title);
                                if (formattedTitle !== values.title) {
                                  setDraft({ ...values, title: formattedTitle });
                                }
                              }
                            }}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                          />
                        </label>
                      );
                    })}

                    <label>
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                        Gênero predominante
                      </span>
                      <select
                        value={values.primaryGenre}
                        onChange={(event) =>
                          setDraft({ ...values, primaryGenre: event.target.value })
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                      >
                        <option value="">Automático — análise do site</option>
                        {GAME_GENRES.map((genre) => (
                          <option key={genre} value={genre}>{genre}</option>
                        ))}
                      </select>
                      <span className="mt-1 block text-[9px] leading-relaxed text-white/25">
                        No automático, o site analisa os gêneros encontrados e exibe somente o predominante. Escolha um gênero apenas se quiser corrigir a análise deste jogo.
                      </span>
                    </label>

                    <label>
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                        EP de início — Jornada de Estreia
                      </span>
                      <input
                        value={values.youtubeFirstLiveEpisode}
                        onChange={(event) =>
                          setDraft({
                            ...values,
                            youtubeFirstLiveEpisode: event.target.value,
                          })
                        }
                        placeholder="Ex.: EP 01 ou 1"
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none placeholder:text-white/20 focus:border-red-500/40"
                      />
                      <span className="mt-1 block text-[9px] leading-relaxed text-white/25">
                        Informe somente o episódio em que a Jornada começa. Ex.: EP 01. O botão INÍCIO DAS LIVES abrirá a aba Conteúdo já filtrada pelo jogo e por esse episódio.
                      </span>
                    </label>

                    <label>
                      <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                        Status
                      </span>
                      <select
                        value={values.status}
                        onChange={(event) =>
                          setDraft({ ...values, status: event.target.value })
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                      >
                        <option value="progress">Em progresso</option>
                        <option value="planned">Próxima Maestria</option>
                        <option value="completed">Finalizado</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-6 rounded-2xl border border-white/[0.08] bg-black/20 p-4">
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-500">
                        Próxima Conquista
                      </p>
                      <h4 className="mt-1 text-base font-black text-white">
                        Defina como o jogo deve escolher a próxima conquista.
                      </h4>
                      <p className="mt-1 text-xs leading-relaxed text-white/35">
                        Automática usa a primeira conquista ainda não concluída. Manual permite escolher uma conquista específica.
                      </p>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label
                        className={`cursor-pointer rounded-xl border p-4 transition ${
                          values.nextAchievementMode === "automatic"
                            ? "border-red-500/35 bg-red-500/[0.08]"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="next-achievement-mode"
                            checked={values.nextAchievementMode === "automatic"}
                            onChange={() =>
                              setDraft({
                                ...values,
                                nextAchievementMode: "automatic",
                                nextAchievement: "",
                              })
                            }
                            className="mt-1 accent-red-500"
                          />
                          <span>
                            <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-white">
                              Automática
                            </span>
                            <span className="mt-1 block text-[10px] leading-relaxed text-white/35">
                              O site escolhe sozinho a próxima conquista pendente.
                            </span>
                          </span>
                        </div>
                      </label>

                      <label
                        className={`cursor-pointer rounded-xl border p-4 transition ${
                          values.nextAchievementMode === "manual"
                            ? "border-red-500/35 bg-red-500/[0.08]"
                            : "border-white/10 bg-white/[0.02] hover:border-white/20"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <input
                            type="radio"
                            name="next-achievement-mode"
                            checked={values.nextAchievementMode === "manual"}
                            onChange={() =>
                              setDraft({
                                ...values,
                                nextAchievementMode: "manual",
                                nextAchievement:
                                  manualNextAchievementTitle ||
                                  nextAchievementOptions.find(
                                    (achievement) =>
                                      !["completed", "concluido", "concluida"].includes(
                                        String(achievement.status || "").toLowerCase()
                                      )
                                  )?.title ||
                                  "",
                              })
                            }
                            className="mt-1 accent-red-500"
                          />
                          <span>
                            <span className="block text-[11px] font-black uppercase tracking-[0.12em] text-white">
                              Definir manualmente
                            </span>
                            <span className="mt-1 block text-[10px] leading-relaxed text-white/35">
                              Escolha exatamente qual conquista será destacada.
                            </span>
                          </span>
                        </div>
                      </label>
                    </div>

                    {values.nextAchievementMode === "manual" ? (
                      <label className="mt-4 block">
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/30">
                          Conquista definida
                        </span>
                        <select
                          value={values.nextAchievement}
                          onChange={(event) =>
                            setDraft({
                              ...values,
                              nextAchievement: event.target.value,
                            })
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm font-bold text-white outline-none focus:border-red-500/40"
                        >
                          <option value="">Selecione uma conquista...</option>
                          {nextAchievementOptions.map((achievement) => (
                            <option
                              key={String(achievement.id || achievement.title)}
                              value={String(achievement.title)}
                            >
                              {String(achievement.title)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>

                  <div className="mt-5 flex justify-end"><button type="button" disabled={saving} onClick={saveBasics} className="rounded-xl border border-red-500/30 bg-red-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-100 hover:bg-red-500/20 disabled:opacity-50">{saving ? "Salvando..." : "Salvar dados do jogo"}</button></div>
                    </>
                  )}
                </section>

                <section className="rounded-[20px] border border-red-500/20 bg-red-500/[0.035] p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <button
                      type="button"
                      onClick={() => toggleAdminSection("02")}
                      aria-expanded={!collapsedSections["02"]}
                      className="group flex min-w-0 flex-1 items-start justify-between gap-4 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[9px] font-black uppercase tracking-[0.18em] text-red-400">02</span>
                        <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-red-100">Jornada de Estreia</span>
                        {!collapsedSections["02"] && (
                          <span className="mt-1 max-w-[760px] text-xs leading-relaxed text-white/45">Controla a tela exibida enquanto o jogo está sendo jogado pela primeira vez. Este é o primeiro módulo novo do Admin.</span>
                        )}
                      </span>
                      <span aria-hidden="true" className="mt-1 text-lg font-black text-white/45 transition-colors group-hover:text-red-300">
                        {collapsedSections["02"] ? "+" : "−"}
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={saving} onClick={toggleJourney} aria-pressed={journeyActive(selectedGame)} className={journeyActive(selectedGame) ? "flex min-w-[230px] items-center justify-between gap-4 rounded-2xl border border-red-500/35 bg-red-500/10 px-4 py-3 disabled:opacity-50" : "flex min-w-[230px] items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 disabled:opacity-50"}>
                      <span className="text-left"><span className="block text-[8px] font-black uppercase tracking-[0.16em] text-white/30">Estado</span><span className={journeyActive(selectedGame) ? "mt-1 block text-sm font-black text-red-100" : "mt-1 block text-sm font-black text-white/60"}>{journeyActive(selectedGame) ? "Estamos jogando" : "Página normal"}</span></span>
                      <span className={journeyActive(selectedGame) ? "relative h-7 w-12 rounded-full bg-red-500/20" : "relative h-7 w-12 rounded-full bg-black/30"}><span className={journeyActive(selectedGame) ? "absolute left-6 top-1 h-5 w-5 rounded-full bg-red-400" : "absolute left-1 top-1 h-5 w-5 rounded-full bg-white/30"} /></span>
                    </button>
                    </div>
                  </div>
                  {!collapsedSections["02"] && (
                    <>
                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Ativa</p><p className="mt-2 text-sm font-black">Mostra o aviso de Jornada de Estreia.</p></div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Desativada</p><p className="mt-2 text-sm font-black">Libera a página normal do jogo.</p></div>
                    <div className="rounded-xl border border-white/[0.07] bg-black/20 p-4"><p className="text-[8px] font-black uppercase tracking-[0.15em] text-white/25">Próximo passo</p><p className="mt-2 text-sm font-black">A próxima conquista agora pode ser automática ou definida manualmente.</p></div>
                  </div>
                  {journeyCompleted && (
                    <div className="mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.035] p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300/75">
                            Jornada concluída
                          </p>
                          <p className="mt-1 text-sm font-black text-white">
                            {journeySelectionFinalized
                              ? `${journeyDraftIds.length} ${journeyDraftIds.length === 1 ? "conquista definida" : "conquistas definidas"} para a Jornada de Estreia.`
                              : "Agora escolha quais conquistas realmente fizeram parte da sua primeira jornada."}
                          </p>
                          <p className="mt-1 text-[10px] leading-relaxed text-white/35">
                            Durante a primeira jogada, nada é decidido. A seleção abaixo só passa a bloquear visualmente as demais conquistas depois que você salvar.
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void saveJourneySelection()}
                          className="shrink-0 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-[9px] font-black uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-400/20 disabled:opacity-50"
                        >
                          {saving
                            ? "Salvando..."
                            : journeySelectionFinalized
                              ? "Atualizar seleção"
                              : "Definir Jornada de Estreia"}
                        </button>
                      </div>
                    </div>
                  )}
                    </>
                  )}
                </section>

                <NewGameAchievementsEditor
                  key={selectedGame.slug}
                  game={selectedGame}
                  journeyIds={journeyDraftIds}
                  manualRecords={manualAchievementRecords}
                  journeySelectionEnabled={journeyCompleted}
                  onJourneyIdsChange={setJourneyDraftIds}
                  collapsed={Boolean(collapsedSections["03"])}
                  onToggle={() => toggleAdminSection("03")}
                  onSave={(update) => updateGame(selectedGame.slug, update)}
                />

                <FinalMasteryEditor
                  key={"mastery-" + selectedGame.slug}
                  game={selectedGame}
                  collapsed={Boolean(collapsedSections["04"])}
                  onToggle={() => toggleAdminSection("04")}
                  onSave={(finalBadge) =>
                    updateFinalMastery(selectedGame.slug, finalBadge)
                  }
                />

                <GameEmblemEditor
                  key={"emblem-" + selectedGame.slug}
                  game={selectedGame}
                  collapsed={Boolean(collapsedSections["05"])}
                  onToggle={() => toggleAdminSection("05")}
                  onSave={(emblem) => updateEmblem(selectedGame.slug, emblem)}
                />

                <section className="rounded-[20px] border border-white/[0.08] bg-[#090909] p-5">
                  <button
                    type="button"
                    onClick={() => toggleAdminSection("06")}
                    aria-expanded={!collapsedSections["06"]}
                    className="group flex w-full items-center justify-between gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                  >
                    <span className="flex flex-col">
                      <span className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35">06</span>
                      <span className="mt-1 text-xl font-black text-white transition-colors group-hover:text-red-100">Review</span>
                    </span>
                    <span aria-hidden="true" className="text-lg font-black text-white/45 transition-colors group-hover:text-red-300">
                      {collapsedSections["06"] ? "+" : "−"}
                    </span>
                  </button>
                  {!collapsedSections["06"] && reviewValues && (
                    <div className="mt-5 space-y-4">
                      <p className="text-xs leading-relaxed text-white/45">
                        A nota e a frase curta alimentam o cartão de avaliação na página do jogo. Ao clicar em “Ler review completo”, o visitante abre a página exclusiva com o texto integral da análise. A frase curta aceita até 100 caracteres.
                      </p>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">Status da review</span>
                          <select
                            value={reviewValues.status}
                            onChange={(event) => patchReviewDraft({ status: event.target.value })}
                            className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.status !== "bloqueada" ? reviewValues.status : "")}
                          >
                            <option value="bloqueada">Bloqueada</option>
                            <option value="em-andamento">Em andamento</option>
                            <option value="liberada">Liberada / Publicada</option>
                          </select>
                        </label>

                        <label className="block">
                          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">10. Nota final (0 a 10)</span>
                          <input
                            type="number"
                            min="0"
                            max="10"
                            step="0.5"
                            value={reviewValues.nota}
                            onChange={(event) => patchReviewDraft({ nota: event.target.value })}
                            placeholder="Ex.: 8,5"
                            className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.nota)}
                          />
                        </label>
                      </div>

                      <section className="rounded-2xl border border-white/[0.08] bg-black/20 p-4 sm:p-5">
                        <div className="mb-4">
                          <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-300">Ficha de review</p>
                          <h3 className="mt-1 text-lg font-black text-white">Rumo à Conquista</h3>
                          <p className="mt-1 text-xs leading-relaxed text-white/45">
                            Preencha no seu ritmo. Use “Salvar rascunho” para continuar outro dia; o rascunho é privado e não publica a review.
                          </p>
                        </div>

                        <label className="block">
                          <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">1. Nome do jogo</span>
                          <input
                            value={reviewValues.fichaNomeJogo || selectedGame.title}
                            readOnly
                            className="mt-2 w-full cursor-not-allowed rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm font-bold text-white/65 outline-none"
                          />
                        </label>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">2. História e narrativa</span>
                            <textarea value={reviewValues.historia} onChange={(event) => patchReviewDraft({ historia: event.target.value })} rows={4} placeholder="História, personagens e maneira de contar..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.historia)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">3. Jogabilidade</span>
                            <textarea value={reviewValues.jogabilidade} onChange={(event) => patchReviewDraft({ jogabilidade: event.target.value })} rows={4} placeholder="Controles, combate, exploração e mecânicas..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.jogabilidade)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">4. Gráficos e direção artística</span>
                            <textarea value={reviewValues.direcaoArtistica} onChange={(event) => patchReviewDraft({ direcaoArtistica: event.target.value })} rows={4} placeholder="Cenários, personagens, animações e estilo visual..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.direcaoArtistica)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">5. Trilha sonora e áudio</span>
                            <textarea value={reviewValues.trilhaSonora} onChange={(event) => patchReviewDraft({ trilhaSonora: event.target.value })} rows={4} placeholder="Músicas, efeitos sonoros e dublagem..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.trilhaSonora)} />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">6. Progressão e conquistas</span>
                            <textarea value={reviewValues.progressaoConquistas} onChange={(event) => patchReviewDraft({ progressaoConquistas: event.target.value })} rows={3} placeholder="Evolução, busca pelas conquistas, repetição e desafios..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.progressaoConquistas)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">7. Pontos positivos</span>
                            <textarea value={reviewValues.positivos} onChange={(event) => patchReviewDraft({ positivos: event.target.value })} rows={3} placeholder="O que mais gostou..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.positivos)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">8. Pontos negativos</span>
                            <textarea value={reviewValues.negativos} onChange={(event) => patchReviewDraft({ negativos: event.target.value })} rows={3} placeholder="O que incomodou ou poderia melhorar..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.negativos)} />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">9. Experiência pessoal</span>
                            <textarea value={reviewValues.experienciaPessoal} onChange={(event) => patchReviewDraft({ experienciaPessoal: event.target.value })} rows={3} placeholder="Como se sentiu ao terminar? Surpreendeu, emocionou, cansou ou marcou você?" className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.experienciaPessoal)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">11. Recomendaria o jogo?</span>
                            <select value={reviewValues.recomendacao} onChange={(event) => patchReviewDraft({ recomendacao: event.target.value })} className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.recomendacao !== "Depende" ? reviewValues.recomendacao : "")}>
                              <option value="Sim">Sim</option>
                              <option value="Não">Não</option>
                              <option value="Depende">Depende</option>
                            </select>
                            <textarea value={reviewValues.recomendacaoExplicacao} onChange={(event) => patchReviewDraft({ recomendacaoExplicacao: event.target.value })} rows={3} placeholder="Explique brevemente sua recomendação..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.recomendacaoExplicacao)} />
                          </label>
                          <label className="block">
                            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">12. Resumo da experiência em uma frase</span>
                            <textarea value={reviewValues.fraseExperiencia} onChange={(event) => patchReviewDraft({ fraseExperiencia: event.target.value })} rows={3} placeholder="Descreva o jogo ou sua experiência em poucas palavras..." className={"mt-2 w-full resize-y rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.fraseExperiencia)} />
                          </label>
                        </div>
                      </section>

                      <label className="block">
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white/40">Título da review</span>
                        <input
                          value={reviewValues.titulo}
                          onChange={(event) => patchReviewDraft({ titulo: event.target.value })}
                          placeholder="Ex.: Divertido, mas repetitivo"
                          className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.titulo)}
                        />
                      </label>

                      <label className="block">
                        <span className="flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.16em] text-white/40">
                          <span>Frase curta do cartão</span>
                          <span>{reviewValues.fraseCartao.length}/100</span>
                        </span>
                        <input value={reviewValues.fraseCartao} maxLength={100} onChange={(event) => patchReviewDraft({ fraseCartao: event.target.value.slice(0, 100) })} placeholder="Uma frase de impacto para o cartão da biblioteca." className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.fraseCartao)} />
                      </label>

                      <label className="block">
                        <span className="flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.16em] text-white/40">
                          <span>Frase curta do cartão na página do jogo</span>
                          <span>{reviewValues.resumo.length}/100</span>
                        </span>
                        <input
                          value={reviewValues.resumo}
                          maxLength={100}
                          onChange={(event) => patchReviewDraft({ resumo: event.target.value.slice(0, 100) })}
                          placeholder="Ex.: Uma experiência intensa, com atmosfera marcante."
                          className={"mt-2 w-full rounded-xl px-3 py-3 text-sm font-bold text-white outline-none " + reviewFieldTone(reviewValues.resumo)}
                        />
                      </label>

                      <div className="rounded-xl border border-red-500/20 bg-red-500/[0.035] p-4">
                        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-red-300">
                          Prévia do cartão na página do jogo
                        </p>
                        <div className="mt-3 rounded-xl border border-amber-400/20 bg-[#090909] p-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-white/70">
                            Minha avaliação
                          </p>
                          <div className="mt-3 flex flex-wrap items-end gap-3">
                            <div className="flex items-baseline gap-1">
                              <span className="text-3xl font-black leading-none text-white tabular-nums">
                                {reviewValues.nota.trim() || "—"}
                              </span>
                              <span className="text-[11px] font-bold text-white/40">/10</span>
                            </div>
                            <div className="pb-0.5">
                              <div className="flex items-center gap-0.5" aria-label="Prévia das estrelas">
                                {Array.from({ length: 5 }, (_, index) => {
                                  const parsedScore = Number(reviewValues.nota.replace(",", "."));
                                  const scoreValid = reviewValues.nota.trim().length > 0 && Number.isFinite(parsedScore);
                                  const fill = scoreValid ? Math.max(0, Math.min(1, parsedScore / 2 - index)) : 0;
                                  return (
                                    <span
                                      key={index}
                                      className="text-[17px] leading-none"
                                      style={{
                                        backgroundImage: "linear-gradient(90deg, #fbbf24 " + fill * 100 + "%, rgba(255,255,255,0.16) " + fill * 100 + "%)",
                                        WebkitBackgroundClip: "text",
                                        backgroundClip: "text",
                                        color: "transparent",
                                      }}
                                    >
                                      ★
                                    </span>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                          <p className="mt-3 text-xs font-medium leading-relaxed text-white/65">
                            {reviewValues.resumo.trim() || "A frase curta aparecerá aqui quando você preencher o campo acima."}
                          </p>
                          <div className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2.5 text-[10px] font-black uppercase tracking-[0.1em] text-red-100">
                            Ler review completo <span aria-hidden="true">→</span>
                          </div>
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-white/35">
                          A prévia é ilustrativa. O cartão público só aparece quando a review está liberada, com nota válida e frase curta preenchida.
                        </p>
                      </div>

                      <label className="block">
                        <span className="flex items-center justify-between gap-3 text-[9px] font-black uppercase tracking-[0.16em] text-white/40">
                          <span>Resumo principal (aprox. 300 caracteres)</span>
                          <span>{reviewValues.texto.length} caracteres</span>
                        </span>
                        <textarea
                          value={reviewValues.texto}
                          onChange={(event) => patchReviewDraft({ texto: event.target.value })}
                          rows={6}
                          placeholder="Escreva sua análise completa do jogo..."
                          className={"mt-2 w-full rounded-xl px-3 py-3 text-sm leading-relaxed text-white outline-none " + reviewFieldTone(reviewValues.texto)}
                        />
                      </label>

                      {reviewGenerateError && (
                        <p role="alert" className="rounded-xl border border-red-500/25 bg-red-500/[0.08] px-4 py-3 text-sm leading-relaxed text-red-200">
                          {reviewGenerateError}
                        </p>
                      )}

                      <div className="flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-black/20 p-4">
                        <p aria-live="polite" className="text-xs leading-relaxed text-white/50">
                          {reviewDraftStatus || "O rascunho será privado. Gerar resumo não publica a review."}
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                          <button type="button" disabled={generatingReview || savingReviewDraft || saving} onClick={generateReviewSummary} className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-red-100 transition hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-50">
                            {generatingReview ? "Gerando resumo..." : "Gerar resumo"}
                          </button>
                          <button type="button" disabled={savingReviewDraft || generatingReview || saving} onClick={saveReviewDraft} className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-sky-100 transition hover:bg-sky-500/20 disabled:cursor-wait disabled:opacity-50">
                            {savingReviewDraft ? "Salvando rascunho..." : "Salvar rascunho"}
                          </button>
                          <button type="button" disabled={saving || savingReviewDraft || generatingReview} onClick={saveReview} className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-100 transition hover:bg-emerald-500/20 disabled:opacity-50">
                            {saving ? "Salvando..." : "Salvar / publicar review"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}