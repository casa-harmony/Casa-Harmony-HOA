/**
 * Compare the endpoints the frontend asks for against the ones the backend
 * actually publishes.
 *
 * The 45 screens were written against the in-browser demo store, so some paths
 * are page-shaped rather than API-shaped. This produces the definitive list of
 * what still needs remapping before NEXT_PUBLIC_DATA_MODE=live is complete.
 *
 *   node scripts/check-endpoints.mjs [http://127.0.0.1:8000]
 *
 * Heuristic by design: it reads string literals out of the source, so a path
 * built at runtime from variables won't be seen. Treat the output as a work
 * list, not a proof of completeness.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const API_ROOT = process.argv[2] ?? "http://127.0.0.1:8000";
const SRC_DIRS = ["app", "components", "lib"];
const ROOT = process.cwd();

/* ---------------------------------------------------- collect source files */

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(full)) out.push(full);
  }
  return out;
}

/* ------------------------------------------- extract requested API paths */

// apiFetch("/x"), useApi("/x"), mutate("/x", ...), downloadFile(`/x/${id}`)
const CALL = /\b(?:apiFetch|useApi|mutate|downloadFile)\s*(?:<[^>]*>)?\s*\(\s*([`"'])([^`"']+)\1/g;

const requested = new Map(); // normalised path -> Set(files)

for (const dir of SRC_DIRS) {
  let files = [];
  try {
    files = walk(join(ROOT, dir));
  } catch {
    continue;
  }
  for (const file of files) {
    // The demo transport is the thing we're migrating away from — skip it.
    if (file.includes(join("lib", "mock-data"))) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(CALL)) {
      const raw = m[2];
      if (!raw.startsWith("/")) continue;
      const path = raw
        .split("?")[0] // drop query strings
        .replace(/\$\{[^}]*\}/g, "{id}") // template holes -> {id}
        .replace(/\/$/, "");
      if (!path) continue;
      if (!requested.has(path)) requested.set(path, new Set());
      requested.get(path).add(relative(ROOT, file));
    }
  }
}

/* ------------------------------------------------------ real API surface */

// The app mounts its schema under the versioned prefix; older builds served it
// at the root. Try both before giving up.
let spec = null;
for (const candidate of ["/api/v1/openapi.json", "/openapi.json"]) {
  try {
    const res = await fetch(`${API_ROOT}${candidate}`);
    if (res.ok) {
      spec = await res.json();
      break;
    }
  } catch {
    /* try the next one */
  }
}
if (!spec) {
  console.error(`Could not read the OpenAPI schema from ${API_ROOT} — is the API running?`);
  process.exit(2);
}
const prefix = "/api/v1";

const real = Object.keys(spec.paths ?? {})
  .filter((p) => p.startsWith(prefix))
  .map((p) => p.slice(prefix.length) || "/");

// A regex per real path so "/vendors/{id}" matches the frontend's "/vendors/{id}".
const matchers = real.map((p) => ({
  path: p,
  re: new RegExp("^" + p.replace(/\{[^}]+\}/g, "[^/]+").replace(/\//g, "\\/") + "$"),
}));

const isReal = (p) => matchers.some((m) => m.re.test(p));

/* ----------------------------------------------------------------- report */

const paths = [...requested.keys()].sort();
const missing = paths.filter((p) => !isReal(p));
const ok = paths.length - missing.length;

console.log(`\nFrontend → backend endpoint check`);
console.log(`  API:      ${API_ROOT}${prefix}`);
console.log(`  Published: ${real.length} paths`);
console.log(`  Requested: ${paths.length} distinct paths\n`);
console.log(`  matched:   ${ok}`);
console.log(`  unmatched: ${missing.length}\n`);

if (missing.length) {
  console.log("Unmatched — these need remapping before live mode is complete:\n");
  for (const p of missing) {
    console.log(`  ${p}`);
    for (const f of [...requested.get(p)].sort()) console.log(`      ${f}`);
  }
  console.log("");
}

process.exit(missing.length ? 1 : 0);
