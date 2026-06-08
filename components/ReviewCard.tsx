type ReviewCardProps = {
  review: {
    status: string;
    nota: string;
    resumo: string;
    melhorMomento: string;
    dificuldade: string;
    pontosFortes: string[];
    pontosFracos: string[];
  };
};

export default function ReviewCard({ review }: ReviewCardProps) {
  return (
    <section className="rounded-[26px] border border-white/10 bg-zinc-950/70 p-7 shadow-xl">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-black uppercase tracking-[0.28em] text-red-400">
            Minha Experiência
          </p>

          <h2 className="mt-3 text-3xl font-black text-white">
            Review da jornada
          </h2>

          <p className="mt-4 text-sm leading-relaxed text-zinc-400">
            {review.resumo}
          </p>
        </div>

        <div className="min-w-[220px] rounded-2xl border border-red-500/20 bg-red-500/10 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-red-300">
            Nota
          </p>

          <p className="mt-2 text-4xl font-black text-white">
            {review.nota}
          </p>

          <p className="mt-2 text-xs font-bold uppercase tracking-[0.18em] text-white/45">
            {review.status}
          </p>
        </div>
      </div>

      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500">
            Melhor momento
          </p>

          <p className="mt-2 text-lg font-black text-white">
            {review.melhorMomento}
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-zinc-500">
            Dificuldade percebida
          </p>

          <p className="mt-2 text-lg font-black text-white">
            {review.dificuldade}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/5 p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-emerald-300">
            Pontos fortes
          </p>

          <ul className="mt-4 space-y-3">
            {review.pontosFortes.map((item) => (
              <li
                key={item}
                className="flex gap-3 text-sm leading-relaxed text-zinc-300"
              >
                <span className="text-emerald-300">+</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border border-red-500/15 bg-red-500/5 p-5">
          <p className="text-xs font-black uppercase tracking-[0.22em] text-red-300">
            Pontos fracos
          </p>

          <ul className="mt-4 space-y-3">
            {review.pontosFracos.map((item) => (
              <li
                key={item}
                className="flex gap-3 text-sm leading-relaxed text-zinc-300"
              >
                <span className="text-red-300">-</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}