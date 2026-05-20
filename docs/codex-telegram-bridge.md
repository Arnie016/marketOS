# Codex To Telegram Bridge

MarketOS can receive richer Codex-side market briefs through:

```text
POST /api/codex-briefs
```

This is the path for automations that have access to Codex tools such as TradingView MCP, screenshots, browser context, and local skills:

```text
Codex automation -> MarketOS /api/codex-briefs -> memory vault -> Telegram cards
```

## Submit A Brief

From the MarketOS server:

```bash
cd ~/apps/market-thesis

cat brief.md | npm run send:codex-brief -- \
  --subject "Codex Market Pulse - 21:00 SGT" \
  --trigger "codex-automation-market-leverage-trend-pulse"
```

From another machine:

```bash
export MARKETOS_BASE_URL="http://47.128.252.247:4177"
export MARKETOS_ADMIN_TOKEN="..."

cat brief.md | node scripts/send-codex-brief.mjs \
  --subject "Codex Market Pulse - 21:00 SGT" \
  --trigger "codex-automation-market-leverage-trend-pulse"
```

## Telegram Format

Use `---MSG---` between cards. Keep each card short.

```text
NOW
One directional read. Say whether it is signal-ready or setup-only.

---MSG---

SETUPS
ASSET | bias | trigger | invalidation | safer leverage | high-risk cap

---MSG---

SCENARIOS
Bull 40% / Chop 35% / Bear 25%. Probabilities sum to 100%.

---MSG---

WATCH
Next timing windows, source limitations, and what would invalidate the thesis.
Analysis only. No orders placed.
```

## Codex Automation Prompt

```text
Run the market-leverage-sentiment skill for a Singapore-based user.

Use TradingView MCP when available for OHLCV, levels, ATR/expected wick, opening range, and multi-timeframe alignment. If unavailable, say so explicitly.

Produce a Telegram-first brief with cards separated by ---MSG---:
1. NOW: strongest current read and whether it is signal-ready or setup-only.
2. SETUPS: max 3 conditional setups with asset, bias, trigger, invalidation, safer leverage band, high-risk cap.
3. SCENARIOS: exactly three primary probabilities summing to 100%.
4. WATCH: next events, timing windows in SGT, source limitations, and invalidations.

Keep the Telegram cards terse. Save detailed tables and source ledger in the full brief/memory, but do not send a wall of text.

After finalizing, send the brief to MarketOS:
POST http://47.128.252.247:4177/api/codex-briefs
Header: x-admin-token from MARKETOS_ADMIN_TOKEN
Body:
{
  "subject": "Codex Market Pulse - <SGT time>",
  "text": "<brief with ---MSG--- separators>",
  "deliveryChannels": ["telegram"],
  "trigger": "codex-automation-market-leverage-trend-pulse",
  "source": "codex-automation"
}

No order placement. No guarantees. Analysis only.
```

## Timing

Default useful windows for Singapore:

- `08:30 SGT`: Asia reset, crypto overnight, macro/news scan.
- `21:00 SGT`: U.S. cash-open prep for equities/indices and crypto correlation.
- Flash alerts: only for confirmed high-impact events or setup triggers.
