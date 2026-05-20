#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envPath = join(root, ".env");

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function readStdin() {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  return body;
}

function usage() {
  console.error(`Usage:
  node scripts/send-codex-brief.mjs --subject "Codex Market Pulse" --text-file brief.md
  cat brief.md | node scripts/send-codex-brief.mjs --subject "Codex Market Pulse"

Environment:
  MARKETOS_BASE_URL=http://47.128.252.247:4177
  MARKETOS_ADMIN_TOKEN=<admin token>  # or ADMIN_TOKEN in .env
`);
}

loadDotEnv(envPath);

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] || process.env.MARKETOS_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:4177").replace(/\/$/, "");
const adminToken = String(args["admin-token"] || process.env.MARKETOS_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "").trim();
const subject = String(args.subject || `Codex Market Pulse - ${new Date().toISOString()}`).trim();
const trigger = String(args.trigger || "codex-automation-market-leverage-trend-pulse").trim();
const source = String(args.source || "codex-automation").trim();
const textFile = args["text-file"];
const channels = String(args.channels || "telegram")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!adminToken) {
  usage();
  throw new Error("Missing MARKETOS_ADMIN_TOKEN or ADMIN_TOKEN.");
}

const text = textFile ? readFileSync(textFile, "utf8") : await readStdin();
if (!text.trim()) {
  usage();
  throw new Error("Brief text is required via --text-file or stdin.");
}

const response = await fetch(`${baseUrl}/api/codex-briefs`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-token": adminToken
  },
  body: JSON.stringify({
    subject,
    text,
    trigger,
    source,
    deliveryChannels: channels
  })
});

const result = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(JSON.stringify(result, null, 2));
  throw new Error(`MarketOS bridge failed: HTTP ${response.status}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      id: result.brief?.id,
      subject: result.brief?.subject,
      memoryPath: result.brief?.memoryPath,
      deliveries: result.brief?.deliveryResults
    },
    null,
    2
  )
);
