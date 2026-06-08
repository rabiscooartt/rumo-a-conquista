"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sagasList as baseSagas } from "@/data/sagas";

export type SagaAccent = "red" | "cyan" | "yellow" | "purple" | "emerald";

export type SiteSagaStage = {
  id: string;
  title: string;
  description?: string;
  gameSlugs: string[];
};

export type SiteSaga = {
  slug: string;
  title: string;
  subtitle: string;
  description?: string;
  accent: SagaAccent | string;
  badgeImage: string;
  coverImage?: string;
  fallbackIcon: string;
  stages: SiteSagaStage[];
  [key: string]: unknown;
};

export type SagaFormInput = {
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  badgeImage: string;
  coverImage: string;
  fallbackIcon: string;
};

const CUSTOM_SAGAS_KEY = "rumo-a-conquista-custom-sagas";
const HIDDEN_SAGAS_KEY = "rumo-a-conquista-hidden-sagas";
const DELETED_SAGAS_KEY = "rumo-a-conquista-deleted-sagas";
const SAGAS_UPDATED_EVENT = "rumo-a-conquista-sagas-updated";

export function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function normalizeStages(stages: unknown): SiteSagaStage[] {
  if (!Array.isArray(stages)) {
    return [
      {
        id: "principal",
        title: "Jogos da Saga",
        description: "",
        gameSlugs: [],
      },
    ];
  }

  const normalizedStages = stages.map((stage, index) => {
    const stageRecord =
      typeof stage === "object" && stage !== null
        ? (stage as Record<string, unknown>)
        : {};

    const rawGameSlugs = stageRecord.gameSlugs;

    const gameSlugs = Array.isArray(rawGameSlugs)
      ? rawGameSlugs.filter((item): item is string => typeof item === "string")
      : [];

    return {
      id: readText(stageRecord.id, `stage-${index + 1}`),
      title: readText(stageRecord.title, "Jogos da Saga"),
      description: readText(stageRecord.description, ""),
      gameSlugs,
    };
  });

  if (normalizedStages.length === 0) {
    return [
      {
        id: "principal",
        title: "Jogos da Saga",
        description: "",
        gameSlugs: [],
      },
    ];
  }

  return normalizedStages;
}

function normalizeSaga(slug: string, saga: Partial<SiteSaga>): SiteSaga {
  const finalSlug = readText(saga.slug, slug);
  const title = readText(saga.title, "Saga sem nome");
  const subtitle = readText(saga.subtitle, "Jornada da conquista");
  const description = readText(saga.description, "");
  const accent = readText(saga.accent, "red");
  const fallbackIcon = readText(saga.fallbackIcon, "🏆");

  const badgeImage =
    readText(saga.badgeImage, "") || `/images/sagas/${finalSlug}/badge.jpg`;

  const coverImage =
    readText(saga.coverImage, "") || `/images/sagas/${finalSlug}/cover.jpg`;

  return {
    ...saga,
    slug: finalSlug,
    title,
    subtitle,
    description,
    accent,
    badgeImage,
    coverImage,
    fallbackIcon,
    stages: normalizeStages(saga.stages),
  };
}

function readCustomSagas() {
  if (typeof window === "undefined") return {};

  const saved = localStorage.getItem(CUSTOM_SAGAS_KEY);
  if (!saved) return {};

  try {
    return JSON.parse(saved) as Record<string, SiteSaga>;
  } catch {
    return {};
  }
}

function readHiddenSagas() {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(HIDDEN_SAGAS_KEY);
  if (!saved) return [];

  try {
    return JSON.parse(saved) as string[];
  } catch {
    return [];
  }
}

function readDeletedSagas() {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(DELETED_SAGAS_KEY);
  if (!saved) return [];

  try {
    return JSON.parse(saved) as string[];
  } catch {
    return [];
  }
}

