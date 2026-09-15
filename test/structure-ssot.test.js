// The generated index has to stay generated. A folder reorganised without rerunning the generator
// leaves a reading order that sends a maintainer to a document that moved, and nothing else notices.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkStructure, renderIndex } from "../scripts/structure-ssot.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the manifest, the folder and the source tree agree", () => {
  const { problems } = checkStructure(root);
  assert.deepEqual(problems, []);
});

test("INDEX.md is what the generator produces", () => {
  const { manifest } = checkStructure(root);
  const indexPath = path.join(root, "structure/INDEX.md");
  assert.ok(existsSync(indexPath), "structure/INDEX.md is missing; run npm run structure:index");
  assert.equal(readFileSync(indexPath, "utf8"), renderIndex(manifest, root),
    "structure/INDEX.md is stale; run npm run structure:index");
});

