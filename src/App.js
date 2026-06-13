import React, { useState, useEffect, useCallback } from 'react';
import './App.css';

// CONFIG — update this to your VPS Flask API URL
const STATUS_API = process.env.REACT_APP_STATUS_API || 'https://web-production-0f1f3.up.railway.app';
const POLL_INTERVAL = 60000; // 60 seconds for main status
const AGENT_POLL_INTERVAL = 10000; // 10 seconds for agent activity (live updates)

// ─── Mock data for when API is unreachable (dev/demo mode) ───────────────────
const MOCK_DATA = {
  last_updated: new Date().toISOString(),
  overall_status: 'GREEN',
  checks: {
    vps_cpu:          { status: 'GREEN',  value: '24%',      message: 'Normal' },
    vps_ram:          { status: 'GREEN',  value: '52%',      message: 'Normal' },
    vps_disk:         { status: 'GREEN',  value: '68%',      message: 'Within normal range' },
    mission_control:  { status: 'GREEN',  value: '200',      message: 'Responding normally' },
    cbs_landing_page: { status: 'GREEN',  value: '200',      message: 'Response time: 287ms' },
    ghl_webhook:      { status: 'GREEN',  value: '200',      message: 'GHL API reachable' },
    ssl_certificate:  { status: 'GREEN',  value: '42 days',  message: 'Certificate healthy' },
    cron_jobs:        { status: 'GREEN',  value: '3/3',      message: 'All cron jobs ran on schedule' },
    stack_guardian:   { status: 'GREEN',  value: '5055',     message: 'API online with persistent storage' },
  },
  incidents: [
    { time: '2026-06-12T03:54:00Z', level: 'YELLOW', message: 'Agents Benson, Jeffrey, Flo decommissioned' },
    { time: '2026-06-10T14:22:00Z', level: 'YELLOW', message: 'Flo cron interrupted — SIGTERM handling improved' },
  ],
  run_count_today: 12,
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
  const safeStatus = (status || 'unknown').toLowerCase();
  return (
    <span className={`pulse-dot pulse-${safeStatus}`} />
  );
}

function StatusBadge({ status }) {
  const safeStatus = status || 'UNKNOWN';
  return (
    <span className="status-badge" style={{ color: STATUS_COLOR[safeStatus] || '#999', boxShadow: STATUS_GLOW[safeStatus] || 'none', borderColor: STATUS_COLOR[safeStatus] || '#999' }}>
      {safeStatus === 'GREEN' ? '● NOMINAL' : safeStatus === 'YELLOW' ? '◐ WARNING' : safeStatus === 'RED' ? '✕ CRITICAL' : '? UNKNOWN'}
    </span>
  );
}

function CheckCard({ id, check }) {
  const safeStatus = check?.status || 'UNKNOWN';
  const color = STATUS_COLOR[safeStatus] || '#999';
  const glow  = STATUS_GLOW[safeStatus] || 'none';
  return (
    <div className="check-card" style={{ '--accent': color, '--glow': glow }}>
      <div className="check-top">
        <span className="check-icon">{CHECK_ICONS[id] || '❓'}</span>
        <span className="check-name">{CHECK_LABELS[id] || id}</span>
        <span className="check-status-dot" style={{ background: color, boxShadow: glow }} />
      </div>
      <div className="check-value" style={{ color }}>{check?.value || 'N/A'}</div>
      <div className="check-message">{check?.message || 'No data'}</div>
    </div>
  );
}

function HistoryBar({ snapshots }) {
  return (
    <div className="history-bar">
      {(snapshots || []).map((s, i) => {
        const safeStatus = s?.overall_status || 'UNKNOWN';
        return (
          <div
            key={i}
            className="history-tick"
            title={`${formatTime(s?.timestamp)} — ${safeStatus}`}
            style={{ background: STATUS_COLOR[safeStatus] || '#333' }}
          />
        );
      })}
    </div>
  );
}

