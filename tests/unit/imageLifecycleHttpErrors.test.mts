// Mensagens HTTP do ciclo de vida: motivo + o que fazer; pending marca operação aberta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lifecycleErrorResponse, RECONCILE_HINT, refusedMessage } from "../../lib/images/lifecycle/httpErrors.ts";
import { IdentityUnverifiedError, TrackedUploadError } from "../../lib/images/lifecycle/tracked.ts";
import { PointerActivationError } from "../../lib/images/lifecycle/trackedPointer.ts";

test("pendências: 409/502 com pending e a orientação de repetir ou reconciliar", () => {
  const identity = lifecycleErrorResponse(new IdentityUnverifiedError("achievement-art/a.webp", "op"));
  assert.equal(identity?.status, 409);
  assert.equal(identity?.body.pending, true);
  assert.ok(identity?.body.error.endsWith(RECONCILE_HINT));
  const pendingUpload = lifecycleErrorResponse(new TrackedUploadError("Falha de comunicação.", "op", true));
  assert.deepEqual([pendingUpload?.status, pendingUpload?.body.pending], [502, true]);
  assert.ok(pendingUpload?.body.error.includes("reconciliação"));
  const definitive = lifecycleErrorResponse(new PointerActivationError("O ponteiro não foi alterado.", "op", false));
  assert.deepEqual([definitive?.status, definitive?.body.pending, definitive?.body.error], [502, false, "O ponteiro não foi alterado."]);
});

test("ativação pendente de outro arquivo (55000) e colisão (23505): 409 com o que fazer; outros erros seguem a rota", () => {
  const pending = lifecycleErrorResponse(Object.assign(new Error("Já existe ativação pendente"), { code: "55000" }));
  assert.equal(pending?.status, 409);
  assert.match(pending!.body.error, /MESMA imagem/);
  assert.equal(pending?.body.pending, true);
  const collision = lifecycleErrorResponse(Object.assign(new Error("colisão"), { code: "23505" }));
  assert.deepEqual([collision?.status, collision?.body.pending], [409, false]);
  assert.equal(lifecycleErrorResponse(new Error("outro")), null);
  assert.equal(lifecycleErrorResponse(Object.assign(new Error("rede"), { code: "08006" })), null);
});

test("recusa antes do envio: o motivo aparece no texto exibido pelo painel", () => {
  const text = refusedMessage([{ filename: "a.png", reason: "progresso concluído sem data de desbloqueio (earned_at)" }]);
  assert.match(text, /^Nenhuma arte foi aceita\. a\.png: progresso concluído sem data/);
});
