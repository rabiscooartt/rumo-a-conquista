import { handleAgentAchievementUnlock } from "@/lib/agentSync/achievementUnlock";
import { supabaseAchievementSyncStore } from "@/lib/agentSync/supabaseStore";
import { invalidatePublicGameData } from "@/lib/publicDataCache";

// Desbloqueio de conquista enviado pelo agente Windows do Rumo à Conquista.
// Autenticação: "Authorization: Bearer <AGENT_SYNC_TOKEN>" (segredo só do servidor e do agente).
// Fora de /api/admin de propósito: não usa a sessão do Admin nem passa pelo proxy administrativo.
export async function POST(request: Request) {
  return handleAgentAchievementUnlock(request, {
    expectedToken: process.env.AGENT_SYNC_TOKEN,
    store: supabaseAchievementSyncStore,
    invalidate: invalidatePublicGameData,
    log: (message, data) => console.info(`[Agent Sync] ${message}`, data ?? {}),
  });
}
