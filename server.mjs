import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchYouTubeTranscript, getResearchStatus, runResearchSnapshot } from "./research-engine.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const dataFile = join(root, "data", "subscribers.json");
const foldersFile = join(root, "data", "folders.json");
const emailSchedulesFile = join(root, "data", "email-schedules.json");
const sentEmailsFile = join(root, "data", "sent-emails.json");
const codexBriefsFile = join(root, "data", "codex-briefs.json");
const memoryDir = join(root, "data", "market-memory");
const memoryIndexFile = join(root, "data", "market-memory-index.json");
const telegramOffsetFile = join(root, "data", "telegram-offset.json");
const skillPath = process.env.FINANCIAL_ENGINE_SKILL_PATH || "/Users/arnav/.codex/skills/market-leverage-sentiment/SKILL.md";
const builtInFinancialEnginePrompt = [
  "You are MarketOS, an analysis-only finance intelligence engine for a Singapore-based user.",
  "You produce source-aware market thesis briefs for crypto, indices, AI equities, FX, macro, geopolitics, AI infrastructure, and bottleneck-driven equity themes.",
  "Never place orders, enable trading, guarantee outcomes, or tell the user to go all-in.",
  "For leveraged setups, express risk as conditional bands, liquidation/wick tolerance, stop/invalidation logic, and scenario probabilities.",
  "Always separate public/news facts, technical data, source limitations, and inference.",
  "For Telegram, prefer terse message packs: NOW, BOTTLENECKS, SCENARIOS, SETUPS, WATCH.",
  "For AI infrastructure themes, map the bottleneck chain: model demand -> compute/GPU capacity -> data centers -> power/grid -> cooling -> fiber/networking -> memory/storage -> capital/funding -> regulation/export controls.",
  "Track beneficiary baskets: hyperscalers, GPU/chip vendors, foundries/semicap, power/utilities, grid equipment, nuclear/gas, cooling, data-center REITs, Bitcoin miners/HPC pivots, and cloud/HPC operators.",
  "For miner/HPC names such as IREN, CORZ, RIOT, CLSK and related crypto infrastructure, distinguish BTC beta, power-contract value, AI/HPC hosting optionality, debt/dilution risk, and execution risk.",
  "When a catalyst is 'more AI data capacity' or similar, explain who benefits immediately, who benefits with lag, who gets squeezed by higher capex/power constraints, and what breaks the thesis.",
  "Use a probability rubric: three primary scenarios summing to 100%, plus optional tail paths/watch items without assigning fake precision.",
  "SETUPS must be conditional: asset | bias | trigger | invalidation | safer leverage band | high-risk band.",
  "If current market data or TradingView/MCP is unavailable in this server process, say so clearly and do not invent prices.",
  "Use the chain: development -> mechanism -> affected asset -> expected repricing/flow -> leverage implication.",
  "For scheduled briefs, include exactly three primary scenarios whose probabilities sum to 100%, then add tail paths only as unweighted watch items."
].join("\n");
const port = Number(process.env.PORT || 4177);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const schedulerEnabled = process.env.SCHEDULER_ENABLED !== "false";
const sendEmailsEnabled = process.env.SEND_EMAILS === "true";
const sendTelegramsEnabled = process.env.SEND_TELEGRAMS === "true";
const researchPollEnabled = process.env.RESEARCH_POLL_ENABLED === "true";
const researchPollIntervalMs = Math.max(15, Number(process.env.RESEARCH_POLL_INTERVAL_MINUTES || 180)) * 60_000;
const telegramCommandsEnabled = process.env.TELEGRAM_COMMANDS_ENABLED === "true";
const telegramPollIntervalMs = Math.max(5, Number(process.env.TELEGRAM_POLL_INTERVAL_SECONDS || 10)) * 1000;
const telegramMessageSeparator = "---MSG---";
const ignoredTickerWords = new Set([
  "AI",
  "API",
  "CFD",
  "FLASH",
  "MSG",
  "NOW",
  "ROI",
  "SETUPS",
  "SGT",
  "SL",
  "OHLCV",
  "TECHNICALS",
  "THESIS",
  "TP",
  "USD",
  "US",
  "VWAP",
  "WATCH",
  "WHY"
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8"
};

async function readJsonBody(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

async function readSubscribers() {
  if (!existsSync(dataFile)) return [];
  const raw = await readFile(dataFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function readEmailSchedules() {
  if (!existsSync(emailSchedulesFile)) return [];
  const raw = await readFile(emailSchedulesFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeEmailSchedules(schedules) {
  await writeFile(emailSchedulesFile, `${JSON.stringify(schedules, null, 2)}\n`);
}

async function readSentEmails() {
  if (!existsSync(sentEmailsFile)) return [];
  const raw = await readFile(sentEmailsFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function readCodexBriefs() {
  if (!existsSync(codexBriefsFile)) return [];
  const raw = await readFile(codexBriefsFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeCodexBriefs(briefs) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(codexBriefsFile, `${JSON.stringify(briefs.slice(0, 300), null, 2)}\n`);
}

async function readMemoryIndex() {
  if (!existsSync(memoryIndexFile)) return [];
  const raw = await readFile(memoryIndexFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function writeMemoryIndex(entries) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(memoryIndexFile, `${JSON.stringify(entries.slice(0, 1000), null, 2)}\n`);
}

async function readTelegramOffset() {
  if (!existsSync(telegramOffsetFile)) return 0;
  const raw = await readFile(telegramOffsetFile, "utf8");
  const data = JSON.parse(raw || "{}");
  return Number(data.offset || 0);
}

async function writeTelegramOffset(offset) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(telegramOffsetFile, `${JSON.stringify({ offset, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}

async function logEmailSend(record) {
  const logs = await readSentEmails();
  logs.push({ ...record, loggedAt: new Date().toISOString() });
  await writeFile(sentEmailsFile, `${JSON.stringify(logs.slice(-500), null, 2)}\n`);
}

async function readFinancialEnginePrompt() {
  try {
    const skill = await readFile(skillPath, "utf8");
    return {
      loaded: true,
      prompt: `You are ThesisOS, a finance analysis agent. Use this local financial engine skill as your operating contract:\n\n${skill.slice(0, 12000)}`
    };
  } catch {
    return {
      loaded: "built-in",
      prompt: builtInFinancialEnginePrompt
    };
  }
}

function extractTickers(text) {
  const matches = String(text || "").match(/\b[A-Z]{2,6}(?:\/[A-Z]{2,5})?\b/g) || [];
  return [...new Set(matches.filter((ticker) => !ignoredTickerWords.has(ticker.replace(/\W/g, ""))))].slice(0, 12);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function maskEmail(email) {
  const [name = "", domain = ""] = String(email || "").split("@");
  if (!domain) return "hidden";
  return `${name.slice(0, 2)}***@${domain}`;
}

function sanitizeSchedule(schedule, includePrivate = false) {
  if (includePrivate) return schedule;
  const { email, unsubscribeToken, enginePrompt, telegramChatId, ...safe } = schedule;
  return {
    ...safe,
    email: maskEmail(email),
    telegramChatId: telegramChatId ? "configured" : undefined,
    enginePromptPreview: enginePrompt ? `${enginePrompt.slice(0, 180)}...` : undefined
  };
}

function sanitizeSubscriber(subscriber, includePrivate = false) {
  return includePrivate ? subscriber : { ...subscriber, email: maskEmail(subscriber.email) };
}

function sanitizeEmailLog(log) {
  if (!log) return null;
  const { result, ...safe } = log;
  return {
    ...safe,
    result: result
      ? {
          ok: result.ok,
          dryRun: result.dryRun,
          provider: result.provider,
          id: result.id,
          reason: result.reason
        }
      : undefined
  };
}

function sanitizeCodexBrief(brief, includeText = false) {
  if (!brief) return null;
  const { text, html, deliveryResults, ...safe } = brief;
  return {
    ...safe,
    textPreview: text ? `${text.slice(0, 500)}${text.length > 500 ? "..." : ""}` : undefined,
    text: includeText ? text : undefined,
    html: includeText ? html : undefined,
    deliveryResults: deliveryResults?.map((result) => ({
      ok: result.ok,
      provider: result.provider,
      dryRun: result.dryRun,
      messageCount: result.messageCount,
      messageIds: result.messageIds,
      id: result.id,
      reason: result.reason
    }))
  };
}

function slugifyFilePart(value) {
  return String(value || "note")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
}

function yamlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function uniqueStrings(items) {
  return [...new Set(items.filter(Boolean))];
}

function normalizeMemoryTag(value) {
  return String(value || "")
    .trim()
    .replace(/^#/, "")
    .replace(/[^A-Za-z0-9/_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferMemoryTags({ text, schedule, kind, extraTags = [] }) {
  const combined = String(text || "");
  const lower = combined.toLowerCase();
  const tickers = extractTickers(combined);
  const scheduleMarkets = normalizeList(schedule?.markets, []);
  const tags = [
    `kind/${kind || "note"}`,
    ...scheduleMarkets.map((market) => `market/${market}`),
    ...tickers.map((ticker) => `asset/${ticker.replace("/", "")}`),
    ...extraTags
  ];

  if (lower.includes("liquidation") || lower.includes("funding")) tags.push("signal/liquidity");
  if (/\b(nvidia|nvda|ai|artificial intelligence)\b/.test(lower)) tags.push("theme/ai");
  if (lower.includes("fed") || lower.includes("cpi") || lower.includes("yield") || lower.includes("dxy")) tags.push("theme/macro");
  if (lower.includes("china") || lower.includes("tariff")) tags.push("theme/china");
  if (lower.includes("short")) tags.push("bias/short");
  if (lower.includes("long")) tags.push("bias/long");

  return uniqueStrings(tags.map(normalizeMemoryTag).filter(Boolean)).slice(0, 40);
}

function buildMemoryMarkdown({ id, kind, subject, text, source, trigger, schedule, tags, assets, createdAt, stamp, deliveryChannels }) {
  const body = String(text || "").replaceAll(telegramMessageSeparator, "\n\n---\n\n").trim();
  const tagLines = tags.map((tag) => `  - ${tag}`).join("\n") || "  - kind/note";
  const assetLines = assets.map((asset) => `  - ${asset}`).join("\n") || "  - none";
  const channelLines = deliveryChannels.map((channel) => `  - ${channel}`).join("\n") || "  - none";

  return [
    "---",
    `id: ${id}`,
    `kind: ${kind}`,
    `createdAt: ${createdAt}`,
    `sgt: ${yamlQuote(stamp.label)}`,
    `source: ${yamlQuote(source)}`,
    `trigger: ${yamlQuote(trigger)}`,
    `subject: ${yamlQuote(subject)}`,
    `scheduleId: ${yamlQuote(schedule?.id || "")}`,
    `scheduleEmail: ${yamlQuote(schedule?.email ? maskEmail(schedule.email) : "")}`,
    "deliveryChannels:",
    channelLines,
    "tags:",
    tagLines,
    "assets:",
    assetLines,
    "---",
    "",
    `# ${subject}`,
    "",
    `- Time: ${stamp.label}`,
    `- Kind: ${kind}`,
    `- Source: ${source}`,
    `- Trigger: ${trigger}`,
    "",
    "## Brief",
    "",
    body || "No text.",
    "",
    "## Review Notes",
    "",
    "- Outcome:",
    "- What worked:",
    "- What failed:",
    "- Follow-up:"
  ].join("\n");
}

async function saveMarketMemory({ kind = "note", subject, text, source = "marketos", trigger = "manual", schedule, deliveryChannels = [], extraTags = [] }) {
  const cleanText = String(text || "").trim();
  if (!cleanText) return null;

  const stamp = getSgtStamp();
  const createdAt = new Date().toISOString();
  const id = randomUUID();
  const assets = extractTickers(`${subject}\n${cleanText}`).slice(0, 20);
  const tags = inferMemoryTags({ text: `${subject}\n${cleanText}`, schedule, kind, extraTags });
  const fileName = `${stamp.isoDate}-${stamp.hhmm.replace(":", "")}-${slugifyFilePart(kind)}-${id.slice(0, 8)}.md`;
  const filePath = join(memoryDir, fileName);
  const relativePath = `data/market-memory/${fileName}`;
  const markdown = buildMemoryMarkdown({
    id,
    kind,
    subject,
    text: cleanText,
    source,
    trigger,
    schedule,
    tags,
    assets,
    createdAt,
    stamp,
    deliveryChannels
  });

  await mkdir(memoryDir, { recursive: true });
  await writeFile(filePath, `${markdown}\n`);

  const entry = {
    id,
    kind,
    subject,
    source,
    trigger,
    tags,
    assets,
    path: relativePath,
    createdAt,
    sgt: stamp.label,
    scheduleId: schedule?.id,
    email: schedule?.email ? maskEmail(schedule.email) : undefined,
    deliveryChannels,
    textPreview: cleanText.replaceAll(telegramMessageSeparator, " ").replace(/\s+/g, " ").slice(0, 500)
  };
  const index = await readMemoryIndex();
  index.unshift(entry);
  await writeMemoryIndex(index);
  return entry;
}

function searchMemoryEntries(entries, { query = "", tag = "", kind = "", limit = 25 } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const tagNeedle = normalizeMemoryTag(tag).toLowerCase();
  const kindNeedle = String(kind || "").trim().toLowerCase();

  return entries
    .filter((entry) => {
      if (kindNeedle && String(entry.kind || "").toLowerCase() !== kindNeedle) return false;
      if (tagNeedle && !(entry.tags || []).some((item) => String(item).toLowerCase() === tagNeedle)) return false;
      if (!q) return true;
      const haystack = [
        entry.subject,
        entry.source,
        entry.trigger,
        entry.textPreview,
        ...(entry.tags || []),
        ...(entry.assets || [])
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)));
}

async function attachMemoryMarkdown(entries) {
  return Promise.all(
    entries.map(async (entry) => {
      try {
        const markdown = await readFile(join(root, entry.path), "utf8");
        return { ...entry, markdown };
      } catch {
        return { ...entry, markdown: null };
      }
    })
  );
}

function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/[$,%xX,]/g, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseKeyValueText(text) {
  const args = {};
  const tokens = String(text || "").match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];

  for (const token of tokens) {
    const index = token.indexOf("=");
    if (index <= 0) continue;
    const key = token.slice(0, index).trim().toLowerCase();
    const rawValue = token.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    args[key] = rawValue;
  }

  return args;
}

function calculateRisk(payload = {}) {
  const args = parseKeyValueText(payload.text);
  const side = String(payload.side || args.side || args.direction || "").toLowerCase();
  const normalizedSide = side.startsWith("s") ? "short" : side.startsWith("l") ? "long" : "";
  const asset = String(payload.asset || args.asset || args.symbol || "").toUpperCase() || "POSITION";
  const entry = parseNumber(payload.entry ?? args.entry);
  const current = parseNumber(payload.current ?? args.current ?? args.price);
  const stop = parseNumber(payload.stop ?? payload.stopLoss ?? args.stop ?? args.sl);
  const liquidation = parseNumber(payload.liquidation ?? payload.liq ?? args.liq ?? args.liquidation);
  const leverage = parseNumber(payload.leverage ?? args.leverage ?? args.lev);
  const margin = parseNumber(payload.margin ?? args.margin ?? args.size);

  if (!entry || !normalizedSide) {
    const error = new Error("Risk command needs at least side=long|short and entry=<price>.");
    error.status = 400;
    throw error;
  }

  const levelStats = (label, level) => {
    if (!level) return null;
    const spotMovePct = ((level - entry) / entry) * 100;
    const roiPct = leverage ? (normalizedSide === "long" ? spotMovePct : -spotMovePct) * leverage : undefined;
    const pnl = margin && roiPct !== undefined ? (margin * roiPct) / 100 : undefined;
    return {
      label,
      level,
      spotMovePct,
      roiPct,
      pnl
    };
  };

  const stopStats = levelStats("stop", stop);
  const liqStats = levelStats("liquidation", liquidation);
  const currentStats = levelStats("current", current);
  const adverseLiqDistancePct = liquidation
    ? normalizedSide === "long"
      ? ((entry - liquidation) / entry) * 100
      : ((liquidation - entry) / entry) * 100
    : undefined;
  const stopDistancePct = stop ? Math.abs(((stop - entry) / entry) * 100) : undefined;
  const stopToLiqRatio = stopDistancePct && adverseLiqDistancePct ? stopDistancePct / adverseLiqDistancePct : undefined;

  let riskLabel = "unknown";
  if (adverseLiqDistancePct !== undefined) {
    if (adverseLiqDistancePct < 0.8) riskLabel = "extreme";
    else if (adverseLiqDistancePct < 1.8) riskLabel = "high";
    else if (adverseLiqDistancePct < 3.5) riskLabel = "medium";
    else riskLabel = "lower";
  }

  return {
    asset,
    side: normalizedSide,
    entry,
    current,
    stop,
    liquidation,
    leverage,
    margin,
    currentStats,
    stopStats,
    liqStats,
    adverseLiqDistancePct,
    stopDistancePct,
    stopToLiqRatio,
    riskLabel
  };
}

function signedPct(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function money(value) {
  if (value === undefined || value === null || Number.isNaN(value)) return "n/a";
  return `${value >= 0 ? "+" : "-"}$${Math.abs(value).toFixed(2)}`;
}

function formatRiskReport(risk) {
  const stopInterpretation = risk.stopStats
    ? risk.stopStats.roiPct > 0
      ? "Stop level is favorable for this side; it behaves like profit-lock/TP, not loss protection."
      : "Stop level is adverse for this side; it behaves like loss protection."
    : null;
  const lines = [
    `${risk.asset} ${risk.side.toUpperCase()} RISK`,
    "",
    `Entry: ${risk.entry}`,
    risk.current ? `Current: ${risk.current} | ROI now: ${signedPct(risk.currentStats?.roiPct)}${risk.currentStats?.pnl !== undefined ? ` (${money(risk.currentStats.pnl)})` : ""}` : null,
    risk.stop ? `Stop: ${risk.stop} | spot move: ${signedPct(risk.stopStats.spotMovePct)} | leveraged ROI: ${signedPct(risk.stopStats.roiPct)}${risk.stopStats.pnl !== undefined ? ` (${money(risk.stopStats.pnl)})` : ""}` : "Stop: not provided",
    risk.liquidation ? `Liq: ${risk.liquidation} | adverse room: ${signedPct(risk.adverseLiqDistancePct)} | risk: ${risk.riskLabel}` : "Liq: not provided",
    risk.stopToLiqRatio ? `Stop uses ${(risk.stopToLiqRatio * 100).toFixed(0)}% of liquidation room.` : null,
    stopInterpretation,
    "",
    "Read: keep this as analysis only. If stop/invalidation hits, thesis failed before liquidation should matter."
  ].filter(Boolean);
  return lines.join("\n");
}

function extractYouTubeVideoId(input) {
  const text = String(input || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.hostname.includes("youtube.com")) {
      if (url.searchParams.get("v")) return url.searchParams.get("v");
      const parts = url.pathname.split("/").filter(Boolean);
      const shortsIndex = parts.indexOf("shorts");
      if (shortsIndex >= 0) return parts[shortsIndex + 1] || "";
      const embedIndex = parts.indexOf("embed");
      if (embedIndex >= 0) return parts[embedIndex + 1] || "";
    }
  } catch {
    // Fall back to raw video ids.
  }
  return /^[A-Za-z0-9_-]{8,20}$/.test(text) ? text : "";
}

async function fetchYouTubeMetadata(videoId) {
  if (process.env.YOUTUBE_API_KEY) {
    const params = new URLSearchParams({
      part: "snippet",
      id: videoId,
      key: process.env.YOUTUBE_API_KEY
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    const data = await response.json().catch(() => ({}));
    const item = data.items?.[0];
    if (response.ok && item) {
      return {
        title: item.snippet?.title,
        channelTitle: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
        description: item.snippet?.description
      };
    }
  }

  const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  const data = await response.json().catch(() => ({}));
  return response.ok ? { title: data.title, channelTitle: data.author_name } : {};
}

async function analyzeYouTubeUrl({ url, prompt = "", schedule } = {}) {
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    const error = new Error("Provide a valid YouTube URL or video id.");
    error.status = 400;
    throw error;
  }

  const [metadata, transcript] = await Promise.all([
    fetchYouTubeMetadata(videoId).catch((error) => ({ error: error.message })),
    fetchYouTubeTranscript(videoId, process.env)
  ]);
  const transcriptText = transcript.text || transcript.excerpt || "";
  const analysis = await runChat({
    model: process.env.DIGEST_MODEL || "gpt-5.5",
    deepThink: true,
    message: [
      "Analyze this YouTube video for market thesis use.",
      "Extract: claims, assets mentioned, AI/crypto/macro bottlenecks, catalysts, evidence quality, contradictions, and whether it changes any setup.",
      "Return exactly 5 Telegram cards separated by ---MSG---: VIDEO, CLAIMS, BOTTLENECKS, MARKET IMPACT, WATCH.",
      "If the video discusses AI infrastructure, map affected assets across compute, data centers, power/grid, cooling, miners/HPC, semiconductors, and countries/regulation.",
      `URL: https://www.youtube.com/watch?v=${videoId}`,
      `Title: ${metadata.title || "unknown"}`,
      `Channel: ${metadata.channelTitle || "unknown"}`,
      `Published: ${metadata.publishedAt || "unknown"}`,
      `User prompt: ${prompt || "none"}`,
      `Transcript status: ${transcript.status}; provider: ${transcript.provider || "unknown"}`,
      `Transcript excerpt:\n${transcriptText.slice(0, 9000) || "No transcript text available."}`
    ].join("\n\n"),
    location: "Singapore",
    timezone: "Asia/Singapore"
  });

  const subject = `YouTube thesis: ${metadata.title || videoId}`.slice(0, 180);
  const memory = await saveMarketMemory({
    kind: "youtube-analysis",
    subject,
    text: `${analysis.text}\n\nSource: https://www.youtube.com/watch?v=${videoId}`,
    source: "youtube",
    trigger: "youtube-analyze",
    schedule,
    deliveryChannels: ["telegram"],
    extraTags: ["source/youtube"]
  });

  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    metadata,
    transcript: {
      status: transcript.status,
      provider: transcript.provider,
      excerpt: transcriptText.slice(0, 1200),
      error: transcript.error
    },
    analysis,
    memory
  };
}

function isAdminRequest(request, url) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  return request.headers["x-admin-token"] === token || url.searchParams.get("admin_token") === token;
}

function requireAdmin(request, url) {
  if (!process.env.ADMIN_TOKEN) {
    const error = new Error("Set ADMIN_TOKEN on the server before using admin endpoints.");
    error.status = 403;
    throw error;
  }
  if (!isAdminRequest(request, url)) {
    const error = new Error("Admin token required.");
    error.status = 401;
    throw error;
  }
}

function getSgtStamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const isoDate = `${map.year}-${map.month}-${map.day}`;
  const hhmm = `${map.hour}:${map.minute}`;
  return { isoDate, hhmm, label: `${isoDate} ${hhmm} SGT` };
}

function classifyTicker(ticker) {
  if (["BTC", "ETH", "SOL", "DOGE", "XRP"].includes(ticker)) return "crypto";
  if (["EUR", "USDJPY", "EURUSD", "DXY"].includes(ticker.replace("/", ""))) return "fx";
  if (["QQQ", "SPY", "IWM", "DIA", "TQQQ", "SQQQ"].includes(ticker)) return "index";
  return "equity";
}

function fallbackAnalysis(payload, skillLoaded) {
  const message = String(payload.message || "");
  const tickers = extractTickers(message);
  const assets = tickers.map((ticker) => ({ ticker, type: classifyTicker(ticker) }));
  const model = payload.model || "gpt-5.5";
  const focus = assets.length ? assets.map((asset) => asset.ticker).join(", ") : "the configured watchlist";
  const text = [
    [
      "NOW",
      "Local fallback is active: OPENAI_API_KEY is not visible to this PM2/server process.",
      "No real model thesis was generated. Fix the runtime env before trusting scheduled briefs."
    ].join("\n"),
    [
      "SETUPS",
      `No clean trigger returned for ${focus}.`,
      "Use manual Codex/TradingView analysis until OpenAI is connected."
    ].join("\n"),
    [
      "WATCH",
      "Run /status in Telegram or GET /api/scheduler/status.",
      "Restart PM2 with OPENAI_API_KEY in the same command or use a persisted ecosystem/.env loader.",
      "Analysis only. No orders are placed."
    ].join("\n")
  ].join(`\n\n${telegramMessageSeparator}\n\n`);

  return {
    provider: "local-fallback",
    model,
    skillLoaded,
    tickers: assets,
    text
  };
}

function collectResponseText(value, output = []) {
  if (!value) return output;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) output.push(trimmed);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectResponseText(item, output);
    return output;
  }

  if (typeof value !== "object") return output;

  if (value.type === "output_text" || value.type === "text") {
    collectResponseText(value.text, output);
  }
  if (typeof value.output_text === "string") collectResponseText(value.output_text, output);
  if (typeof value.text === "string") collectResponseText(value.text, output);
  if (typeof value.content === "string") collectResponseText(value.content, output);
  if (value.content && value.content !== value) collectResponseText(value.content, output);
  if (value.message && value.message !== value) collectResponseText(value.message, output);
  if (value.output && value.output !== value) collectResponseText(value.output, output);
  if (value.choices && value.choices !== value) collectResponseText(value.choices, output);

  return output;
}

function extractOpenAIResponseText(data) {
  const candidates = collectResponseText(data?.output_text || data?.output || data?.choices || data?.content || data?.message);
  return [...new Set(candidates)].join("\n\n").trim();
}

async function runChat(payload) {
  const engine = await readFinancialEnginePrompt();
  const model = String(payload.model || "gpt-5.5");

  if (!process.env.OPENAI_API_KEY) {
    return fallbackAnalysis(payload, engine.loaded);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS || 8_000));

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: `${engine.prompt}\n\nReturn a concise finance brief. Mention when live TradingView MCP is not connected.`
          },
          {
            role: "user",
            content: JSON.stringify({
              message: payload.message,
              folder: payload.folder,
              bundle: payload.bundle,
              deepThink: payload.deepThink,
              location: payload.location || "Singapore",
              timezone: payload.timezone || "Asia/Singapore"
            })
          }
        ]
      })
    });
  } catch (error) {
    clearTimeout(timeout);
    return { ...fallbackAnalysis(payload, engine.loaded), provider: "local-fallback-after-api-error", error: error.message };
  }
  clearTimeout(timeout);

  const data = await response.json();
  if (!response.ok) {
    return { ...fallbackAnalysis(payload, engine.loaded), provider: "local-fallback-after-api-error", error: data.error?.message || response.statusText };
  }

  return {
    provider: "openai",
    model,
    skillLoaded: engine.loaded,
    tickers: extractTickers(payload.message).map((ticker) => ({ ticker, type: classifyTicker(ticker) })),
    text: extractOpenAIResponseText(data) || `OpenAI returned no text. Response id: ${data.id || "unknown"}.`
  };
}

