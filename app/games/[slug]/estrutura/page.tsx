"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import Navbar from "@/components/Navbar";
import GamePageStructurePreview from "@/components/GamePageStructurePreview";
import { useSiteGames } from "@/lib/useSiteGames";

export default function GameStructurePreviewPage() {
  const params = useParams();
  const slug = String(params?.slug || "");
  const { gamesMap, isLoaded } = useSiteGames();
  const game = gamesMap[slug];

  if (!isLoaded) {
    return (
      <main className="min-h-screen bg-[#050505] text-white">
        <Navbar />
        <section className="mx-auto w-full max-w-[1500px] px-6 py-10">
          <div className="rounded-[14px] border border-white/[0.08] bg-[#090909] p-6 text-sm font-bold text-white/40">
            Carregando estrutura do jogo...
          </div>
        </section>
      </main>
    );
  }

  if (!game) {
    return (
      <main className="min-h-screen bg-[#050505] text-white">
        <Navbar />
        <section className="mx-auto w-full max-w-[1500px] px-6 py-10">
          <div className="rounded-[14px] border border-red-500/20 bg-red-500/[0.04] p-6">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-300">Jogo não encontrado</p>
            <h1 className="mt-2 text-2xl font-black">Estrutura de jogo</h1>
            <p className="mt-2 text-sm text-white/40">Slug: {slug}</p>
            <Link href="/biblioteca" className="mt-5 inline-flex rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-[10px] font-black uppercase tracking-[0.08em] text-white/60 hover:text-white">
              Voltar para Biblioteca
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return <GamePageStructurePreview slug={slug} game={game} />;
}
