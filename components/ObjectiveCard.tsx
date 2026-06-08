type ObjectiveCardProps = {
  title: string;
};

export default function ObjectiveCard({ title }: ObjectiveCardProps) {
  return (
    <div className="mt-4 inline-flex max-w-full items-center gap-3 rounded-xl border border-red-500/25 bg-black/45 px-4 py-3 shadow-[0_0_20px_rgba(239,68,68,0.10)] backdrop-blur-md">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 text-base">
        🎯
      </div>

      <div className="min-w-0">
        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-red-300">
          Objetivo Atual
        </p>

        <h2 className="mt-1 truncate text-base font-black text-white md:text-lg">
          {title}
        </h2>
      </div>
    </div>
  );
}