async function generateDigest(schedule, trigger = "scheduled") {
  const stamp = getSgtStamp();
  const sourceContext = await runResearchSnapshot(schedule, { trigger, dataDir });
  const isFlash = /flash|alert|emergency/i.test(trigger);
  const message = [
    schedule.enginePrompt,
    `Trigger: ${trigger}. Current Singapore time: ${stamp.label}.`,
    `Delivery channel priority: Telegram first, email second. Alert style: ${schedule.alertStyle || "compact"}.`,
    isFlash
      ? `Return a Telegram message pack separated by exactly ${telegramMessageSeparator}. Message 1: FLASH - at most 3 one-line alerts under 160 chars each. Message 2: WATCH - at most 3 bullets. No essay.`
      : `Return exactly 5 Telegram messages separated by exactly ${telegramMessageSeparator}. Message 1 title: NOW - one directional read and max 3 one-line alerts. Message 2 title: BOTTLENECKS - AI/crypto/macro constraints and beneficiary baskets, max 5 bullets. Message 3 title: SCENARIOS - exactly three primary probabilities summing to 100%, plus unweighted tail paths if needed. Message 4 title: SETUPS - max 3 conditional setups, each as ASSET | bias | trigger | invalidation | leverage band. Message 5 title: WATCH - next events/source status, max 5 bullets.`,
    "If live market/news/TradingView connectors are unavailable in this server process, say that clearly and produce a setup-ready brief rather than inventing current prices.",
    "Keep each Telegram message under 900 characters. No intro, no conclusion, no repeated headers. If there is no confirmed trade trigger, say 'No clean trigger' rather than forcing one.",
    "Include: top setup if any, safer leverage band, higher-risk version, exactly three primary probability scenarios summing to 100%, TP/SL/invalidation logic, source modules checked, and AI bottleneck chain when relevant.",
    `Optional social/news source context:\n${JSON.stringify(sourceContext).slice(0, 12000)}`
  ].join("\n\n");

  const result = await runChat({
    message,
    model: process.env.DIGEST_MODEL || "gpt-5.5",
    deepThink: true,
    folder: { name: "Email autopilot", tickers: schedule.markets },
    bundle: schedule.markets.join(", "),
    location: "Singapore",
    timezone: "Asia/Singapore"
  });

  const body = result.text;
  const sourceLine = result.provider === "openai" ? `Generated by ${result.model}.` : "Generated by local fallback until OPENAI_API_KEY is configured.";
  const subject = `MarketOS ${trigger} brief - ${stamp.hhmm} SGT`;

  return {
    subject,
    text: `${body}\n\n${sourceLine}\nAnalysis only. No orders are placed.`,
    html: [
      "<main style=\"font-family:Arial,sans-serif;line-height:1.55;color:#111;max-width:720px\">",
      `<p style="color:#666">${escapeHtml(stamp.label)} | ${escapeHtml(sourceLine)}</p>`,
      `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(body)}</pre>`,
      "<hr />",
      "<p style=\"color:#666;font-size:13px\">Analysis only. MarketOS does not place orders or guarantee outcomes.</p>",
      "</main>"
    ].join("")
  };
}

