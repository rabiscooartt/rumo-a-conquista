"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type CandidateCategory = "Em breve";
type Candidate = { name: string; category: CandidateCategory; genre?: string; genreChecked?: boolean; genreSource?: string; genreSourceUrl?: string };
type GenreLookupResult = { title: string; genres: string[]; primaryGenre: string; source: string; sourceUrl?: string };
type GamePickerState = {
  bank: Candidate[];
  manualNames: string[];
  randomNames: string[];
  drawnName: string | null;
  drawnNames: string[];
  manualDrawnNames: string[];
  skippedDrawNames: string[];
  initialized: boolean;
};

const STORAGE_KEY = "rumo-a-conquista-game-picker-v1";
const REEL_WINNER_INDEX = 34;
const REEL_CARD_STEP = 180;
const REEL_CARD_WIDTH = 170;
const REEL_DURATION_MS = 6200;
async function requestGameGenres(titles: string[], mode: "normal" | "retry" = "normal"): Promise<GenreLookupResult[]> {
  const response = await fetch("/api/admin/games/genres", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ titles, mode }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    results?: GenreLookupResult[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error || "Não foi possível buscar os gêneros.");
  }
  return Array.isArray(payload.results) ? payload.results : [];
}

const GENRE_PENDING_FILTER = "__genre_pending__";
const GENRE_UNKNOWN_FILTER = "__genre_unknown__";

