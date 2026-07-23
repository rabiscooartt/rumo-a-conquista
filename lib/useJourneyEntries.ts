"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

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


function normalizeTags(tags: unknown) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => String(tag).trim())
    .filter(Boolean)
    .slice(0, 8);
}

function mapDatabaseEntry(entry: any): JourneyEntry {
  return {
    id: entry.id,
    gameTitle: entry.gameTitle ?? "",
    gameSlug: entry.gameSlug ?? "",
    dayLabel: entry.dayLabel ?? "",
    status: entry.status ?? "",
    weekDay: entry.weekDay ?? "",
    date: entry.date ?? "",
    title: entry.title ?? "",
    notes: entry.notes ?? "",
    highlight: entry.highlight ?? "",
    threadsUrl: entry.threadsUrl ?? "",
    tags: normalizeTags(entry.tags),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}


function normalizeInput(
  input: JourneyEntryInput
): JourneyEntryInput {

  return {
    gameTitle: input.gameTitle.trim(),
    gameSlug: input.gameSlug?.trim() || "",
    dayLabel: input.dayLabel.trim(),
    status: input.status.trim(),
    weekDay: input.weekDay.trim(),
    date: input.date,
    title: input.title?.trim() || "",
    notes: input.notes.trim(),
    highlight: input.highlight?.trim() || "",
    threadsUrl: input.threadsUrl?.trim() || "",
    tags: normalizeTags(input.tags),
  };

}

function sortEntries(entries: JourneyEntry[]) {
  return [...entries].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return (
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
    );
  });
}


export function useJourneyEntries() {
  const [entries, setEntries] = useState<JourneyEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);


  const loadEntries = useCallback(async () => {

    const { data, error } = await supabase
      .from("journey_entries")
      .select("*")
      .order("date", {
        ascending: false,
      });


    if (error) {
      console.error(
        "Erro carregando jornada:",
        error
      );

      setIsLoaded(true);
      return;
    }


    const mappedEntries =
      (data || []).map(mapDatabaseEntry);


    setEntries(
      sortEntries(mappedEntries)
    );


    setIsLoaded(true);

  }, []);



  useEffect(() => {

    loadEntries();

  }, [loadEntries]);



  const latestEntries = useMemo(() => {

    return sortEntries(entries).slice(0, 7);

  }, [entries]);

function sortEntries(entries: JourneyEntry[]) {
  return [...entries].sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();

    if (dateA !== dateB) {
      return dateB - dateA;
    }

    return (
      new Date(b.createdAt).getTime() -
      new Date(a.createdAt).getTime()
    );
  });
}


export function useJourneyEntries() {
  const [entries, setEntries] = useState<JourneyEntry[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);


  const loadEntries = useCallback(async () => {

    const { data, error } = await supabase
      .from("journey_entries")
      .select("*")
      .order("date", {
        ascending: false,
      });


    if (error) {
      console.error(
        "Erro carregando jornada:",
        error
      );

      setIsLoaded(true);
      return;
    }


    const mappedEntries =
      (data || []).map(mapDatabaseEntry);


    setEntries(
      sortEntries(mappedEntries)
    );


    setIsLoaded(true);

  }, []);



  useEffect(() => {

    loadEntries();

  }, [loadEntries]);



  const latestEntries = useMemo(() => {

    return sortEntries(entries).slice(0, 7);

  }, [entries]);

    const addEntry = useCallback(
    async (input: JourneyEntryInput) => {

      const normalizedInput = normalizeInput(input);


      if (
        !normalizedInput.gameTitle ||
        !normalizedInput.notes
      ) {
        return null;
      }


      const now = new Date().toISOString();


      const newEntry = {
        ...normalizedInput,
        createdAt: now,
        updatedAt: now,
      };


      const { data, error } = await supabase
        .from("journey_entries")
        .insert(newEntry)
        .select()
        .single();


      if (error) {
        console.error(
          "Erro adicionando jornada:",
          error
        );

        return null;
      }


      const mappedEntry =
        mapDatabaseEntry(data);


      setEntries((current) =>
        sortEntries([
          mappedEntry,
          ...current,
        ])
      );


      return mappedEntry;

    },
    []
  );



  const updateEntry = useCallback(
    async (
      entryId: string,
      input: JourneyEntryInput
    ) => {

      const normalizedInput =
        normalizeInput(input);


      const { data, error } = await supabase
        .from("journey_entries")
        .update({
          ...normalizedInput,
          updatedAt:
            new Date().toISOString(),
        })
        .eq("id", entryId)
        .select()
        .single();



      if (error) {
        console.error(
          "Erro atualizando jornada:",
          error
        );

        return;
      }


      const updatedEntry =
        mapDatabaseEntry(data);


      setEntries((current) =>
        sortEntries(
          current.map((entry) =>
            entry.id === entryId
              ? updatedEntry
              : entry
          )
        )
      );

    },
    []
  );



  const removeEntry = useCallback(
    async (entryId: string) => {

      const { error } = await supabase
        .from("journey_entries")
        .delete()
        .eq("id", entryId);



      if (error) {
        console.error(
          "Erro removendo jornada:",
          error
        );

        return;
      }


      setEntries((current) =>
        current.filter(
          (entry) =>
            entry.id !== entryId
        )
      );

    },
    []
  );



  const clearEntries = useCallback(
    async () => {

      const { error } = await supabase
        .from("journey_entries")
        .delete()
        .neq("id", "");



      if (error) {
        console.error(
          "Erro limpando jornada:",
          error
        );

        return;
      }


      setEntries([]);

    },
    []
  );


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
