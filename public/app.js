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

let deepThinkEnabled = true;
let activeFolder = "QQQ open";
let activeTickers = ["QQQ", "SPY", "NVDA", "DXY"];
let activeBundle = "Index";

const tickerInfo = {
  QQQ: "Nasdaq 100 ETF: AI/growth upside sleeve.",
  SPY: "S&P 500 ETF: broad market core.",
  NVDA: "Nvidia: AI catalyst leader, high beta.",
  TSM: "TSMC: Nvidia/AI supply chain.",
  AVGO: "Broadcom: custom AI chips and infra.",
  MU: "Micron: HBM/memory AI beta.",
  BTC: "Bitcoin: 24/7 liquidity/risk appetite proxy.",
  ETH: "Ethereum: crypto beta and ETF/liquidity proxy.",
  SOL: "Solana: high beta crypto network.",
  DXY: "Dollar index: macro pressure gauge.",
  EUR: "EUR perp usually maps to EUR/USD.",
  USDJPY: "USD/JPY: dollar strength plus Japan intervention risk.",
  IWM: "Russell 2000 ETF: small-cap risk appetite.",
  USOIL: "Oil: inflation and geopolitical pressure.",
  GOLD: "Gold: real rates and safety demand."
};

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

function renderScheduleConfirmation(schedule) {
  const times = schedule.sendTimesSgt.join(" + ");
  const markets = schedule.markets.join(", ");
  const creators = schedule.creatorWatchlist.join(", ");
  return highlightTickers(
    `Email autopilot saved for ${times} SGT. Markets: ${markets}. Creators/social watch: ${creators}. Risk mode: ${schedule.riskMode}. Max leverage rule: ${schedule.maxLeverage}.`
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
      result.provider === "openai" ? `${result.model} via OpenAI API` : `${result.model} local fallback. Add OPENAI_API_KEY for model calls.`;

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
    body: JSON.stringify({ name, tickers, notes: "Saved from ThesisOS UI" })
  }).catch(() => undefined);
}

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => runPrompt(button.dataset.prompt));
});

document.querySelectorAll("[data-folder]").forEach((button) => {
  bindFolderButton(button);
});

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

askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runPrompt(promptInput.value);
});

deepThinkToggle.addEventListener("click", () => {
  deepThinkEnabled = !deepThinkEnabled;
  deepThinkToggle.classList.toggle("active", deepThinkEnabled);
  deepThinkToggle.textContent = deepThinkEnabled ? "Deep Think" : "Fast";
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
    maxLeverage: formData.get("maxLeverage"),
    telegramChatId: formData.get("telegramChatId"),
    focus: formData.get("focus"),
    creatorWatchlist: formData.get("creatorWatchlist"),
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
    window.localStorage.setItem("thesis-os:last-email-schedule", JSON.stringify(result.schedule));
    saveStatus.textContent = `Saved ${result.count} delivery plan${result.count === 1 ? "" : "s"}`;
    appendMessage("assistant", "Email autopilot", renderScheduleConfirmation(result.schedule), "draft");
  } catch (error) {
    saveStatus.textContent = error.message;
  }
});

renderTickerRow();
updateSessionClock();
window.setInterval(updateSessionClock, 30_000);
