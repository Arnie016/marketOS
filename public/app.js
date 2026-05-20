const cashState = document.querySelector("#cashState");
const futuresState = document.querySelector("#futuresState");
const sgtClock = document.querySelector("#sgtClock");
const askForm = document.querySelector("#askForm");
const promptInput = document.querySelector("#marketPrompt");
const briefText = document.querySelector("#briefText");
const conversation = document.querySelector("#conversation");
const welcomePanel = document.querySelector("#welcomePanel");
const subscribeForm = document.querySelector("#subscribeForm");
const saveStatus = document.querySelector("#saveStatus");
const deepThinkToggle = document.querySelector("#deepThinkToggle");
const modelSelect = document.querySelector("#modelSelect");
const activeFolderName = document.querySelector("#activeFolderName");
const contextSubtitle = document.querySelector("#contextSubtitle");
const tickerRow = document.querySelector("#tickerRow");
const engineState = document.querySelector("#engineState");
const providerState = document.querySelector("#providerState");
const foldersList = document.querySelector("#foldersList");
const setupList = document.querySelector("#setupList");
const setupTitle = document.querySelector("#setupTitle");
const setupSummary = document.querySelector("#setupSummary");
const setupBias = document.querySelector("#setupBias");
const setupSafeLev = document.querySelector("#setupSafeLev");
const setupHighLev = document.querySelector("#setupHighLev");
const setupScore = document.querySelector("#setupScore");
const returnCaption = document.querySelector("#returnCaption");
const returnChart = document.querySelector("#returnChart");
const projectionRows = document.querySelector("#projectionRows");
const exitLadder = document.querySelector("#exitLadder");
const scenarioStack = document.querySelector("#scenarioStack");
const telegramPreview = document.querySelector("#telegramPreview");

let deepThinkEnabled = true;
let activeFolder = "QQQ open";
let activeTickers = ["QQQ", "SPY", "NVDA", "DXY"];
let activeBundle = "Index";
let selectedSetupId = "eth-short";
let selectedCapital = 100;
let selectedLeverage = 5;

const tickerInfo = {
  QQQ: "Nasdaq 100 ETF: AI/growth upside sleeve.",
  SPY: "S&P 500 ETF: broad market core.",
  NVDA: "Nvidia: AI catalyst leader, high beta.",
  TSM: "TSMC: Nvidia/AI supply chain.",
  AVGO: "Broadcom: custom AI chips and infra.",
  MU: "Micron: HBM/memory AI beta.",
  IREN: "Iris Energy: BTC miner and AI/HPC data center pivot.",
  CORZ: "Core Scientific: BTC miner and AI/HPC infrastructure.",
  RIOT: "Riot Platforms: Bitcoin mining and power infrastructure.",
  CLSK: "CleanSpark: Bitcoin miner with energy-cost sensitivity.",
  BTC: "Bitcoin: 24/7 liquidity/risk appetite proxy.",
  ETH: "Ethereum: crypto beta and ETF/liquidity proxy.",
  SOL: "Solana: high-beta crypto network.",
  DXY: "Dollar index: macro pressure gauge.",
  VIX: "Equity volatility gauge.",
  IWM: "Russell 2000 ETF: small-cap risk appetite.",
  USOIL: "Oil: inflation and geopolitical pressure.",
  GOLD: "Gold: real rates and safety demand.",
  XAUUSD: "Gold CFD/spot quote."
};

