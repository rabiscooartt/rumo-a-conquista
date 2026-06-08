"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import GamePageClient from "@/components/GamePageClient";
import { type FlexibleAchievementInput, useSiteGames } from "@/lib/useSiteGames";
import { type AchievementInput } from "@/components/GameAchievementsPanel";
import { type ReviewInput } from "@/components/GameReviewPanel";

type GameEmblemInput = {
  title?: string;
  image?: string;
  description?: string;
  tags?: string[] | string;
};

type FinalBadgeInput = {
  title?: string;
  icon?: string;
  image?: string;
};

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function readNumber(value: unknown, fallback = 0) {
  const number = Number(value);

  if (Number.isFinite(number)) {
    return number;
  }

  return fallback;
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalizedValue = value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    if (
      [
        "true",
        "1",
        "sim",
        "yes",
        "oculta",
        "oculto",
        "hidden",
        "secret",
        "secreta",
        "secreto",
      ].includes(normalizedValue)
    ) {
      return true;
    }

    if (
      [
        "false",
        "0",
        "nao",
        "não",
        "no",
        "visivel",
        "visível",
        "visible",
      ].includes(normalizedValue)
    ) {
      return false;
    }
  }

  return fallback;
}

function readStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  const text = readText(value, "");

  if (!text.trim()) {
    return [];
  }

  return text
    .split(/[\n,;]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStatus(status?: string) {
  const value = readText(status, "progress")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  if (
    value === "completed" ||
    value === "finalizado" ||
    value === "concluido"
  ) {
    return "completed";
  }

  if (value === "planned" || value === "backlog" || value === "futuro") {
    return "planned";
  }

  return "progress";
}

function normalizeRank(value?: string) {
  const rank = readText(value, "Bronze");

  if (rank === "Diamante") {
    return "Extrema";
  }

  if (rank === "Ouro") {
    return "Difícil";
  }

  if (rank === "Prata") {
    return "Média";
  }

  return rank;
}

function getTrophyFromRank(value?: string) {
  const rank = readText(value, "Bronze");

  if (rank === "Diamante" || rank === "Extrema") {
    return "💎";
  }

  if (rank === "Ouro" || rank === "Difícil") {
    return "🥇";
  }

  if (rank === "Prata" || rank === "Média") {
    return "🥈";
  }

  return "🥉";
}

function normalizeAchievement(
  achievement: FlexibleAchievementInput,
  index: number
): AchievementInput {
  const achievementRecord = achievement as FlexibleAchievementInput & {
    isHidden?: boolean;
    hidden?: boolean;
    isSecret?: boolean;
    secret?: boolean;
  };

  const title = readText(achievement.title, `Conquista ${index + 1}`);

  const difficulty =
    readText(achievement.difficulty, "") ||
    readText(achievement.rank, "Bronze");

  const trophy =
    readText(achievement.trophy, "") ||
    readText(achievement.icon, "") ||
    getTrophyFromRank(difficulty);

  return {
    id: readText(achievement.id, `${title}-${index}`),
    title,
    description: readText(
      achievement.description,
      "Descrição da conquista ainda não definida."
    ),
    trophy,
    difficulty: normalizeRank(difficulty),
    status: readText(achievement.status, "locked"),
    earnedDate: readText(achievement.earnedDate, ""),
    icon: trophy,
    image: readText(achievement.image, ""),
    isCustom: Boolean(achievement.isCustom ?? true),

    // IMPORTANTE:
    // Esse campo é o que faz a página pública saber que a conquista deve ficar oculta.
    isHidden:
      readBoolean(achievementRecord.isHidden, false) ||
      readBoolean(achievementRecord.hidden, false) ||
      readBoolean(achievementRecord.isSecret, false) ||
      readBoolean(achievementRecord.secret, false),
  } as AchievementInput;
}

function normalizeReviewList(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((item) => readText(item, "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[\n,;]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeReview(rawReview: unknown): ReviewInput {
  if (!rawReview || typeof rawReview !== "object") {
    return {
      status: "pendente",
      nota: "",
      titulo: "Análise da Jornada",
      texto:
        "Review completa da jornada, com pontos fortes, pontos fracos e experiência geral do jogo.",
      positivos: [],
      negativos: [],
    };
  }

  const review = rawReview as ReviewInput;

  return {
    status: review.status ?? "pendente",
    nota: review.nota ?? "",
    titulo: review.titulo ?? "Análise da Jornada",
    texto:
      review.texto ??
      review.resumo ??
      "Review completa da jornada, com pontos fortes, pontos fracos e experiência geral do jogo.",
    resumo: review.resumo,
    positivos: normalizeReviewList(review.positivos ?? review.pontosFortes),
    negativos: normalizeReviewList(review.negativos ?? review.pontosFracos),
    pontosFortes: review.pontosFortes,
    pontosFracos: review.pontosFracos,
  };
}

function getGameEmblem(rawGame: unknown, slug: string): GameEmblemInput | undefined {
  const game = rawGame as {
    emblem?: GameEmblemInput;
    gameEmblem?: GameEmblemInput;
    emblemTitle?: string;
    emblemImage?: string;
    emblemDescription?: string;
    emblemTags?: string[] | string;
  };

  const savedEmblem = game.emblem;

  if (
    savedEmblem &&
    (savedEmblem.title ||
      savedEmblem.image ||
      savedEmblem.description ||
      readStringList(savedEmblem.tags).length > 0)
  ) {
    return {
      title: readText(savedEmblem.title, "Emblema do Jogo"),
      image: readText(savedEmblem.image, ""),
      description: readText(savedEmblem.description, ""),
      tags: readStringList(savedEmblem.tags),
    };
  }

  if (
    game.gameEmblem &&
    (game.gameEmblem.title ||
      game.gameEmblem.image ||
      game.gameEmblem.description ||
      readStringList(game.gameEmblem.tags).length > 0)
  ) {
    return {
      title: readText(game.gameEmblem.title, "Emblema do Jogo"),
      image: readText(game.gameEmblem.image, ""),
      description: readText(game.gameEmblem.description, ""),
      tags: readStringList(game.gameEmblem.tags),
    };
  }

  if (
    game.emblemTitle ||
    game.emblemImage ||
    game.emblemDescription ||
    readStringList(game.emblemTags).length > 0
  ) {
    return {
      title: readText(game.emblemTitle, "Emblema do Jogo"),
      image: readText(game.emblemImage, ""),
      description: readText(game.emblemDescription, ""),
      tags: readStringList(game.emblemTags),
    };
  }

  if (slug === "hogwarts-legacy") {
    return {
      title: "Legado Absoluto",
      image: "/images/games/howgarts-legacy/emblem.png",
      description:
        "Uma relíquia simbólica concedida ao bruxo que explorou Hogwarts por completo, dominou seus desafios e revelou todos os segredos deixados pelo legado mágico. O Legado Absoluto representa a conclusão definitiva da jornada e a marca de quem se tornou um verdadeiro guardião dessa história.",
      tags: ["Colecionável", "Emblema Especial", "Hogwarts Legacy"],
    };
  }

  return undefined;
}

function getFinalBadge(rawGame: unknown): FinalBadgeInput | undefined {
  const game = rawGame as {
    finalBadge?: FinalBadgeInput;
  };

  if (!game.finalBadge) {
    return undefined;
  }

  return {
    title: readText(game.finalBadge.title, "Maestria Final"),
    icon: readText(game.finalBadge.icon, "💎"),
    image: readText(game.finalBadge.image, ""),
  };
}

export default function GamePage() {
  const params = useParams();
  const slug = String(params?.slug || "");

  const { gamesMap, isLoaded } = useSiteGames();

  const game = gamesMap[slug];

  const formattedGame = useMemo(() => {
    if (!game) {
      return null;
    }

    const achievementsList = Array.isArray(game.achievementsList)
      ? game.achievementsList.map((achievement, index) =>
          normalizeAchievement(achievement, index)
        )
      : [];

    const progress = readNumber(game.progress, 0);
    const status = normalizeStatus(readText(game.status, "progress"));

    const completedAchievements = achievementsList.filter(
      (achievement) => achievement.status === "completed"
    ).length;

    return {
      title: readText(game.title, "Jogo sem nome"),
      subtitle: readText(game.subtitle, ""),
      image: readText(game.image, "") || `/images/games/${slug}/banner.jpg`,
      cardImage: readText(game.cardImage, ""),
      achievements:
        achievementsList.length > 0
          ? `${completedAchievements}/${achievementsList.length}`
          : "0/0",
      progress,
      mastery:
        status === "completed" || progress >= 100
          ? "Concluída"
          : "Em andamento",
      hours: readText(game.hours, "0h"),
      status,
      nextMission:
        readText(game.currentObjective, "") ||
        readText(game.objective, "") ||
        "Definir próximo objetivo",
      currentObjective: readText(game.currentObjective, ""),
      objective: readText(game.objective, ""),
      achievementsList,
      review: normalizeReview(game.review),
      finalBadge: getFinalBadge(game),
      emblem: getGameEmblem(game, slug),
    };
  }, [game, slug]);

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
        <Navbar />

        <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
          <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-8 text-white/50">
            Carregando jogo...
          </div>
        </section>
      </main>
    );
  }

  if (!formattedGame) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
        <Navbar />

        <section className="mx-auto w-full max-w-[1500px] px-8 py-10">
          <Link
            href="/biblioteca"
            className="inline-flex rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-black text-red-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300"
          >
            ← Voltar para Biblioteca
          </Link>

          <div className="mt-8 rounded-[28px] border border-red-500/20 bg-red-500/5 p-8">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
              Jogo não encontrado
            </p>

            <h1 className="mt-3 text-4xl font-black text-white">
              Esse jogo não existe ou foi removido
            </h1>

            <p className="mt-3 max-w-[720px] text-sm leading-relaxed text-white/50">
              O slug procurado foi:{" "}
              <span className="font-black text-red-200">{slug}</span>.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/admin/jogos"
                className="rounded-xl border border-red-500/35 bg-red-500/15 px-5 py-3 text-sm font-black text-red-100 transition hover:bg-red-500/25"
              >
                Ir para Admin Jogos
              </Link>

              <Link
                href="/biblioteca"
                className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-black text-white/65 transition hover:border-white/20 hover:text-white"
              >
                Ver Biblioteca
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return <GamePageClient slug={slug} game={formattedGame} />;
}