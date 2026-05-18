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
