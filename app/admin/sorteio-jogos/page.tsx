"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import Link from "next/link";
import Navbar from "@/components/Navbar";

type CandidateCategory = "Na fila" | "Rejogar";
type Candidate = { name: string; category: CandidateCategory };
type GamePickerState = {
  bank: Candidate[];
  manualNames: string[];
  randomNames: string[];
  initialized: boolean;
};

const STORAGE_KEY = "rumo-a-conquista-game-picker-v1";
const EMPTY_STATE: GamePickerState = {
  bank: [],
  manualNames: [],
  randomNames: [],
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
  const hasHeader = nameColumn >= 0 && categoryColumn >= 0;
  const gameColumn = hasHeader ? nameColumn : 0;
  const statusColumn = hasHeader ? categoryColumn : 1;
  const sourceRows = hasHeader ? rows.slice(1) : rows;
  const editionMap = new Map<string, Candidate>();

  for (const row of sourceRows) {
    const name = (row[gameColumn] || "").replace(/\s+/g, " ").trim();
    const status = normalize(row[statusColumn] || "");

    if (!name || /^https?:\/\//i.test(name)) continue;
    let category: CandidateCategory;
    if (status.includes("rejogar")) category = "Rejogar";
    else if (status.includes("na fila")) category = "Na fila";
    else continue;

    const key = baseEditionKey(name);
    if (!key) continue;

    const previous = editionMap.get(key);
    if (!previous) {
      editionMap.set(key, { name, category });
      continue;
    }

    const chosenName = isDeluxe(name) && !isDeluxe(previous.name) ? name : previous.name;
    const chosenCategory = previous.category === "Rejogar" || category === "Rejogar" ? "Rejogar" : "Na fila";
    editionMap.set(key, { name: chosenName, category: chosenCategory });
  }

  return [...editionMap.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function readSavedState(): Omit<GamePickerState, "initialized"> {
  if (typeof window === "undefined") {
    return { bank: [], manualNames: [], randomNames: [] };
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return { bank: [], manualNames: [], randomNames: [] };

    const parsed = JSON.parse(saved) as {
      bank?: Candidate[];
      manualNames?: string[];
      randomNames?: string[];
    };
    const bank = Array.isArray(parsed.bank)
      ? cleanCandidates([
          ["Jogo", "Categoria"],
          ...parsed.bank.map((candidate) => [
            String(candidate?.name || ""),
            String(candidate?.category || ""),
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

    return { bank, manualNames, randomNames };
  } catch {
    return { bank: [], manualNames: [], randomNames: [] };
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
  const [categoryFilter, setCategoryFilter] = useState<"Todos" | CandidateCategory>("Todos");
  const [isDrawing, setIsDrawing] = useState(false);
  const [message, setMessage] = useState("");
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [newGameName, setNewGameName] = useState("");
  const [newGameCategory, setNewGameCategory] = useState<CandidateCategory>("Na fila");

  useEffect(() => {
    const stored = readSavedState();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ ...stored, initialized: true });
  }, []);

  useEffect(() => {
    if (!state.initialized) return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        bank: state.bank,
        manualNames: state.manualNames,
        randomNames: state.randomNames,
      })
    );
  }, [state]);

  const selectedSet = useMemo(() => new Set(state.manualNames), [state.manualNames]);
  const filteredBank = useMemo(() => {
    const term = normalize(search);
    return state.bank.filter((candidate) => {
      const matchesSearch = !term || normalize(candidate.name).includes(term);
      const matchesCategory = categoryFilter === "Todos" || candidate.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [state.bank, search, categoryFilter]);

  const queueCount = state.bank.filter((candidate) => candidate.category === "Na fila").length;
  const replayCount = state.bank.filter((candidate) => candidate.category === "Rejogar").length;
  const remainingCount = state.bank.length - state.manualNames.length;

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
      }));
      setMessage("Banco importado: " + imported.length + " jogos prontos para a seleção.");
    } catch {
      setMessage("Não foi possível ler esse arquivo. Tente importar o CSV novamente.");
    } finally {
      input.value = "";
    }
  }

  function addGame() {
    const name = newGameName.trim().replace(/\\s+/g, " ");

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
        const category: CandidateCategory =
          existing.category === "Rejogar" || newGameCategory === "Rejogar"
            ? "Rejogar"
            : "Na fila";

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
        }));
        setNewGameName("");
        setMessage(
          "A versão normal foi substituída pela Deluxe. O jogo continua aparecendo apenas uma vez no banco."
        );
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
      bank: [...current.bank, { name, category: newGameCategory }].sort(
        (a, b) => a.name.localeCompare(b.name, "pt-BR")
      ),
    }));
    setNewGameName("");
    setMessage('"' + name + '" foi adicionado ao banco como "' + newGameCategory + '".');
  }

  function toggleManual(name: string) {
    setState((current) => {
      const exists = current.manualNames.includes(name);
      if (exists) {
        return {
          ...current,
          manualNames: current.manualNames.filter((item) => item !== name),
          randomNames: [],
        };
      }
      if (current.manualNames.length >= 5) return current;
      return { ...current, manualNames: [...current.manualNames, name], randomNames: [] };
    });
  }

  function drawRandomGames() {
    if (state.manualNames.length !== 5 || remainingCount < 5 || isDrawing) return;
    setIsDrawing(true);
    setMessage("A roleta está escolhendo os outros 5 jogos…");

    const manualSet = new Set(state.manualNames);
    const pool = state.bank.filter((candidate) => !manualSet.has(candidate.name));
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    const winners = pool.slice(0, 5).map((candidate) => candidate.name);

    window.setTimeout(() => {
      setState((current) => ({ ...current, randomNames: winners }));
      setIsDrawing(false);
      setMessage("Sorteio concluído. Os 10 jogos estão separados e sem repetição.");
    }, 900);
  }

  function resetSelection() {
    setState((current) => ({ ...current, manualNames: [], randomNames: [] }));
    setMessage("Seleção limpa. O banco de jogos foi preservado.");
  }

  async function copyBatch() {
    if (state.manualNames.length !== 5 || state.randomNames.length !== 5) return;

    const manualLines = state.manualNames.map((name, index) => (index + 1) + ". " + name).join("\n");
    const randomLines = state.randomNames.map((name, index) => (index + 6) + ". " + name).join("\n");
    const text = [
      "🎮 RUMO À CONQUISTA | ESCOLHENDO OS PRÓXIMOS 10 JOGOS 🎲",
      "",
      "ESCOLHIDOS MANUALMENTE",
      manualLines,
      "",
      "SORTEADOS NA ROLETA",
      randomLines,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setMessage("Título e lista dos 10 jogos copiados para usar no roteiro ou no YouTube.");
    } catch {
      setMessage("O navegador bloqueou a cópia automática. Selecione os jogos abaixo e copie manualmente.");
    }
  }

  function downloadBackup() {
    if (state.bank.length === 0) return;
    const csv = ["Jogo,Categoria", ...state.bank.map((candidate) => {
      const name = '"' + candidate.name.replace(/"/g, '""') + '"';
      return name + "," + candidate.category;
    })].join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "banco-jogos-rumo-a-conquista.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const hasCompleteBatch = state.manualNames.length === 5 && state.randomNames.length === 5;

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
              Escolha 5 jogos para o próximo lote e deixe a roleta sortear outros 5, sem repetir nenhum título.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
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
              <input type="file" accept=".csv,text/csv" onChange={(event) => void handleImport(event)} className="hidden" />
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
                  O jogo será salvo neste navegador e poderá participar dos próximos sorteios, sem alterar a fila oficial de Maestrias.
                </p>
              </div>
              <span className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-white/45">
                {state.bank.length} no banco
              </span>
            </div>

            <form
              className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_210px_auto]"
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
              <select
                aria-label="Categoria do jogo"
                value={newGameCategory}
                onChange={(event) => setNewGameCategory(event.target.value as CandidateCategory)}
                className="rounded-xl border border-white/10 bg-[#101319] px-3 py-3 text-sm text-white/85 outline-none focus:border-red-500/50"
              >
                <option value="Na fila">🎮 Na fila</option>
                <option value="Rejogar">🔄 Rejogar</option>
              </select>
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
            { label: "Banco total", value: state.bank.length, tone: "text-white" },
            { label: "Na fila", value: queueCount, tone: "text-red-300" },
            { label: "Rejogar", value: replayCount, tone: "text-amber-200" },
            { label: "Jogos livres p/ sorteio", value: remainingCount, tone: "text-emerald-300" },
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
              Importe o arquivo <strong className="text-white/80">jogos_fila_rejogar_limpos.csv</strong> que preparamos. O banco ficará salvo neste navegador e não altera a fila oficial de Próximas Maestrias.
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
                <SectionTitle eyebrow="Etapa 01" title="Escolha 5 jogos" detail="Marque seus favoritos. Eles ficam protegidos contra o sorteio aleatório." />
                <span className={"shrink-0 rounded-xl border px-3 py-2 text-sm font-black " + (state.manualNames.length === 5 ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-white/10 bg-white/[0.04] text-white/70")}>
                  {state.manualNames.length}/5
                </span>
              </div>

              <div className="mb-4 flex flex-col gap-3 sm:flex-row">
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar jogo pelo nome..." className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-red-500/50" />
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "Todos" | CandidateCategory)} className="rounded-xl border border-white/10 bg-[#101319] px-3 py-3 text-sm text-white/80 outline-none focus:border-red-500/50">
                  <option value="Todos">Todas as categorias</option>
                  <option value="Na fila">Na fila</option>
                  <option value="Rejogar">Rejogar</option>
                </select>
              </div>

              <div className="mb-3 flex items-center justify-between text-xs text-white/40">
                <span>{filteredBank.length} jogos encontrados</span>
                <span>Selecione até 5</span>
              </div>

              <div className="max-h-[500px] space-y-2 overflow-y-auto pr-1">
                {filteredBank.map((candidate) => {
                  const checked = selectedSet.has(candidate.name);
                  const locked = !checked && state.manualNames.length >= 5;
                  return (
                    <button key={candidate.name} type="button" disabled={locked || isDrawing} aria-pressed={checked} onClick={() => toggleManual(candidate.name)} className={"flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition " + (checked ? "border-red-500/40 bg-red-500/10" : "border-white/[0.07] bg-black/20 hover:border-white/20 hover:bg-white/[0.04]") + ((locked || isDrawing) ? " cursor-not-allowed opacity-45" : "")}>
                      <span className={"flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs font-black " + (checked ? "border-red-400 bg-red-500 text-white" : "border-white/20 text-transparent")}>{checked ? "✓" : "✓"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-white/90">{candidate.name}</span>
                        <span className={"mt-1 block text-[10px] font-black uppercase tracking-[0.16em] " + (candidate.category === "Rejogar" ? "text-amber-200/70" : "text-white/35")}>{candidate.category}</span>
                      </span>
                      {checked && <span className="text-[10px] font-black uppercase tracking-wider text-red-300">Escolhido</span>}
                    </button>
                  );
                })}
                {filteredBank.length === 0 && <p className="rounded-xl border border-white/10 px-4 py-8 text-center text-sm text-white/40">Nenhum jogo encontrado com esse filtro.</p>}
              </div>
            </section>

            <div className="space-y-5">
              <section className="rounded-3xl border border-red-500/20 bg-gradient-to-br from-red-500/[0.09] via-white/[0.025] to-transparent p-5 sm:p-6">
                <SectionTitle eyebrow="Etapa 02" title="Gire a roleta" detail="Os outros 5 jogos serão escolhidos aleatoriamente, excluindo os cinco que você marcou." />
                <div className="mb-5 flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className={"flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-red-400/30 bg-red-500/10 text-3xl " + (isDrawing ? "animate-spin" : "")}>🎲</div>
                  <div>
                    <p className="text-base font-black text-white">{isDrawing ? "Sorteando os jogos..." : state.randomNames.length === 5 ? "Sorteio concluído" : "Pronto para sortear"}</p>
                    <p className="mt-1 text-sm text-white/45">{state.manualNames.length}/5 escolhidos manualmente · {remainingCount} disponíveis para a roleta</p>
                  </div>
                </div>
                <button type="button" onClick={drawRandomGames} disabled={state.manualNames.length !== 5 || remainingCount < 5 || isDrawing} className="w-full rounded-xl bg-red-600 px-5 py-4 text-sm font-black uppercase tracking-[0.08em] text-white shadow-[0_12px_35px_rgba(220,38,38,0.16)] transition hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none">
                  {isDrawing ? "A roleta está girando..." : state.randomNames.length === 5 ? "Sortear novamente" : "Girar roleta e sortear 5"}
                </button>
                {state.manualNames.length !== 5 && <p className="mt-3 text-center text-xs text-white/40">Escolha exatamente 5 jogos para habilitar a roleta.</p>}
              </section>

              <section className="rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <SectionTitle eyebrow="Resultado" title="Seu lote de 10 jogos" detail="A lista fica guardada neste navegador enquanto você trabalha no lote." />
                  <span className="rounded-lg border border-white/10 px-2 py-1 text-xs font-black text-white/55">{state.manualNames.length + state.randomNames.length}/10</span>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-red-300">Escolha manual · 5 jogos</p>
                    {state.manualNames.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/30">Os jogos que você marcar aparecerão aqui.</p> : (
                      <div className="space-y-2">
                        {state.manualNames.map((name, index) => <div key={name} className="flex items-center gap-3 rounded-xl bg-red-500/[0.07] px-3 py-2.5"><span className="text-xs font-black text-red-300">{String(index + 1).padStart(2, "0")}</span><span className="text-sm font-semibold text-white/85">{name}</span></div>)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">Sorteio · 5 jogos</p>
                    {state.randomNames.length === 0 ? <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/30">Os sorteados aparecerão depois que a roleta girar.</p> : (
                      <div className="space-y-2">
                        {state.randomNames.map((name, index) => <div key={name} className="flex items-center gap-3 rounded-xl bg-amber-400/[0.06] px-3 py-2.5"><span className="text-xs font-black text-amber-200">{String(index + 6).padStart(2, "0")}</span><span className="text-sm font-semibold text-white/85">{name}</span></div>)}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button type="button" onClick={() => void copyBatch()} disabled={!hasCompleteBatch} className="rounded-xl bg-white px-4 py-3 text-sm font-black text-black transition hover:bg-white/85 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30">
                    Copiar lista + título
                  </button>
                  <button type="button" onClick={resetSelection} disabled={state.manualNames.length === 0 && state.randomNames.length === 0} className="rounded-xl border border-white/10 px-4 py-3 text-sm font-bold text-white/65 transition hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-30">
                    Limpar seleção
                  </button>
                </div>
              </section>
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