const setups = [
  {
    id: "eth-short",
    title: "ETH short continuation",
    asset: "ETH",
    bias: "Short",
    direction: -1,
    score: 64,
    safeLeverage: "3x-5x",
    highLeverage: "8x-12x after trigger",
    summary: "Best only if ETH rejects resistance or loses support. Do not chase middle candles; wick survival matters more than headline conviction.",
    trigger: "Reject 2123-2128 or break/retest below 2107",
    invalidation: "Clean reclaim above 2136 with BTC holding bid",
    targetMove: -1.4,
    stopMove: 0.55,
    exits: [
      ["Wait", "No trade in the middle", "Let price either reject resistance or break support first."],
      ["Enter", "Short only after trigger", "Trigger must be price-confirmed, not just YouTube/social sentiment."],
      ["Protect", "Stop above reclaim zone", "If ETH reclaims the breakdown area, the short thesis is stale."],
      ["Trim", "First flush into liquidity", "Take partial profit into fast downside candles; do not wait for perfect bottom."],
      ["Kill", "BTC flips risk-on", "If BTC breaks higher with ETH volume, stop treating this as a clean short."]
    ],
    scenarios: [
      ["Downside continuation", 44, "ETH loses local support, long liquidations extend, shorts get paid.", "var(--green)"],
      ["Whipsaw/range", 36, "Price chops around support and taxes high leverage with wicks.", "var(--yellow)"],
      ["Squeeze", 20, "Reclaim above resistance traps late shorts.", "var(--red)"]
    ]
  },
  {
    id: "qqq-open",
    title: "QQQ long after cash-open confirmation",
    asset: "QQQ",
    bias: "Long",
    direction: 1,
    score: 61,
    safeLeverage: "2x-4x",
    highLeverage: "5x-8x max",
    summary: "A better parking lane than random perps if US cash open confirms breadth. Needs DXY/yields not fighting the move.",
    trigger: "First 15-30 min range breaks up with NVDA/semis participating",
    invalidation: "Opening range breakdown or DXY/yields spike",
    targetMove: 0.85,
    stopMove: -0.42,
    exits: [
      ["Wait", "Do not front-run cash open", "Let opening-range volatility print first."],
      ["Enter", "Long on breadth confirmation", "Need QQQ plus semis, not one megacap only."],
      ["Protect", "Stop below opening range", "If it loses the range, the setup becomes chop."],
      ["Trim", "First push into resistance", "Cash open moves often mean revert after the first impulse."],
      ["Kill", "Rates/DXY shock", "Macro pressure overrides AI narrative in index trades."]
    ],
    scenarios: [
      ["AI-led upside", 42, "NVDA/semis pull QQQ higher after open.", "var(--green)"],
      ["Priced-in chop", 38, "Good headlines already reflected; range trade only.", "var(--yellow)"],
      ["Macro disappointment", 20, "Rates/DXY or weak breadth fades the move.", "var(--red)"]
    ]
  },
  {
    id: "ai-hpc",
    title: "AI-HPC miner basket",
    asset: "IREN/CORZ/RIOT/CLSK",
    bias: "Long basket",
    direction: 1,
    score: 58,
    safeLeverage: "Spot-2x",
    highLeverage: "3x-5x only",
    summary: "Second-order AI bottleneck bet: cheap power and data-center capacity become scarce. This is volatile equity beta, not a clean perps scalp.",
    trigger: "BTC stable plus fresh AI capacity/datacenter headline",
    invalidation: "BTC sells off hard or power/capex narrative weakens",
    targetMove: 4.2,
    stopMove: -2.1,
    exits: [
      ["Wait", "Need catalyst plus tape", "These names can move without liquidity discipline."],
      ["Enter", "Scale basket, not one ticker", "Diversify single-name headline risk."],
      ["Protect", "Stop on BTC + basket breakdown", "If BTC and the basket fall together, the hedge failed."],
      ["Trim", "Fast gap-up into hype", "These squeezes can reverse violently."],
      ["Kill", "AI capacity story contradicted", "If hyperscaler/AI demand cools, this becomes just miner beta."]
    ],
    scenarios: [
      ["Bottleneck repricing", 39, "AI data-center scarcity pulls miner/HPC assets higher.", "var(--green)"],
      ["BTC beta chop", 41, "Stocks follow BTC and ignore AI thesis short-term.", "var(--yellow)"],
      ["Capex/power selloff", 20, "Market punishes power costs, dilution, or weak BTC.", "var(--red)"]
    ]
  },
  {
    id: "btc-short",
    title: "BTC short only below range",
    asset: "BTC",
    bias: "Short",
    direction: -1,
    score: 55,
    safeLeverage: "2x-4x",
    highLeverage: "6x-8x max",
    summary: "Cleaner hedge than shorting every alt if BTC loses range support. If BTC is range-bound, ETH/SOL shorts can get squeezed faster.",
    trigger: "Break and failed retest of local BTC support",
    invalidation: "Reclaim above range midpoint with spot bid",
    targetMove: -1.1,
    stopMove: 0.45,
    exits: [
      ["Wait", "Need range loss", "BTC chops are designed to liquidate impatient shorts."],
      ["Enter", "Short failed retest", "Breakdown alone is weaker than break plus retest failure."],
      ["Protect", "Stop above reclaimed range", "If range is reclaimed, thesis invalidates."],
      ["Trim", "Into liquidation flush", "Fast red candles are where short profit exists."],
      ["Kill", "ETF/spot bid appears", "Spot-led demand can squeeze perps quickly."]
    ],
    scenarios: [
      ["Risk-off break", 40, "BTC loses support and drags majors down.", "var(--green)"],
      ["Range chop", 42, "Funding/liquidity whipsaw both sides.", "var(--yellow)"],
      ["Spot squeeze", 18, "ETF/spot demand reclaims the range.", "var(--red)"]
    ]
  },
  {
    id: "sol-long",
    title: "SOL high-beta recovery long",
    asset: "SOL",
    bias: "Long",
    direction: 1,
    score: 51,
    safeLeverage: "2x-3x",
    highLeverage: "5x-8x max",
    summary: "Only makes sense if BTC and ETH stabilize first. SOL can outperform on recovery but has worse wick risk.",
    trigger: "BTC/ETH stabilize, SOL reclaims local resistance with volume",
    invalidation: "SOL loses reclaim level or BTC rolls over",
    targetMove: 2.4,
    stopMove: -1.15,
    exits: [
      ["Wait", "Need majors stable", "Do not long SOL while BTC is still breaking down."],
      ["Enter", "Long reclaim plus volume", "SOL needs confirmation because wicks are larger."],
      ["Protect", "Stop below reclaim", "If reclaim fails, exit quickly."],
      ["Trim", "At first relative outperformance", "SOL rallies can be sharp but fragile."],
      ["Kill", "BTC/ETH reject", "High-beta long dies if majors reject."]
    ],
    scenarios: [
      ["High-beta bounce", 36, "Majors stabilize and SOL catches up.", "var(--green)"],
      ["No-confirmation chop", 40, "SOL fails to separate from majors.", "var(--yellow)"],
      ["Alt flush", 24, "BTC/ETH roll over and SOL underperforms.", "var(--red)"]
    ]
  }
];

