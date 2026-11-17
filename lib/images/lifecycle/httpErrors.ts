// Respostas HTTP dos erros do ciclo de vida, iguais nas rotas de imagem (Etapa 4.5).
// Os painéis exibem o campo `error`: a mensagem diz o que aconteceu e o que fazer. `pending: true`
// marca operação aberta no banco (precisa ser repetida ou reconciliada).
import { IdentityUnverifiedError, TrackedUploadError } from "./tracked.ts";
import { PointerActivationError } from "./trackedPointer.ts";

export const RECONCILE_HINT =
  "Para concluir, repita o mesmo envio; se continuar pendente, peça a reconciliação (scripts/image-lifecycle-reconcile.mjs).";

export type LifecycleErrorBody = { error: string; pending: boolean; code?: string };

function withHint(message: string, pending: boolean) {
  return pending ? `${message.replace(/\s*$/, "")} ${RECONCILE_HINT}` : message;
}

/** Traduz erros do ciclo de vida; null quando o erro não é do ciclo de vida (a rota trata como antes). */
export function lifecycleErrorResponse(error: unknown): { status: number; body: LifecycleErrorBody } | null {
  if (error instanceof IdentityUnverifiedError) {
    return { status: 409, body: { error: withHint(error.message, true), pending: true } };
  }
  if (error instanceof TrackedUploadError || error instanceof PointerActivationError) {
    return { status: 502, body: { error: withHint(error.message, error.pending), pending: error.pending } };
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "55000") {
    return {
      status: 409,
      body: {
        error: withHint("Há uma troca de imagem anterior ainda pendente para este item; nada foi alterado agora. Reenvie a MESMA imagem da tentativa anterior para concluí-la antes de enviar outra.", true),
        pending: true, code,
      },
    };
  }
  if (code === "23505") {
    return {
      status: 409,
      body: { error: "Já existe no Storage um arquivo com o mesmo nome e conteúdo diferente (colisão de identificação); nada foi enviado nem alterado. Renomeie o arquivo e tente de novo.", pending: false, code },
    };
  }
  return null;
}

/** Mensagem para conquistas recusadas antes do envio (o painel mostra só `error`). */
export function refusedMessage(refused: { filename: string; reason: string }[]) {
  return `Nenhuma arte foi aceita. ${refused.map((r) => `${r.filename}: ${r.reason}`).join(" ")}`;
}
