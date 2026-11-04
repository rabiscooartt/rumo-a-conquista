import GamePageClient from "./GamePageClient";
import { loadPublicGamePage } from "@/lib/publicGamePage";
import { loadGamePageJourneyRows } from "@/lib/homeInitialData";

type GamePageProps = {
  params: Promise<{ slug: string }>;
};

export default async function GamePage({ params }: GamePageProps) {
  const { slug } = await params;
  let initialLoadError = "";

  const [initialGame, initialJourneyRows] = await Promise.all([
    loadPublicGamePage(slug).catch((error: unknown) => {
      console.error("[Game Page] Não foi possível carregar o jogo:", error);
      initialLoadError =
        error instanceof Error ? error.message : "Não foi possível carregar o jogo.";
      return null;
    }),
    loadGamePageJourneyRows(),
  ]);

  if (!initialGame && !initialLoadError) {
    initialLoadError = "Jogo não encontrado.";
  }

  return (
    <GamePageClient
      slug={slug}
      initialGame={initialGame}
      initialJourneyRows={initialJourneyRows}
      initialLoadError={initialLoadError}
    />
  );
}