function getSelectedSetup() {
  return setups.find((setup) => setup.id === selectedSetupId) || setups[0];
}

function getSgtParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-SG", {
    timeZone: "Asia/Singapore",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: map.weekday,
    hour: Number(map.hour),
    minute: Number(map.minute),
    label: `${map.weekday} ${map.hour}:${map.minute}`
  };
}

function minutesSinceMidnight({ hour, minute }) {
  return hour * 60 + minute;
}

function updateSessionClock() {
  const now = getSgtParts();
  const minutes = minutesSinceMidnight(now);
  const isWeekday = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(now.weekday);
  const isSaturday = now.weekday === "Sat";
  const cashOpen = isWeekday && minutes >= 21 * 60 + 30;
  const cashAfterMidnight = ["Tue", "Wed", "Thu", "Fri", "Sat"].includes(now.weekday) && minutes < 4 * 60;
  const futuresOpen =
    (isWeekday && minutes >= 6 * 60) ||
    (["Tue", "Wed", "Thu", "Fri"].includes(now.weekday) && minutes < 5 * 60) ||
    (isSaturday && minutes < 5 * 60);
  const futuresBreak = ["Tue", "Wed", "Thu", "Fri", "Sat"].includes(now.weekday) && minutes >= 5 * 60 && minutes < 6 * 60;

  sgtClock.textContent = now.label;
  cashState.textContent = cashOpen || cashAfterMidnight ? "Open" : "Closed";
  futuresState.textContent = futuresBreak ? "Break" : futuresOpen ? "Open" : "Closed";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function highlightTickers(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\b[A-Z]{2,6}(?:\/[A-Z]{2,5})?\b/g, (match) => {
    const key = match.replace("/", "");
    const title = tickerInfo[match] || tickerInfo[key] || "Tracked market symbol.";
    return `<button class="ticker-token" type="button" title="${escapeHtml(title)}" data-ticker="${escapeHtml(match)}">${escapeHtml(match)}</button>`;
  });
}

