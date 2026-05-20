import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const defaultMarketSymbols = ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT", "BINANCE:SOLUSDT", "NASDAQ:QQQ", "NASDAQ:NVDA", "TVC:DXY"];
const highImpactTerms = [
  "breaking",
  "crash",
  "liquidation",
  "liquidations",
  "funding",
  "etf",
  "sec",
  "fed",
  "fomc",
  "cpi",
  "inflation",
  "tariff",
  "china",
  "nvidia",
  "nvda",
  "hack",
  "war",
  "recession"
];

async function readJsonFile(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw || JSON.stringify(fallback));
}

async function writeJsonFile(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeList(value, fallback = []) {
  const items = (Array.isArray(value) ? value : String(value || "").split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function getIsoHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function compactText(text, max = 6000) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function parseYouTubePlayerResponse(html) {
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*({.+?});\s*var\s/s,
    /ytInitialPlayerResponse\s*=\s*({.+?});<\/script>/s,
    /"playerResponse":"({.+?})","/s
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match) continue;
    try {
      const raw = match[1].startsWith("{") ? match[1] : JSON.parse(`"${match[1]}"`);
      return JSON.parse(raw);
    } catch {
      // Try the next extraction pattern.
    }
  }

  return null;
}

function pickCaptionTrack(playerResponse) {
  const tracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!tracks.length) return null;
  return (
    tracks.find((track) => track.languageCode === "en" && !track.kind) ||
    tracks.find((track) => track.languageCode === "en") ||
    tracks.find((track) => String(track.languageCode || "").startsWith("en")) ||
    tracks[0]
  );
}

function parseTranscriptPayload(raw) {
  try {
    const json = JSON.parse(raw);
    const text = (json.events || [])
      .flatMap((event) => event.segs || [])
      .map((seg) => seg.utf8 || "")
      .join(" ");
    return compactText(text);
  } catch {
    const text = [...String(raw).matchAll(/<text[^>]*>(.*?)<\/text>/gs)]
      .map((match) => decodeHtml(match[1]))
      .join(" ");
    return compactText(text);
  }
}

async function fetchTranscriptFromProvider(videoId, env) {
  if (!env.YOUTUBE_TRANSCRIPT_PROVIDER_URL) return null;
  const base = String(env.YOUTUBE_TRANSCRIPT_PROVIDER_URL).replace(/\/$/, "");
  const separator = base.includes("?") ? "&" : "?";
  const response = await fetch(`${base}${separator}videoId=${encodeURIComponent(videoId)}`);
  const raw = await response.text();
  if (!response.ok) return { status: "error", provider: "external", error: raw.slice(0, 300) };
  try {
    const json = JSON.parse(raw);
    return { status: "ok", provider: "external", text: compactText(json.text || json.transcript || raw, Number(env.YOUTUBE_TRANSCRIPT_MAX_CHARS || 6000)) };
  } catch {
    return { status: "ok", provider: "external", text: compactText(raw, Number(env.YOUTUBE_TRANSCRIPT_MAX_CHARS || 6000)) };
  }
}

