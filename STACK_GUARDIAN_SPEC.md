# Stack Guardian — Full Implementation Spec
**Issued by:** Claude CIO  
**For:** Infra  
**Date:** June 4, 2026  
**Priority:** HIGH — Build in order, Phase 1 first

---

## Architecture Overview

```
VPS (ip-172-31-44-91)
├── watchtower.py          ← runs every 15 min via cron
├── status.json            ← written by watchtower, served by Flask
└── status-api.py          ← Flask API serving status.json to dashboard

Railway (external)
└── stack-guardian-dashboard  ← React app polling Flask API every 60s
```

**Key principle:** Watchtower and the dashboard are FULLY DECOUPLED from Mission Control. MC is not touched.

---

## Phase 1 — Watchtower Script

### File Location
```
~/.openclaw/workspace/ops/watchtower.py
```

### What It Monitors (every 15 minutes via cron)

| Check | Method | RED Threshold |
|---|---|---|
| VPS CPU | psutil | >85% sustained |
| VPS RAM | psutil | >85% used |
| VPS Disk | psutil | >75% used (warn), >85% (critical) |
| OpenClaw Gateway | HTTP GET localhost:18789/health | non-200 or timeout |
| Mission Control API | HTTP GET 100.106.125.48:4000/health | non-200 or timeout |
| CBS Landing Page | HTTP GET send.chatterbox.systems | non-200 or timeout >5s |
| GHL Webhook Health | HTTP GET GHL API ping | non-200 |
| SSL Certificate | check cert expiry on send.chatterbox.systems | <14 days remaining |
| Cron Jobs | read /var/log/cron or last-run timestamps | missed last expected run |
| Agent Processes | check systemd status for benson, jeffrey, flo | not active |

### Status Levels
```
GREEN  = all checks passing
YELLOW = 1-2 non-critical warnings (disk >75%, SSL <30 days)
RED    = any critical failure (gateway down, MC down, landing page down)
```

### Output — status.json Schema
Watchtower writes this file after EVERY run:
```
~/.openclaw/workspace/ops/status.json
```

```json
{
  "last_updated": "2026-06-04T07:15:00Z",
  "overall_status": "GREEN",
  "checks": {
    "vps_cpu": {
      "status": "GREEN",
      "value": "34%",
      "message": "Normal"
    },
    "vps_ram": {
      "status": "GREEN",
      "value": "61%",
      "message": "Normal"
    },
    "vps_disk": {
      "status": "YELLOW",
      "value": "78%",
      "message": "Disk above 75% warning threshold"
    },
    "openclaw_gateway": {
      "status": "GREEN",
      "value": "200",
      "message": "Responding normally"
    },
    "mission_control": {
      "status": "GREEN",
      "value": "200",
      "message": "Responding normally"
    },
    "cbs_landing_page": {
      "status": "GREEN",
      "value": "200",
      "message": "Response time: 412ms"
    },
    "ghl_webhook": {
      "status": "GREEN",
      "value": "200",
      "message": "GHL API reachable"
    },
    "ssl_certificate": {
      "status": "GREEN",
      "value": "47 days",
      "message": "Certificate healthy"
    },
    "cron_jobs": {
      "status": "GREEN",
      "value": "4/4",
      "message": "All cron jobs ran on schedule"
    },
    "agent_processes": {
      "status": "GREEN",
      "value": "3/3",
      "message": "benson, jeffrey, flo all active"
    }
  },
  "incidents": [],
  "run_count_today": 12
}
```

### Alert Logic
```python
# After writing status.json, watchtower checks overall_status:
# GREEN  → no alert, silent run
# YELLOW → post to Discord #ops-watchtower only
# RED    → post to Discord #ops-watchtower AND send Telegram to Steven
```

### Telegram Alert Format (RED only)
```
🚨 STACK GUARDIAN ALERT
Status: RED
Time: 2026-06-04 07:15 UTC
Failed checks:
  ❌ openclaw_gateway — Gateway not responding
  ❌ vps_disk — Disk at 87% (critical)
Action required. Check #ops-watchtower for details.
```