function IncidentRow({ incident }) {
  const safeLevel = incident?.level || 'UNKNOWN';
  const color = STATUS_COLOR[safeLevel] || '#999';
  return (
    <div className="incident-row">
      <span className="incident-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      <span className="incident-time">{timeAgo(incident?.time)}</span>
      <span className="incident-msg">{incident?.message || 'No message'}</span>
      <span className="incident-level" style={{ color }}>{safeLevel}</span>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [status, setStatus]         = useState(null);
  const [history, setHistory]       = useState(null);
  const [agentStatus, setAgentStatus] = useState(null);
  const [lastFetch, setLastFetch]   = useState(null);
  const [apiMode, setApiMode]       = useState('connecting'); // connecting | live | demo
  const [countdown, setCountdown]   = useState(POLL_INTERVAL / 1000);

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

  // Fetch agent activity more frequently (every 10 seconds)
  const fetchAgentStatus = useCallback(async () => {
    try {
      const healthRes = await fetch(`${STATUS_API}/health`, { signal: AbortSignal.timeout(5000) });
      if (!healthRes.ok) throw new Error('Agent fetch error');
      const healthData = await healthRes.json();
      if (healthData.agent_status) {
        setAgentStatus(healthData.agent_status);
      }
    } catch (e) {
      // Silently fail for agent polling, don't affect main API status
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchAgentStatus();
    const mainInterval = setInterval(fetchStatus, POLL_INTERVAL);
    const agentInterval = setInterval(fetchAgentStatus, AGENT_POLL_INTERVAL);
    return () => {
      clearInterval(mainInterval);
      clearInterval(agentInterval);
    };
  }, [fetchStatus, fetchAgentStatus]);

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
          <StatusBadge status={status?.overall_status} />
        </div>

        <div className="header-right">
          <div className="header-meta">
            <span className="meta-label">LAST CHECK</span>
            <span className="meta-value">{status?.last_updated ? timeAgo(status.last_updated) : 'N/A'}</span>
          </div>
          <div className="header-meta">
            <span className="meta-label">RUNS TODAY</span>
            <span className="meta-value">{status?.run_count_today || 0}</span>
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
            <PulsingDot status={status?.overall_status} />
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
              <span className="section-title">AGENT STATUS</span>
            </div>
            <div className="agents-list">
              {/* Infra Agent */}
              <div className="agent-row" style={{opacity: agentStatus?.infra === 'ACTIVE' ? 1 : 0.5}}>
                <span className="agent-dot" style={{ background: agentStatus?.infra === 'ACTIVE' ? '#00ff88' : '#999', boxShadow: agentStatus?.infra === 'ACTIVE' ? '0 0 8px #00ff88' : '0 0 6px #99999966' }} />
                <div className="agent-info">
                  <span className="agent-name">Infra (Claude Code)</span>
                  <span className="agent-role">{agentStatus?.infra === 'ACTIVE' ? 'Running on VPS' : 'Offline'}</span>
                </div>
                <span className="agent-model">{agentStatus?.infra === 'ACTIVE' ? 'ONLINE' : 'OFFLINE'}</span>
              </div>

              {/* Current Running Agent */}
              {agentStatus?.current_agent ? (
                <div className="agent-row" style={{opacity: 1}}>
                  <span className="agent-dot" style={{ background: '#00ccff', boxShadow: '0 0 8px #00ccff' }} />
                  <div className="agent-info">
                    <span className="agent-name">{agentStatus.current_agent?.agent_name || 'Unknown'}</span>
                    <span className="agent-role">{agentStatus.current_agent?.command || 'No command'}</span>
                  </div>
                  <span className="agent-model">RUNNING</span>
                </div>
              ) : (
                <div className="agent-row" style={{opacity: 0.5}}>
                  <span className="agent-dot" style={{ background: '#666', boxShadow: '0 0 6px #66666666' }} />
                  <div className="agent-info">
                    <span className="agent-name">No agents running</span>
                    <span className="agent-role">Awaiting commands...</span>
                  </div>
                  <span className="agent-model">IDLE</span>
                </div>
              )}

              {/* Last 3 Completed Agents */}
              {agentStatus?.completed_agents && agentStatus.completed_agents.map((agent, idx) => (
                <div key={idx} className="agent-row" style={{opacity: 0.7}}>
                  <span className="agent-dot" style={{ background: '#99ff99', boxShadow: '0 0 6px #99ff9966' }} />
                  <div className="agent-info">
                    <span className="agent-name">{agent?.agent_name || 'Unknown'}</span>
                    <span className="agent-role">{agent?.command || 'No command'}</span>
                  </div>
                  <span className="agent-model">{agent?.completed_at ? timeAgo(agent.completed_at) : 'Unknown'}</span>
                </div>
              ))}
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
