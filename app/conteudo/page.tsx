import ConteudoClient, { type YouTubeChannelResponse } from "@/app/conteudo/ConteudoClient";
import { loadYoutubeChannel } from "@/lib/youtubeChannel";

const INITIAL_CHANNEL_TIMEOUT_MS = 2500;

// Se o YouTube demorar, a página sai sem esperar e o navegador busca os vídeos como antes.
async function loadInitialChannel(): Promise<YouTubeChannelResponse | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), INITIAL_CHANNEL_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([loadYoutubeChannel("@orabiisco", 50), timeout]);
    return result?.ok ? result.data : null;
  } catch (error) {
    console.error("[Conteúdo] Não foi possível carregar o canal no servidor:", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function ConteudoPage() {
  return <ConteudoClient initialChannel={await loadInitialChannel()} />;
}
