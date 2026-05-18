# MarketOS / ThesisOS

Finance analyst console for saved ticker folders, Singapore-time market context, and scheduled opportunity email plans.

## Local Run

```bash
npm install
npm run check
npm run start
```

Open `http://localhost:4177`.

## Lightsail Deploy

Use the Singapore Node.js Lightsail instance.

```bash
mkdir -p ~/apps
cd ~/apps
git clone https://github.com/Arnie016/marketOS.git market-thesis
cd market-thesis
npm install
npm run check
sudo npm install -g pm2
pm2 start server.mjs --name market-thesis
pm2 save
pm2 startup
```

For quick testing, open TCP port `4177` in Lightsail networking and visit:

```text
http://47.128.252.247:4177
```

For production, attach a static IP, add a domain, put Nginx in front of the app, and use HTTPS.

## Data Safety

Do not commit `.env`, subscriber lists, email schedules, uploaded screenshots, API keys, wallet keys, exchange passwords, cookies, or seed phrases.

The app currently stores schedules locally as JSON. Email sending and real cron workers should be connected on the server next.

## Server Email Scheduler

The Node process includes a PM2-friendly scheduler. It checks saved email plans every minute using Singapore time and runs matching briefs.

Required production environment:

```bash
export PUBLIC_BASE_URL="https://your-domain.com"
export ADMIN_TOKEN="change-this-long-random-token"
export SCHEDULER_ENABLED=true
export SEND_EMAILS=true
export RESEND_API_KEY="re_..."
export EMAIL_FROM="MarketOS <briefs@your-domain.com>"
export OPENAI_API_KEY="sk-..."
```

If `SEND_EMAILS` is not `true`, or Resend settings are missing, the scheduler records a dry run in `data/sent-emails.json` and sends nothing.

Admin-only manual run:

```bash
curl -X POST http://localhost:4177/api/run-digest \
  -H "Content-Type: application/json" \
  -H "x-admin-token: $ADMIN_TOKEN" \
  -d '{"email":"you@example.com","trigger":"manual-test"}'
```

Scheduler status:

```bash
curl http://localhost:4177/api/scheduler/status
```
