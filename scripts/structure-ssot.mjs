#!/usr/bin/env node
// The index is generated, so it cannot drift from the manifest by hand. This script is both the
// generator and the gate: with --fix it rewrites structure/INDEX.md, without it it fails when the
// index, the manifest and the folder disagree.
//
// The source-to-document map is checked in its WEAK form on purpose. A documents[] entry is
// rejected when the document never names the area or a path under it, which catches a claim
// nobody wrote. It does not prove the document says anything useful about that area, and it
// cannot see two documents contradicting each other. Both of those are review, and pretending a
// string match covers them would be the same mistake test/docs-guidance.test.js refuses to make.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "structure");
const manifestPath = path.join(dir, "manifest.json");
const indexPath = path.join(dir, "INDEX.md");
const NAME = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)?\.md$/;
const NL = String.fromCharCode(10);

export function sourceAreas(repoRoot = root) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(repoRoot, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const next = rel + entry.name + "/";
      out.push(next);
      walk(next);
    }
  };
  walk("src/");
  return out.sort();
}

export function checkStructure(repoRoot = root) {
  const problems = [];
  const manifest = JSON.parse(readFileSync(path.join(repoRoot, "structure/manifest.json"), "utf8"));
  const budget = manifest.sizeBudgetLines;
  if (!Number.isInteger(budget) || budget < 1) problems.push("sizeBudgetLines must be a positive integer");
  const tierIds = new Set((manifest.tiers || []).map((t) => t.id));
  const bodies = new Map();

  for (const doc of manifest.docs || []) {
    const where = "structure/" + doc.path;
    if (!NAME.test(doc.path)) { problems.push(where + ": name must be kebab-case, start with a letter, and sit at most one directory deep"); continue; }
    if (!tierIds.has(doc.tier)) problems.push(where + ": tier " + doc.tier + " is not declared in tiers[]");
    if (!doc.title || !doc.scope) problems.push(where + ": every entry needs a title and a scope");
    const abs = path.join(repoRoot, where);
    if (!existsSync(abs)) { problems.push(where + ": listed in the manifest and not on disk"); continue; }
    const body = readFileSync(abs, "utf8");
    bodies.set(doc.path, body);
    const lines = body.split(NL).length;
    if (lines > budget) problems.push(where + ": " + lines + " lines, over the " + budget + " line budget; split it along a topic boundary");
    for (const area of doc.documents || []) {
      if (!existsSync(path.join(repoRoot, area))) { problems.push(where + ": documents names " + area + ", which is not in the repository"); continue; }
      if (!body.includes(area)) problems.push(where + ": documents claims " + area + " but the document never names it");
    }
  }

  const onDisk = [];
  const collect = (rel) => {
    for (const entry of readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const next = rel === "structure" ? entry.name : rel.slice("structure/".length) + "/" + entry.name;
      if (entry.isDirectory()) { if (entry.name !== "decisions") collect("structure/" + next); continue; }
      if (entry.name.endsWith(".md") && entry.name !== "INDEX.md" && entry.name !== "AGENTS.md") onDisk.push(next);
    }
  };
  collect("structure");
  const listed = new Set((manifest.docs || []).map((d) => d.path));
  for (const f of onDisk.sort()) if (!listed.has(f)) problems.push("structure/" + f + ": on disk and not in the manifest");

  const claimed = (manifest.docs || []).flatMap((d) => d.documents || []);
  const graced = new Set(((manifest.grace || {}).undocumentedSourceAreas || []).map((g) => g.path));
  for (const area of sourceAreas(repoRoot)) {
    const covered = claimed.some((e) => area.startsWith(e) || e.startsWith(area));
    if (!covered && !graced.has(area)) problems.push(area + ": no document claims it and it is not in grace.undocumentedSourceAreas");
  }
  for (const g of graced) {
    if (!existsSync(path.join(repoRoot, g))) problems.push(g + ": graced as undocumented and not in the repository");
  }

  return { problems, manifest };
}

export function renderIndex(manifest, repoRoot = root) {
  const L = [];
  L.push("# aside-codemode structure index");
  L.push("");
  L.push("This folder is the maintainer source of truth for the shape the system has right now.");
  L.push("Open work and sequencing live in `devlog/`, which is not tracked. The rules for changing");
  L.push("anything here are in [`AGENTS.md`](AGENTS.md).");
  L.push("");
  L.push("Generated from [`manifest.json`](manifest.json) by `npm run structure:index`. Do not edit by");
  L.push("hand; `npm run structure:check` fails when this file and the manifest disagree.");
  L.push("");
  L.push("## Reading order");
  for (const tier of manifest.tiers || []) {
    const docs = (manifest.docs || []).filter((d) => d.tier === tier.id);
    if (!docs.length) continue;
    L.push("");
    L.push("### Tier " + tier.id + " — " + tier.name);
    L.push("");
    L.push(tier.purpose);
    L.push("");
    L.push("| Doc | Scope |");
    L.push("| --- | --- |");
    for (const d of docs) L.push("| [`" + d.path + "`](" + d.path + ") | " + d.scope + " |");
  }
  L.push("");
  L.push("## Source to document");
  L.push("");
  L.push("| Source area | Described by |");
  L.push("| --- | --- |");
  const inverse = new Map();
  for (const d of manifest.docs || []) for (const a of d.documents || []) {
    if (!inverse.has(a)) inverse.set(a, []);
    inverse.get(a).push(d.path);
  }
  for (const area of [...inverse.keys()].sort()) {
    L.push("| `" + area + "` | " + inverse.get(area).sort().map((p) => "[`" + p + "`](" + p + ")").join(", ") + " |");
  }
  const grace = ((manifest.grace || {}).undocumentedSourceAreas || []);
  if (grace.length) {
    L.push("");
    L.push("Not yet described, with the reason recorded in the manifest:");
    L.push("");
    for (const g of grace) L.push("- `" + g.path + "` — " + g.reason);
  }
  const decisionsDir = path.join(repoRoot, "structure/decisions");
  const adrs = existsSync(decisionsDir) ? readdirSync(decisionsDir).filter((f) => f.endsWith(".md")).sort() : [];
  if (adrs.length) {
    L.push("");
    L.push("## Decision records");
    L.push("");
    for (const f of adrs) {
      const first = readFileSync(path.join(decisionsDir, f), "utf8").split(NL)[0].replace(/^#\s*/, "");
      L.push("- [`" + f + "`](decisions/" + f + ") — " + first);
    }
  }
  L.push("");
  return L.join(NL);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const fix = process.argv.includes("--fix");
  const { problems, manifest } = checkStructure();
  if (problems.length) {
    for (const p of problems) process.stderr.write("structure: " + p + NL);
    process.exit(1);
  }
  const rendered = renderIndex(manifest);
  if (fix) {
    writeFileSync(indexPath, rendered, "utf8");
    process.stdout.write("structure: wrote structure/INDEX.md" + NL);
  } else {
    const current = existsSync(indexPath) ? readFileSync(indexPath, "utf8") : "";
    if (current !== rendered) {
      process.stderr.write("structure: INDEX.md is stale; run npm run structure:index" + NL);
      process.exit(1);
    }
    process.stdout.write("structure: index and manifest agree" + NL);
  }
}

