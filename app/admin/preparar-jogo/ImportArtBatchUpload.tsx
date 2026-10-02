"use client";

import { useMemo, useState } from "react";

type PreparedAchievement = {
  name: string;
  filename: string;
  rank: string;
};

type SavedAchievement = {
  filename: string;
  title: string;
  image: string;
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
  onSaved,
}: {
  achievements: PreparedAchievement[];
  gameSlug: string;
  onSaved?: (saved: SavedAchievement[]) => void;
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
    okCount > 0 &&
    unknownCount === 0 &&
    duplicateCount === 0 &&
    !uploading;

  async function save() {
    setUploading(true);
    setMessage("");

    try {
      let savedCount = 0;
      const savedResults: SavedAchievement[] = [];

      // A Vercel limita o corpo de uma requisição de Function a 4,5 MB.
      // Enviar uma imagem por requisição evita que 10 PNGs somados ultrapassem esse limite.
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];

        if (file.size > 4 * 1024 * 1024) {
          throw new Error(
            `A imagem "${file.name}" tem ${(file.size / 1024 / 1024).toFixed(2)} MB. Para este envio, cada arquivo precisa ter no máximo 4 MB.`
          );
        }

        setMessage(`Salvando ${index + 1}/${files.length}: ${file.name}`);

        const body = new FormData();
        body.append("gameSlug", gameSlug);
        body.append("expectedFilenames", JSON.stringify([file.name]));
        body.append("files", file);

        const response = await fetch("/api/admin/achievement-art", {
          method: "POST",
          body,
        });

        const raw = await response.text();
        let payload: {
          error?: string;
          count?: number;
          saved?: SavedAchievement[];
        } = {};

        try {
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(
            response.status === 413
              ? "O arquivo enviado é grande demais para a Vercel. Reduza o tamanho da imagem e tente novamente."
              : raw.trim() || "O servidor não retornou uma resposta válida."
          );
        }

        if (!response.ok) {
          throw new Error(
            payload.error || `Não foi possível salvar "${file.name}".`
          );
        }

        savedCount += Number(payload.count ?? 1);

        if (Array.isArray(payload.saved)) {
          savedResults.push(
            ...payload.saved.filter(
              (item: unknown): item is SavedAchievement =>
                Boolean(
                  item &&
                    typeof item === "object" &&
                    typeof (item as SavedAchievement).filename === "string" &&
                    typeof (item as SavedAchievement).title === "string" &&
                    typeof (item as SavedAchievement).image === "string"
                )
            )
          );
        }
      }

      if (savedResults.length > 0 && onSaved) {
        onSaved(savedResults);
      }

      setMessage(
        savedCount === 1
          ? "1 arte salva com sucesso."
          : savedCount + " artes salvas com sucesso."
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
        Selecione as imagens do lote. O nome do arquivo identifica
        automaticamente cada conquista; você pode importar um lote por vez.
      </p>

      <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[.02] px-5 py-8 text-center hover:border-red-500/30">
        <span className="text-sm font-black">Selecionar imagens</span>
        <span className="mt-1 text-[9px] uppercase tracking-wider text-white/25">
          PNG, JPG ou WEBP • seleção múltipla • até 4 MB por arquivo
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
            <div className="mt-4 rounded-xl border border-white/[.06] bg-white/[.02] p-3">
              <p className="text-[9px] font-black uppercase tracking-wider text-white/35">
                Outras conquistas ainda sem imagem
              </p>
              <p className="mt-2 text-xs text-white/35">
                Isso é normal ao importar um lote parcial. Você pode salvar as imagens reconhecidas agora e importar as restantes depois.
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
