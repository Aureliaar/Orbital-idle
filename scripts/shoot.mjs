#!/usr/bin/env node
// Screenshot the Cloudflare Workers branch preview so headless sessions
// can verify visuals via the Read tool.
//
// Usage:
//   node scripts/shoot.mjs                    # current branch
//   node scripts/shoot.mjs <branch-or-url>    # explicit branch or full URL
//
// Writes tmp/preview.png. Polls the preview URL until it responds 200,
// then shells out to `npx playwright screenshot`.

import { execFileSync, execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const WORKER = "orbital.jacopo-sinigaglia.workers.dev";
const OUT = resolve("tmp/preview.png");
const POLL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 5_000;

const slugify = (branch) =>
  branch.toLowerCase().replace(/\//g, "-").replace(/[^a-z0-9-]/g, "-");

const arg = process.argv[2];
let url;
if (arg?.startsWith("http")) {
  url = arg;
} else {
  const branch =
    arg ?? execSync("git branch --show-current").toString().trim();
  if (!branch) {
    console.error("no branch given and not on a branch");
    process.exit(1);
  }
  url =
    branch === "main"
      ? `https://${WORKER}/`
      : `https://${slugify(branch)}-${WORKER}/`;
}

console.log(`target: ${url}`);

const deadline = Date.now() + POLL_TIMEOUT_MS;
while (Date.now() < deadline) {
  try {
    const res = await fetch(url, { method: "GET" });
    if (res.ok) {
      console.log(`live (${res.status}), capturing…`);
      break;
    }
    console.log(`  ${res.status}, retrying`);
  } catch (e) {
    console.log(`  ${e.code ?? e.message}, retrying`);
  }
  if (Date.now() + POLL_INTERVAL_MS >= deadline) {
    console.error("preview never came up");
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

mkdirSync(resolve("tmp"), { recursive: true });

execFileSync(
  "npx",
  [
    "playwright",
    "screenshot",
    "--wait-for-timeout",
    "1500",
    "--viewport-size",
    "1280,800",
    url,
    OUT,
  ],
  { stdio: "inherit" },
);

console.log(`wrote ${OUT}`);
