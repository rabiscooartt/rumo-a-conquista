// Arquivamento: chaves determinísticas e travas que não dependem do banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import { archiveKey, deleteArchivedOriginal, ArchiveError, type ArchiveDeps } from "../../lib/images/lifecycle/archive.ts";

test("chave da operação: determinística, por objeto e tentativa, abaixo do limite da auditoria", () => {
  const k = archiveKey("archive_copy", "achievement-art", "games/x/a.png", 1);
  assert.equal(k, archiveKey("archive_copy", "achievement-art", "games/x/a.png", 1));
  assert.notEqual(k, archiveKey("archive_copy", "achievement-art", "games/x/a.png", 2));
  assert.notEqual(k, archiveKey("delete_object", "achievement-art", "games/x/a.png", 1));
  assert.ok(archiveKey("restore_object", "achievement-art", `${"p".repeat(900)}.png`, 5).length <= 300);
});

test("remoção do original exige allowDelete: sem ele nada é lido, chamado ou removido", async () => {
  const touched: string[] = [];
  const deps = {
    rpc: async (fn: string) => { touched.push(fn); return {}; },
    readObject: async () => { touched.push("readObject"); return null; },
    storage: { download: async () => null, upload: async () => "created", info: async () => null, remove: async () => { touched.push("remove"); } },
  } as unknown as ArchiveDeps;
  await assert.rejects(deleteArchivedOriginal({ deps, bucket: "achievement-art", path: "a.png", actor: "t", reason: "t", allowDelete: false as unknown as boolean }), ArchiveError);
  assert.deepEqual(touched, []);
});
