import Navbar from "@/components/Navbar";
import HeroBanner from "@/components/HeroBanner";
import ProfileStats from "@/components/ProfileStats";
import HomeSidebar from "@/components/HomeSidebar";
import InProgressGames from "@/components/InProgressGames";
import CompletedGames from "@/components/CompletedGames";

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#0b1624_0%,#050505_45%,#020202_100%)] text-white">
      <Navbar />

      <section className="mx-auto w-full max-w-[1620px] px-6 py-6">
        <div className="grid min-h-[calc(100vh-74px)] grid-cols-1 gap-0 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
          <aside className="hidden border-r border-white/[0.08] px-4 py-5 xl:block">
            <div className="sticky top-20">
              <div className="border-b border-white/[0.08] pb-4 pt-2">
                <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-[0.12em] text-white/75">
                  <span className="text-red-500">✣</span>
                  Perfil
                </div>
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-8 px-5">
            <section id="perfil" className="space-y-8">
              <HeroBanner />

              <div id="estatisticas">
                <ProfileStats />
              </div>
            </section>

            <section id="historico">
              <InProgressGames />
            </section>

            <section id="marcos">
              <CompletedGames />
            </section>

            <section id="insignias" className="hidden" />
          </div>

          <aside
            id="backlog"
            className="min-w-0 border-l border-white/[0.08] py-5 xl:sticky xl:top-20 xl:self-start"
          >
            <HomeSidebar />
          </aside>
        </div>
      </section>
    </main>
  );
}