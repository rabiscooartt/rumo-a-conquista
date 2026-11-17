// Chave de idempotência do envio rastreado: tamanho fixo, abaixo do limite de 300 da auditoria.
import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadKey } from "../../lib/images/lifecycle/tracked.ts";

test("a chave do envio tem tamanho fixo mesmo com caminho longo e muda com caminho ou conteúdo", () => {
  const sha = "a".repeat(64);
  const longPath = `games/${"s".repeat(150)}/achievements/${"n".repeat(100)}.aaaaaaaaaaaaaaaa.webp`;
  const key = uploadKey("achievement-art", longPath, sha);
  assert.equal(key.length, 136);
  assert.ok(key.length <= 300);
  assert.match(key, /^upload:[0-9a-f]{64}:[0-9a-f]{64}$/);
  assert.equal(uploadKey("achievement-art", longPath, sha), key, "determinística: retomada usa a mesma chave");
  assert.notEqual(uploadKey("achievement-art", `${longPath}x`, sha), key);
  assert.notEqual(uploadKey("site-banners", longPath, sha), key);
  assert.notEqual(uploadKey("achievement-art", longPath, "b".repeat(64)), key);
});
