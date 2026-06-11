"use client";

import { useEffect, useMemo, useState } from "react";

export type ReviewInput = {
  status?: string;
  nota?: string | number;
  titulo?: string;
  texto?: string;
  resumo?: string;
  positivos?: string[] | string;
  negativos?: string[] | string;
  pontosFortes?: string[] | string;
  pontosFracos?: string[] | string;
};

export type ManualReviewState = ReviewInput;

type GameReviewPanelProps = {
  slug: string;
  review?: ReviewInput;
  isUnlocked?: boolean;
  achievementsCompleted?: number;
  achievementsTotal?: number;
  [key: string]: unknown;
};

type ReviewForm = {
  status: string;
  nota: string;
  titulo: string;
  texto: string;
  positivos: string;
  negativos: string;
};

const REVIEW_UPDATED_EVENT = "rumo-a-conquista-review-updated";
const ACHIEVEMENTS_UPDATED_EVENT = "rumo-a-conquista-achievements-updated";

function readText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function textToList(value: unknown) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function listToText(value: unknown) {
  if (!value) return "";

  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).join("\n");
  }

  if (typeof value === "string") {
    return value;
  }

  return "";
}

function readLocalReview(slug: string): ReviewInput | null {
  if (typeof window === "undefined") return null;

  const savedReview = localStorage.getItem(`rumo-a-conquista-review-${slug}`);

  if (!savedReview) return null;

  try {
    return JSON.parse(savedReview) as ReviewInput;
  } catch {
    return null;
  }
}

function saveLocalReview(slug: string, review: ReviewInput) {
  if (typeof window === "undefined") return;

  localStorage.setItem(
    `rumo-a-conquista-review-${slug}`,
    JSON.stringify(review)
  );

  window.dispatchEvent(new Event(REVIEW_UPDATED_EVENT));
  window.dispatchEvent(new Event(ACHIEVEMENTS_UPDATED_EVENT));
}

function normalizeReview(review?: ReviewInput): Required<ReviewInput> {
  const source = review || {};

  return {
    status: readText(source.status, "bloqueada"),
    nota: readText(source.nota, ""),
    titulo: readText(source.titulo, "Análise da Jornada"),
    texto: readText(
      source.texto ?? source.resumo,
      "A review completa desta jornada ainda não foi escrita."
    ),
    resumo: readText(source.resumo ?? source.texto, ""),
    positivos: textToList(source.positivos ?? source.pontosFortes),
    negativos: textToList(source.negativos ?? source.pontosFracos),
    pontosFortes: textToList(source.pontosFortes ?? source.positivos),
    pontosFracos: textToList(source.pontosFracos ?? source.negativos),
  };
}

export function createDefaultReview(
  review?: ReviewInput
): Required<ReviewInput> {
  return normalizeReview(review);
}

function normalizeReviewStatus(status?: string) {
  const normalized = readText(status, "bloqueada")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (
    normalized === "liberada" ||
    normalized === "reviewliberada" ||
    normalized === "completed" ||
    normalized === "concluida" ||
    normalized === "concluido"
  ) {
    return "liberada";
  }

  if (
    normalized === "emandamento" ||
    normalized === "progress" ||
    normalized === "emprogresso"
  ) {
    return "em-andamento";
  }

  return "bloqueada";
}

function isReviewUnlocked(
  review: Required<ReviewInput>,
  isUnlocked?: boolean,
  achievementsCompleted?: number,
  achievementsTotal?: number
) {
  const status = normalizeReviewStatus(review.status);

  if (isUnlocked) return true;
  if (status === "liberada") return true;

  if (
    typeof achievementsCompleted === "number" &&
    typeof achievementsTotal === "number" &&
    achievementsTotal > 0 &&
    achievementsCompleted >= achievementsTotal
  ) {
    return true;
  }

  return false;
}