export async function fetchYouTubeTranscript(videoId, env) {
  if (env.YOUTUBE_TRANSCRIPTS_ENABLED === "false") {
    return { status: "disabled", note: "YOUTUBE_TRANSCRIPTS_ENABLED=false" };
  }

  const providerResult = await fetchTranscriptFromProvider(videoId, env);
  if (providerResult) return providerResult;

  try {
    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en`;
    const watchResponse = await fetch(watchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 MarketOSResearch/1.0",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const html = await watchResponse.text();
    if (!watchResponse.ok) return { status: "error", provider: "youtube-watch-page", error: `watch page ${watchResponse.status}` };

    const playerResponse = parseYouTubePlayerResponse(html);
    const track = pickCaptionTrack(playerResponse);
    if (!track?.baseUrl) return { status: "no_caption", provider: "youtube-watch-page" };

    const transcriptUrl = `${track.baseUrl.replace(/\\u0026/g, "&")}${track.baseUrl.includes("fmt=") ? "" : "&fmt=json3"}`;
    const transcriptResponse = await fetch(transcriptUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 MarketOSResearch/1.0",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    const raw = await transcriptResponse.text();
    if (!transcriptResponse.ok) return { status: "error", provider: "youtube-caption-track", error: `caption ${transcriptResponse.status}` };

    const text = parseTranscriptPayload(raw);
    return text
      ? { status: "ok", provider: "youtube-caption-track", languageCode: track.languageCode, text: compactText(text, Number(env.YOUTUBE_TRANSCRIPT_MAX_CHARS || 6000)) }
      : { status: "empty", provider: "youtube-caption-track" };
  } catch (error) {
    return { status: "error", provider: "youtube-caption-track", error: error.message };
  }
}

function scoreYouTubeItem(item, query, schedule) {
  const title = String(item.title || "").toLowerCase();
  const description = String(item.description || "").toLowerCase();
  const channel = String(item.channelTitle || "").toLowerCase();
  const queryText = String(query || "").toLowerCase();
  const creators = normalizeList(schedule.creatorWatchlist, []).map((creator) => creator.toLowerCase());
  const trustedChannelIds = new Set(normalizeList(schedule.trustedCreatorChannelIds, []));
  let score = 20;

  if (creators.some((creator) => channel.includes(creator) || creator.includes(channel))) score += 25;
  if (trustedChannelIds.has(item.channelId)) score += 25;
  for (const term of highImpactTerms) {
    if (title.includes(term)) score += 8;
    if (description.includes(term)) score += 3;
  }
  for (const token of queryText.split(/\W+/).filter((token) => token.length > 2)) {
    if (title.includes(token)) score += 2;
  }
  if (item.transcript?.status === "ok") score += 15;
  if (item.publishedAt && Date.now() - Date.parse(item.publishedAt) < 12 * 60 * 60 * 1000) score += 10;

  return Math.min(score, 100);
}

function summarizeYouTubeItem(item, query, transcript, schedule) {
  const record = {
    sourceType: "youtube",
    eventType: "video",
    id: item.id?.videoId,
    sourceId: item.id?.videoId ? `youtube:${item.id.videoId}` : undefined,
    title: item.snippet?.title,
    channelTitle: item.snippet?.channelTitle,
    channelId: item.snippet?.channelId,
    publishedAt: item.snippet?.publishedAt,
    url: item.id?.videoId ? `https://www.youtube.com/watch?v=${item.id.videoId}` : undefined,
    description: item.snippet?.description,
    query,
    transcript: transcript
      ? {
          status: transcript.status,
          provider: transcript.provider,
          excerpt: transcript.text ? compactText(transcript.text, 1200) : undefined,
          error: transcript.error
        }
      : { status: "not_attempted" }
  };
  record.score = scoreYouTubeItem(record, query, schedule);
  return record;
}