function formatUsd(value) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function appendMessage(role, label, html, extraClass = "") {
  const message = document.createElement("article");
  message.className = `message ${role} ${extraClass}`.trim();
  message.innerHTML = role === "user" ? `<p>${html}</p>` : `<span>${escapeHtml(label)}</span><p>${html}</p>`;
  conversation.appendChild(message);
  conversation.scrollTop = conversation.scrollHeight;
  return message;
}

function renderTickerRow() {
  tickerRow.innerHTML = activeTickers
    .map((ticker) => `<span title="${escapeHtml(tickerInfo[ticker] || "Tracked symbol")}" data-ticker="${escapeHtml(ticker)}">${escapeHtml(ticker)}</span>`)
    .join("");
  contextSubtitle.textContent = activeFolder;
  activeFolderName.textContent = activeFolder;
}

function renderSetupList() {
  setupList.innerHTML = setups
    .map(
      (setup) => `
        <button class="setup-card ${setup.id === selectedSetupId ? "active" : ""}" type="button" data-setup-id="${setup.id}">
          <div>
            <small>${escapeHtml(setup.asset)} · ${escapeHtml(setup.bias)}</small>
            <strong>${escapeHtml(setup.title)}</strong>
            <span>${escapeHtml(setup.trigger)}</span>
          </div>
          <div class="setup-score">${setup.score}</div>
        </button>
      `
    )
    .join("");

  setupList.querySelectorAll("[data-setup-id]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSetupId = button.dataset.setupId;
      renderAllSetupViews();
    });
  });
}

function pnlForMove(capital, leverage, spotMovePercent, setup = getSelectedSetup()) {
  return capital * leverage * ((spotMovePercent * setup.direction) / 100);
}

function chartPoint(x, y, bounds) {
  const xScale = (x - bounds.minX) / (bounds.maxX - bounds.minX);
  const yScale = (y - bounds.minY) / (bounds.maxY - bounds.minY);
  return [bounds.pad + xScale * (bounds.width - bounds.pad * 2), bounds.height - bounds.pad - yScale * (bounds.height - bounds.pad * 2)];
}

