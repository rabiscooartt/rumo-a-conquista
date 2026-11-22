import Navbar from "@/components/Navbar";
import HeroBanner from "@/components/HeroBanner";
import ProfileStats from "@/components/ProfileStats";
import HomeSidebar from "@/components/HomeSidebar";
import InProgressGames from "@/components/InProgressGames";
import CompletedGames from "@/components/CompletedGames";
import JourneyShortcuts from "@/components/JourneyShortcuts";

const PROFILE_SECTIONS = [
  { href: "#perfil", label: "Jornada atual" },
  { href: "#estatisticas", label: "Estatísticas" },
  { href: "#historico", label: "Em progresso" },
  { href: "#marcos", label: "Concluídos" },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#050608] text-white">
      <Navbar />

      <div className="mx-auto grid w-full max-w-[1620px] grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden min-h-[calc(100vh-74px)] border-r border-white/[0.08] px-4 py-5 lg:block">
          <div className="sticky top-20">
            <div className="border-t border-white/[0.08] pt-5">
              <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                <span className="text-red-500">✣</span>
                Perfil
              </div>
            </div>

            <nav aria-label="Seções do perfil" className="mt-6 border-t border-white/[0.08] pt-5">
              <p className="text-[8px] font-black uppercase tracking-[0.20em] text-white/30">
                Nesta página
              </p>

              <ul className="mt-3 space-y-1">
                {PROFILE_SECTIONS.map((section) => (
                  <li key={section.href}>
                    <a
                      href={section.href}
                      className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-[12px] font-bold text-white/60 transition hover:bg-white/[0.04] hover:text-white"
                    >
                      <span aria-hidden="true" className="h-1 w-1 rounded-full bg-red-500/70" />
                      {section.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <JourneyShortcuts current="/perfil" />
          </div>
        </aside>

        <div className="min-w-0 px-4 py-5 md:px-5">
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-4">
            <div className="min-w-0 space-y-8 sm:space-y-10">
              <section id="perfil" className="scroll-mt-24 space-y-4">
                <HeroBanner />

                <div id="estatisticas" className="scroll-mt-24">
                  <ProfileStats />
                </div>
              </section>

              <section id="historico" className="scroll-mt-24">
                <InProgressGames />
              </section>

              <section id="marcos" className="scroll-mt-24">
                <CompletedGames />
              </section>

              <section id="insignias" className="hidden" />
            </div>

            <aside
              id="backlog"
              className="min-w-0 xl:sticky xl:top-20 xl:self-start"
            >
              <HomeSidebar />
            </aside>
          </div>
        </div>
      </div>
    </main>
  );
}
