import Navbar from "@/components/Navbar";
import LandingHome from "@/components/LandingHome";
import { loadHomeInitialData } from "@/lib/homeInitialData";

export default async function Home() {
  const { catalog, avatar } = await loadHomeInitialData();

  return (
    <main className="min-h-screen text-white">
      <Navbar />
      <LandingHome initialCatalog={catalog} initialAvatar={avatar} />
    </main>
  );
}
