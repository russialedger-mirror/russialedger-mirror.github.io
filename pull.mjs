#!/usr/bin/env node
/**
 * Pull the site's signed release from any copy of it and write it to a folder,
 * for a mirror (docs/DISTRIBUTION.md, M6). Node 18 or later, no packages.
 *
 *   node pull.mjs --key <minisign public key line> --out site/ \
 *     --from https://russialedger.com --from https://<another mirror> [--have site/]
 *
 * Tries each --from in turn: reads release.json and release.json.minisig, checks
 * the signature against the pinned key (minisign format: Ed25519 over BLAKE2b-512),
 * then downloads every file the release lists and checks its sha256. Nothing is
 * written unless every check passes. With --have, files whose hash already
 * matches are copied from that folder instead of downloaded. Prints the version.
 * Exit codes: 0 written, 3 already up to date (--have holds this version), 1 failure.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const KEY_ID_BYTES = 8;
const PARALLEL = 8;

/** Check a .minisig against a public key line; returns the trusted comment, or throws. Same rules as scripts/minisign.ts. */
export function verifyMinisig(publicKeyLine, data, minisig) {
  const pk = Buffer.from(publicKeyLine.trim(), "base64");
  if (pk.length !== 2 + KEY_ID_BYTES + 32 || pk.subarray(0, 2).toString() !== "Ed") throw new Error("not a minisign public key");
  const keyId = pk.subarray(2, 2 + KEY_ID_BYTES);
  const pub = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: pk.subarray(2 + KEY_ID_BYTES).toString("base64url") }, format: "jwk" });
  const lines = minisig.split("\n");
  const sig = Buffer.from(lines[1] ?? "", "base64");
  const trusted = (lines[2] ?? "").replace(/^trusted comment: /, "");
  const global = Buffer.from(lines[3] ?? "", "base64");
  if (!sig.subarray(2, 2 + KEY_ID_BYTES).equals(keyId)) throw new Error("signed with a different key");
  const alg = sig.subarray(0, 2).toString();
  const signature = sig.subarray(2 + KEY_ID_BYTES);
  const message = alg === "ED" ? createHash("blake2b512").update(data).digest() : data;
  if (!verify(null, message, pub, signature)) throw new Error("signature does not match release.json");
  if (!verify(null, Buffer.concat([signature, Buffer.from(trusted, "utf8")]), pub, global)) throw new Error("trusted comment signature does not match");
  return trusted;
}

const sha256 = (b) => createHash("sha256").update(b).digest("hex");

/** The public key file for the pinned key, as `minisign -G` writes it (the release does not list it: it is not signed). */
export function publicKeyFile(publicKeyLine) {
  const id = Buffer.from(publicKeyLine.trim(), "base64").subarray(2, 2 + KEY_ID_BYTES);
  return `untrusted comment: minisign public key ${Buffer.from(id).reverse().toString("hex").toUpperCase()}\n${publicKeyLine.trim()}\n`;
}

/** A release's file list, refusing paths that would leave the output folder. */
export function releaseFiles(release) {
  if (!release || !Array.isArray(release.files)) throw new Error("release.json has no file list");
  for (const f of release.files) {
    if (typeof f.path !== "string" || typeof f.sha256 !== "string" || f.path.startsWith("/") || f.path.split("/").includes("..")) throw new Error(`bad path in release.json: ${f.path}`);
  }
  return release.files;
}

async function get(url) {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "russialedger-mirror-kit/1" } });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/** Pull one release from `base` into `out` (via a temporary folder). Returns the version. */
export async function pull({ base, key, out, have }) {
  const root = base.replace(/\/+$/, "");
  const json = await get(`${root}/release.json`);
  const minisig = (await get(`${root}/release.json.minisig`)).toString("utf8");
  verifyMinisig(key, json, minisig);
  const release = JSON.parse(json.toString("utf8"));
  const files = releaseFiles(release);
  if (have && existsSync(join(have, "release.json")) && readFileSync(join(have, "release.json")).equals(json)) return { version: release.version, upToDate: true };
  const tmp = `${resolve(out)}.partial`;
  rmSync(tmp, { recursive: true, force: true });
  let next = 0;
  const work = async () => {
    while (next < files.length) {
      const f = files[next++];
      const target = join(tmp, ...f.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      const cached = have && join(have, ...f.path.split("/"));
      if (cached && existsSync(cached) && sha256(readFileSync(cached)) === f.sha256) {
        cpSync(cached, target);
        continue;
      }
      const body = f.path === "release.json" ? json : await get(`${root}/${f.path.split("/").map(encodeURIComponent).join("/")}`);
      if (f.path !== "release.json" && sha256(body) !== f.sha256) throw new Error(`${f.path}: sha256 does not match release.json`);
      writeFileSync(target, body);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, work));
  writeFileSync(join(tmp, "release.json"), json);
  writeFileSync(join(tmp, "release.json.minisig"), minisig);
  writeFileSync(join(tmp, "minisign.pub"), publicKeyFile(key));
  rmSync(out, { recursive: true, force: true });
  renameSync(tmp, out);
  return { version: release.version, upToDate: false };
}

function args(argv) {
  const out = { from: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") out.from.push(argv[++i]);
    else if (a === "--key") out.key = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--have") out.have = argv[++i];
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith(`${sep}pull.mjs`)) {
  const a = args(process.argv.slice(2));
  if (!a.key || !a.out || !a.from.length) {
    console.error("usage: node pull.mjs --key <public key line> --out <folder> --from <url> [--from <url> …] [--have <folder>]");
    process.exit(1);
  }
  let last;
  for (const base of a.from) {
    try {
      const r = await pull({ base, key: a.key, out: a.out, have: a.have });
      console.log(`${r.upToDate ? "up to date" : "pulled"} ${r.version} from ${base}`);
      process.exit(r.upToDate ? 3 : 0);
    } catch (e) {
      last = e;
      console.error(`could not pull from ${base}: ${e.message}`);
    }
  }
  console.error(`no source gave a valid release (${last?.message})`);
  process.exit(1);
}