async function sendEmail({ to, subject, html, text, unsubscribeUrl, idempotencyKey }) {
  const from = process.env.EMAIL_FROM || "MarketOS <onboarding@resend.dev>";
  const canSend = sendEmailsEnabled && process.env.RESEND_API_KEY && process.env.EMAIL_FROM;
  const payload = {
    from,
    to: [to],
    subject,
    html,
    text,
    headers: {
      "List-Unsubscribe": `<${unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    },
    tags: [{ name: "app", value: "marketos" }]
  };

  if (!canSend) {
    const result = {
      ok: true,
      dryRun: true,
      reason: "Set SEND_EMAILS=true, RESEND_API_KEY, and EMAIL_FROM to send real email.",
      payload: { ...payload, to: payload.to.map(maskEmail) }
    };
    await logEmailSend({ provider: "dry-run", to: maskEmail(to), subject, result });
    return result;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 256)
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || data.message || "Resend email send failed.");
    error.status = 502;
    throw error;
  }

  await logEmailSend({ provider: "resend", to: maskEmail(to), subject, id: data.id });
  return { ok: true, provider: "resend", id: data.id };
}

function chunkTelegramText(text) {
  const chunks = [];
  const limit = 3900;
  let remaining = String(text || "");

  while (remaining.length > limit) {
    const softSplitAt = Math.max(remaining.lastIndexOf("\n", limit), remaining.lastIndexOf(" ", limit));
    const splitAt = softSplitAt > 0 ? softSplitAt : limit;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function splitTelegramSections(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return [];

  if (cleaned.includes(telegramMessageSeparator)) {
    return cleaned
      .split(telegramMessageSeparator)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const sectionPattern = /(?=^(?:NOW|FLASH|THESIS|BOTTLENECKS|SCENARIOS|SETUPS|WATCH|WATCH NEXT|WHAT HAPPENED|WHAT MATTERS|WHY IT MATTERS|TECHNICALS|CHAIN|ONE-LINER ALERTS)\b[:\s-]*)/gim;
  const sections = cleaned
    .split(sectionPattern)
    .map((part) => part.trim())
    .filter(Boolean);

  return sections.length > 1 ? sections : [cleaned];
}

function buildTelegramMessages(subject, text) {
  const sections = splitTelegramSections(text);
  const messages = sections.length ? sections : [String(text || "").trim()];
  return messages.flatMap((section, index) => {
    const body = index === 0 ? `${subject}\n\n${section}` : section;
    return chunkTelegramText(body).filter(Boolean);
  });
}

async function sendTelegram({ chatId, subject, text, idempotencyKey }) {
  const targetChatId = String(chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || "").trim();
  const messages = buildTelegramMessages(subject, text);
  const canSend = sendTelegramsEnabled && process.env.TELEGRAM_BOT_TOKEN && targetChatId;
  const payloadPreview = {
    chat_id: targetChatId ? "configured" : "missing",
    messageCount: messages.length,
    text: messages[0]?.slice(0, 500)
  };

  if (!canSend) {
    const result = {
      ok: true,
      dryRun: true,
      provider: "telegram",
      reason: "Set SEND_TELEGRAMS=true, TELEGRAM_BOT_TOKEN, and TELEGRAM_DEFAULT_CHAT_ID or a schedule telegramChatId to send Telegram.",
      payload: payloadPreview
    };
    await logEmailSend({ provider: "telegram-dry-run", to: targetChatId ? "telegram-chat" : "missing-chat", subject, result });
    return result;
  }

  const sent = [];

  for (const [index, chunk] of messages.entries()) {
    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-MarketOS-Idempotency-Key": `${idempotencyKey}:${index}`.slice(0, 256)
      },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: chunk,
        disable_web_page_preview: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const error = new Error(data.description || "Telegram send failed.");
      error.status = 502;
      throw error;
    }
    sent.push(data.result?.message_id);
  }

  await logEmailSend({ provider: "telegram", to: "telegram-chat", subject, ids: sent });
  return { ok: true, provider: "telegram", messageIds: sent, messageCount: sent.length };
}

function formatMemorySearch(entries, query) {
  if (!entries.length) return `MEMORY\nNo notes found for "${query || "latest"}".`;
  return [
    `MEMORY ${query ? `| ${query}` : "| latest"}`,
    "",
    ...entries.slice(0, 5).map((entry, index) => {
      const tags = (entry.tags || []).slice(0, 4).join(", ");
      return `${index + 1}. ${entry.subject}\n${entry.sgt} | ${entry.kind}${tags ? ` | ${tags}` : ""}\n${entry.textPreview || ""}`;
    })
  ].join("\n\n").slice(0, 3500);
}

async function answerNowCommand({ chatId, query, schedule }) {
  const entries = searchMemoryEntries(await readMemoryIndex(), { query, limit: 5 });
  const research = await getResearchStatus(dataDir).catch(() => null);
  const result = await runChat({
    model: process.env.DIGEST_MODEL || "gpt-5.5",
    deepThink: true,
    message: [
      `User asked Telegram /now ${query || ""}.`,
      "Return exactly 5 Telegram cards separated by ---MSG---: NOW, BOTTLENECKS, SCENARIOS, SETUPS, WATCH.",
      "Use conditional setups only. No order placement. Mention if live market data/TradingView is unavailable.",
      "SCENARIOS must contain exactly three primary probabilities summing to 100%, plus unweighted tail paths if useful.",
      "BOTTLENECKS should map AI/crypto/macro infrastructure constraints when relevant: compute, power, data centers, miners/HPC, chips, countries/regulation.",
      `Recent memory:\n${JSON.stringify(entries).slice(0, 6000)}`,
      `Research status:\n${JSON.stringify(research).slice(0, 6000)}`
    ].join("\n\n"),
    folder: { name: "Telegram command", tickers: query ? [query] : schedule?.markets || [] },
    bundle: query,
    location: "Singapore",
    timezone: "Asia/Singapore"
  });

  await sendTelegram({
    chatId,
    subject: `MarketOS NOW ${query || ""}`.trim(),
    text: result.text,
    idempotencyKey: `telegram-now:${chatId}:${Date.now()}`
  });
  return result;
}

async function handleTelegramCommand(update) {
  const message = update.message || update.edited_message;
  const text = String(message?.text || "").trim();
  const chatId = message?.chat?.id;
  if (!chatId || !text.startsWith("/")) return null;

  const allowedChatId = String(process.env.TELEGRAM_DEFAULT_CHAT_ID || "").trim();
  if (allowedChatId && String(chatId) !== allowedChatId) {
    console.warn(`[telegram-commands] ignored command from unauthorized chat ${chatId}`);
    return null;
  }

  const [rawCommand, ...restParts] = text.split(/\s+/);
  const command = rawCommand.split("@")[0].toLowerCase();
  const rest = restParts.join(" ").trim();
  const schedules = await readEmailSchedules();
  const schedule = schedules.find((item) => String(item.telegramChatId) === String(chatId)) || findSchedule(schedules, {});

  if (command === "/help" || command === "/start") {
    await sendTelegram({
      chatId,
      subject: "MarketOS commands",
      text: [
        "/now ETH - memory-aware thesis",
        "/risk asset=ETH side=short entry=2099.7 liq=2139 stop=2097 leverage=18 margin=100",
        "/memory ETH - search saved notes",
        "/youtube <url> - transcript-aware video thesis",
        "/alerts - pending alert memory",
        "/status - bot/source status",
        "",
        "Analysis only. No orders are placed."
      ].join("\n"),
      idempotencyKey: `telegram-help:${chatId}:${Date.now()}`
    });
    return { ok: true, command };
  }

  if (command === "/status") {
    const research = await getResearchStatus(dataDir).catch(() => null);
    const memory = await readMemoryIndex().catch(() => []);
    await sendTelegram({
      chatId,
      subject: "MarketOS status",
      text: [
        `Scheduler: ${schedulerEnabled ? "on" : "off"} | Research: ${researchPollEnabled ? "on" : "off"} | Commands: ${telegramCommandsEnabled ? "on" : "off"}`,
        `Telegram: ${sendTelegramsEnabled ? "send-on" : "send-off"} | OpenAI: ${process.env.OPENAI_API_KEY ? "configured" : "missing"} | YouTube: ${process.env.YOUTUBE_API_KEY ? "configured" : "missing"}`,
        `Memory notes: ${memory.length}`,
        `Research runs: ${research?.runCount || 0} | Pending alerts: ${research?.pendingAlerts?.length || 0}`
      ].join("\n"),
      idempotencyKey: `telegram-status:${chatId}:${Date.now()}`
    });
    return { ok: true, command };
  }

  if (command === "/risk" || command === "/liq" || command === "/plan") {
    const risk = calculateRisk({ text: rest });
    await sendTelegram({
      chatId,
      subject: "MarketOS risk",
      text: formatRiskReport(risk),
      idempotencyKey: `telegram-risk:${chatId}:${Date.now()}`
    });
    await saveMarketMemory({
      kind: "risk-check",
      subject: `${risk.asset} ${risk.side} risk check`,
      text: formatRiskReport(risk),
      source: "telegram-command",
      trigger: command,
      schedule,
      deliveryChannels: ["telegram"],
      extraTags: ["risk/check"]
    });
    return { ok: true, command, risk };
  }

  if (command === "/memory") {
    const entries = searchMemoryEntries(await readMemoryIndex(), { query: rest, limit: 5 });
    await sendTelegram({
      chatId,
      subject: "MarketOS memory",
      text: formatMemorySearch(entries, rest),
      idempotencyKey: `telegram-memory:${chatId}:${Date.now()}`
    });
    return { ok: true, command, count: entries.length };
  }

  if (command === "/alerts") {
    const entries = searchMemoryEntries(await readMemoryIndex(), { tag: "alert/flash", limit: 5 });
    await sendTelegram({
      chatId,
      subject: "MarketOS alerts",
      text: formatMemorySearch(entries, "alert/flash"),
      idempotencyKey: `telegram-alerts:${chatId}:${Date.now()}`
    });
    return { ok: true, command, count: entries.length };
  }

  if (command === "/now" || command === "/thesis") {
    return answerNowCommand({ chatId, query: rest.toUpperCase(), schedule });
  }

  if (command === "/youtube" || command === "/yt") {
    const [url, ...promptParts] = restParts;
    const result = await analyzeYouTubeUrl({ url, prompt: promptParts.join(" "), schedule });
    await sendTelegram({
      chatId,
      subject: result.metadata.title ? `YouTube: ${result.metadata.title}`.slice(0, 180) : "YouTube thesis",
      text: `${result.analysis.text}\n\nSource: ${result.url}`,
      idempotencyKey: `telegram-youtube:${chatId}:${result.videoId}:${Date.now()}`
    });
    return { ok: true, command, videoId: result.videoId };
  }

  await sendTelegram({
    chatId,
    subject: "MarketOS command not recognized",
    text: "Use /help for commands.",
    idempotencyKey: `telegram-unknown:${chatId}:${Date.now()}`
  });
  return { ok: false, command, reason: "unknown" };
}

async function sendDigestForSchedule(schedule, trigger = "scheduled") {
  if (schedule.unsubscribedAt) {
    return { skipped: true, reason: "Schedule is unsubscribed." };
  }

  const digest = await generateDigest(schedule, trigger);
  const memory = await saveMarketMemory({
    kind: "scheduled-brief",
    subject: digest.subject,
    text: digest.text,
    source: "scheduler",
    trigger,
    schedule,
    deliveryChannels: schedule.deliveryChannels || [],
    extraTags: ["delivery/scheduled"]
  });
  const unsubscribeUrl = `${publicBaseUrl}/unsubscribe?token=${encodeURIComponent(schedule.unsubscribeToken)}`;
  const idempotencyKey = `${schedule.id}:${trigger}:${getSgtStamp().isoDate}:${getSgtStamp().hhmm}`;
  const footer = `\n\nUnsubscribe: ${unsubscribeUrl}`;
  const htmlWithFooter = `${digest.html}<p style="font-size:12px;color:#777"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`;
  const deliveryResults = [];

  if (schedule.deliveryChannels?.includes("email")) {
    const result = await sendEmail({
      to: schedule.email,
      subject: digest.subject,
      html: htmlWithFooter,
      text: `${digest.text}${footer}`,
      unsubscribeUrl,
      idempotencyKey
    });
    deliveryResults.push(result);
  }

  if (schedule.deliveryChannels?.includes("telegram")) {
    const result = await sendTelegram({
      chatId: schedule.telegramChatId,
      subject: digest.subject,
      text: digest.text,
      idempotencyKey
    });
    deliveryResults.push(result);
  }

  if (!deliveryResults.length) {
    return { skipped: true, reason: "No delivery channels are enabled." };
  }

  return { ok: true, subject: digest.subject, deliveries: deliveryResults, memory };
}

function findSchedule(schedules, payload = {}) {
  return (
    schedules.find((item) => item.id === payload.scheduleId) ||
    schedules.find((item) => item.email === String(payload.email || "").toLowerCase()) ||
    schedules.find((item) => item.status === "configured" && !item.unsubscribedAt)
  );
}

async function saveAndDeliverCodexBrief(payload) {
  const schedules = await readEmailSchedules();
  const schedule = findSchedule(schedules, payload);
  const stamp = getSgtStamp();
  const subject = String(payload.subject || `MarketOS Codex brief - ${stamp.hhmm} SGT`).trim().slice(0, 180);
  const text = String(payload.text || payload.markdown || "").trim();
  const html = payload.html ? String(payload.html) : `<pre style="white-space:pre-wrap;font-family:Arial,sans-serif">${escapeHtml(text)}</pre>`;

  if (!text) {
    const error = new Error("Codex brief text is required.");
    error.status = 400;
    throw error;
  }

  const channels = normalizeList(payload.deliveryChannels || payload.channels, schedule?.deliveryChannels || ["telegram"]);
  const id = payload.id || randomUUID();
  const deliveryResults = [];

  if (channels.includes("telegram")) {
    deliveryResults.push(
      await sendTelegram({
        chatId: payload.telegramChatId || schedule?.telegramChatId,
        subject,
        text,
        idempotencyKey: `${id}:telegram`
      })
    );
  }

  if (channels.includes("email") && schedule?.email) {
    const unsubscribeUrl = `${publicBaseUrl}/unsubscribe?token=${encodeURIComponent(schedule.unsubscribeToken)}`;
    deliveryResults.push(
      await sendEmail({
        to: schedule.email,
        subject,
        html: `${html}<p style="font-size:12px;color:#777"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`,
        text: `${text}\n\nUnsubscribe: ${unsubscribeUrl}`,
        unsubscribeUrl,
        idempotencyKey: `${id}:email`
      })
    );
  }

  const record = {
    id,
    subject,
    text,
    html,
    source: String(payload.source || "codex-automation"),
    trigger: String(payload.trigger || "manual-codex"),
    scheduleId: schedule?.id,
    email: schedule?.email ? maskEmail(schedule.email) : undefined,
    deliveryChannels: channels,
    deliveryResults,
    createdAt: new Date().toISOString()
  };
  const memory = await saveMarketMemory({
    kind: "codex-brief",
    subject,
    text,
    source: record.source,
    trigger: record.trigger,
    schedule,
    deliveryChannels: channels,
    extraTags: ["delivery/codex"]
  });
  record.memoryId = memory?.id;
  record.memoryPath = memory?.path;
  const briefs = await readCodexBriefs();
  briefs.unshift(record);
  await writeCodexBriefs(briefs);
  return record;
}

async function readFolders() {
  if (!existsSync(foldersFile)) return [];
  const raw = await readFile(foldersFile, "utf8");
  return JSON.parse(raw || "[]");
}

async function saveFolder(payload) {
  const folders = await readFolders();
  const name = String(payload.name || "Untitled folder").trim().slice(0, 80);
  const record = {
    id: payload.id || randomUUID(),
    name,
    tickers: Array.isArray(payload.tickers) ? payload.tickers.slice(0, 20) : extractTickers(name),
    notes: String(payload.notes || "").trim().slice(0, 500),
    updatedAt: new Date().toISOString()
  };

  const index = folders.findIndex((folder) => folder.id === record.id);
  if (index >= 0) folders[index] = record;
  else folders.push(record);

  await writeFile(foldersFile, `${JSON.stringify(folders, null, 2)}\n`);
  return { ok: true, folder: record, folders };
}

async function saveSubscriber(payload) {
  const subscribers = await readSubscribers();
  const normalizedEmail = String(payload.email || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error("Enter a valid email.");
    error.status = 400;
    throw error;
  }

  const record = {
    id: randomUUID(),
    email: normalizedEmail,
    location: String(payload.location || "Singapore").trim(),
    timezone: String(payload.timezone || "Asia/Singapore").trim(),
    cadence: String(payload.cadence || "weekly").trim(),
    channels: Array.isArray(payload.channels) ? payload.channels.slice(0, 4) : ["email"],
    focus: String(payload.focus || "AI, QQQ, Nvidia, macro timing").trim(),
    risk: String(payload.risk || "balanced").trim(),
    createdAt: new Date().toISOString()
  };

  const existingIndex = subscribers.findIndex((item) => item.email === normalizedEmail);
  if (existingIndex >= 0) {
    subscribers[existingIndex] = { ...subscribers[existingIndex], ...record, id: subscribers[existingIndex].id };
  } else {
    subscribers.push(record);
  }

  await writeFile(dataFile, `${JSON.stringify(subscribers, null, 2)}\n`);
  return { ok: true, subscriber: record, count: subscribers.length };
}

function normalizeList(value, fallback = []) {
  const items = (Array.isArray(value) ? value : String(value || "")
    .split(",")
  )
    .map((item) => String(item).trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function buildDigestPrompt(record) {
  const times = record.sendTimesSgt.join(" and ");
  const markets = record.markets.join(", ");
  const creators = record.creatorWatchlist.length ? record.creatorWatchlist.join(", ") : "configured creators";

  return [
    `Run the market-leverage-sentiment engine for a Singapore-based user at ${times} SGT.`,
    `Markets: ${markets}.`,
    `Sources: TradingView/OHLCV when available, macro calendar, CoinMarketCap-style market data, fear/greed/liquidity, funding/liquidations, source-tiered news, YouTube transcript/metadata extraction, X flow, Perplexity/web synthesis, and creator/social watchlist: ${creators}.`,
    "AI bottleneck map: compute/GPU capacity, semiconductors/foundries, data centers, power/grid, cooling, memory/storage, networking/fiber, miner/HPC pivots, cloud capex, export controls, and country-level policy.",
    "Relevant baskets: NVDA/AVGO/TSM/ASML/AMD/MU, hyperscalers, data-center REITs, power/grid/nuclear/gas, cooling, IREN/CORZ/RIOT/CLSK-style miner/HPC infrastructure, BTC/ETH crypto beta, and index expressions like QQQ/SPY.",
    "Research engine: discover new public source events, extract captions/transcripts when available, store creator/source memory, and mark TradingView/MCP status honestly.",
    `Alert lanes: FLASH is one line under 220 characters; NOW is scan-first summary; BOTTLENECKS maps constraints; SCENARIOS has exactly three primary probabilities; SETUPS are conditional trade ideas only after triggers; WATCH is next events.`,
    `Output style: Telegram first, terse, no text walls. Separate Telegram cards with ${telegramMessageSeparator}. Use ${record.alertStyle || "compact"} mode. Include only the strongest setup lines.`,
    `Output: top opportunities, exactly three primary probability scenarios summing to 100%, optional unweighted tail paths, leverage bands, safer vs high-risk version, TP/SL logic, invalidation, AI bottleneck implications, and source ledger.`,
    `Safety: analysis only; do not place orders or guarantee outcomes.`
  ].join(" ");
}

async function saveEmailSchedule(payload) {
  const schedules = await readEmailSchedules();
  const normalizedEmail = String(payload.email || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    const error = new Error("Enter a valid email.");
    error.status = 400;
    throw error;
  }

  const sendTimesSgt = normalizeList(payload.sendTimesSgt, ["08:30", "21:00"])
    .filter((time) => /^\d{2}:\d{2}$/.test(time))
    .slice(0, 4);
  const existing = schedules.find((item) => item.email === normalizedEmail);

  const record = {
    id: payload.id || existing?.id || randomUUID(),
    email: normalizedEmail,
    unsubscribeToken: existing?.unsubscribeToken || randomUUID(),
    timezone: "Asia/Singapore",
    cadence: String(payload.cadence || "twice-daily"),
    sendTimesSgt: sendTimesSgt.length ? sendTimesSgt : ["08:30", "21:00"],
    markets: normalizeList(payload.markets, ["crypto", "indices", "ai-equities", "macro"]).slice(0, 12),
    creatorWatchlist: normalizeList(payload.creatorWatchlist, ["Sajad", "Keith Gill", "Coin Bureau", "Benjamin Cowen", "DataDash"]).slice(0, 20),
    trustedCreatorChannelIds: normalizeList(payload.trustedCreatorChannelIds, []).slice(0, 50),
    youtubeQueries: normalizeList(payload.youtubeQueries, [
      "crypto market analysis ETH BTC liquidity",
      "stock market today QQQ SPY Nvidia",
      "macro market analysis Fed yields dollar"
    ]).slice(0, 10),
    xQueries: normalizeList(payload.xQueries, [
      "($ETH OR $BTC OR $SOL) (liquidity OR liquidation OR funding OR breakout) lang:en -is:retweet",
      "($QQQ OR $SPY OR $NVDA) (market OR earnings OR breakout OR macro) lang:en -is:retweet"
    ]).slice(0, 10),
    sourceModules: normalizeList(payload.sourceModules, [
      "tradingview",
      "news",
      "coin-market-data",
      "fear-greed",
      "funding-liquidations",
      "youtube-social"
    ]).slice(0, 20),
    riskMode: String(payload.riskMode || "balanced").trim(),
    maxLeverage: String(payload.maxLeverage || "8x normal / 18x high-risk only").trim(),
    alertStyle: String(payload.alertStyle || "compact").trim(),
    marketSymbols: normalizeList(payload.marketSymbols, ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "BINANCE:SOLUSDT", "NASDAQ:QQQ", "NASDAQ:NVDA", "TVC:DXY"]).slice(0, 20),
    transcriptsEnabled: payload.transcriptsEnabled !== false,
    discoveryEnabled: payload.discoveryEnabled !== false,
    includeEmergencyAlerts: Boolean(payload.includeEmergencyAlerts),
    deliveryChannels: normalizeList(payload.deliveryChannels, ["email"]).slice(0, 4),
    telegramChatId: String(payload.telegramChatId || existing?.telegramChatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || "").trim(),
    status: "configured",
    createdAt: existing?.createdAt || new Date().toISOString(),
    lastSentKey: existing?.lastSentKey,
    lastSentAt: existing?.lastSentAt,
    unsubscribedAt: null,
    updatedAt: new Date().toISOString()
  };

  record.enginePrompt = buildDigestPrompt(record);

  const existingIndex = schedules.findIndex((item) => item.email === normalizedEmail);
  if (existingIndex >= 0) {
    schedules[existingIndex] = { ...schedules[existingIndex], ...record, id: schedules[existingIndex].id };
  } else {
    schedules.push(record);
  }

  await writeEmailSchedules(schedules);
  return { ok: true, schedule: sanitizeSchedule(record), count: schedules.length };
}

async function unsubscribeSchedule(token) {
  const schedules = await readEmailSchedules();
  const index = schedules.findIndex((schedule) => schedule.unsubscribeToken === token);
  if (index < 0) {
    const error = new Error("Unsubscribe link is invalid or expired.");
    error.status = 404;
    throw error;
  }

  schedules[index] = {
    ...schedules[index],
    status: "unsubscribed",
    unsubscribedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await writeEmailSchedules(schedules);
  return schedules[index];
}

let schedulerRunning = false;
let researchMonitorRunning = false;
let telegramCommandsRunning = false;

async function runSchedulerTick() {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    const stamp = getSgtStamp();
    const schedules = await readEmailSchedules();
    let changed = false;

    for (const schedule of schedules) {
      if (schedule.status !== "configured" || schedule.unsubscribedAt) continue;
      if (!schedule.sendTimesSgt?.includes(stamp.hhmm)) continue;

      const sendKey = `${schedule.id}:${stamp.isoDate}:${stamp.hhmm}`;
      if (schedule.lastSentKey === sendKey) continue;

      try {
        const result = await sendDigestForSchedule(schedule, stamp.hhmm);
        schedule.lastSentKey = sendKey;
        schedule.lastSentAt = new Date().toISOString();
        schedule.lastSendResult = result.deliveries
          ? result.deliveries.map((delivery) => `${delivery.provider || "delivery"}${delivery.dryRun ? "-dry-run" : ""}`).join(",")
          : result.dryRun
            ? "dry-run"
            : result.provider || "sent";
        changed = true;
        console.log(`[scheduler] ${stamp.label} ${schedule.email}: ${schedule.lastSendResult}`);
      } catch (error) {
        schedule.lastSendError = error.message;
        changed = true;
        console.error(`[scheduler] ${stamp.label} ${schedule.email}: ${error.message}`);
      }
    }

    if (changed) await writeEmailSchedules(schedules);
  } finally {
    schedulerRunning = false;
  }
}

function startScheduler() {
  if (!schedulerEnabled) {
    console.log("[scheduler] disabled by SCHEDULER_ENABLED=false");
    return;
  }

  console.log(
    `[scheduler] enabled; SEND_EMAILS=${sendEmailsEnabled ? "true" : "false"}; SEND_TELEGRAMS=${sendTelegramsEnabled ? "true" : "false"}; PUBLIC_BASE_URL=${publicBaseUrl}`
  );
  setTimeout(() => runSchedulerTick().catch((error) => console.error(`[scheduler] ${error.message}`)), 5_000);
  setInterval(() => runSchedulerTick().catch((error) => console.error(`[scheduler] ${error.message}`)), 60_000);
}

function formatFlashAlerts(alerts) {
  return alerts
    .slice(0, 5)
    .map((alert) => `${alert.severity.toUpperCase()} | ${alert.text}${alert.url ? ` | ${alert.url}` : ""}`)
    .join("\n");
}

async function runResearchMonitorTick() {
  if (researchMonitorRunning) return;
  researchMonitorRunning = true;
  try {
    const schedules = await readEmailSchedules();
    for (const schedule of schedules) {
      if (schedule.status !== "configured" || schedule.unsubscribedAt || !schedule.includeEmergencyAlerts) continue;
      const result = await runResearchSnapshot(schedule, { trigger: "monitor-flash", dataDir });
      const alerts = result.memory?.alerts || [];
      if (!alerts.length) continue;

      const flashText = `${formatFlashAlerts(alerts)}\n\nAnalysis only. No orders are placed.`;
      await saveMarketMemory({
        kind: "flash-alert",
        subject: "MarketOS FLASH",
        text: flashText,
        source: "research-monitor",
        trigger: "monitor-flash",
        schedule,
        deliveryChannels: schedule.deliveryChannels || [],
        extraTags: ["alert/flash"]
      });

      if (schedule.deliveryChannels?.includes("telegram")) {
        await sendTelegram({
          chatId: schedule.telegramChatId,
          subject: "MarketOS FLASH",
          text: flashText,
          idempotencyKey: `${schedule.id}:monitor:${alerts.map((alert) => alert.sourceId).join(":")}`
        });
      }
      console.log(`[research] ${schedule.email}: ${alerts.length} flash alert(s)`);
    }
  } catch (error) {
    console.error(`[research] ${error.message}`);
  } finally {
    researchMonitorRunning = false;
  }
}

function startResearchMonitor() {
  if (!researchPollEnabled) {
    console.log("[research] monitor disabled by RESEARCH_POLL_ENABLED!=true");
    return;
  }

  console.log(`[research] monitor enabled; interval=${Math.round(researchPollIntervalMs / 60_000)}m`);
  setTimeout(() => runResearchMonitorTick().catch((error) => console.error(`[research] ${error.message}`)), 15_000);
  setInterval(() => runResearchMonitorTick().catch((error) => console.error(`[research] ${error.message}`)), researchPollIntervalMs);
}

async function runTelegramCommandsTick() {
  if (telegramCommandsRunning) return;
  telegramCommandsRunning = true;
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) return;
    const offset = await readTelegramOffset();
    const params = new URLSearchParams({
      timeout: "0",
      limit: "20"
    });
    if (offset) params.set("offset", String(offset));

    const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getUpdates?${params}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      console.error(`[telegram-commands] ${data.description || response.statusText}`);
      return;
    }

    let nextOffset = offset;
    for (const update of data.result || []) {
      nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
      try {
        await handleTelegramCommand(update);
      } catch (error) {
        const chatId = update.message?.chat?.id || update.edited_message?.chat?.id;
        console.error(`[telegram-commands] ${error.message}`);
        if (chatId) {
          await sendTelegram({
            chatId,
            subject: "MarketOS command error",
            text: `${error.message}\n\nUse /help for command syntax.`,
            idempotencyKey: `telegram-command-error:${chatId}:${update.update_id || Date.now()}`
          }).catch((sendError) => console.error(`[telegram-commands] failed to send error: ${sendError.message}`));
        }
      }
    }

    if (nextOffset !== offset) await writeTelegramOffset(nextOffset);
  } catch (error) {
    console.error(`[telegram-commands] ${error.message}`);
  } finally {
    telegramCommandsRunning = false;
  }
}

function startTelegramCommands() {
  if (!telegramCommandsEnabled) {
    console.log("[telegram-commands] disabled by TELEGRAM_COMMANDS_ENABLED!=true");
    return;
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("[telegram-commands] disabled because TELEGRAM_BOT_TOKEN is missing");
    return;
  }

  console.log(`[telegram-commands] enabled; interval=${Math.round(telegramPollIntervalMs / 1000)}s`);
  setTimeout(() => runTelegramCommandsTick().catch((error) => console.error(`[telegram-commands] ${error.message}`)), 3_000);
  setInterval(() => runTelegramCommandsTick().catch((error) => console.error(`[telegram-commands] ${error.message}`)), telegramPollIntervalMs);
}

async function serveStatic(pathname, response, headOnly = false) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(join(publicDir, requested));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    response.end(headOnly ? undefined : content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  try {
    if (request.method === "POST" && url.pathname === "/api/subscribers") {
      const payload = await readJsonBody(request);
      const result = await saveSubscriber(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/subscribers") {
      const subscribers = await readSubscribers();
      const includePrivate = isAdminRequest(request, url);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: subscribers.length, subscribers: subscribers.map((item) => sanitizeSubscriber(item, includePrivate)) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/email-schedules") {
      const payload = await readJsonBody(request);
      const result = await saveEmailSchedule(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/email-schedules") {
      const schedules = await readEmailSchedules();
      const includePrivate = isAdminRequest(request, url);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: schedules.length, schedules: schedules.map((item) => sanitizeSchedule(item, includePrivate)) }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/scheduler/status") {
      const schedules = await readEmailSchedules();
      const logs = await readSentEmails();
      const research = await getResearchStatus(dataDir).catch(() => null);
      const memory = await readMemoryIndex().catch(() => []);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        schedulerEnabled,
        sendEmailsEnabled,
        sendTelegramsEnabled,
        telegramCommandsEnabled,
        telegramPollIntervalSeconds: Math.round(telegramPollIntervalMs / 1000),
        researchPollEnabled,
        researchPollIntervalMinutes: Math.round(researchPollIntervalMs / 60_000),
        telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_DEFAULT_CHAT_ID),
        youtubeConfigured: Boolean(process.env.YOUTUBE_API_KEY),
        xConfigured: Boolean(process.env.X_BEARER_TOKEN),
        perplexityConfigured: Boolean(process.env.PERPLEXITY_API_KEY),
        tradingViewHttpConfigured: Boolean(process.env.TRADINGVIEW_MCP_HTTP_URL || process.env.MARKET_DATA_HTTP_URL),
        publicBaseUrl,
        configuredSchedules: schedules.filter((schedule) => schedule.status === "configured" && !schedule.unsubscribedAt).length,
        research: research
          ? {
              lastRun: research.lastRun,
              creatorCount: research.creatorCount,
              eventCount: research.eventCount,
              pendingAlertCount: research.pendingAlerts.length
            }
          : null,
        memoryCount: memory.length,
        lastMemory: memory[0] || null,
        lastEmail: sanitizeEmailLog(logs.at(-1))
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/research/status") {
      requireAdmin(request, url);
      const result = await getResearchStatus(dataDir);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/memory") {
      requireAdmin(request, url);
      const entries = await readMemoryIndex();
      const filtered = searchMemoryEntries(entries, {
        query: url.searchParams.get("q") || url.searchParams.get("query") || "",
        tag: url.searchParams.get("tag") || "",
        kind: url.searchParams.get("kind") || "",
        limit: url.searchParams.get("limit") || 25
      });
      const includeText = url.searchParams.get("include_text") === "true";
      const resultEntries = includeText ? await attachMemoryMarkdown(filtered) : filtered;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: resultEntries.length, total: entries.length, entries: resultEntries }));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/memory/")) {
      requireAdmin(request, url);
      const id = decodeURIComponent(url.pathname.slice("/api/memory/".length));
      const entries = await readMemoryIndex();
      const entry = entries.find((item) => item.id === id);
      if (!entry) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Memory note not found." }));
        return;
      }
      const [entryWithText] = await attachMemoryMarkdown([entry]);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ entry: entryWithText }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/memory") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const schedules = await readEmailSchedules();
      const schedule = payload.scheduleId || payload.email ? findSchedule(schedules, payload) : undefined;
      const entry = await saveMarketMemory({
        kind: String(payload.kind || "manual-note"),
        subject: String(payload.subject || "Manual MarketOS note").slice(0, 180),
        text: String(payload.text || payload.markdown || ""),
        source: String(payload.source || "manual"),
        trigger: String(payload.trigger || "manual"),
        schedule,
        deliveryChannels: normalizeList(payload.deliveryChannels, []),
        extraTags: normalizeList(payload.tags, ["manual"])
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, entry }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/codex/context") {
      requireAdmin(request, url);
      const [schedules, research, briefs, memory] = await Promise.all([
        readEmailSchedules(),
        getResearchStatus(dataDir),
        readCodexBriefs(),
        readMemoryIndex()
      ]);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        now: getSgtStamp().label,
        server: {
          publicBaseUrl,
          telegramConfigured: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_DEFAULT_CHAT_ID),
          youtubeConfigured: Boolean(process.env.YOUTUBE_API_KEY),
          xConfigured: Boolean(process.env.X_BEARER_TOKEN),
          perplexityConfigured: Boolean(process.env.PERPLEXITY_API_KEY),
          tradingViewHttpConfigured: Boolean(process.env.TRADINGVIEW_MCP_HTTP_URL || process.env.MARKET_DATA_HTTP_URL)
        },
        schedules: schedules.map((schedule) => sanitizeSchedule(schedule)),
        research,
        recentMemory: memory.slice(0, 12),
        recentCodexBriefs: briefs.slice(0, 12).map((brief) => sanitizeCodexBrief(brief))
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/codex-briefs") {
      requireAdmin(request, url);
      const briefs = await readCodexBriefs();
      const includeText = url.searchParams.get("include_text") === "true";
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: briefs.length, briefs: briefs.map((brief) => sanitizeCodexBrief(brief, includeText)) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/codex-briefs") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const brief = await saveAndDeliverCodexBrief(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, brief: sanitizeCodexBrief(brief, true) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/telegram/send") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const result = await sendTelegram({
        chatId: payload.telegramChatId,
        subject: String(payload.subject || "MarketOS").slice(0, 180),
        text: String(payload.text || ""),
        idempotencyKey: `telegram-direct:${Date.now()}`
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/risk") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const risk = calculateRisk(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, risk, text: formatRiskReport(risk) }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/youtube/analyze") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const schedules = await readEmailSchedules();
      const schedule = payload.scheduleId || payload.email ? findSchedule(schedules, payload) : findSchedule(schedules, {});
      const result = await analyzeYouTubeUrl({ url: payload.url || payload.videoId, prompt: payload.prompt, schedule });
      if (payload.sendTelegram !== false) {
        await sendTelegram({
          chatId: payload.telegramChatId || schedule?.telegramChatId,
          subject: result.metadata.title ? `YouTube: ${result.metadata.title}`.slice(0, 180) : "YouTube thesis",
          text: `${result.analysis.text}\n\nSource: ${result.url}`,
          idempotencyKey: `youtube-analyze:${result.videoId}:${Date.now()}`
        });
      }
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/telegram/commands/poll") {
      requireAdmin(request, url);
      await runTelegramCommandsTick();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/research/run") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const schedules = await readEmailSchedules();
      const schedule =
        schedules.find((item) => item.id === payload.scheduleId || item.email === String(payload.email || "").toLowerCase()) ||
        schedules.find((item) => item.status === "configured" && !item.unsubscribedAt);
      if (!schedule) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Schedule not found." }));
        return;
      }
      const result = await runResearchSnapshot(schedule, { trigger: String(payload.trigger || "manual-research"), dataDir });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/run-digest") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const schedules = await readEmailSchedules();
      const schedule = schedules.find((item) => item.id === payload.scheduleId || item.email === String(payload.email || "").toLowerCase());
      if (!schedule) {
        response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Schedule not found." }));
        return;
      }
      const result = await sendDigestForSchedule(schedule, String(payload.trigger || "manual"));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/telegram/test") {
      requireAdmin(request, url);
      const payload = await readJsonBody(request);
      const result = await sendTelegram({
        chatId: payload.telegramChatId,
        subject: "MarketOS Telegram test",
        text: "Telegram delivery is connected. Scheduled opportunity briefs can now use this channel.",
        idempotencyKey: `telegram-test:${Date.now()}`
      });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, result }));
      return;
    }

    if ((request.method === "GET" || request.method === "POST") && url.pathname === "/unsubscribe") {
      const token = url.searchParams.get("token");
      if (!token) {
        response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Missing unsubscribe token.");
        return;
      }
      const schedule = await unsubscribeSchedule(token);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(`<main style="font-family:Arial,sans-serif;max-width:640px;margin:48px auto;line-height:1.5"><h1>Unsubscribed</h1><p>${escapeHtml(maskEmail(schedule.email))} will no longer receive MarketOS email briefs.</p></main>`);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      const payload = await readJsonBody(request);
      const result = await runChat(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/folders") {
      const folders = await readFolders();
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ folders }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/folders") {
      const payload = await readJsonBody(request);
      const result = await saveFolder(payload);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(result));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/opportunities") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        gated: true,
        plan: "$12/month",
        examples: [
          { asset: "QQQ", bias: "long", leverage: "6x-8x", window: "US cash open confirmation" },
          { asset: "NVDA basket", bias: "long", leverage: "5x-7x", window: "post-news retest only" }
        ]
      }));
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end("Method not allowed");
      return;
    }

    await serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    const status = error.status || 500;
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message || "Server error" }));
  }
});

server.listen(port, () => {
  console.log(`ThesisOS running at http://localhost:${port}`);
  startScheduler();
  startResearchMonitor();
  startTelegramCommands();
});
