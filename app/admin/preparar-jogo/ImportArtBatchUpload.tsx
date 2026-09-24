"use client";

import { useMemo, useState } from "react";

type PreparedAchievement = {
  name: string;
  filename: string;
  rank: string;
};

type FileStatus = {
  file: File;
  achievement: PreparedAchievement | null;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[-_\s]*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function ImportArtBatchUpload({
  achievements,
  gameSlug,
}: {
  achievements: PreparedAchievement[];
  gameSlug: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  const results = useMemo<FileStatus[]>(
    () =>
      files.map((file) => {
        const key = normalize(file.name);
        const achievement = achievements.find(
          (item) => normalize(item.filename) === key
        );
        return { file, achievement: achievement ?? null };
      }),
    [files, achievements]
  );

  const missing = useMemo(
    () =>
      achievements.filter(
        (achievement) =>
          !results.some(
            (item) => item.achievement?.filename === achievement.filename
          )
      ),
    [achievements, results]
  );

  const okCount = results.filter((item) => item.achievement).length;
  const unknownCount = results.length - okCount;
  const duplicateCount =
    results.length -
    new Set(
      results
        .filter((item) => item.achievement)
        .map((item) => item.achievement!.filename)
    ).size;

  const ready =
    results.length > 0 &&
    unknownCount === 0 &&
    missing.length === 0 &&
    duplicateCount === 0 &&
    !uploading;

  async function save() {
    setUploading(true);
    setMessage("");

    try {
      const body = new FormData();
      body.append("gameSlug", gameSlug);
      body.append(
        "expectedFilenames",
        JSON.stringify(achievements.map((item) => item.filename))
      );
      files.forEach((file) => body.append("files", file));

      const response = await fetch("/api/admin/achievement-art", {
        method: "POST",
        body,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Não foi possível salvar as artes.");
      }

      setMessage(
        payload.count === 1
          ? "1 arte salva com sucesso."
          : payload.count + " artes salvas com sucesso."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Erro ao salvar as artes."
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="mt-5 rounded-[20px] border border-white/[.07] bg-black/25 p-5">
      <p className="text-[9px] uppercase tracking-[.18em] text-red-500">
        06 • Importar artes
      </p>
      <h2 className="mt-1 text-xl font-black">
        Adicionar imagens das conquistas
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-white/35">
        Selecione todas as imagens do lote de uma vez. O nome do arquivo
        identifica automaticamente a conquista.
      </p>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[.02] px-5 py-8 text-center hover:border-red-500/30">
        <span className="text-sm font-black">Selecionar imagens</span>
        <span className="mt-1 text-[9px] uppercase tracking-wider text-white/25">
          PNG, JPG ou WEBP • seleção múltipla
        </span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="sr-only"
          onChange={(event) => {
            setFiles(Array.from(event.target.files ?? []));
            setMessage("");
          }}
        />
      </label>

      {files.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-2 text-[9px] font-black uppercase">
            <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300">
              ✓ {okCount} reconhecidas
            </span>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-amber-300">
              ⚠ {unknownCount} não reconhecidas
            </span>
            <span className="rounded-full bg-white/5 px-3 py-1 text-white/40">
              Faltando: {missing.length}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {results.map((item) => (
              <div
                key={item.file.name}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[.06] bg-white/[.02] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold">{item.file.name}</p>
                  <p className="text-[9px] text-white/30">
                    {item.achievement
                      ? `→ ${item.achievement.name} • ${item.achievement.rank}`
                      : "→ Arquivo não reconhecido"}
                  </p>
                </div>
                <span
                  className={
                    item.achievement
                      ? "text-emerald-400"
                      : "text-amber-400"
                  }
                >
                  {item.achievement ? "✓" : "⚠"}
                </span>
              </div>
            ))}
          </div>

          {missing.length > 0 && (
            <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/[.04] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-amber-300">
                Conquistas sem imagem
              </p>
              <p className="mt-2 text-xs text-white/45">
                {missing.map((item) => item.name).join(" • ")}
              </p>
            </div>
          )}

          {unknownCount > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[.04] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-amber-300">
                Arquivos não reconhecidos
              </p>
              <p className="mt-2 text-xs text-white/45">
                O nome do arquivo precisa corresponder ao arquivo preparado
                para a conquista.
              </p>
            </div>
          )}

          {duplicateCount > 0 && (
            <div className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[.04] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-red-300">
                Arquivos duplicados
              </p>
              <p className="mt-2 text-xs text-white/45">
                Há mais de uma imagem apontando para a mesma conquista.
              </p>
            </div>
          )}

          <button
            type="button"
            disabled={!ready}
            onClick={() => void save()}
            className="mt-4 w-full rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-red-100 disabled:cursor-not-allowed disabled:opacity-30"
          >
            {uploading ? "Salvando artes..." : "Confirmar e salvar artes"}
          </button>

          {message && (
            <p
              className={
                message.includes("sucesso")
                  ? "mt-3 text-center text-[10px] text-emerald-300"
                  : "mt-3 text-center text-[10px] text-red-300"
              }
            >
              {message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
