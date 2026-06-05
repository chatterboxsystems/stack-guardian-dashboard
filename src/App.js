import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// CONFIG — update this to your VPS Flask API URL
const STATUS_API = process.env.REACT_APP_STATUS_API || 'http://100.106.125.48:5055';
const POLL_INTERVAL = 60000; // 60 seconds

// ─── Mock data for when API is unreachable (dev/demo mode) ───────────────────
const MOCK_DATA = {
  last_updated: new Date().toISOString(),
  overall_status: 'YELLOW',
  checks: {
    vps_cpu:          { status: 'GREEN',  value: '34%',      message: 'Normal' },
    vps_ram:          { status: 'GREEN',  value: '61%',      message: 'Normal' },
    vps_disk:         { status: 'YELLOW', value: '78%',      message: 'Above 75% warning threshold' },
    openclaw_gateway: { status: 'GREEN',  value: '200',      message: 'Responding normally' },
    mission_control:  { status: 'GREEN',  value: '200',      message: 'Responding normally' },
    cbs_landing_page: { status: 'GREEN',  value: '200',      message: 'Response time: 412ms' },
    ghl_webhook:      { status: 'GREEN',  value: '200',      message: 'GHL API reachable' },
    ssl_certificate:  { status: 'GREEN',  value: '47 days',  message: 'Certificate healthy' },
    cron_jobs:        { status: 'GREEN',  value: '4/4',      message: 'All cron jobs ran on schedule' },
    agent_processes:  { status: 'GREEN',  value: '3/3',      message: 'benson, jeffrey, flo all active' },
  },
  incidents: [
    { time: '2026-06-03T14:22:00Z', level: 'RED',    message: 'Gateway unresponsive — auto-restarted' },
    { time: '2026-06-02T09:11:00Z', level: 'YELLOW', message: 'Disk hit 76% — monitor flagged' },
  ],
  run_count_today: 18,
};