function getInitialForm(review: Required<ReviewInput>): ReviewForm {
  return {
    status: readText(review.status, "bloqueada"),
    nota: readText(review.nota, ""),
    titulo: readText(review.titulo, "Análise da Jornada"),
    texto: readText(review.texto ?? review.resumo, ""),
    positivos: listToText(review.positivos ?? review.pontosFortes),
    negativos: listToText(review.negativos ?? review.pontosFracos),
  };
}

function getScoreLabel(nota: string) {
  const score = Number(String(nota).replace(",", "."));

  if (!Number.isFinite(score)) return "Sem nota";
  if (score >= 9) return "Excelente";
  if (score >= 8) return "Muito bom";
  if (score >= 7) return "Bom";
  if (score >= 6) return "Regular";

  return "Abaixo do esperado";
}

function ScoreDisplay({
  nota,
  size = "large",
}: {
  nota: string;
  size?: "large" | "hero";
}) {
  const score = readText(nota, "?");
  const scoreClass = size === "hero" ? "text-5xl" : "text-6xl";
  const slashClass = size === "hero" ? "text-2xl" : "text-3xl";

  return (
    <div className="mt-5 flex items-end gap-1">
      <span className={`${scoreClass} font-black leading-none text-white`}>
        {score || "?"}
      </span>

      <span
        className={`${slashClass} pb-1 font-black leading-none text-white/45`}
      >
        /10
      </span>
    </div>
  );
}

