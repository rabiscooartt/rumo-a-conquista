type ReviewScoreCardProps = {
  nota: string;
  status: string;
};

export default function ReviewScoreCard({ nota, status }: ReviewScoreCardProps) {
  return (
    <div className="w-[230px] rounded-2xl border border-red-500/30 bg-red-950/35 p-5 shadow-[0_0_30px_rgba(239,68,68,0.16)] backdrop-blur-md">
      <p className="text-xs font-black uppercase tracking-[0.3em] text-red-300">
        Nota
      </p>

      <p className="mt-2 text-5xl font-black leading-none text-white">
        {nota}
      </p>

      <p className="mt-3 text-xs font-black uppercase tracking-[0.22em] text-white/45">
        {status}
      </p>

      <a
        href="#review-section"
        className="mt-5 inline-flex w-full items-center justify-center rounded-xl border border-red-400/30 bg-red-500 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white shadow-[0_0_20px_rgba(239,68,68,0.35)] transition hover:bg-red-400 hover:shadow-[0_0_30px_rgba(239,68,68,0.5)]"
      >
        Ver review
      </a>
    </div>
  );
}