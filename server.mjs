import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataFile = join(root, "data", "subscribers.json");
const foldersFile = join(root, "data", "folders.json");
const emailSchedulesFile = join(root, "data", "email-schedules.json");
const skillPath = process.env.FINANCIAL_ENGINE_SKILL_PATH || "/Users/arnav/.codex/skills/market-leverage-sentiment/SKILL.md";
const port = Number(process.env.PORT || 4177);

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

async function readFinancialEnginePrompt() {
  try {
    const skill = await readFile(skillPath, "utf8");
    return {
      loaded: true,
      prompt: `You are ThesisOS, a finance analysis agent. Use this local financial engine skill as your operating contract:\n\n${skill.slice(0, 12000)}`
    };
  } catch {
    return {
      loaded: false,
      prompt:
        "You are ThesisOS, a finance analysis agent. Always check market timing, macro regime, catalyst chain, technicals, risk, leverage room, TP/SL, and source quality. Analysis only, no order placement."
    };
  }
}

function extractTickers(text) {
  const matches = String(text || "").match(/\b[A-Z]{2,6}(?:\/[A-Z]{2,5})?\b/g) || [];
  return [...new Set(matches)].slice(0, 12);
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
  const mode = payload.deepThink ? "Deep Think" : "Fast";
  const model = payload.model || "gpt-5.5";
  const focus = assets.length ? assets.map((asset) => asset.ticker).join(", ") : "QQQ, SPY, NVDA, BTC";

  return {
    provider: "local-fallback",
    model,
    skillLoaded,
    tickers: assets,
    text: `${mode} draft for ${focus}. Market timing comes first, then macro KPIs, catalyst chain, technical stack, scenario weights, leverage room, TP/SL, and delivery. Connect OPENAI_API_KEY to replace this local fallback with the selected model response.`
  };
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
    text: data.output_text || "No text returned."
  };
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
    id: payload.id || crypto.randomUUID(),
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
    id: crypto.randomUUID(),
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
    `Sources: TradingView/OHLCV when available, macro calendar, CoinMarketCap-style market data, fear/greed/liquidity, funding/liquidations, source-tiered news, and creator/social watchlist: ${creators}.`,
    `Output: top opportunities, probability scenarios summing to 100%, leverage bands, safer vs high-risk version, TP/SL logic, invalidation, and source ledger.`,
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

  const record = {
    id: payload.id || crypto.randomUUID(),
    email: normalizedEmail,
    timezone: "Asia/Singapore",
    cadence: String(payload.cadence || "twice-daily"),
    sendTimesSgt: sendTimesSgt.length ? sendTimesSgt : ["08:30", "21:00"],
    markets: normalizeList(payload.markets, ["crypto", "indices", "ai-equities", "macro"]).slice(0, 12),
    creatorWatchlist: normalizeList(payload.creatorWatchlist, ["Sajad", "CheatG"]).slice(0, 20),
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
    includeEmergencyAlerts: Boolean(payload.includeEmergencyAlerts),
    deliveryChannels: normalizeList(payload.deliveryChannels, ["email"]).slice(0, 4),
    status: "configured",
    updatedAt: new Date().toISOString()
  };

  record.enginePrompt = buildDigestPrompt(record);

  const existingIndex = schedules.findIndex((item) => item.email === normalizedEmail);
  if (existingIndex >= 0) {
    schedules[existingIndex] = { ...schedules[existingIndex], ...record, id: schedules[existingIndex].id };
  } else {
    schedules.push(record);
  }

  await writeFile(emailSchedulesFile, `${JSON.stringify(schedules, null, 2)}\n`);
  return { ok: true, schedule: record, count: schedules.length };
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
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: subscribers.length, subscribers }));
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
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ count: schedules.length, schedules }));
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
});