function ReviewList({
  title,
  items,
  accent,
}: {
  title: string;
  items: string[];
  accent: "positive" | "negative";
}) {
  const colorClass =
    accent === "positive"
      ? "border-emerald-400/20 bg-emerald-500/5 text-emerald-200"
      : "border-red-400/20 bg-red-500/5 text-red-200";

  return (
    <div className={`rounded-2xl border p-5 ${colorClass}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-white/40">
        {title}
      </p>

      {items.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {items.map((item, index) => (
            <li
              key={`${item}-${index}`}
              className="flex gap-3 text-sm font-bold leading-relaxed text-white/75"
            >
              <span>{accent === "positive" ? "✅" : "⚠️"}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-white/40">
          Nenhum item cadastrado ainda.
        </p>
      )}
    </div>
  );
}

export default function GameReviewPanel({
  slug,
  review,
  isUnlocked,
  achievementsCompleted,
  achievementsTotal,
}: GameReviewPanelProps) {
  const [localReview, setLocalReview] = useState<ReviewInput | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  const mergedReview = useMemo(() => {
    return normalizeReview(localReview || review);
  }, [localReview, review]);

  const [form, setForm] = useState<ReviewForm>(() =>
    getInitialForm(mergedReview)
  );

  const unlocked = isReviewUnlocked(
    mergedReview,
    isUnlocked,
    achievementsCompleted,
    achievementsTotal
  );

  const positives = textToList(
    mergedReview.positivos ?? mergedReview.pontosFortes
  );

  const negatives = textToList(
    mergedReview.negativos ?? mergedReview.pontosFracos
  );

  useEffect(() => {
    setLocalReview(readLocalReview(slug));
  }, [slug]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsEditing(params.get("editar") === "1");
  }, []);

  useEffect(() => {
    setForm(getInitialForm(mergedReview));
  }, [mergedReview]);

  function handleSaveReview() {
    const nextReview: ReviewInput = {
      status: form.status,
      nota: form.nota.trim(),
      titulo: form.titulo.trim() || "Análise da Jornada",
      texto: form.texto.trim(),
      resumo: form.texto.trim(),
      positivos: textToList(form.positivos),
      negativos: textToList(form.negativos),
      pontosFortes: textToList(form.positivos),
      pontosFracos: textToList(form.negativos),
    };

    setLocalReview(nextReview);
    saveLocalReview(slug, nextReview);

    alert("Review salva com sucesso.");
  }

  if (!unlocked && !isEditing) {
    return (
      <section
        id="review-section"
        className="grid gap-6 lg:grid-cols-[320px_1fr]"
      >
        <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-6 shadow-xl">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
              Review
            </p>

            <span className="rounded-md border border-white/10 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-white/45">
              Bloqueada
            </span>
          </div>

          <h2 className="mt-4 text-3xl font-black text-white">Nota Final</h2>

          <ScoreDisplay nota="?" />

          <p className="mt-5 text-sm leading-relaxed text-white/45">
            A review será liberada quando todas as conquistas forem concluídas.
          </p>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
            Análise
          </p>

          <h2 className="mt-4 text-4xl font-black leading-tight text-white">
            Review bloqueada
          </h2>

          <p className="mt-5 text-base font-medium leading-8 text-white/60">
            Complete os objetivos da jornada para desbloquear a review completa
            deste jogo.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section id="review-section" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <div className="rounded-[28px] border border-red-500/25 bg-red-950/20 p-6 shadow-xl">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
              Review
            </p>

            <span className="rounded-md border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">
              Liberada
            </span>
          </div>

          <h2 className="mt-4 text-3xl font-black text-white">Nota Final</h2>

          <ScoreDisplay nota={readText(mergedReview.nota, "?")} />

          <p className="mt-5 text-sm font-black uppercase tracking-[0.18em] text-red-200">
            {getScoreLabel(readText(mergedReview.nota, ""))}
          </p>
        </div>

        <div className="rounded-[28px] border border-white/10 bg-zinc-950/80 p-7 shadow-xl">
          <p className="text-xs font-black uppercase tracking-[0.3em] text-red-400">
            Análise
          </p>

          <h2 className="mt-4 text-4xl font-black leading-tight text-white">
            {readText(mergedReview.titulo, "Análise da Jornada")}
          </h2>

          <p className="mt-5 whitespace-pre-line text-base font-medium leading-8 text-white/70">
            {readText(
              mergedReview.texto ?? mergedReview.resumo,
              "Review ainda não escrita."
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ReviewList
          title="Pontos positivos"
          items={positives}
          accent="positive"
        />

        <ReviewList
          title="Pontos negativos"
          items={negatives}
          accent="negative"
        />
      </div>

      {isEditing && (
        <section className="rounded-[28px] border border-purple-400/20 bg-purple-500/5 p-6 shadow-xl">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.3em] text-purple-300">
                Editor
              </p>

              <h2 className="mt-2 text-3xl font-black text-white">
                Editar review
              </h2>

              <p className="mt-2 text-sm text-white/45">
                Essa edição salva no navegador e atualiza a página do jogo.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSaveReview}
              className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-5 py-3 text-sm font-black text-emerald-200 transition hover:bg-emerald-500/25"
            >
              Salvar review
            </button>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Status
              </span>

              <select
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-purple-400/40"
              >
                <option value="bloqueada">Bloqueada</option>
                <option value="em-andamento">Em andamento</option>
                <option value="liberada">Review liberada</option>
              </select>
            </label>

            <label>
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Nota
              </span>

              <input
                value={form.nota}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    nota: event.target.value,
                  }))
                }
                placeholder="Ex: 8"
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-purple-400/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Título da análise
              </span>

              <input
                value={form.titulo}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    titulo: event.target.value,
                  }))
                }
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold text-white outline-none focus:border-purple-400/40"
              />
            </label>

            <label className="md:col-span-2 xl:col-span-4">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Texto da review
              </span>

              <textarea
                value={form.texto}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    texto: event.target.value,
                  }))
                }
                rows={6}
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-purple-400/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Pontos positivos
              </span>

              <textarea
                value={form.positivos}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    positivos: event.target.value,
                  }))
                }
                rows={4}
                placeholder="Um ponto positivo por linha"
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-purple-400/40"
              />
            </label>

            <label className="md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-white/35">
                Pontos negativos
              </span>

              <textarea
                value={form.negativos}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    negativos: event.target.value,
                  }))
                }
                rows={4}
                placeholder="Um ponto negativo por linha"
                className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-black/35 px-4 py-3 text-sm font-bold leading-relaxed text-white outline-none focus:border-purple-400/40"
              />
            </label>
          </div>
        </section>
      )}
    </section>
  );
}