async function fetchYouTubeContext(schedule, env) {
  if (!env.YOUTUBE_API_KEY) {
    return {
      status: "not_configured",
      note: "Set YOUTUBE_API_KEY to search fresh creator/video metadata."
    };
  }

  const defaultQueries = [
    "crypto market analysis ETH BTC liquidity",
    "stock market today QQQ SPY Nvidia",
    "macro market analysis Fed yields dollar",
    ...normalizeList(schedule.creatorWatchlist, []).map((creator) => `${creator} market analysis`)
  ];
  const queries = normalizeList(schedule.youtubeQueries, defaultQueries).slice(0, Number(env.YOUTUBE_QUERY_LIMIT || 5));
  const publishedAfter = getIsoHoursAgo(Number(env.YOUTUBE_LOOKBACK_HOURS || env.RESEARCH_LOOKBACK_HOURS || 36));
  const results = [];
  const transcriptLimit = Number(env.YOUTUBE_TRANSCRIPT_VIDEO_LIMIT || 6);
  let transcriptAttempts = 0;
  const transcriptsEnabled = schedule.transcriptsEnabled !== false;

  for (const query of queries) {
    const params = new URLSearchParams({
      part: "snippet",
      type: "video",
      order: "date",
      maxResults: String(env.YOUTUBE_MAX_RESULTS_PER_QUERY || 4),
      publishedAfter,
      q: query,
      key: env.YOUTUBE_API_KEY
    });
    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "error", provider: "youtube-data-api", error: data.error?.message || response.statusText };
    }

    const items = [];
    for (const item of data.items || []) {
      const shouldTranscript = transcriptsEnabled && transcriptAttempts < transcriptLimit && item.id?.videoId;
      const transcript = shouldTranscript ? await fetchYouTubeTranscript(item.id.videoId, env) : { status: "skipped", reason: "transcript limit" };
      if (shouldTranscript) transcriptAttempts += 1;
      items.push(summarizeYouTubeItem(item, query, transcript, schedule));
    }
    results.push({ query, items });
  }

  const flatItems = uniqueBy(results.flatMap((result) => result.items), (item) => item.sourceId);
  return {
    status: "ok",
    provider: "youtube-data-api",
    transcriptMode: env.YOUTUBE_TRANSCRIPT_PROVIDER_URL ? "external-provider" : "best-effort-public-captions",
    caveat: "Transcripts require captions or an external provider; unavailable videos are still scored by metadata.",
    queries,
    results,
    topItems: flatItems.sort((a, b) => b.score - a.score).slice(0, 12)
  };
}

function summarizeXPost(post, usersById, query) {
  const user = usersById.get(post.author_id);
  const score = Math.min(
    100,
    15 +
      highImpactTerms.filter((term) => String(post.text || "").toLowerCase().includes(term)).length * 8 +
      Math.log10((post.public_metrics?.like_count || 0) + (post.public_metrics?.retweet_count || 0) + 1) * 10
  );
  return {
    sourceType: "x",
    eventType: "post",
    id: post.id,
    sourceId: post.id ? `x:${post.id}` : undefined,
    text: post.text,
    createdAt: post.created_at,
    author: user?.username || post.author_id,
    metrics: post.public_metrics,
    query,
    score,
    url: user?.username && post.id ? `https://x.com/${user.username}/status/${post.id}` : undefined
  };
}

