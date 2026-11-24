import Navbar from "@/components/Navbar";

// Todas as rotas são dinâmicas (o layout raiz usa force-dynamic). Sem esta tela, o Next espera a
// resposta do servidor antes de trocar de página e o clique parece não ter efeito; com ela, a troca
// é imediata e o pré-carregamento parcial das rotas passa a funcionar.
export default function Loading() {
  return (
    <main className="min-h-screen text-white" aria-busy="true">
      <Navbar idSuffix="-loading" />
      <div className="rac-route-progress" role="progressbar" aria-label="Carregando página" />
      <div className="mx-auto w-full max-w-[1500px] px-4 pt-6 md:px-6">
        <div className="rac-skeleton h-[180px] w-full rounded-2xl sm:h-[220px]" />
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="rac-skeleton h-36 rounded-xl" />
          ))}
        </div>
      </div>
    </main>
  );
}
