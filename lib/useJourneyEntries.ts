"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { journeyEntries as baseJourneyEntries } from "@/data/journeyEntries";

export type JourneyEntry = {
  id: string;
  gameTitle: string;
  gameSlug?: string;
  dayLabel: string;
  status: string;
  weekDay: string;
  date: string;
  title?: string;
  notes: string;
  highlight?: string;
  threadsUrl?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

export type JourneyEntryInput = {
  gameTitle: string;
  gameSlug?: string;
  dayLabel: string;
  status: string;
  weekDay: string;
  date: string;
  title?: string;
  notes: string;
  highlight?: string;
  threadsUrl?: string;
  tags: string[];
};

const JOURNEY_STORAGE_KEY = "rumo-a-conquista-journey-entries";

export const JOURNEY_UPDATED_EVENT =
  "rumo-a-conquista-journey-updated";

function createId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;

  if (typeof value === "number") {
    return String(value);
  }

  return fallback;
}

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => normalizeText(tag).trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizeStoredEntry(
  entry: Partial<JourneyEntry>
): JourneyEntry {
  const now = new Date().toISOString();

  return {
    id: normalizeText(entry.id, createId()),
    gameTitle: normalizeText(entry.gameTitle, "Jogo"),
    gameSlug: normalizeText(entry.gameSlug, ""),
    dayLabel: normalizeText(entry.dayLabel, "Dia 1"),
    status: normalizeText(
      entry.status,
      "🟣 AO VIVO - TWITCH"
    ),
    weekDay: normalizeText(
      entry.weekDay,
      "Segunda-feira"
    ),
    date: normalizeText(
      entry.date,
      now.slice(0, 10)
    ),
    title: normalizeText(entry.title, ""),
    notes: normalizeText(entry.notes, ""),
    highlight: normalizeText(entry.highlight, ""),
    threadsUrl: normalizeText(entry.threadsUrl, ""),
    tags: normalizeTags(entry.tags),
    createdAt: normalizeText(entry.createdAt, now),
    updatedAt: normalizeText(entry.updatedAt, now),
  };
}

function readLocalJourneyEntries() {
  if (typeof window === "undefined") {
    return baseJourneyEntries.map((entry) =>
      normalizeStoredEntry(entry)
    );
  }

  // Migração:
  // remove dados antigos do navegador
  // e carrega os dados oficiais do projeto
  localStorage.removeItem(JOURNEY_STORAGE_KEY);

  return baseJourneyEntries.map((entry) =>
    normalizeStoredEntry(entry)
  );
}


function saveLocalJourneyEntries(
  entries: JourneyEntry[]
) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(
    JOURNEY_STORAGE_KEY,
    JSON.stringify(entries)
  );

  window.dispatchEvent(
    new Event(JOURNEY_UPDATED_EVENT)
  );
}

function getDateTimeValue(entry: JourneyEntry) {
  const dateTime = new Date(entry.date).getTime();

  if (Number.isFinite(dateTime)) {
    return dateTime;
  }

  const createdTime = new Date(entry.createdAt).getTime();

  if (Number.isFinite(createdTime)) {
    return createdTime;
  }

  return 0;
}

function sortEntries(entries: JourneyEntry[]) {
  return [...entries].sort((a, b) => {
    const dateA = getDateTimeValue(a);
    const dateB = getDateTimeValue(b);

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return b.createdAt.localeCompare(a.createdAt);
  });
}

function normalizeEntryInput(
  input: JourneyEntryInput
): JourneyEntryInput {
  return {
    gameTitle: input.gameTitle.trim(),
    gameSlug: input.gameSlug?.trim() || "",
    dayLabel: input.dayLabel.trim(),
    status: input.status.trim(),
    weekDay: input.weekDay.trim(),
    date: input.date.trim(),
    title: input.title?.trim() || "",
    notes: input.notes.trim(),
    highlight: input.highlight?.trim() || "",
    threadsUrl: input.threadsUrl?.trim() || "",
    tags: normalizeTags(input.tags),
  };
}

export function useJourneyEntries() {
  const [entries, setEntries] = useState<JourneyEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadEntries = useCallback(() => {
    const savedEntries = readLocalJourneyEntries();

    setEntries(sortEntries(savedEntries));
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    loadEntries();

    window.addEventListener(
      JOURNEY_UPDATED_EVENT,
      loadEntries
    );

    window.addEventListener(
      "storage",
      loadEntries
    );

    window.addEventListener(
      "focus",
      loadEntries
    );

    return () => {
      window.removeEventListener(
        JOURNEY_UPDATED_EVENT,
        loadEntries
      );

      window.removeEventListener(
        "storage",
        loadEntries
      );

      window.removeEventListener(
        "focus",
        loadEntries
      );
    };
  }, [loadEntries]);

  const latestEntries = useMemo(() => {
    return sortEntries(entries).slice(0, 7);
  }, [entries]);

  const addEntry = useCallback(
    (input: JourneyEntryInput) => {
      const normalizedInput =
        normalizeEntryInput(input);

      if (
        !normalizedInput.gameTitle ||
        !normalizedInput.notes
      ) {
        return null;
      }

      const now = new Date().toISOString();

      const newEntry: JourneyEntry = {
        id: createId(),
        ...normalizedInput,
        createdAt: now,
        updatedAt: now,
      };

      const nextEntries = sortEntries([
        newEntry,
        ...entries,
      ]);

      setEntries(nextEntries);

      saveLocalJourneyEntries(nextEntries);

      return newEntry;
    },
    [entries]
  );

  const updateEntry = useCallback(
    (
      entryId: string,
      input: JourneyEntryInput
    ) => {
      const normalizedInput =
        normalizeEntryInput(input);

      const nextEntries = sortEntries(
        entries.map((entry) => {
          if (entry.id !== entryId) {
            return entry;
          }

          return {
            ...entry,
            ...normalizedInput,
            updatedAt:
              new Date().toISOString(),
          };
        })
      );

      setEntries(nextEntries);

      saveLocalJourneyEntries(nextEntries);
    },
    [entries]
  );

  const removeEntry = useCallback(
    (entryId: string) => {
      const nextEntries = entries.filter(
        (entry) => entry.id !== entryId
      );

      setEntries(nextEntries);

      saveLocalJourneyEntries(nextEntries);
    },
    [entries]
  );

  const clearEntries = useCallback(() => {
    setEntries([]);

    saveLocalJourneyEntries([]);
  }, []);

  return {
    entries,
    latestEntries,
    isLoaded,
    addEntry,
    updateEntry,
    removeEntry,
    clearEntries,
  };
}