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

      <section className="mx-auto w-full max-w-[1700px] px-8 py-8">
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-8">
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
            className="min-w-0 xl:sticky xl:top-20 xl:self-start"
          >
            <HomeSidebar />
          </aside>
        </div>
      </section>
    </main>
  );
}