const MOCK_HISTORY = {
  snapshots: Array.from({ length: 48 }, (_, i) => ({
    timestamp: new Date(Date.now() - (47 - i) * 30 * 60000).toISOString(),
    overall_status: ['GREEN','GREEN','GREEN','YELLOW','GREEN','GREEN','RED','GREEN'][Math.floor(Math.random() * 8)] || 'GREEN',
  }))
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const STATUS_COLOR = { GREEN: '#00ff88', YELLOW: '#ffcc00', RED: '#ff3355' };
const STATUS_GLOW  = { GREEN: '0 0 12px #00ff8866', YELLOW: '0 0 12px #ffcc0066', RED: '0 0 16px #ff335588' };

function timeAgo(iso) {
  const diff = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  return `${Math.floor(diff/3600)}h ago`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

const CHECK_LABELS = {
  vps_cpu:          'CPU',
  vps_ram:          'RAM',
  vps_disk:         'Disk',
  openclaw_gateway: 'OpenClaw Gateway',
  mission_control:  'Mission Control',
  cbs_landing_page: 'CBS Landing Page',
  ghl_webhook:      'GHL Webhook',
  ssl_certificate:  'SSL Certificate',
  cron_jobs:        'Cron Jobs',
  agent_processes:  'Agent Processes',
};

const CHECK_ICONS = {
  vps_cpu:          '⚡',
  vps_ram:          '🧠',
  vps_disk:         '💾',
  openclaw_gateway: '🌐',
  mission_control:  '🎯',
  cbs_landing_page: '🏠',
  ghl_webhook:      '🔗',
  ssl_certificate:  '🔒',
  cron_jobs:        '⏱',
  agent_processes:  '🤖',
};

// ─── Components ──────────────────────────────────────────────────────────────

function PulsingDot({ status }) {
  return (
    <span className={`pulse-dot pulse-${status.toLowerCase()}`} />
  );
}

function StatusBadge({ status }) {
  return (
    <span className="status-badge" style={{ color: STATUS_COLOR[status], boxShadow: STATUS_GLOW[status], borderColor: STATUS_COLOR[status] }}>
      {status === 'GREEN' ? '● NOMINAL' : status === 'YELLOW' ? '◐ WARNING' : '✕ CRITICAL'}
    </span>
  );
}

function CheckCard({ id, check }) {
  const color = STATUS_COLOR[check.status];
  const glow  = STATUS_GLOW[check.status];
  return (
    <div className="check-card" style={{ '--accent': color, '--glow': glow }}>
      <div className="check-top">
        <span className="check-icon">{CHECK_ICONS[id]}</span>
        <span className="check-name">{CHECK_LABELS[id]}</span>
        <span className="check-status-dot" style={{ background: color, boxShadow: glow }} />
      </div>
      <div className="check-value" style={{ color }}>{check.value}</div>
      <div className="check-message">{check.message}</div>
    </div>
  );
}

function HistoryBar({ snapshots }) {
  return (
    <div className="history-bar">
      {snapshots.map((s, i) => (
        <div
          key={i}
          className="history-tick"
          title={`${formatTime(s.timestamp)} — ${s.overall_status}`}
          style={{ background: STATUS_COLOR[s.overall_status] || '#333' }}
        />
      ))}
    </div>
  );
}

function IncidentRow({ incident }) {
  const color = STATUS_COLOR[incident.level];
  return (
    <div className="incident-row">
      <span className="incident-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="incident-time">{timeAgo(incident.time)}</span>
      <span className="incident-msg">{incident.message}</span>
      <span className="incident-level" style={{ color }}>{incident.level}</span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus]       = useState(null);
  const [history, setHistory]     = useState(null);
  const [lastFetch, setLastFetch] = useState(null);
  const [apiMode, setApiMode]     = useState('connecting'); // connecting | live | demo
  const [countdown, setCountdown] = useState(POLL_INTERVAL / 1000);

  const fetchStatus = useCallback(async () => {
    try {
      const [sRes, hRes] = await Promise.all([
        fetch(`${STATUS_API}/status`, { signal: AbortSignal.timeout(8000) }),
        fetch(`${STATUS_API}/history`, { signal: AbortSignal.timeout(8000) }),
      ]);
      if (!sRes.ok) throw new Error('API error');
      const sData = await sRes.json();
      const hData = await hRes.json();
      setStatus(sData);
      setHistory(hData);
      setApiMode('live');
      setLastFetch(new Date());
      setCountdown(POLL_INTERVAL / 1000);
    } catch {
      if (!status) {
        setStatus(MOCK_DATA);
        setHistory(MOCK_HISTORY);
        setApiMode('demo');
        setLastFetch(new Date());
      } else {
        setApiMode(prev => prev === 'live' ? 'demo' : prev);
      }
    }
  }, [status]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    const tick = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!status) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">STACK GUARDIAN</div>
        <div className="loading-bar"><div className="loading-fill" /></div>
        <div className="loading-text">INITIALIZING WATCHTOWER...</div>
      </div>
    );
  }

  const checks = status.checks || {};
  const incidents = status.incidents || [];
  const snapshots = history?.snapshots || [];
  const greenCount  = Object.values(checks).filter(c => c.status === 'GREEN').length;
  const yellowCount = Object.values(checks).filter(c => c.status === 'YELLOW').length;
  const redCount    = Object.values(checks).filter(c => c.status === 'RED').length;
  const total = Object.keys(checks).length;

  return (
    <div className="app">
      {/* Scanline overlay */}
      <div className="scanlines" />

      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <span className="logo-icon">⬡</span>
            <div className="logo-text">
              <span className="logo-main">STACK GUARDIAN</span>
              <span className="logo-sub">CBS INFRASTRUCTURE MONITOR</span>
            </div>
          </div>
        </div>

        <div className="header-center">
          <StatusBadge status={status.overall_status} />
        </div>

        <div className="header-right">
          <div className="header-meta">
            <span className="meta-label">LAST CHECK</span>
            <span className="meta-value">{timeAgo(status.last_updated)}</span>
          </div>
          <div className="header-meta">
            <span className="meta-label">RUNS TODAY</span>
            <span className="meta-value">{status.run_count_today}</span>
          </div>
          <div className="header-meta">
            <span className="meta-label">NEXT POLL</span>
            <span className="meta-value">{countdown}s</span>
          </div>
          <div className={`api-pill api-${apiMode}`}>
            {apiMode === 'live' ? '● LIVE' : apiMode === 'demo' ? '◌ DEMO' : '… CONNECTING'}
          </div>
        </div>
      </header>

      {/* Score bar */}
      <div className="score-bar">
        <div className="score-item score-green">
          <span className="score-num">{greenCount}</span>
          <span className="score-lbl">NOMINAL</span>
        </div>
        <div className="score-divider" />
        <div className="score-item score-yellow">
          <span className="score-num">{yellowCount}</span>
          <span className="score-lbl">WARNING</span>
        </div>
        <div className="score-divider" />
        <div className="score-item score-red">
          <span className="score-num">{redCount}</span>
          <span className="score-lbl">CRITICAL</span>
        </div>
        <div className="score-divider" />
        <div className="score-item">
          <span className="score-num">{total}</span>
          <span className="score-lbl">TOTAL CHECKS</span>
        </div>
        <div className="score-progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${(greenCount/total)*100}%` }} />
          </div>
          <span className="progress-pct">{Math.round((greenCount/total)*100)}% healthy</span>
        </div>
      </div>

      {/* Main grid */}
      <main className="main-grid">

        {/* Check cards */}
        <section className="section checks-section">
          <div className="section-header">
            <span className="section-title">SERVICE CHECKS</span>
            <PulsingDot status={status.overall_status} />
          </div>
          <div className="checks-grid">
            {Object.entries(checks).map(([id, check]) => (
              <CheckCard key={id} id={id} check={check} />
            ))}
          </div>
        </section>

        {/* Right column */}
        <aside className="sidebar">

          {/* 48hr history */}
          <section className="section history-section">
            <div className="section-header">
              <span className="section-title">48H HISTORY</span>
              <span className="section-sub">{snapshots.length} snapshots</span>
            </div>
            <HistoryBar snapshots={snapshots} />
            <div className="history-legend">
              <span style={{color: STATUS_COLOR.GREEN}}>● Nominal</span>
              <span style={{color: STATUS_COLOR.YELLOW}}>● Warning</span>
              <span style={{color: STATUS_COLOR.RED}}>● Critical</span>
            </div>
          </section>

          {/* Incidents */}
          <section className="section incidents-section">
            <div className="section-header">
              <span className="section-title">INCIDENT LOG</span>
              <span className="section-sub">{incidents.length} events</span>
            </div>
            {incidents.length === 0 ? (
              <div className="no-incidents">
                <span style={{color: STATUS_COLOR.GREEN}}>✓</span> No incidents recorded
              </div>
            ) : (
              <div className="incidents-list">
                {incidents.map((inc, i) => <IncidentRow key={i} incident={inc} />)}
              </div>
            )}
          </section>

          {/* Agent roster */}
          <section className="section agents-section">
            <div className="section-header">
              <span className="section-title">AGENT ROSTER</span>
            </div>
            <div className="agents-list">
              {[
                { id: 'benson', name: 'Benson III', role: 'Ops / Dispatch',  model: 'DeepSeek R1' },
                { id: 'jeffrey', name: 'Jeffrey',    role: 'Lead Gen',        model: 'DeepSeek R1' },
                { id: 'flo',    name: 'Flo',         role: 'Content / Social', model: 'Gemini Flash' },
              ].map(agent => {
                const agentStatus = checks.agent_processes?.status || 'GREEN';
                return (
                  <div key={agent.id} className="agent-row">
                    <span className="agent-dot" style={{ background: STATUS_COLOR[agentStatus], boxShadow: STATUS_GLOW[agentStatus] }} />
                    <div className="agent-info">
                      <span className="agent-name">{agent.name}</span>
                      <span className="agent-role">{agent.role}</span>
                    </div>
                    <span className="agent-model">{agent.model}</span>
                  </div>
                );
              })}
            </div>
          </section>

        </aside>
      </main>

      {/* Footer */}
      <footer className="footer">
        <span>CHATTERBOX SYSTEMS · STACK GUARDIAN v1.0</span>
        <span>WATCHTOWER POLLING EVERY 15 MIN · DASHBOARD REFRESH {POLL_INTERVAL/1000}s</span>
        <span>{lastFetch ? `LAST SYNC: ${lastFetch.toLocaleTimeString()}` : 'SYNCING...'}</span>
      </footer>
    </div>
  );
}