### Discord Post Format (YELLOW + RED)
```
🟡 WATCHTOWER REPORT — 2026-06-04 07:15 UTC
Overall: YELLOW

✅ VPS CPU: 34%
✅ VPS RAM: 61%
⚠️ VPS Disk: 78% — above warning threshold
✅ OpenClaw Gateway: OK
✅ Mission Control: OK
✅ CBS Landing Page: OK (412ms)
✅ GHL Webhook: OK
✅ SSL: 47 days remaining
✅ Cron Jobs: 4/4
✅ Agents: 3/3 (benson, jeffrey, flo)
```

### Cron Entry
```bash
# Run watchtower every 15 minutes
*/15 * * * * /usr/bin/python3 /root/.openclaw/workspace/ops/watchtower.py >> /root/.openclaw/workspace/ops/logs/watchtower.log 2>&1
```

---

## Phase 2 — Flask Status API

### File Location
```
~/.openclaw/workspace/ops/status-api.py
```

### Purpose
Lightweight Flask server that serves `status.json` to the dashboard. That's it. No auth complexity, no write endpoints. Read-only.

### Port
```
5055
```
(chosen to avoid conflicts with gateway:18789 and MC:4000)

### Endpoints

#### GET /status
Returns current `status.json` contents.
```json
{
  "last_updated": "2026-06-04T07:15:00Z",
  "overall_status": "GREEN",
  "checks": { ... },
  "incidents": [],
  "run_count_today": 12
}
```

#### GET /health
Simple liveness check for the API itself.
```json
{ "status": "ok", "service": "stack-guardian-status-api" }
```

#### GET /history
Returns last 48 hours of status snapshots (watchtower archives each run).
```json
{
  "snapshots": [
    { "timestamp": "2026-06-04T07:15:00Z", "overall_status": "GREEN" },
    { "timestamp": "2026-06-04T07:00:00Z", "overall_status": "YELLOW" }
  ]
}
```

### CORS
Enable CORS on all routes so the Railway dashboard can poll it:
```python
from flask_cors import CORS
CORS(app)
```

### Flask App Code Structure
```python
from flask import Flask, jsonify
from flask_cors import CORS
import json
import os
from datetime import datetime

app = Flask(__name__)
CORS(app)

STATUS_FILE = "/root/.openclaw/workspace/ops/status.json"
HISTORY_DIR = "/root/.openclaw/workspace/ops/history/"

@app.route('/status')
def get_status():
    with open(STATUS_FILE, 'r') as f:
        return jsonify(json.load(f))

@app.route('/health')
def health():
    return jsonify({"status": "ok", "service": "stack-guardian-status-api"})

@app.route('/history')
def get_history():
    snapshots = []
    if os.path.exists(HISTORY_DIR):
        for fname in sorted(os.listdir(HISTORY_DIR))[-96:]:  # last 48hrs @ 30min
            with open(os.path.join(HISTORY_DIR, fname)) as f:
                data = json.load(f)
                snapshots.append({
                    "timestamp": data["last_updated"],
                    "overall_status": data["overall_status"]
                })
    return jsonify({"snapshots": snapshots})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5055)
```

### Systemd Service
Create as a systemd service so it survives reboots:

**File:** `/etc/systemd/system/stack-guardian-api.service`
```ini
[Unit]
Description=Stack Guardian Status API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/.openclaw/workspace/ops
ExecStart=/usr/bin/python3 /root/.openclaw/workspace/ops/status-api.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable it:**
```bash
systemctl daemon-reload
systemctl enable stack-guardian-api
systemctl start stack-guardian-api
```

---

## Phase 3 — Backup Agent

### File Location
```
~/.openclaw/workspace/ops/backup-agent.py
```

### Runs nightly at 2AM
```bash
0 2 * * * /usr/bin/python3 /root/.openclaw/workspace/ops/backup-agent.py >> /root/.openclaw/workspace/ops/logs/backup.log 2>&1
```

### What Gets Backed Up
```
~/ops/backups/YYYY-MM-DD/
  ├── SOUL_benson.md
  ├── SOUL_jeffrey.md
  ├── SOUL_flo.md
  ├── openclaw.json
  ├── cron_jobs.json
  ├── mc.env
  ├── watchtower.py
  ├── status-api.py
  └── backup-manifest.json   ← lists all files + checksums
