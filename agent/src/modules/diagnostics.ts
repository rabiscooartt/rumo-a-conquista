import type { AgentModule, ModuleContext } from "../core/module.ts";
import { PermanentEventError } from "../events/processor.ts";

export const DIAGNOSTIC_EVENT = "agent.diagnostic";

type DiagnosticPayload = {
  message?: string;
  /** Falha de propósito nas N primeiras tentativas (valida retry de ponta a ponta). */
  failAttempts?: number;
  /** Demora proposital em ms (valida recuperação após queda no meio do processamento). */
  delayMs?: number;
  /** Falha definitiva proposital (valida o estado failed e o requeue). */
  permanentFailure?: boolean;
};

/**
 * Único módulo da Fase 1: consome eventos "agent.diagnostic" para verificar a
 * cadeia completa (registro → persistência → processamento → retry → recuperação)
 * no agente real, sem tocar em progresso, histórico, Maestria ou clips.
 */
export function diagnosticsModule(): AgentModule {
  let handled = 0;
  return {
    name: "diagnostics",
    start(ctx: ModuleContext) {
      ctx.events.handle(DIAGNOSTIC_EVENT, async (event, { attempt, signal, log }) => {
        const payload = (event.payload ?? {}) as DiagnosticPayload;
        if (payload.delayMs && payload.delayMs > 0) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, Math.min(payload.delayMs!, 120_000));
            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(signal.reason ?? new Error("abortado"));
            });
          });
        }
        if (payload.permanentFailure) throw new PermanentEventError("Falha definitiva simulada (diagnóstico)");
        if (payload.failAttempts && attempt <= payload.failAttempts) {
          throw new Error(`Falha simulada na tentativa ${attempt} de ${payload.failAttempts}`);
        }
        handled += 1;
        ctx.state.set("lastHandled", { id: event.id, at: Date.now() });
        log.info("Diagnóstico processado", { id: event.id, message: payload.message ?? null, attempt, teste: event.isTest });
        return { ok: true, attempt, handledAt: new Date().toISOString() };
      });
    },
    health() {
      return { ok: true, detail: { handledThisRun: handled } };
    },
  };
}
