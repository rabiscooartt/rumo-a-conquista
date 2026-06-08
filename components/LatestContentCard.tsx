type LatestContent = {
  tipo: "Live" | "Vídeo" | "Corte" | "Resumo" | "Review";
  titulo: string;
  plataforma: string;
  data: string;
  link: string;
  thumbnail: string;
  descricao?: string;
};

type LatestContentCardProps = {
  content?: LatestContent;
};

export default function LatestContentCard({ content }: LatestContentCardProps) {
  if (!content) {
    return (
      <section className="rounded-2xl border border-white/10 bg-zinc-950/70 p-6 shadow-xl">
        <div className="mb-4">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
            Último Conteúdo
          </p>

          <h2 className="mt-2 text-2xl font-black text-white">
            Nenhum conteúdo publicado ainda
          </h2>
        </div>

        <p className="text-sm text-zinc-400">
          Quando você publicar uma live, vídeo, corte ou resumo sobre este jogo,
          ele vai aparecer aqui.
        </p>
      </section>
    );
  }

  const badgeColor =
    content.tipo === "Live"
      ? "bg-red-500/15 text-red-300 border-red-500/30"
      : content.tipo === "Vídeo"
      ? "bg-red-500/15 text-red-300 border-red-500/30"
      : content.tipo === "Corte"
      ? "bg-blue-500/15 text-blue-300 border-blue-500/30"
      : content.tipo === "Review"
      ? "bg-yellow-500/15 text-yellow-300 border-yellow-500/30"
      : "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";

  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-zinc-950/70 shadow-xl">
      <div className="grid gap-0 md:grid-cols-[330px_1fr]">
        <div className="relative min-h-[220px] overflow-hidden bg-zinc-900">
          <img
            src={content.thumbnail}
            alt={content.titulo}
            className="h-full w-full object-cover transition duration-500 hover:scale-105"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" />

          <div className="absolute left-4 top-4">
            <span
              className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] ${badgeColor}`}
            >
              {content.tipo}
            </span>
          </div>
        </div>

        <div className="flex flex-col justify-between p-6 md:p-7">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.25em] text-red-400">
              Último Conteúdo
            </p>

            <h2 className="mt-2 text-2xl font-black leading-tight text-white">
              {content.titulo}
            </h2>

            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
              {content.descricao ||
                "Última live, vídeo ou publicação relacionada a este jogo."}
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Plataforma
                </p>
                <p className="mt-1 font-black text-white">
                  {content.plataforma}
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Data
                </p>
                <p className="mt-1 font-black text-white">{content.data}</p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Tipo
                </p>
                <p className="mt-1 font-black text-white">{content.tipo}</p>
              </div>
            </div>
          </div>

          <div className="mt-6">
            <a
              href={content.link}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl border border-red-400/30 bg-red-500 px-5 py-3 text-sm font-black uppercase tracking-wide text-white shadow-[0_0_22px_rgba(239,68,68,0.35)] transition hover:bg-red-400 hover:shadow-[0_0_30px_rgba(239,68,68,0.5)]"
            >
              Assistir agora
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}