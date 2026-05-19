import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { getResearchStatus, runResearchSnapshot } from "./research-engine.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const dataDir = join(root, "data");
const dataFile = join(root, "data", "subscribers.json");
const foldersFile = join(root, "data", "folders.json");
const emailSchedulesFile = join(root, "data", "email-schedules.json");
const sentEmailsFile = join(root, "data", "sent-emails.json");
const skillPath = process.env.FINANCIAL_ENGINE_SKILL_PATH || "/Users/arnav/.codex/skills/market-leverage-sentiment/SKILL.md";
const port = Number(process.env.PORT || 4177);
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/$/, "");
const schedulerEnabled = process.env.SCHEDULER_ENABLED !== "false";
const sendEmailsEnabled = process.env.SEND_EMAILS === "true";
const sendTelegramsEnabled = process.env.SEND_TELEGRAMS === "true";
const researchPollEnabled = process.env.RESEARCH_POLL_ENABLED === "true";
const researchPollIntervalMs = Math.max(15, Number(process.env.RESEARCH_POLL_INTERVAL_MINUTES || 180)) * 60_000;

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

async function generateDigest(schedule, trigger = "scheduled") {
  const stamp = getSgtStamp();
  const sourceContext = await runResearchSnapshot(schedule, { trigger, dataDir });
  const isFlash = /flash|alert|emergency/i.test(trigger);
  const message = [
    schedule.enginePrompt,
    `Trigger: ${trigger}. Current Singapore time: ${stamp.label}.`,
    `Delivery channel priority: Telegram first, email second. Alert style: ${schedule.alertStyle || "compact"}.`,
    isFlash
      ? "This is a FLASH alert. Return at most 3 one-line alerts. Format each line: ASSET | direction/bias | trigger | invalidation. No essay."
      : "This is a scheduled thesis. Use four short sections: WHAT HAPPENED, WHAT MATTERS, SETUPS, WATCH. Keep each bullet under 18 words.",
    "If live market/news/TradingView connectors are unavailable in this server process, say that clearly and produce a setup-ready brief rather than inventing current prices.",
    "Return a Telegram-ready brief with: top setup if any, safer leverage band, higher-risk version, three probability scenarios summing to 100%, TP/SL/invalidation logic, source modules checked, and a short warning that this is analysis only.",
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
    const splitAt = Math.max(remaining.lastIndexOf("\n", limit), remaining.lastIndexOf(" ", limit), limit);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendTelegram({ chatId, subject, text, idempotencyKey }) {
  const targetChatId = String(chatId || process.env.TELEGRAM_DEFAULT_CHAT_ID || "").trim();
  const canSend = sendTelegramsEnabled && process.env.TELEGRAM_BOT_TOKEN && targetChatId;
  const payloadPreview = {
    chat_id: targetChatId ? "configured" : "missing",
    text: `${subject}\n\n${String(text || "").slice(0, 500)}`
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

  const chunks = chunkTelegramText(`${subject}\n\n${text}`);
  const sent = [];

  for (const [index, chunk] of chunks.entries()) {
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
  return { ok: true, provider: "telegram", messageIds: sent };
}

async function sendDigestForSchedule(schedule, trigger = "scheduled") {
  if (schedule.unsubscribedAt) {
    return { skipped: true, reason: "Schedule is unsubscribed." };
  }

  const digest = await generateDigest(schedule, trigger);
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

  return { ok: true, subject: digest.subject, deliveries: deliveryResults };
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
    "Research engine: discover new public source events, extract captions/transcripts when available, store creator/source memory, and mark TradingView/MCP status honestly.",
    "Alert lanes: FLASH is one line under 220 characters; WHAT HAPPENED is daily recap; WHAT MATTERS is macro/geopolitics; SETUPS are conditional trade ideas only after triggers.",
    `Output style: Telegram first, terse, no text walls. Use ${record.alertStyle || "compact"} mode. Include only the strongest setup lines.`,
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

      if (schedule.deliveryChannels?.includes("telegram")) {
        await sendTelegram({
          chatId: schedule.telegramChatId,
          subject: "MarketOS FLASH",
          text: `${formatFlashAlerts(alerts)}\n\nAnalysis only. No orders are placed.`,
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
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({
        schedulerEnabled,
        sendEmailsEnabled,
        sendTelegramsEnabled,
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
});