const EMPTY_STATE: GamePickerState = {
  bank: [],
  manualNames: [],
  randomNames: [],
  drawnName: null,
  drawnNames: [],
  manualDrawnNames: [],
  skippedDrawNames: [],
  initialized: false,
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function rowsFromCsv(source: string): string[][] {
  const input = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function isDeluxe(name: string) {
  return /\bdeluxe(?:\s+edition)?\b/i.test(name);
}

function baseEditionKey(name: string) {
  return normalize(name)
    .replace(/\bdeluxe(?:\s+edition)?\b/g, " ")
    .replace(/\bedition\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCandidates(rows: string[][]): Candidate[] {
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalize);
  const nameColumn = headers.findIndex((header) => header === "jogo" || header === "nome" || header.includes("nome do jogo"));
  const categoryColumn = headers.findIndex((header) => header === "categoria" || header === "status");
  const genreColumn = headers.findIndex((header) => header === "genero" || header === "genero predominante");
  const checkedColumn = headers.findIndex((header) => header === "genero verificado" || header === "genero conferido");
  const sourceColumn = headers.findIndex((header) => header === "fonte do genero");
  const sourceUrlColumn = headers.findIndex((header) => header === "url da fonte do genero");
  const hasHeader = nameColumn >= 0 && categoryColumn >= 0;
  const gameColumn = hasHeader ? nameColumn : 0;
  const statusColumn = hasHeader ? categoryColumn : 1;
  const sourceRows = hasHeader ? rows.slice(1) : rows;
  const editionMap = new Map<string, Candidate>();

  for (const row of sourceRows) {
    const name = (row[gameColumn] || "").replace(/\s+/g, " ").trim();
    const status = normalize(row[statusColumn] || "");
    const genre = genreColumn >= 0 ? (row[genreColumn] || "").trim() : "";
    const checkedValue = checkedColumn >= 0 ? normalize(row[checkedColumn] || "") : "";
    const genreSource = sourceColumn >= 0 ? (row[sourceColumn] || "").trim().toLowerCase() : "";
    const genreSourceUrl = sourceUrlColumn >= 0 ? (row[sourceUrlColumn] || "").trim() : "";
    const genreChecked = Boolean(genre) || ["true", "sim", "yes", "1"].includes(checkedValue);

    if (!name || /^https?:\/\//i.test(name)) continue;
    let category: CandidateCategory;
    if (status.includes("rejogar") || status.includes("na fila") || status.includes("em breve")) category = "Em breve";
    else continue;

    const key = baseEditionKey(name);
    if (!key) continue;

    const previous = editionMap.get(key);
    if (!previous) {
      editionMap.set(key, { name, category, genre, genreChecked, genreSource, genreSourceUrl });
      continue;
    }

    const chosenName = isDeluxe(name) && !isDeluxe(previous.name) ? name : previous.name;
    const chosenCategory: CandidateCategory = "Em breve";
    const chosenGenre = previous.genre || genre;
    const chosenGenreChecked = previous.genreChecked === true || genreChecked;
    const chosenGenreSource = previous.genreSource || genreSource;
    const chosenGenreSourceUrl = previous.genreSourceUrl || genreSourceUrl;
    editionMap.set(key, { name: chosenName, category: chosenCategory, genre: chosenGenre, genreChecked: chosenGenreChecked, genreSource: chosenGenreSource, genreSourceUrl: chosenGenreSourceUrl });
  }

  return [...editionMap.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function readSavedState(): Omit<GamePickerState, "initialized"> {
  if (typeof window === "undefined") {
    return { bank: [], manualNames: [], randomNames: [], drawnName: null, drawnNames: [], manualDrawnNames: [], skippedDrawNames: [] };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { bank: [], manualNames: [], randomNames: [], drawnName: null, drawnNames: [], manualDrawnNames: [], skippedDrawNames: [] };

    const parsed = JSON.parse(saved) as {
      bank?: Candidate[];
      manualNames?: string[];
      randomNames?: string[];
      drawnName?: string | null;
      drawnNames?: string[];
      manualDrawnNames?: string[];
      skippedDrawNames?: string[];
    };
    const bank = Array.isArray(parsed.bank)
      ? cleanCandidates([
          ["Jogo", "Categoria", "Gênero", "Gênero verificado", "Fonte do gênero", "URL da fonte do gênero"],
          ...parsed.bank.map((candidate) => [
            String(candidate?.name || ""),
            String(candidate?.category || ""),
            String(candidate?.genre || ""),
            candidate?.genreChecked ? "true" : "false",
            String(candidate?.genreSource || ""),
            String(candidate?.genreSourceUrl || ""),
          ]),
        ])
      : [];
    const validNames = new Set(bank.map((candidate) => candidate.name));
    const manualNames = Array.isArray(parsed.manualNames)
      ? [...new Set(parsed.manualNames.filter((name) => validNames.has(name)))].slice(0, 5)
      : [];
    const manualSet = new Set(manualNames);
    const randomNames = Array.isArray(parsed.randomNames)
      ? [...new Set(parsed.randomNames.filter((name) => validNames.has(name) && !manualSet.has(name)))].slice(0, 5)
      : [];

    const legacyDrawnName = typeof parsed.drawnName === "string" && validNames.has(parsed.drawnName)
      ? parsed.drawnName
      : null;
    const drawnNames = Array.isArray(parsed.drawnNames)
      ? [...new Set(parsed.drawnNames.filter((name) => validNames.has(name)))].slice(0, 5)
      : legacyDrawnName
        ? [legacyDrawnName]
        : [];
    const drawnName = legacyDrawnName || drawnNames[drawnNames.length - 1] || null;
    const manualDrawnNames = Array.isArray(parsed.manualDrawnNames)
      ? [...new Set(parsed.manualDrawnNames.filter((name) => validNames.has(name) && drawnNames.includes(name)))]
      : [];
    const skippedDrawNames = Array.isArray(parsed.skippedDrawNames)
      ? [...new Set(parsed.skippedDrawNames.filter((name) => validNames.has(name)))]
      : [];

    return { bank, manualNames, randomNames, drawnName, drawnNames, manualDrawnNames, skippedDrawNames };
  } catch {
    return { bank: [], manualNames: [], randomNames: [], drawnName: null, drawnNames: [], manualDrawnNames: [], skippedDrawNames: [] };
  }
}

function SectionTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="mb-5">
      <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-black text-white">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-white/45">{detail}</p>
    </div>
  );
}

export default function GamePickerAdminPage() {
  const [state, setState] = useState<GamePickerState>(EMPTY_STATE);
  const [search, setSearch] = useState("");
    const [genreFilter, setGenreFilter] = useState("Todos");
  const [isClassifying, setIsClassifying] = useState(false);
  const [genreProgress, setGenreProgress] = useState({ done: 0, total: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [wheelItems, setWheelItems] = useState<Candidate[]>([]);
  const [wheelPosition, setWheelPosition] = useState(-REEL_CARD_WIDTH / 2);
  const [isReelAnimating, setIsReelAnimating] = useState(false);
  const [showWinnerAlert, setShowWinnerAlert] = useState(false);
  const [activeWinnerName, setActiveWinnerName] = useState<string | null>(null);
  const [activeWinnerIsManual, setActiveWinnerIsManual] = useState(false);
  const [currentDrawNumber, setCurrentDrawNumber] = useState(0);
  const drawStartTimer = useRef<number | null>(null);
  const drawFinishTimer = useRef<number | null>(null);
  const presentationCloseTimer = useRef<number | null>(null);
  const [message, setMessage] = useState("");
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [newGameName, setNewGameName] = useState("");
  const [editingGameName, setEditingGameName] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    const stored = readSavedState();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ...stored, initialized: true });
  }, []);

  useEffect(() => {
    return () => {
      if (drawStartTimer.current !== null) window.clearTimeout(drawStartTimer.current);
      if (drawFinishTimer.current !== null) window.clearTimeout(drawFinishTimer.current);
      if (presentationCloseTimer.current !== null) window.clearTimeout(presentationCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!state.initialized) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bank: state.bank,
        manualNames: state.manualNames,
        randomNames: state.randomNames,
        drawnName: state.drawnName,
        drawnNames: state.drawnNames,
        manualDrawnNames: state.manualDrawnNames,
        skippedDrawNames: state.skippedDrawNames,
      })
    );
  }, [state]);

  const availableGenres = useMemo(
    () => [...new Set(state.bank.map((candidate) => candidate.genre).filter((genre): genre is string => Boolean(genre)))].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [state.bank]
  );
  const filteredBank = useMemo(() => {
    const term = normalize(search);
    return state.bank.filter((candidate) => {
      const matchesSearch = !term || normalize(candidate.name).includes(term);
      const matchesGenre =
        genreFilter === "Todos" ||
        (genreFilter === GENRE_PENDING_FILTER && !candidate.genre && !candidate.genreChecked) ||
        (genreFilter === GENRE_UNKNOWN_FILTER && !candidate.genre && candidate.genreChecked) ||
        candidate.genre === genreFilter;
      return matchesSearch && matchesGenre;
    });
  }, [state.bank, search, genreFilter]);

  const emBreveCount = state.bank.filter((candidate) => candidate.category === "Em breve").length;
  const genrePendingCount = state.bank.filter((candidate) => !candidate.genre && !candidate.genreChecked).length;
  const genreUnknownCount = state.bank.filter((candidate) => !candidate.genre && candidate.genreChecked).length;
  const remainingCount = state.bank.filter((candidate) => candidate.category === "Em breve").length;

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      const imported = cleanCandidates(rowsFromCsv(content));
      if (imported.length === 0) {
        setMessage("Não encontrei jogos válidos. Use o CSV limpo com as colunas Jogo e Categoria.");
        return;
      }

      setState((current) => ({
        ...current,
        bank: imported,
        manualNames: [],
        randomNames: [],
        drawnName: null,
        drawnNames: [],
        manualDrawnNames: [],
        skippedDrawNames: [],
      }));
      const pendingGenres = imported.filter((candidate) => !candidate.genre && !candidate.genreChecked).length;
      setMessage("Banco importado: " + imported.length + " jogos prontos. " + pendingGenres + " precisam de busca de gênero; clique em Identificar gêneros para classificar o banco.");
    } catch {
      setMessage("Não foi possível ler esse arquivo. Tente importar o CSV novamente.");
    } finally {
      input.value = "";
    }
  }

  function lookupGenreForAddedGame(name: string, successPrefix: string) {
    void requestGameGenres([name])
      .then((results) => {
        const result = results.find((item) => normalize(item.title) === normalize(name));
        const genre = result?.primaryGenre || "";
        setState((current) => ({
          ...current,
          bank: current.bank.map((candidate) =>
            candidate.name === name
              ? { ...candidate, genre, genreChecked: true, genreSource: result?.source || "none", genreSourceUrl: result?.sourceUrl || "" }
              : candidate
          ),
        }));
        setMessage(
          genre
            ? successPrefix + " Gênero predominante: " + genre + "."
            : successPrefix + " Não encontrei um gênero confiável para esse título. Você pode tentar novamente em Identificar gêneros."
        );
      })
      .catch(() => {
        setMessage(successPrefix + " O jogo foi salvo, mas a busca de gênero falhou. Você pode tentar novamente em Identificar gêneros.");
      });
  }

  function addGame() {
    const name = newGameName.trim().replace(/\s+/g, " ");

    if (!name) {
      setMessage("Digite o nome do jogo antes de adicionar.");
      return;
    }

    const incomingKey = baseEditionKey(name);
    const existing = state.bank.find(
      (candidate) => baseEditionKey(candidate.name) === incomingKey
    );

    if (existing) {
      if (isDeluxe(name) && !isDeluxe(existing.name)) {
        const category: CandidateCategory = "Em breve";

        setState((current) => ({
          ...current,
          bank: current.bank
            .map((candidate) =>
              candidate.name === existing.name
                ? { ...candidate, name, category }
                : candidate
            )
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
          manualNames: current.manualNames.map((item) =>
            item === existing.name ? name : item
          ),
          randomNames: current.randomNames.map((item) =>
            item === existing.name ? name : item
          ),
          drawnName: current.drawnName === existing.name ? name : current.drawnName,
          drawnNames: current.drawnNames.map((item) => item === existing.name ? name : item),
          manualDrawnNames: current.manualDrawnNames.map((item) => item === existing.name ? name : item),
          skippedDrawNames: current.skippedDrawNames.map((item) => item === existing.name ? name : item),
        }));
        setNewGameName("");
        setMessage("A versão normal foi substituída pela Deluxe. Buscando o gênero da edição mantida...");
        lookupGenreForAddedGame(name, "A versão normal foi substituída pela Deluxe.");
        return;
      }

      setMessage(
        '"' +
          existing.name +
          '" já está no banco. Não adicionei uma cópia para evitar duplicatas.'
      );
      return;
    }

    setState((current) => ({
      ...current,
      bank: [...current.bank, { name, category: "Em breve" as CandidateCategory }].sort(
        (a, b) => a.name.localeCompare(b.name, "pt-BR")
      ),
    }));
    setNewGameName("");
    setMessage('"' + name + '" foi adicionado. Buscando o gênero predominante...');
    lookupGenreForAddedGame(name, '"' + name + '" foi adicionado à categoria Em breve.');
  }

  async function classifyPendingGenres(includeUnknown = false) {
    if (isClassifying) return;

    const titles = state.bank
      .filter((candidate) => !candidate.genre && (includeUnknown || !candidate.genreChecked))
      .map((candidate) => candidate.name);

    if (titles.length === 0) {
      setMessage("Todos os jogos já tiveram a busca de gênero realizada. Os que não tiverem gênero confiável aparecem como Sem gênero identificado.");
      return;
    }

    setIsClassifying(true);
    setGenreProgress({ done: 0, total: titles.length });
    setMessage((includeUnknown ? "Iniciando busca ampliada" : "Iniciando busca automática") + " dos gêneros para " + titles.length + " jogos...");

    let processed = 0;
    let found = 0;
    try {
      // The API accepts up to six titles and limits its upstream concurrency.
      for (let index = 0; index < titles.length; index += 3) {
        const batch = titles.slice(index, index + 3);
        const results = await requestGameGenres(batch, includeUnknown ? "retry" : "normal");
        const resultsByTitle = new Map(results.map((result) => [normalize(result.title), result]));
        found += results.filter((result) => Boolean(result.primaryGenre)).length;

        setState((current) => ({
          ...current,
          bank: current.bank.map((candidate) => {
            const result = resultsByTitle.get(normalize(candidate.name));
            if (!result || !batch.some((title) => normalize(title) === normalize(candidate.name))) return candidate;
            // Nunca substitui um gênero já identificado por uma tentativa posterior.
            if (candidate.genre) return candidate;
            return { ...candidate, genre: result.primaryGenre || "", genreChecked: true, genreSource: result.source || "none", genreSourceUrl: result.sourceUrl || "" };
          }),
        }));

        processed += batch.length;
        setGenreProgress({ done: processed, total: titles.length });
        setMessage((includeUnknown ? "Busca ampliada" : "Buscando gêneros") + ": " + processed + "/" + titles.length + " verificados · " + found + " identificados.");
      }

      setMessage((includeUnknown ? "Busca ampliada concluída" : "Busca concluída") + ": " + found + " gêneros predominantes identificados de " + titles.length + " jogos. Sem gênero confiável: " + (titles.length - found) + ".");
    } catch (error) {
      setMessage(
        "A busca foi interrompida em " + processed + "/" + titles.length + " jogos. " +
        (error instanceof Error ? error.message : "Tente novamente para continuar.")
      );
    } finally {
      setIsClassifying(false);
    }
  }

  function beginEdit(candidate: Candidate) {
    setEditingGameName(candidate.name);
    setEditTitle(candidate.name);
    setMessage("");
  }

  function cancelEdit() {
    setEditingGameName(null);
    setEditTitle("");
  }

  function saveGameEdit(originalName: string) {
    const name = editTitle.trim().replace(/\s+/g, " ");

    if (!name) {
      setMessage("Digite um nome válido para o jogo.");
      return;
    }

    const duplicate = state.bank.find(
      (candidate) =>
        candidate.name !== originalName &&
        normalize(candidate.name) === normalize(name)
    );

    if (duplicate) {
      setMessage('Já existe um jogo chamado "' + duplicate.name + '". Para evitar duplicatas, o nome não foi alterado.');
      return;
    }

    const titleChanged = name !== originalName;
    const previous = state.bank.find((candidate) => candidate.name === originalName);
    if (!previous) {
      cancelEdit();
      return;
    }

    setState((current) => ({
      ...current,
      bank: current.bank.map((candidate) =>
        candidate.name !== originalName
          ? candidate
          : {
              ...candidate,
              name,
              category: "Em breve" as CandidateCategory,
              ...(titleChanged
                ? { genre: "", genreChecked: false, genreSource: "" }
                : {}),
            }
      ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      manualNames: current.manualNames.map((item) => item === originalName ? name : item),
      randomNames: current.randomNames.map((item) => item === originalName ? name : item),
      drawnName: current.drawnName === originalName ? name : current.drawnName,
      drawnNames: current.drawnNames.map((item) => item === originalName ? name : item),
      manualDrawnNames: current.manualDrawnNames.map((item) => item === originalName ? name : item),
      skippedDrawNames: current.skippedDrawNames.map((item) => item === originalName ? name : item),
    }));

    setEditingGameName(null);
    setEditTitle("");

    if (titleChanged) {
      setMessage('Nome atualizado para "' + name + '". Buscando novamente o gênero predominante...');
      lookupGenreForAddedGame(name, 'Nome atualizado para "' + name + '".');
    } else {
      setMessage('Alterações salvas para "' + name + '".');
    }
  }

  function removeGame(name: string) {
    const confirmed = window.confirm(
      'Remover "' +
        name +
        '" do banco de jogos? Ele também sairá da seleção atual, se estiver escolhido.'
    );

    if (!confirmed) return;

    setState((current) => ({
      ...current,
      bank: current.bank.filter((candidate) => candidate.name !== name),
      manualNames: current.manualNames.filter((item) => item !== name),
      // Limpa o resultado apenas se o jogo sorteado for removido.
      randomNames: current.randomNames.filter((item) => item !== name),
      drawnName: current.drawnName === name ? null : current.drawnName,
      drawnNames: current.drawnNames.filter((item) => item !== name),
      manualDrawnNames: current.manualDrawnNames.filter((item) => item !== name),
      skippedDrawNames: current.skippedDrawNames.filter((item) => item !== name),
    }));
    setMessage(
      '"' +
        name +
        '" foi removido do banco. A seleção dos jogos restantes foi preservada; o resultado da roleta foi limpo para permitir um novo sorteio.'
    );
  }

  function finishPresentation() {
    if (presentationCloseTimer.current !== null) window.clearTimeout(presentationCloseTimer.current);
    presentationCloseTimer.current = null;
    setShowWinnerAlert(false);
    setWheelItems([]);
    setActiveWinnerName(null);
    setActiveWinnerIsManual(false);
    setIsReelAnimating(false);
    setWheelPosition(-REEL_CARD_WIDTH / 2);
  }

  function spinOneGame(winner: Candidate, pool: Candidate[], drawNumber: number, manual = false) {
    const alternatives = pool.filter((candidate) => candidate.name !== winner.name);
    const strip: Candidate[] = Array.from({ length: REEL_WINNER_INDEX }, () => {
      const source = alternatives.length > 0 ? alternatives : pool;
      return source[Math.floor(Math.random() * source.length)];
    });
    strip.push(winner);

    setCurrentDrawNumber(drawNumber);
    setActiveWinnerName(null);
    setActiveWinnerIsManual(manual);
    setWheelItems(strip);
    setWheelPosition(-REEL_CARD_WIDTH / 2);
    setIsReelAnimating(false);
    setIsDrawing(true);
    setShowWinnerAlert(true);
    setMessage("Sorteio " + drawNumber + " de 5: a roleta está girando...");

    drawStartTimer.current = window.setTimeout(() => {
      setIsReelAnimating(true);
      setWheelPosition(-(REEL_WINNER_INDEX * REEL_CARD_STEP + REEL_CARD_WIDTH / 2));
      drawStartTimer.current = null;
    }, 80);

    drawFinishTimer.current = window.setTimeout(() => {
      setState((current) => {
        const stillEligible = current.bank.some(
          (candidate) => candidate.category === "Em breve" && candidate.name === winner.name
        ) && !current.drawnNames.includes(winner.name) && !current.skippedDrawNames.includes(winner.name);
        if (!stillEligible || current.drawnNames.length >= 5) return current;
        const drawnNames = [...current.drawnNames, winner.name];
        const manualDrawnNames = manual
          ? [...current.manualDrawnNames.filter((name) => name !== winner.name), winner.name]
          : current.manualDrawnNames.filter((name) => name !== winner.name);
        return { ...current, drawnNames, drawnName: winner.name, manualDrawnNames };
      });
      setActiveWinnerName(winner.name);
      setIsDrawing(false);
      setIsReelAnimating(false);
      setMessage("Sorteio " + drawNumber + " concluído: " + winner.name + ".");
      drawFinishTimer.current = null;

      // Mantém o vencedor em destaque antes de devolver a tela ao painel.
      presentationCloseTimer.current = window.setTimeout(() => {
        finishPresentation();
      }, 3800);
    }, REEL_DURATION_MS + 250);
  }

  function chooseCandidate(name: string) {
    if (isDrawing || showWinnerAlert || isClassifying) return;
    if (state.drawnNames.length >= 5) {
      setMessage("Você já preencheu as cinco vagas. Retire um resultado para liberar espaço.");
      return;
    }

    const candidate = state.bank.find((item) => item.name === name && item.category === "Em breve");
    if (!candidate) {
      setMessage("Esse jogo não está mais disponível na categoria Em breve.");
      return;
    }
    if (state.drawnNames.includes(name)) {
      setMessage('"' + name + '" já está nos resultados.');
      return;
    }
    if (state.skippedDrawNames.includes(name)) {
      setMessage('"' + name + '" foi retirado desta rodada. Limpe os resultados para escolher esse título novamente.');
      return;
    }

    if (drawStartTimer.current !== null) window.clearTimeout(drawStartTimer.current);
    if (drawFinishTimer.current !== null) window.clearTimeout(drawFinishTimer.current);
    if (presentationCloseTimer.current !== null) window.clearTimeout(presentationCloseTimer.current);

    const pool = state.bank.filter((item) =>
      item.category === "Em breve" &&
      !state.drawnNames.includes(item.name) &&
      !state.skippedDrawNames.includes(item.name)
    );
    setMessage('Você escolheu "' + name + '". A roleta vai revelar sua escolha.');
    spinOneGame(candidate, pool, state.drawnNames.length + 1, true);
  }

  function drawRandomGame() {
    if (isDrawing || showWinnerAlert) return;

    if (state.drawnNames.length >= 5) {
      setMessage("Você já tem cinco resultados. Retire um deles para sortear um substituto.");
      return;
    }

    const pool = state.bank.filter((candidate) =>
      candidate.category === "Em breve" &&
      !state.drawnNames.includes(candidate.name) &&
      !state.skippedDrawNames.includes(candidate.name)
    );
    if (pool.length === 0) {
      setMessage("Não há outros jogos disponíveis. Retire um resultado ou limpe a rodada para começar novamente.");
      return;
    }

    if (drawStartTimer.current !== null) window.clearTimeout(drawStartTimer.current);
    if (drawFinishTimer.current !== null) window.clearTimeout(drawFinishTimer.current);
    if (presentationCloseTimer.current !== null) window.clearTimeout(presentationCloseTimer.current);

    const winner = pool[Math.floor(Math.random() * pool.length)];
    spinOneGame(winner, pool, state.drawnNames.length + 1);
  }

  function removeDrawnResult(name: string) {
    if (isDrawing || showWinnerAlert) return;
    setState((current) => {
      const drawnNames = current.drawnNames.filter((item) => item !== name);
      return {
        ...current,
        drawnNames,
        drawnName: drawnNames[drawnNames.length - 1] || null,
        manualDrawnNames: current.manualDrawnNames.filter((item) => item !== name),
        skippedDrawNames: current.skippedDrawNames.includes(name)
          ? current.skippedDrawNames
          : [...current.skippedDrawNames, name],
      };
    });
    setMessage('"' + name + '" foi retirado dos resultados e não será sorteado novamente nesta rodada. Agora você pode sortear um substituto.');
  }

  function clearDrawnGame() {
    if (isDrawing || showWinnerAlert) return;
    if (presentationCloseTimer.current !== null) window.clearTimeout(presentationCloseTimer.current);
    presentationCloseTimer.current = null;
    setShowWinnerAlert(false);
    setWheelItems([]);
    setActiveWinnerName(null);
    setActiveWinnerIsManual(false);
    setWheelPosition(-REEL_CARD_WIDTH / 2);
    setState((current) => ({ ...current, drawnName: null, drawnNames: [], manualDrawnNames: [], skippedDrawNames: [] }));
    setMessage("Resultados limpos. O banco de jogos foi preservado; você pode iniciar uma nova rodada de até cinco sorteios.");
  }

  async function copyDrawnGame() {
    if (state.drawnNames.length === 0 && !state.drawnName) return;
    const titles = state.drawnNames.length > 0 ? state.drawnNames : state.drawnName ? [state.drawnName] : [];

    try {
      await navigator.clipboard.writeText(
        "🏆 RUMO À CONQUISTA | JOGOS SORTEADOS\n\n" +
        titles.map((name, index) => (index + 1) + ". " + name).join("\n")
      );
      setMessage(titles.length + " jogo(s) sorteado(s) copiado(s) para a área de transferência.");
    } catch {
      setMessage("O navegador bloqueou a cópia automática. Os jogos sorteados continuam visíveis no painel.");
    }
  }

  function downloadBackup() {
    if (state.bank.length === 0) return;
    const escapeCsv = (value: string) => '"' + value.replace(/"/g, '""') + '"';
    const csv = [
      ["Jogo", "Categoria", "Gênero", "Gênero verificado", "Fonte do gênero", "URL da fonte do gênero"].map(escapeCsv).join(","),
      ...state.bank.map((candidate) => [
        candidate.name,
        candidate.category,
        candidate.genre || "",
        candidate.genreChecked ? "true" : "false",
        candidate.genreSource || "",
        candidate.genreSourceUrl || "",
      ].map(escapeCsv).join(",")),
    ].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "banco-jogos-rumo-a-conquista.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[#07090d] text-white">
      <Navbar />
      <div className="mx-auto w-full max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-5 border-b border-white/10 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-red-400">
              <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_12px_rgba(239,68,68,0.9)]" />
              Área administrativa
            </div>
            <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Banco de Jogos <span className="text-red-500">&</span> Roleta</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50 sm:text-base">
              Guarde os jogos que você quer experimentar. Clique em Escolher para definir seu próximo jogo ou use a roleta para sortear aleatoriamente.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void classifyPendingGenres(genrePendingCount === 0 && genreUnknownCount > 0)}
              disabled={isClassifying || (genrePendingCount === 0 && genreUnknownCount === 0) || state.bank.length === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-400/[0.07] px-4 py-3 text-sm font-black text-cyan-100 transition hover:bg-cyan-400/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span>{isClassifying ? "↻" : "◎"}</span>
              {isClassifying
                ? "Buscando " + genreProgress.done + "/" + genreProgress.total
                : genrePendingCount > 0
                  ? "Identificar gêneros (" + genrePendingCount + ")"
                  : genreUnknownCount > 0
                    ? "Tentar novamente (" + genreUnknownCount + ")"
                    : "Gêneros verificados"}
            </button>
            <button
              type="button"
              onClick={() => setIsAddFormOpen((open) => !open)}
              aria-expanded={isAddFormOpen}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20"
            >
              <span>{isAddFormOpen ? "×" : "＋"}</span>
              {isAddFormOpen ? "Fechar cadastro" : "Adicionar jogo"}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-black text-red-200 transition hover:bg-red-500/20">
              <span>＋</span> Importar CSV
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleImport(event)} className="hidden" disabled={isDrawing} />
            </label>
            <button type="button" onClick={downloadBackup} disabled={state.bank.length === 0} className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-bold text-white/75 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40">
              Exportar banco
            </button>
            <Link href="/biblioteca" className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white/60 transition hover:text-white">
              Biblioteca ↗
            </Link>
          </div>
        </div>

        {isAddFormOpen && (
          <section className="mb-6 rounded-2xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.08] via-white/[0.025] to-transparent p-5 sm:p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">Cadastro manual</p>
                <h2 className="mt-1 text-lg font-black text-white">Adicionar jogo ao banco</h2>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  O jogo será salvo na categoria Em breve e poderá participar dos próximos sorteios, sem alterar a fila oficial de Maestrias.
                </p>
              </div>
              <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/45">
                {state.bank.length} no banco
              </span>
            </div>

            <form
              className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                addGame();
              }}
            >
              <input
                aria-label="Nome do jogo"
                value={newGameName}
                onChange={(event) => setNewGameName(event.target.value)}
                maxLength={140}
                placeholder="Nome do jogo (ex.: God of War Ragnarök)"
                className="min-w-0 rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-500/50"
                required
              />
              <button
                type="submit"
                disabled={!newGameName.trim() || isDrawing}
                className="rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ＋ Adicionar
              </button>
            </form>
            <p className="mt-3 text-xs leading-5 text-white/35">
              Títulos repetidos são bloqueados. Se já houver uma versão normal e você cadastrar a Deluxe, a normal será substituída.
            </p>
          </section>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Em breve", value: emBreveCount, tone: "text-red-300" },
            { label: "Gêneros pendentes", value: genrePendingCount, tone: "text-cyan-200" },
            { label: "Sem gênero identificado", value: genreUnknownCount, tone: "text-amber-200" },
            { label: "Disponíveis na roleta", value: remainingCount, tone: "text-emerald-300" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">{stat.label}</p>
              <p className={"mt-2 text-3xl font-black " + stat.tone}>{stat.value}</p>
            </div>
          ))}
        </div>

        {message && (
          <div role="status" className="mb-6 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/75">
            {message}
          </div>
        )}

        {state.bank.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] px-6 py-16 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10 text-3xl">🎲</div>
            <h2 className="mt-5 text-xl font-black">Vamos carregar seu banco de jogos</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-white/50">
              Importe o arquivo <strong className="text-white/80">jogos_fila_rejogar_limpos.csv</strong>. Os antigos status “Na fila” e “Rejogar” serão convertidos para “Em breve” neste banco de candidatos; a fila oficial de Próximas Maestrias não será alterada.
            </p>
            <label className="mt-6 inline-flex cursor-pointer items-center gap-2 rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white transition hover:bg-red-500">
              Importar lista limpa
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleImport(event)} className="hidden" />
            </label>
          </div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-4 sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <SectionTitle eyebrow="Banco Em breve" title="Jogos candidatos" detail="Clique em Escolher para selecionar um título específico e confirmar na roleta, ou sorteie aleatoriamente pelo painel ao lado." />
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jogo pelo nome..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-500/50" />
                <select value={genreFilter} onChange={(event) => setGenreFilter(event.target.value)} className="rounded-xl border border-white/10 bg-[#101319] px-3 py-3 text-sm text-white/80 outline-none focus:border-cyan-400/50">
                  <option value="Todos">Todos os gêneros</option>
                  {genrePendingCount > 0 && <option value={GENRE_PENDING_FILTER}>Gênero pendente ({genrePendingCount})</option>}
                  {genreUnknownCount > 0 && <option value={GENRE_UNKNOWN_FILTER}>Sem gênero identificado ({genreUnknownCount})</option>}
                  {availableGenres.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                </select>
              </div>

              <div className="mb-3 flex items-center justify-between text-xs text-white/40">
                <span>{filteredBank.length} jogos encontrados</span>
                <span>Todos podem ser sorteados</span>
              </div>

              <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                {filteredBank.map((candidate) => {
                  const isEditing = editingGameName === candidate.name;
                  const isAlreadyDrawn = state.drawnNames.includes(candidate.name);
                  const wasSkipped = state.skippedDrawNames.includes(candidate.name);
                  const noResultsSpace = state.drawnNames.length >= 5;
                  return (
                    <div key={candidate.name} className="space-y-2">
                      <div className="flex w-full items-center gap-2 rounded-xl border border-white/[0.07] bg-black/20 px-2 py-2 transition hover:border-white/20 hover:bg-white/[0.04]">
                        <div className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-1.5 text-left">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/20 bg-red-500/[0.08] text-base">🎮</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-white/90">{candidate.name}</span>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-md bg-red-400/[0.08] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-red-200/80">Em breve</span>
                              <span className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.04] px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100/70">
                                {candidate.genre || (candidate.genreChecked ? "Sem gênero identificado" : "Gênero pendente")}
                              </span>
                              {candidate.genre && candidate.genreSource && candidate.genreSource !== "none" && (
                                candidate.genreSourceUrl ? (
                                  <a href={candidate.genreSourceUrl} target="_blank" rel="noreferrer" title="Abrir a fonte consultada para este gênero" className="text-[9px] font-bold uppercase tracking-wider text-white/50 underline decoration-white/20 underline-offset-2 hover:text-white/80">
                                    Fonte ↗
                                  </a>
                                ) : (
                                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/30">{candidate.genreSource}</span>
                                )
                              )}
                            </span>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => chooseCandidate(candidate.name)}
                          disabled={isDrawing || showWinnerAlert || isClassifying || isAlreadyDrawn || wasSkipped || noResultsSpace}
                          title={isAlreadyDrawn ? "Esse jogo já está nos resultados" : wasSkipped ? "Esse jogo foi descartado nesta rodada" : noResultsSpace ? "Retire um resultado para liberar uma vaga" : "Escolher " + candidate.name}
                          aria-label={"Escolher " + candidate.name}
                          className={"shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-black transition sm:px-3 sm:text-xs " + (isAlreadyDrawn ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200/70" : "border-red-500/30 bg-red-500/10 text-red-200 hover:bg-red-500/20") + " disabled:cursor-not-allowed disabled:opacity-40"}
                        >
                          {isAlreadyDrawn ? "Escolhido" : wasSkipped ? "Descartado" : noResultsSpace ? "Limite 5" : "Escolher"}
                        </button>
                        <button type="button" title={"Editar " + candidate.name} aria-label={"Editar " + candidate.name} disabled={isDrawing || isClassifying} onClick={() => isEditing ? cancelEdit() : beginEdit(candidate)} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-[11px] font-bold text-white/55 transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.07] hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-30 sm:px-3 sm:text-xs">
                          {isEditing ? "Cancelar" : "Editar"}
                        </button>
                        <button type="button" title={"Remover " + candidate.name + " do banco"} aria-label={"Remover " + candidate.name + " do banco"} disabled={isDrawing} onClick={() => removeGame(candidate.name)} className="shrink-0 rounded-lg border border-white/10 px-2.5 py-2 text-[11px] font-bold text-white/45 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-30 sm:px-3 sm:text-xs">
                          Remover
                        </button>
                      </div>
                      {isEditing && (
                        <form className="grid gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.035] p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); saveGameEdit(candidate.name); }}>
                          <input aria-label={"Editar nome de " + candidate.name} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} maxLength={140} required className="min-w-0 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/50" />
                          <button type="submit" disabled={!editTitle.trim() || isDrawing} className="rounded-lg bg-cyan-500/90 px-3 py-2.5 text-xs font-black text-black transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">Salvar</button>
                          <button type="button" onClick={cancelEdit} className="rounded-lg border border-white/10 px-3 py-2.5 text-xs font-bold text-white/60 transition hover:bg-white/[0.05]">Cancelar</button>
                        </form>
                      )}
                    </div>
                  );
                })}
                {filteredBank.length === 0 && <p className="rounded-xl border border-white/10 px-4 py-8 text-center text-sm text-white/40">Nenhum jogo encontrado com esse filtro.</p>}
              </div>
            </section>

            <div className="space-y-5">
              <section className="rounded-3xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.09] via-white/[0.025] to-transparent p-5 sm:p-6">
                <SectionTitle eyebrow="Roleta Em breve" title="Sortear o próximo jogo" detail="Sorteie um jogo por vez, até preencher cinco resultados. Cada título sorteado fica registrado e pode ser retirado individualmente." />
                <div className="mb-3 flex items-center justify-between gap-3 text-xs text-white/45">
                  <span>{isDrawing ? "A sorte está lançada..." : state.drawnNames.length + " de 5 resultados preenchidos"}</span>
                  <span>{state.bank.filter((candidate) => candidate.category === "Em breve" && !state.drawnNames.includes(candidate.name) && !state.skippedDrawNames.includes(candidate.name)).length} disponíveis</span>
                </div>
                <div className="relative mb-5 h-[164px] overflow-hidden rounded-2xl border border-white/10 bg-[#08090c] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-10 before:bg-gradient-to-r before:from-[#08090c] before:to-transparent after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-10 after:bg-gradient-to-l after:from-[#08090c] after:to-transparent" aria-label="Roleta animada de jogos">
                  <div className="absolute left-1/2 top-0 z-20 h-full w-0.5 -translate-x-1/2 bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.85)]" />
                  <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[9px] border-t-[12px] border-x-transparent border-t-red-500" />
                  {wheelItems.length > 0 ? (
                    <div
                      className="absolute left-1/2 top-0 flex h-full items-center gap-[10px] will-change-transform"
                      style={{
                        transform: "translateX(" + wheelPosition + "px)",
                        transition: isReelAnimating ? "transform " + REEL_DURATION_MS + "ms cubic-bezier(0.08, 0.65, 0.04, 1)" : "none",
                      }}
                    >
                      {wheelItems.map((candidate, index) => {
                        const isWinnerTile = index === REEL_WINNER_INDEX;
                        return (
                          <div
                            key={index + "-" + candidate.name}
                            className={"flex h-[112px] w-[170px] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-center " + (isWinnerTile && !isDrawing ? "border-emerald-300/80 bg-emerald-400/15 shadow-[0_0_30px_rgba(52,211,153,0.22)]" : "border-white/10 bg-white/[0.035]")}
                          >
                            <span className="mb-2 text-2xl">{isWinnerTile && !isDrawing ? "🏆" : "🎮"}</span>
                            <span className="line-clamp-2 text-xs font-black leading-4 text-white/90">{candidate.name}</span>
                            {isWinnerTile && !isDrawing && <span className="mt-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">Vencedor</span>}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                      <span className="text-3xl">🎰</span>
                      <span className="text-sm font-bold text-white/60">Aperte o botão para girar a roleta</span>
                    </div>
                  )}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-8 bg-gradient-to-t from-[#08090c] to-transparent" />
                </div>
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
                  <span className="text-xl">{isDrawing ? "🎰" : state.drawnName ? "🏆" : "🎲"}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white">{isDrawing ? "A roleta está girando!" : state.drawnName ? "Resultado definido" : "Pronto para sortear"}</p>
                    <p className="mt-1 break-words text-xs text-white/45">{isDrawing ? "O marcador vermelho vai indicar o jogo vencedor." : state.drawnName || (remainingCount + " jogos aguardando o sorteio")}</p>
                  </div>
                </div>
                <button type="button" onClick={drawRandomGame} disabled={state.drawnNames.length >= 5 || isDrawing || showWinnerAlert || state.bank.every((candidate) => candidate.category !== "Em breve" || state.drawnNames.includes(candidate.name) || state.skippedDrawNames.includes(candidate.name))} className="w-full rounded-xl bg-red-600 px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-white shadow-[0_12px_35px_rgba(220,38,38,0.16)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none">
                  {isDrawing ? "A roleta está girando..." : state.drawnNames.length >= 5 ? "Retire um resultado para sortear outro" : state.drawnNames.length > 0 ? "Sortear mais 1 jogo" : "Sortear 1 jogo"}
                </button>
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <SectionTitle eyebrow="Resultados" title="Jogos sorteados" detail="Mantenha até cinco jogos. Use Retirar para descartar um título e liberar uma vaga para outro sorteio." />
                  <span className="rounded-lg border border-white/10 px-2 py-1 text-xs font-black text-white/55">{state.drawnNames.length}/5</span>
                </div>
                {state.drawnNames.length > 0 ? (
                  <div className="space-y-2">
                    {state.drawnNames.map((name, index) => (
                      <div key={name} className="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-400/25 bg-red-500/10 text-sm font-black text-red-200">{index + 1}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[9px] font-black uppercase tracking-[0.18em] text-red-300">{state.manualDrawnNames.includes(name) ? "Escolha manual" : "Jogo sorteado " + (index + 1)}</p>
                          <p className="mt-1 break-words text-sm font-black text-white">{name}</p>
                        </div>
                        <span className="text-lg">🏆</span>
                        <button type="button" onClick={() => removeDrawnResult(name)} disabled={isDrawing || showWinnerAlert} title={"Retirar " + name + " dos resultados"} aria-label={"Retirar " + name + " dos resultados"} className="shrink-0 rounded-lg border border-amber-400/20 px-2 py-1.5 text-[10px] font-black text-amber-200/80 transition hover:border-amber-300/50 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-30">Retirar</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-sm text-white/30">Nenhum resultado ainda. Clique em “Sortear 1 jogo” para começar.</p>
                )}

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => void copyDrawnGame()} disabled={state.drawnNames.length === 0 && !state.drawnName} className="rounded-xl bg-white px-4 py-3 text-sm font-black text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">Copiar jogos sorteados</button>
                  <button type="button" onClick={clearDrawnGame} disabled={(state.drawnNames.length === 0 && !state.drawnName) || isDrawing || showWinnerAlert} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white/65 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-30">Limpar resultados</button>
                </div>
              </section>
            </div>
          </div>
        )}

        {showWinnerAlert && (
          <div role="dialog" aria-modal="true" aria-labelledby="roulette-winner-title" className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#030407]/95 p-3 backdrop-blur-lg sm:p-6">
            <div className="relative my-auto w-full max-w-5xl overflow-hidden rounded-3xl border border-red-500/30 bg-[#0b0d12] p-4 shadow-[0_0_120px_rgba(220,38,38,0.16)] sm:p-8">
              <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 via-amber-300 to-emerald-300" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-400/25 bg-red-500/10 text-2xl">🎰</div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.24em] text-red-300">Rumo à Conquista · Roleta em breve</p>
                    <h2 id="roulette-winner-title" className="mt-1 text-xl font-black text-white sm:text-2xl">{isDrawing ? "Sorteando o jogo " + currentDrawNumber + " de 5" : "Jogo escolhido!"}</h2>
                    <p className="mt-1 text-xs text-white/45">A roleta ocupa o centro da tela durante a animação e retorna ao painel após revelar o resultado.</p>
                  </div>
                </div>
                <div className="shrink-0 rounded-xl border border-white/10 bg-white/[0.035] px-4 py-2 text-center">
                  <p className="text-[9px] font-black uppercase tracking-widest text-white/40">Resultados</p>
                  <p className="mt-0.5 text-lg font-black text-white">{state.drawnNames.length}/5</p>
                </div>
              </div>
              <div className="mt-6 flex gap-2" aria-label="Progresso dos cinco sorteios">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={index} className={"h-1.5 flex-1 rounded-full transition-colors " + (state.drawnNames.length > index ? "bg-emerald-400" : currentDrawNumber > index ? "bg-red-500" : "bg-white/10")} />
                ))}
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 text-xs font-semibold text-white/45">
                <span>{isDrawing ? "A sorte está lançada..." : "Vencedor confirmado"}</span>
                <span>Sorteio {currentDrawNumber} de 5</span>
              </div>
              <div className="relative mt-3 h-[176px] overflow-hidden rounded-2xl border border-white/10 bg-[#07080b] sm:h-[210px] before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:z-10 before:w-12 before:bg-gradient-to-r before:from-[#07080b] before:to-transparent after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-10 after:w-12 after:bg-gradient-to-l after:from-[#07080b] after:to-transparent">
                <div className="absolute left-1/2 top-0 z-20 h-full w-0.5 -translate-x-1/2 bg-red-500 shadow-[0_0_18px_rgba(239,68,68,0.95)]" />
                <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[13px] border-x-transparent border-t-red-500" />
                {wheelItems.length > 0 ? (
                  <div
                    className="absolute left-1/2 top-0 flex h-full items-center gap-[10px] will-change-transform"
                    style={{
                      transform: "translateX(" + wheelPosition + "px)",
                      transition: isReelAnimating ? "transform " + REEL_DURATION_MS + "ms cubic-bezier(0.08, 0.65, 0.04, 1)" : "none",
                    }}
                  >
                    {wheelItems.map((candidate, index) => (
                      <div key={index + "-" + candidate.name} className={"flex h-[124px] w-[170px] shrink-0 flex-col items-center justify-center rounded-xl border px-3 text-center " + (index === REEL_WINNER_INDEX && !isDrawing ? "border-emerald-300/80 bg-emerald-400/15 shadow-[0_0_30px_rgba(52,211,153,0.22)]" : "border-white/10 bg-white/[0.035]")}>
                        <span className="mb-2 text-2xl">{index === REEL_WINNER_INDEX && !isDrawing ? "🏆" : "🎮"}</span>
                        <span className="line-clamp-2 text-xs font-black leading-4 text-white/90">{candidate.name}</span>
                        {index === REEL_WINNER_INDEX && !isDrawing && <span className="mt-1 text-[9px] font-black uppercase tracking-widest text-emerald-300">Vencedor</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                    <span className="text-4xl">🎰</span>
                    <span className="text-sm font-bold text-white/60">Preparando a roleta...</span>
                  </div>
                )}
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 px-4 py-5 text-center sm:px-6">
                {isDrawing ? (
                  <>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">A roleta está girando</p>
                    <p className="mt-2 text-xl font-black text-white sm:text-2xl">Qual será o jogo escolhido?</p>
                    <p className="mt-1 text-xs text-white/40">O nome é escolhido aleatoriamente antes de a animação começar.</p>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">🎉 {activeWinnerIsManual ? "Sua escolha" : "Jogo sorteado"}</p>
                    <p className="mt-2 break-words text-xl font-black text-white sm:text-2xl">{activeWinnerName}</p>
                    <p className="mt-1 text-xs text-white/40">Voltando ao painel automaticamente...</p>
                    <button type="button" onClick={finishPresentation} className="mt-4 rounded-xl bg-white px-6 py-3 text-sm font-black text-black transition hover:bg-white/85">Voltar ao painel agora</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="mt-7 text-center text-xs leading-5 text-white/30">
          Este banco e o lote são salvos no armazenamento local deste navegador. Eles não alteram os jogos cadastrados nem a fila oficial de Próximas Maestrias.
        </p>
      </div>
    </main>
  );
}
