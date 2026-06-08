type JourneyItem = {
  icon: string;
  title: string;
  value: string;
  progress?: number;
};

type ObjectivesProps = {
  items: JourneyItem[];
};

export default function Objectives({
  items,
}: ObjectivesProps) {
  return (
    <section className="max-w-[1500px] mx-auto px-8 mt-10">
      <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-8">
        <div className="mb-8">
          <h2 className="text-4xl font-black">
            Painel da Jornada
          </h2>

          <p className="text-white/50 mt-2">
            Progresso geral da aventura
          </p>
        </div>

        <div className="grid grid-cols-3 gap-5">
          {items.map((item, index) => (
            <div
              key={index}
              className="rounded-3xl border border-white/10 bg-black/30 p-6 hover:border-white/20 hover:bg-white/[0.03] transition"
            >
              <div className="text-3xl mb-4">
                {item.icon}
              </div>

              <h3 className="text-lg font-bold">
                {item.title}
              </h3>

              <p className="text-white/70 mt-1">
                {item.value}
              </p>

              {item.progress !== undefined && (
                <div className="mt-5">
                  <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-500 rounded-full shadow-[0_0_12px_rgba(239,68,68,0.8)]"
                      style={{
                        width: `${item.progress}%`,
                      }}
                    />
                  </div>

                  <p className="text-xs text-white/40 mt-2">
                    {item.progress}% concluído
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}