function renderReturnChart() {
  const setup = getSelectedSetup();
  const moves = [-4, -3, -2, -1, -0.5, 0, 0.5, 1, 2, 3, 4];
  const values = moves.map((move) => pnlForMove(selectedCapital, selectedLeverage, move, setup));
  const maxAbs = Math.max(1, ...values.map((value) => Math.abs(value)));
  const bounds = { width: 720, height: 260, pad: 34, minX: -4, maxX: 4, minY: -maxAbs * 1.15, maxY: maxAbs * 1.15 };
  const points = moves.map((move, index) => chartPoint(move, values[index], bounds));
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const zeroY = chartPoint(0, 0, bounds)[1];
  const zeroX = chartPoint(0, 0, bounds)[0];
  const targetX = chartPoint(setup.targetMove, 0, bounds)[0];
  const stopX = chartPoint(setup.stopMove, 0, bounds)[0];

  returnCaption.textContent = `$${selectedCapital.toLocaleString()} margin at ${selectedLeverage}x · ${setup.asset}`;
  returnChart.innerHTML = `
    <line x1="${bounds.pad}" y1="${zeroY}" x2="${bounds.width - bounds.pad}" y2="${zeroY}" stroke="rgba(255,255,255,.2)" />
    <line x1="${zeroX}" y1="${bounds.pad}" x2="${zeroX}" y2="${bounds.height - bounds.pad}" stroke="rgba(255,255,255,.13)" />
    <line x1="${targetX}" y1="${bounds.pad}" x2="${targetX}" y2="${bounds.height - bounds.pad}" stroke="rgba(14,203,129,.65)" stroke-dasharray="6 6" />
    <line x1="${stopX}" y1="${bounds.pad}" x2="${stopX}" y2="${bounds.height - bounds.pad}" stroke="rgba(246,70,93,.65)" stroke-dasharray="6 6" />
    <path d="${path}" fill="none" stroke="#f4c430" stroke-width="4" stroke-linecap="round" />
    ${points
      .map(([x, y], index) => `<circle cx="${x}" cy="${y}" r="${moves[index] === 0 ? 4 : 3}" fill="${values[index] >= 0 ? "#0ecb81" : "#f6465d"}" />`)
      .join("")}
    <text x="${bounds.pad}" y="24" fill="#a0a7b2" font-size="12">spot move %</text>
    <text x="${bounds.width - bounds.pad - 130}" y="24" fill="#f4c430" font-size="12">leveraged P/L</text>
    <text x="${targetX + 6}" y="${bounds.height - 16}" fill="#0ecb81" font-size="12">target ${setup.targetMove}%</text>
    <text x="${stopX + 6}" y="${bounds.height - 32}" fill="#f6465d" font-size="12">stop ${setup.stopMove}%</text>
    <text x="${bounds.pad}" y="${zeroY - 8}" fill="#68707d" font-size="12">$0</text>
  `;

  projectionRows.innerHTML = [10, 100, 1000]
    .map((capital) => {
      const target = pnlForMove(capital, selectedLeverage, setup.targetMove, setup);
      const stop = pnlForMove(capital, selectedLeverage, setup.stopMove, setup);
      return `
        <div>
          <span>${capital.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} margin</span>
          <strong class="${target >= 0 ? "positive" : "negative"}">${formatUsd(target)}</strong>
          <small>Target ${setup.targetMove}% spot · stop ${formatUsd(stop)}</small>
        </div>
      `;
    })
    .join("");
}

function renderExitLadder() {
  const setup = getSelectedSetup();
  exitLadder.innerHTML = setup.exits
    .map(
      ([phase, title, detail]) => `
        <div class="exit-step">
          <span>${escapeHtml(phase)}</span>
          <div>
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(detail)}</small>
          </div>
        </div>
      `
    )
    .join("");
}

function renderScenarios() {
  const setup = getSelectedSetup();
  scenarioStack.innerHTML = setup.scenarios
    .map(
      ([name, probability, detail, color]) => `
        <article class="scenario-row" style="--w:${probability}%;--c:${color}">
          <header><strong>${escapeHtml(name)}</strong><strong>${probability}%</strong></header>
          <p>${escapeHtml(detail)}</p>
        </article>
      `
    )
    .join("");
}

function renderTelegramPreview() {
  const setup = getSelectedSetup();
  telegramPreview.innerHTML = [
    ["NOW", `${setup.asset}: ${setup.bias}. Wait for trigger; do not chase middle candles.`],
    ["SETUP", `${setup.asset} | ${setup.bias} | trigger: ${setup.trigger} | invalidation: ${setup.invalidation}.`],
    ["RISK", `Normal ${setup.safeLeverage}; high-risk ${setup.highLeverage}. Stop before liquidation, not at liquidation.`],
    ["SCENARIOS", setup.scenarios.map(([name, probability]) => `${probability}% ${name}`).join(" / ")],
    ["WATCH", "TradingView/OHLCV + news + funding + YouTube/social; social is weak unless price confirms."]
  ]
    .map(
      ([title, body]) => `
        <article class="telegram-message">
          <strong>${escapeHtml(title)}</strong>
          <span>${highlightTickers(body)}</span>
          <small>Analysis only. No orders placed.</small>
        </article>
      `
    )
    .join("");
}

function renderHero() {
  const setup = getSelectedSetup();
  setupTitle.textContent = setup.title;
  setupSummary.textContent = setup.summary;
  setupBias.textContent = setup.bias;
  setupSafeLev.textContent = setup.safeLeverage;
  setupHighLev.textContent = setup.highLeverage;
  setupScore.textContent = `${setup.score}/100`;
}

function renderAllSetupViews() {
  renderSetupList();
  renderHero();
  renderReturnChart();
  renderExitLadder();
  renderScenarios();
  renderTelegramPreview();
}

function renderScheduleConfirmation(schedule) {
  const times = schedule.sendTimesSgt.join(" + ");
  const markets = schedule.markets.join(", ");
  const creators = schedule.creatorWatchlist.join(", ");
  return highlightTickers(
    `Autopilot saved for ${times} SGT. Markets: ${markets}. Watchlist: ${creators}. Risk mode: ${schedule.riskMode}. Max leverage rule: ${schedule.maxLeverage}.`
  );
}

async function runPrompt(prompt) {
  const text = prompt.trim();
  if (!text) return;

  welcomePanel?.classList.add("hidden");
  appendMessage("user", "You", highlightTickers(text));
  const thinking = appendMessage("assistant", "Deep Think", "Routing through financial engine", "thinking");
  promptInput.value = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        model: modelSelect.value,
        deepThink: deepThinkEnabled,
        folder: { name: activeFolder, tickers: activeTickers },
        bundle: activeBundle,
        location: "Singapore",
        timezone: "Asia/Singapore"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Chat failed");

    thinking.remove();
    appendMessage("assistant", result.provider === "openai" ? "Model response" : "Local engine", highlightTickers(result.text), "draft");
    briefText.innerHTML = highlightTickers(result.text);
    engineState.textContent = result.skillLoaded ? "Financial skill loaded" : "Fallback engine loaded";
    providerState.textContent =
      result.provider === "openai" ? `${result.model} via OpenAI API` : `${result.model} local fallback. Restart PM2 with OPENAI_API_KEY.`;

    if (Array.isArray(result.tickers) && result.tickers.length) {
      activeTickers = [...new Set([...activeTickers, ...result.tickers.map((item) => item.ticker)])].slice(0, 10);
      renderTickerRow();
    }
  } catch (error) {
    thinking.remove();
    appendMessage("assistant", "Error", escapeHtml(error.message), "draft");
  }
}

async function saveFolder(name, tickers) {
  await fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, tickers, notes: "Saved from MarketOS UI" })
  }).catch(() => undefined);
}

function bindPromptButtons(root = document) {
  root.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => runPrompt(button.dataset.prompt));
  });
}

function bindFolderButton(button) {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-folder]").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    activeFolder = button.dataset.folder;
    activeTickers = button.dataset.tickers.split(",").map((ticker) => ticker.trim());
    activeBundle = activeFolder;
    renderTickerRow();
    welcomePanel?.classList.remove("hidden");
    briefText.textContent = `Loaded ${activeFolder}. Ask a question or paste more tickers.`;
  });
}

function addFolderButton(name, tickers) {
  const button = document.createElement("button");
  button.className = "folder active";
  button.type = "button";
  button.dataset.folder = name;
  button.dataset.tickers = tickers.join(",");
  button.innerHTML = `<span>${escapeHtml(name)}</span><small>${escapeHtml(tickers.join(", "))}</small>`;
  document.querySelectorAll("[data-folder]").forEach((item) => item.classList.remove("active"));
  foldersList.appendChild(button);
  bindFolderButton(button);
}

bindPromptButtons();

document.querySelectorAll("[data-folder]").forEach((button) => bindFolderButton(button));

document.querySelectorAll("[data-bundle]").forEach((button) => {
  button.addEventListener("click", () => {
    activeBundle = button.dataset.bundle;
    activeTickers = button.dataset.tickers.split(",").map((ticker) => ticker.trim());
    renderTickerRow();
    runPrompt(`Use the ${activeBundle} bundle: ${activeTickers.join(", ")}.`);
  });
});

document.querySelector("#newAnalysisButton").addEventListener("click", () => {
  conversation.querySelectorAll(".message:not(#enginePreview)").forEach((node) => node.remove());
  welcomePanel?.classList.remove("hidden");
  briefText.textContent = "New analysis ready. Paste tickers or ask a finance question.";
});

document.querySelector("#newFolderButton").addEventListener("click", async () => {
  const name = window.prompt("Folder name", "New ticker thesis");
  if (!name) return;
  const tickers = (window.prompt("Tickers", "QQQ,NVDA,BTC") || "")
    .split(",")
    .map((ticker) => ticker.trim().toUpperCase())
    .filter(Boolean);
  activeFolder = name;
  activeTickers = tickers.length ? tickers : ["QQQ"];
  renderTickerRow();
  await saveFolder(name, activeTickers);
  addFolderButton(name, activeTickers);
  appendMessage("assistant", "Folder saved", highlightTickers(`${name}: ${activeTickers.join(", ")}`), "draft");
});

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runPrompt(promptInput.value);
});

deepThinkToggle.addEventListener("click", () => {
  deepThinkEnabled = !deepThinkEnabled;
  deepThinkToggle.classList.toggle("active", deepThinkEnabled);
  deepThinkToggle.textContent = deepThinkEnabled ? "Deep Think" : "Fast";
});

document.querySelector("#capitalButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-capital]");
  if (!button) return;
  selectedCapital = Number(button.dataset.capital);
  document.querySelectorAll("#capitalButtons button").forEach((item) => item.classList.toggle("active", item === button));
  renderReturnChart();
});

document.querySelector("#leverageButtons").addEventListener("click", (event) => {
  const button = event.target.closest("[data-leverage]");
  if (!button) return;
  selectedLeverage = Number(button.dataset.leverage);
  document.querySelectorAll("#leverageButtons button").forEach((item) => item.classList.toggle("active", item === button));
  renderReturnChart();
});

subscribeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(subscribeForm);
  const channels = formData.getAll("channel");
  const sourceModules = formData.getAll("sourceModule");
  const markets = formData.getAll("market");
  const sendTimesSgt = formData
    .getAll("sendTime")
    .map((time) => String(time).trim())
    .filter(Boolean);
  const payload = {
    email: formData.get("email"),
    location: formData.get("location"),
    timezone: "Asia/Singapore",
    cadence: formData.get("cadence"),
    riskMode: formData.get("riskMode"),
    alertStyle: formData.get("alertStyle"),
    maxLeverage: formData.get("maxLeverage"),
    telegramChatId: formData.get("telegramChatId"),
    focus: formData.get("focus"),
    creatorWatchlist: formData.get("creatorWatchlist"),
    youtubeQueries: formData.get("youtubeQueries"),
    xQueries: formData.get("xQueries"),
    sendTimesSgt,
    sourceModules,
    markets,
    includeEmergencyAlerts: formData.get("emergencyAlerts") === "true",
    deliveryChannels: channels,
    channels
  };

  saveStatus.textContent = "Saving";

  try {
    const response = await fetch("/api/email-schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Save failed");
    window.localStorage.setItem("market-os:last-email-schedule", JSON.stringify(result.schedule));
    saveStatus.textContent = `Saved ${result.count} delivery plan${result.count === 1 ? "" : "s"}`;
    appendMessage("assistant", "Autopilot", renderScheduleConfirmation(result.schedule), "draft");
  } catch (error) {
    saveStatus.textContent = error.message;
  }
});

renderTickerRow();
renderAllSetupViews();
updateSessionClock();
window.setInterval(updateSessionClock, 30_000);