export function useSiteSagas() {
  const [customSagas, setCustomSagas] = useState<Record<string, SiteSaga>>({});
  const [hiddenSagaSlugs, setHiddenSagaSlugs] = useState<string[]>([]);
  const [deletedSagaSlugs, setDeletedSagaSlugs] = useState<string[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const baseSagasMap = useMemo(() => {
    const entries = (baseSagas as Partial<SiteSaga>[]).map((saga) => {
      const slug = readText(saga.slug, slugify(readText(saga.title, "saga")));
      return [slug, normalizeSaga(slug, saga)] as const;
    });

    return entries.reduce<Record<string, SiteSaga>>((acc, [slug, saga]) => {
      acc[slug] = saga;
      return acc;
    }, {});
  }, []);

  const loadSagas = useCallback(() => {
    setCustomSagas(readCustomSagas());
    setHiddenSagaSlugs(readHiddenSagas());
    setDeletedSagaSlugs(readDeletedSagas());
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    loadSagas();

    window.addEventListener(SAGAS_UPDATED_EVENT, loadSagas);
    window.addEventListener("storage", loadSagas);
    window.addEventListener("focus", loadSagas);

    return () => {
      window.removeEventListener(SAGAS_UPDATED_EVENT, loadSagas);
      window.removeEventListener("storage", loadSagas);
      window.removeEventListener("focus", loadSagas);
    };
  }, [loadSagas]);

  function emitUpdate() {
    window.dispatchEvent(new Event(SAGAS_UPDATED_EVENT));
  }

  function persistCustomSagas(nextCustomSagas: Record<string, SiteSaga>) {
    localStorage.setItem(CUSTOM_SAGAS_KEY, JSON.stringify(nextCustomSagas));
    setCustomSagas(nextCustomSagas);
    emitUpdate();
  }

  function persistHiddenSagas(nextHiddenSagaSlugs: string[]) {
    localStorage.setItem(HIDDEN_SAGAS_KEY, JSON.stringify(nextHiddenSagaSlugs));
    setHiddenSagaSlugs(nextHiddenSagaSlugs);
    emitUpdate();
  }

  function persistDeletedSagas(nextDeletedSagaSlugs: string[]) {
    localStorage.setItem(DELETED_SAGAS_KEY, JSON.stringify(nextDeletedSagaSlugs));
    setDeletedSagaSlugs(nextDeletedSagaSlugs);
    emitUpdate();
  }

  const allSagasMap = useMemo(() => {
    const mergedSagas: Record<string, SiteSaga> = {
      ...baseSagasMap,
      ...customSagas,
    };

    deletedSagaSlugs.forEach((slug) => {
      delete mergedSagas[slug];
    });

    return mergedSagas;
  }, [baseSagasMap, customSagas, deletedSagaSlugs]);

  const sagasMap = useMemo(() => {
    const visibleSagas: Record<string, SiteSaga> = {
      ...allSagasMap,
    };

    hiddenSagaSlugs.forEach((slug) => {
      delete visibleSagas[slug];
    });

    return visibleSagas;
  }, [allSagasMap, hiddenSagaSlugs]);

  const allSagasList = useMemo(() => {
    return Object.values(allSagasMap);
  }, [allSagasMap]);

  const sagasList = useMemo(() => {
    return Object.values(sagasMap);
  }, [sagasMap]);

  const hiddenSagasList = useMemo(() => {
    return hiddenSagaSlugs
      .map((slug) => allSagasMap[slug])
      .filter((saga): saga is SiteSaga => Boolean(saga));
  }, [hiddenSagaSlugs, allSagasMap]);

  function addSaga(input: SagaFormInput) {
    const slug = slugify(input.slug || input.title);

    if (!slug) {
      alert("Digite um nome ou slug para a saga.");
      return false;
    }

    const normalizedSaga = normalizeSaga(slug, {
      slug,
      title: input.title.trim() || "Saga sem nome",
      subtitle: input.subtitle.trim() || "Jornada da conquista",
      description: input.description.trim(),
      accent: input.accent || "red",
      badgeImage: input.badgeImage.trim() || `/images/sagas/${slug}/badge.jpg`,
      coverImage: input.coverImage.trim() || `/images/sagas/${slug}/cover.jpg`,
      fallbackIcon: input.fallbackIcon.trim() || "🏆",
      stages: [
        {
          id: "principal",
          title: "Jogos da Saga",
          description: "",
          gameSlugs: [],
        },
      ],
    });

    const nextCustomSagas = {
      ...customSagas,
      [slug]: normalizedSaga,
    };

    const nextHiddenSagaSlugs = hiddenSagaSlugs.filter((item) => item !== slug);
    const nextDeletedSagaSlugs = deletedSagaSlugs.filter((item) => item !== slug);

    localStorage.setItem(CUSTOM_SAGAS_KEY, JSON.stringify(nextCustomSagas));
    localStorage.setItem(HIDDEN_SAGAS_KEY, JSON.stringify(nextHiddenSagaSlugs));
    localStorage.setItem(DELETED_SAGAS_KEY, JSON.stringify(nextDeletedSagaSlugs));

    setCustomSagas(nextCustomSagas);
    setHiddenSagaSlugs(nextHiddenSagaSlugs);
    setDeletedSagaSlugs(nextDeletedSagaSlugs);

    emitUpdate();

    return true;
  }

  function updateSaga(slug: string, update: Partial<SiteSaga>) {
    const currentSaga = allSagasMap[slug] || baseSagasMap[slug] || customSagas[slug];

    if (!currentSaga) return;

    const nextSaga = normalizeSaga(slug, {
      ...currentSaga,
      ...update,
      slug,
    });

    const nextCustomSagas = {
      ...customSagas,
      [slug]: nextSaga,
    };

    persistCustomSagas(nextCustomSagas);
  }

  function removeSaga(slug: string) {
    const nextHiddenSagaSlugs = Array.from(new Set([...hiddenSagaSlugs, slug]));
    persistHiddenSagas(nextHiddenSagaSlugs);
  }

  function deleteSagaPermanently(slug: string) {
    const nextCustomSagas = { ...customSagas };
    delete nextCustomSagas[slug];

    const nextHiddenSagaSlugs = hiddenSagaSlugs.filter((item) => item !== slug);

    const nextDeletedSagaSlugs = Array.from(new Set([...deletedSagaSlugs, slug]));

    localStorage.setItem(CUSTOM_SAGAS_KEY, JSON.stringify(nextCustomSagas));
    localStorage.setItem(HIDDEN_SAGAS_KEY, JSON.stringify(nextHiddenSagaSlugs));
    localStorage.setItem(DELETED_SAGAS_KEY, JSON.stringify(nextDeletedSagaSlugs));

    setCustomSagas(nextCustomSagas);
    setHiddenSagaSlugs(nextHiddenSagaSlugs);
    setDeletedSagaSlugs(nextDeletedSagaSlugs);

    emitUpdate();
  }

  function restoreSaga(slug: string) {
    const nextHiddenSagaSlugs = hiddenSagaSlugs.filter((item) => item !== slug);
    persistHiddenSagas(nextHiddenSagaSlugs);
  }

  function restoreAllSagas() {
    persistHiddenSagas([]);
  }

  function addGameToSaga(sagaSlug: string, gameSlug: string) {
    const saga = allSagasMap[sagaSlug];

    if (!saga || !gameSlug) return;

    const stages =
      saga.stages.length > 0
        ? saga.stages.map((stage) => ({ ...stage }))
        : normalizeStages([]);

    const firstStage = stages[0];

    if (firstStage.gameSlugs.includes(gameSlug)) return;

    stages[0] = {
      ...firstStage,
      gameSlugs: [...firstStage.gameSlugs, gameSlug],
    };

    updateSaga(sagaSlug, {
      stages,
    });
  }

  function removeGameFromSaga(sagaSlug: string, gameSlug: string) {
    const saga = allSagasMap[sagaSlug];

    if (!saga) return;

    const stages = saga.stages.map((stage) => ({
      ...stage,
      gameSlugs: stage.gameSlugs.filter((slug) => slug !== gameSlug),
    }));

    updateSaga(sagaSlug, {
      stages,
    });
  }

  function isCustomSaga(slug: string) {
    return Boolean(customSagas[slug]);
  }

  function isBaseSaga(slug: string) {
    return Boolean(baseSagasMap[slug]);
  }

  function isHiddenSaga(slug: string) {
    return hiddenSagaSlugs.includes(slug);
  }

  return {
    isLoaded,
    allSagasMap,
    allSagasList,
    sagasMap,
    sagasList,
    hiddenSagasList,
    hiddenBaseSagas: hiddenSagasList,
    customSagas,
    hiddenSagaSlugs,
    deletedSagaSlugs,
    addSaga,
    updateSaga,
    removeSaga,
    deleteSagaPermanently,
    restoreSaga,
    restoreAllSagas,
    addGameToSaga,
    removeGameFromSaga,
    isCustomSaga,
    isBaseSaga,
    isHiddenSaga,
  };
}