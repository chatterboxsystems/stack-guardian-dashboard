# Stack Guardian Dashboard

CBS Infrastructure Monitor — polls the Watchtower Flask API and displays live system health.

## Architecture

```
VPS Flask API (port 5055) → Dashboard polls every 60s → Railway deployment
```

## Setup

### 1. Environment Variables

Create a `.env` file in the root (or set in Railway dashboard):

```
REACT_APP_STATUS_API=http://YOUR_VPS_IP:5055
```

Replace `YOUR_VPS_IP` with the actual VPS IP. Default is `http://100.106.125.48:5055`.

### 2. Local Development

```bash
npm install
npm start
```

### 3. Deploy to Railway

1. Push this repo to `github.com/chatterboxsystems/stack-guardian-dashboard`
2. In Railway: New Project → Deploy from GitHub Repo → select this repo
3. Add environment variable: `REACT_APP_STATUS_API=http://100.106.125.48:5055`
4. Railway auto-deploys on every `git push`

## API Endpoints Expected

The dashboard polls these endpoints on the Flask status API:

- `GET /status` — current check results + incidents
- `GET /health` — API liveness
- `GET /history` — last 48h snapshots

## Demo Mode

If the Flask API is unreachable, the dashboard automatically falls back to **demo mode** with mock data. The pill in the top-right shows `◌ DEMO` vs `● LIVE`.

## Tech Stack

- React 18
- Polling via `setInterval` (no websockets needed)
- Zero external dependencies beyond React
- Deployed via Railway + Nixpacks
