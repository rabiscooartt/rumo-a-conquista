// Mesmos casos de normalização conferidos no TypeScript e no SQL (storage_lifecycle_object_key).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { objectKeyFromReference } from "../../lib/images/lifecycle/references.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/storage-object-keys.json", import.meta.url), "utf8")) as {
  knownBuckets: string[];
  cases: Array<{ note: string; input: string; known: boolean; expected: string | null }>;
};

test("normalização das chaves: casos compartilhados com o SQL", () => {
  for (const item of fixture.cases) {
    const actual = objectKeyFromReference(item.input, item.known ? fixture.knownBuckets : undefined);
    assert.equal(actual, item.expected, item.note);
  }
});
