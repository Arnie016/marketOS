#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

env_file=".env"
touch "$env_file"
chmod 600 "$env_file"

get_value() {
  local key="$1"
  grep -E "^${key}=" "$env_file" | tail -1 | cut -d= -f2- || true
}

set_value() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"
  if grep -qE "^${key}=" "$env_file"; then
    sed -i.bak "s/^${key}=.*/${key}=${escaped}/" "$env_file"
    rm -f "${env_file}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

prompt_secret() {
  local key="$1"
  local label="$2"
  local current
  current="$(get_value "$key")"
  if [[ -n "$current" ]]; then
    read -r -p "${label} already set. Keep existing? [Y/n] " keep
    if [[ ! "$keep" =~ ^[Nn]$ ]]; then
      return
    fi
  fi
  local value
  read -r -s -p "${label}: " value
  echo
  set_value "$key" "$value"
}

prompt_plain() {
  local key="$1"
  local label="$2"
  local default="${3:-}"
  local current
  current="$(get_value "$key")"
  local prompt="$label"
  if [[ -n "$current" ]]; then
    prompt="${label} [current: ${current}]"
  elif [[ -n "$default" ]]; then
    prompt="${label} [default: ${default}]"
  fi
  local value
  read -r -p "${prompt}: " value
  value="${value:-${current:-$default}}"
  set_value "$key" "$value"
}

if [[ -z "$(get_value ADMIN_TOKEN)" ]]; then
  set_value ADMIN_TOKEN "$(openssl rand -hex 32)"
  echo "Generated ADMIN_TOKEN in .env"
fi

prompt_secret OPENAI_API_KEY "OpenAI API key"
prompt_secret TELEGRAM_BOT_TOKEN "Telegram bot token"
prompt_plain TELEGRAM_DEFAULT_CHAT_ID "Telegram chat id" "989856241"
prompt_secret YOUTUBE_API_KEY "YouTube API key"

set_value PORT "4177"
set_value PUBLIC_BASE_URL "http://47.128.252.247:4177"
set_value SCHEDULER_ENABLED "true"
set_value SEND_TELEGRAMS "true"
set_value TELEGRAM_COMMANDS_ENABLED "true"
set_value TELEGRAM_POLL_INTERVAL_SECONDS "10"
set_value RESEARCH_POLL_ENABLED "true"
set_value RESEARCH_POLL_INTERVAL_MINUTES "180"
set_value OPENAI_TIMEOUT_MS "15000"
set_value DIGEST_MODEL "gpt-5.5"

echo
echo ".env configured with secure file permissions:"
ls -l "$env_file"
echo
echo "Restarting PM2..."
pm2 restart 0 --update-env
pm2 save
echo
echo "Configured keys:"
curl -s "http://localhost:4177/api/scheduler/status" | python3 -m json.tool
