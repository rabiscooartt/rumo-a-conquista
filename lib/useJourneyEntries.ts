"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

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

export type JourneyEntryInput = Omit<JourneyEntry, "id" | "createdAt" | "updatedAt">;

function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) return [];

  return tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8);
}

function mapDatabaseEntry(entry: Record<string, unknown>): JourneyEntry {
  return {
    id: String(entry.id || ""),
    gameTitle: String(entry.gameTitle || ""),
    gameSlug: String(entry.gameSlug || ""),
    dayLabel: String(entry.dayLabel || ""),
    status: String(entry.status || ""),
    weekDay: String(entry.weekDay || ""),
    date: String(entry.date || ""),
    title: String(entry.title || ""),
    notes: String(entry.notes || ""),
    highlight: String(entry.highlight || ""),
    threadsUrl: String(entry.threadsUrl || ""),
    tags: normalizeTags(entry.tags),
    createdAt: String(entry.createdAt || ""),
    updatedAt: String(entry.updatedAt || ""),
  };
}

function normalizeInput(input: JourneyEntryInput): JourneyEntryInput {
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

function sortEntries(entries: JourneyEntry[]) {
  return [...entries].sort((a, b) => {
    const dateDifference = new Date(b.date).getTime() - new Date(a.date).getTime();
    return dateDifference || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

async function requestAdminJourney<T>(method: "POST" | "PATCH" | "DELETE", body: unknown) {
  const response = await fetch("/admin/api/jornada", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    | { entry?: Record<string, unknown>; error?: string }
    | null;

  if (!response.ok) {
    throw new Error(payload?.error || "Não foi possível salvar a anotação da Jornada.");
  }

  return payload as T;
}

export function useJourneyEntries() {
  const [entries, setEntries] = useState<JourneyEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  const loadEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from("journey_entries")
      .select("*")
      .order("date", { ascending: false });

    if (error) {
      console.error("Erro carregando jornada:", error);
      setIsLoaded(true);
      return;
    }

    setEntries(sortEntries((data || []).map((entry) => mapDatabaseEntry(entry))));
    setIsLoaded(true);
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const latestEntries = useMemo(() => sortEntries(entries).slice(0, 7), [entries]);

  const addEntry = useCallback(async (input: JourneyEntryInput) => {
    const normalizedInput = normalizeInput(input);
    if (!normalizedInput.gameTitle || !normalizedInput.notes) {
      throw new Error("Nome do jogo e anotações são obrigatórios.");
    }

    const payload = await requestAdminJourney<{ entry: Record<string, unknown> }>(
      "POST",
      normalizedInput
    );
    const entry = mapDatabaseEntry(payload.entry);
    setEntries((current) => sortEntries([entry, ...current]));
    return entry;
  }, []);

  const updateEntry = useCallback(async (entryId: string, input: JourneyEntryInput) => {
    const normalizedInput = normalizeInput(input);
    if (!normalizedInput.gameTitle || !normalizedInput.notes) {
      throw new Error("Nome do jogo e anotações são obrigatórios.");
    }

    const payload = await requestAdminJourney<{ entry: Record<string, unknown> }>(
      "PATCH",
      { id: entryId, entry: normalizedInput }
    );
    const updatedEntry = mapDatabaseEntry(payload.entry);
    setEntries((current) => sortEntries(current.map((entry) => entry.id === entryId ? updatedEntry : entry)));
    return updatedEntry;
  }, []);

  const removeEntry = useCallback(async (entryId: string) => {
    await requestAdminJourney("DELETE", { id: entryId });
    setEntries((current) => current.filter((entry) => entry.id !== entryId));
  }, []);

  const clearEntries = useCallback(async () => {
    await requestAdminJourney("DELETE", { all: true });
    setEntries([]);
  }, []);

  return { entries, latestEntries, isLoaded, addEntry, updateEntry, removeEntry, clearEntries };
}