async function fetchXContext(schedule, env) {
  if (!env.X_BEARER_TOKEN) {
    return { status: "not_configured", note: "Set X_BEARER_TOKEN to search recent X posts." };
  }

  const defaultQueries = [
    "($ETH OR $BTC OR $SOL) (liquidity OR liquidation OR funding OR breakout) lang:en -is:retweet",
    "($QQQ OR $SPY OR $NVDA) (market OR earnings OR breakout OR macro) lang:en -is:retweet",
    "(Fed OR yields OR DXY OR China) (markets OR risk) lang:en -is:retweet"
  ];
  const queries = normalizeList(schedule.xQueries, defaultQueries).slice(0, Number(env.X_QUERY_LIMIT || 4));
  const results = [];

  for (const query of queries) {
    const params = new URLSearchParams({
      query,
      max_results: String(env.X_MAX_RESULTS_PER_QUERY || 10),
      "tweet.fields": "created_at,public_metrics,author_id",
      expansions: "author_id",
      "user.fields": "username,name,verified"
    });
    const response = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, {
      headers: { Authorization: `Bearer ${env.X_BEARER_TOKEN}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "error", provider: "x-api", error: data.detail || data.title || response.statusText };
    }
    const usersById = new Map((data.includes?.users || []).map((user) => [user.id, user]));
    results.push({
      query,
      posts: (data.data || []).map((post) => summarizeXPost(post, usersById, query))
    });
  }

  return { status: "ok", provider: "x-api", queries, results, topItems: results.flatMap((result) => result.posts).sort((a, b) => b.score - a.score).slice(0, 12) };
}

async function fetchPerplexityContext(schedule, env) {
  if (!env.PERPLEXITY_API_KEY) {
    return { status: "not_configured", note: "Set PERPLEXITY_API_KEY to add current web/news synthesis." };
  }

  const prompt = [
    "Give a terse market-intelligence scan for a Telegram trading analyst bot.",
    `Markets: ${normalizeList(schedule.markets).join(", ")}.`,
    `Creator/social watchlist: ${normalizeList(schedule.creatorWatchlist).join(", ")}.`,
    "Separate: major news, geopolitics/macro, crypto liquidity, equity/index setup implications.",
    "No trade guarantees. Keep under 180 words."
  ].join(" ");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.PERPLEXITY_MODEL || "sonar-pro",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 450
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { status: "error", provider: "perplexity", error: data.error?.message || response.statusText };
  }

  return {
    status: "ok",
    provider: "perplexity",
    text: data.choices?.[0]?.message?.content || ""
  };
}

function summarizeExaResult(result, query) {
  const text =
    result.text ||
    result.summary ||
    (Array.isArray(result.highlights) ? result.highlights.join(" ") : "");
  const lower = `${result.title || ""} ${text || ""}`.toLowerCase();
  const score = Math.min(
    100,
    25 +
      highImpactTerms.filter((term) => lower.includes(term)).length * 6 +
      (result.publishedDate && Date.now() - Date.parse(result.publishedDate) < 24 * 60 * 60 * 1000 ? 12 : 0)
  );

  return {
    sourceType: "exa",
    eventType: "web-result",
    id: result.id || result.url,
    sourceId: result.url ? `exa:${result.url}` : undefined,
    title: result.title,
    url: result.url,
    author: result.author,
    publishedAt: result.publishedDate,
    query,
    text: compactText(text, 1400),
    score
  };
}

async function fetchExaContext(schedule, env) {
  if (!env.EXA_API_KEY) {
    return { status: "not_configured", note: "Set EXA_API_KEY to add AI-native web/news discovery with extracted highlights." };
  }

  const defaultQueries = [
    "latest market moving headlines Reuters AP Bloomberg CNBC WSJ Fed ECB DXY yields crypto equities",
    "latest crypto liquidation funding ETF flows bitcoin ethereum solana CoinDesk The Block Coinglass",
    "latest AI infrastructure Nvidia TSMC Broadcom power data center capex Reuters Bloomberg",
    "latest macro geopolitics dollar oil gold yields China tariff Fed ECB"
  ];
  const queries = normalizeList(schedule.exaQueries, defaultQueries).slice(0, Number(env.EXA_QUERY_LIMIT || 4));
  const results = [];

  for (const query of queries) {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.EXA_API_KEY
      },
      body: JSON.stringify({
        query,
        type: env.EXA_SEARCH_TYPE || "auto",
        numResults: Number(env.EXA_MAX_RESULTS_PER_QUERY || 6),
        startPublishedDate: getIsoHoursAgo(Number(env.EXA_LOOKBACK_HOURS || env.RESEARCH_LOOKBACK_HOURS || 36)),
        contents: {
          highlights: {
            query: "market impact, affected assets, catalyst, contradiction, timing, source claim"
          },
          text: { maxCharacters: Number(env.EXA_TEXT_MAX_CHARS || 1200) }
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { status: "error", provider: "exa", error: data.error || data.message || response.statusText };
    }
    results.push({
      query,
      items: (data.results || []).map((result) => summarizeExaResult(result, query))
    });
  }

  return {
    status: "ok",
    provider: "exa",
    queries,
    topItems: uniqueBy(results.flatMap((result) => result.items), (item) => item.sourceId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 16)
  };
}

function parseMarketSymbol(symbol) {
  const [exchange, ticker] = String(symbol || "").includes(":") ? String(symbol).split(":") : ["BINANCE", String(symbol || "")];
  return { exchange, symbol: ticker };
}

async function fetchMarketDataContext(schedule, env) {
  const endpoint = env.TRADINGVIEW_MCP_HTTP_URL || env.MARKET_DATA_HTTP_URL;
  if (!endpoint) {
    return {
      status: "not_configured",
      provider: "tradingview-mcp-http",
      note: "Set TRADINGVIEW_MCP_HTTP_URL or MARKET_DATA_HTTP_URL on the server to fetch OHLCV/indicators. Local Codex MCP is not automatically available inside Lightsail."
    };
  }

  const symbols = normalizeList(schedule.marketSymbols, defaultMarketSymbols).slice(0, Number(env.MARKET_SYMBOL_LIMIT || 8));
  const base = String(endpoint).replace(/\/$/, "");
  const results = [];

  for (const rawSymbol of symbols) {
    const parsed = parseMarketSymbol(rawSymbol);
    const params = new URLSearchParams({
      exchange: parsed.exchange,
      symbol: parsed.symbol,
      timeframe: env.MARKET_TIMEFRAME || "15m",
      max_records: String(env.MARKET_MAX_RECORDS || 120)
    });
    try {
      const response = await fetch(`${base}/historical?${params}`);
      const data = await response.json().catch(() => ({}));
      results.push({
        requested: rawSymbol,
        status: response.ok ? "ok" : "error",
        provider: "tradingview-mcp-http",
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || response.statusText
      });
    } catch (error) {
      results.push({ requested: rawSymbol, status: "error", provider: "tradingview-mcp-http", error: error.message });
    }
  }

  return { status: "ok", provider: "tradingview-mcp-http", results };
}

function normalizeEvents(context) {
  const youtubeEvents = context.youtube?.topItems || [];
  const xEvents = context.x?.topItems || [];
  const exaEvents = context.exa?.topItems || [];
  const perplexityEvents = context.perplexity?.status === "ok"
    ? [{
        sourceType: "perplexity",
        eventType: "web-synthesis",
        sourceId: `perplexity:${new Date().toISOString().slice(0, 13)}`,
        title: "Perplexity market synthesis",
        text: context.perplexity.text,
        score: 45,
        createdAt: new Date().toISOString()
      }]
    : [];
  return [...youtubeEvents, ...xEvents, ...exaEvents, ...perplexityEvents].filter((event) => event.sourceId);
}

async function mergeSourceEvents(dataDir, events) {
  const filePath = join(dataDir, "source-events.json");
  const existing = await readJsonFile(filePath, []);
  const existingById = new Map(existing.map((event) => [event.sourceId, event]));
  const now = new Date().toISOString();
  const newEvents = [];

  for (const event of events) {
    const prior = existingById.get(event.sourceId);
    if (prior) {
      existingById.set(event.sourceId, { ...prior, ...event, firstSeenAt: prior.firstSeenAt, lastSeenAt: now, seenCount: (prior.seenCount || 1) + 1 });
    } else {
      const record = { ...event, firstSeenAt: now, lastSeenAt: now, seenCount: 1 };
      existingById.set(event.sourceId, record);
      newEvents.push(record);
    }
  }

  const merged = [...existingById.values()]
    .sort((a, b) => Date.parse(b.lastSeenAt || b.createdAt || b.publishedAt || 0) - Date.parse(a.lastSeenAt || a.createdAt || a.publishedAt || 0))
    .slice(0, 1000);
  await writeJsonFile(filePath, merged);
  return { events: merged, newEvents };
}

async function updateCreatorMemory(dataDir, youtubeContext) {
  const filePath = join(dataDir, "creators.json");
  const existing = await readJsonFile(filePath, []);
  const byId = new Map(existing.map((creator) => [creator.channelId || creator.name, creator]));
  const now = new Date().toISOString();

  for (const item of youtubeContext?.topItems || []) {
    if (!item.channelId && !item.channelTitle) continue;
    const key = item.channelId || item.channelTitle;
    const prior = byId.get(key) || {
      channelId: item.channelId,
      name: item.channelTitle,
      sourceType: "youtube",
      firstSeenAt: now,
      topics: [],
      videoCount: 0,
      averageScore: 0
    };
    const topics = [...new Set([...(prior.topics || []), item.query].filter(Boolean))].slice(0, 20);
    const videoCount = (prior.videoCount || 0) + 1;
    const averageScore = Math.round((((prior.averageScore || 0) * (videoCount - 1) + (item.score || 0)) / videoCount) * 10) / 10;
    byId.set(key, { ...prior, name: item.channelTitle || prior.name, channelId: item.channelId || prior.channelId, topics, videoCount, averageScore, lastSeenAt: now });
  }

  const creators = [...byId.values()].sort((a, b) => (b.averageScore || 0) - (a.averageScore || 0)).slice(0, 500);
  await writeJsonFile(filePath, creators);
  return creators;
}

function buildAlertCandidates(events, env) {
  const threshold = Number(env.FLASH_ALERT_SCORE || 70);
  return events
    .filter((event) => (event.score || 0) >= threshold)
    .slice(0, 8)
    .map((event) => ({
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      severity: event.score >= 85 ? "high" : "medium",
      sourceId: event.sourceId,
      text: `${event.sourceType?.toUpperCase() || "SOURCE"} | ${event.title || event.text?.slice(0, 90)} | score ${event.score}`,
      url: event.url
    }));
}

async function appendAlerts(dataDir, alerts) {
  if (!alerts.length) return [];
  const filePath = join(dataDir, "alert-queue.json");
  const existing = await readJsonFile(filePath, []);
  const merged = [...alerts, ...existing].slice(0, 500);
  await writeJsonFile(filePath, merged);
  return merged;
}

async function appendResearchRun(dataDir, run) {
  const filePath = join(dataDir, "research-runs.json");
  const existing = await readJsonFile(filePath, []);
  const merged = [run, ...existing].slice(0, 200);
  await writeJsonFile(filePath, merged);
}

function sourceStatuses(context) {
  return {
    youtube: context.youtube?.status || "unknown",
    x: context.x?.status || "unknown",
    exa: context.exa?.status || "unknown",
    perplexity: context.perplexity?.status || "unknown",
    marketData: context.marketData?.status || "unknown"
  };
}

export async function runResearchSnapshot(schedule, options = {}) {
  const env = options.env || process.env;
  const dataDir = options.dataDir || join(process.cwd(), "data");
  await mkdir(dataDir, { recursive: true });
  const startedAt = new Date().toISOString();

  const [youtube, x, exa, perplexity, marketData] = await Promise.allSettled([
    fetchYouTubeContext(schedule, env),
    fetchXContext(schedule, env),
    fetchExaContext(schedule, env),
    fetchPerplexityContext(schedule, env),
    fetchMarketDataContext(schedule, env)
  ]).then((results) => results.map((result) => (result.status === "fulfilled" ? result.value : { status: "error", error: result.reason?.message || "source failed" })));

  const context = { youtube, x, exa, perplexity, marketData };
  const normalizedEvents = normalizeEvents(context);
  const { newEvents } = await mergeSourceEvents(dataDir, normalizedEvents);
  const creators = schedule.discoveryEnabled === false ? await readJsonFile(join(dataDir, "creators.json"), []) : await updateCreatorMemory(dataDir, youtube);
  const alerts = buildAlertCandidates(newEvents, env);
  await appendAlerts(dataDir, alerts);

  const run = {
    id: randomUUID(),
    trigger: options.trigger || "manual",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceStatuses: sourceStatuses(context),
    eventCount: normalizedEvents.length,
    newEventCount: newEvents.length,
    alertCount: alerts.length
  };
  await appendResearchRun(dataDir, run);

  return {
    ...context,
    memory: {
      run,
      newEvents: newEvents.slice(0, 20),
      alerts,
      topCreators: creators.slice(0, 12)
    }
  };
}

export async function getResearchStatus(dataDir) {
  const [runs, creators, events, alerts] = await Promise.all([
    readJsonFile(join(dataDir, "research-runs.json"), []),
    readJsonFile(join(dataDir, "creators.json"), []),
    readJsonFile(join(dataDir, "source-events.json"), []),
    readJsonFile(join(dataDir, "alert-queue.json"), [])
  ]);

  return {
    runCount: runs.length,
    lastRun: runs[0],
    creatorCount: creators.length,
    topCreators: creators.slice(0, 12),
    eventCount: events.length,
    recentEvents: events.slice(0, 12),
    pendingAlerts: alerts.slice(0, 12)
  };
}