```

### Retention
Keep last 7 days. Delete anything older automatically.

### After backup completes
Post to Discord `#ops-backups`:
```
✅ NIGHTLY BACKUP COMPLETE — 2026-06-04 02:00 UTC
Files backed up: 8
Location: ~/ops/backups/2026-06-04/
Size: 42KB
Retention: 7 days (oldest: 2026-05-28)
```

---

## Directory Structure to Create on VPS

```bash
mkdir -p ~/.openclaw/workspace/ops/logs
mkdir -p ~/.openclaw/workspace/ops/history
mkdir -p ~/.openclaw/workspace/ops/backups
mkdir -p ~/.openclaw/workspace/ops/runbooks
mkdir -p ~/.openclaw/workspace/ops/incidents
```

---

## Dependencies to Install on VPS

```bash
pip3 install flask flask-cors psutil requests python-telegram-bot
```

---

## Discord Channels to Create

| Channel | Purpose |
|---|---|
| `#ops-watchtower` | Every 15min status (YELLOW + RED only) |
| `#ops-incidents` | RED alerts + root cause notes |
| `#ops-backups` | Nightly backup confirmations |
| `#ops-reports` | Weekly summary (Phase 4) |

---

## Environment Variables Needed

Add to VPS environment (same pattern as existing env vars):

```bash
WATCHTOWER_DISCORD_WEBHOOK=<#ops-watchtower webhook URL>
INCIDENTS_DISCORD_WEBHOOK=<#ops-incidents webhook URL>
BACKUPS_DISCORD_WEBHOOK=<#ops-backups webhook URL>
TELEGRAM_BOT_TOKEN=<existing bot token>
TELEGRAM_STEVEN_CHAT_ID=<Steven's chat ID>
GHL_CBS_API_KEY=<existing CBS GHL key>
```

---

## Build Order for Infra

```
Step 1 — Create directory structure on VPS
Step 2 — Install pip dependencies
Step 3 — Build watchtower.py (write status.json + Discord + Telegram alerts)
Step 4 — Test watchtower.py manually: python3 watchtower.py
Step 5 — Add watchtower cron job
Step 6 — Build status-api.py (Flask, 3 endpoints, CORS enabled)
Step 7 — Deploy status-api as systemd service
Step 8 — Test: curl http://100.106.125.48:5055/status
Step 9 — Build backup-agent.py
Step 10 — Add backup cron job
Step 11 — Report back to Steven with all endpoints live and sample status.json output
```

---

## Handoff Checklist (Infra reports back when complete)

- [ ] `watchtower.py` running and writing `status.json`
- [ ] Cron job confirmed active (`crontab -l` shows entry)
- [ ] Flask API live at `http://100.106.125.48:5055/status`
- [ ] `/health` endpoint returns 200
- [ ] `/history` endpoint returning snapshots
- [ ] systemd service enabled and running
- [ ] Backup agent running and posting to Discord
- [ ] Sample `status.json` posted here for dashboard build verification
- [ ] All 4 Discord channels created with webhook URLs stored as env vars

---

## Next Phase (Dashboard — after Infra confirms API is live)

Claude CIO will build the React dashboard that polls `http://100.106.125.48:5055/status` and deploy to Railway as `stack-guardian-dashboard`. Infra scaffolds the repo structure for Railway deployment.

---
*End of spec. Questions → Steven Baker III / Claude CIO*
