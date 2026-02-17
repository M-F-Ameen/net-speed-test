import { useEffect, useState, useCallback, useRef } from "react";
import "./App.css";

type Phase = "idle" | "ping" | "download" | "upload" | "done" | "error";
type Tab = "speed" | "network" | "devices";

interface SpeedResult {
  ping: number;
  download: number;
  upload: number;
}

interface PublicInfo {
  ip: string;
  city: string;
  region: string;
  country: string;
  org: string;
  timezone: string;
}

interface LocalInterface {
  interface: string;
  ip: string;
  mac: string;
  netmask: string;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  arch: string;
  uptime: number;
  totalMemory: number;
  freeMemory: number;
  cpuModel: string;
  cpuCores: number;
}

interface Device {
  ip: string;
  mac: string;
  type: string;
  hostname: string;
  vendor: string;
}

interface NetworkInfo {
  public: PublicInfo;
  local: LocalInterface[];
  system: SystemInfo;
  devices: Device[];
}

/* ── helper: format bytes ── */
const fmtBytes = (b: number) => {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
};

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

function App() {
  const [isMaximized, setIsMaximized] = useState(false);
  const [tab, setTab] = useState<Tab>("speed");

  // speed test state
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveSpeed, setLiveSpeed] = useState(0);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isTesting = phase !== "idle" && phase !== "done" && phase !== "error";
  const cleanupRef = useRef<(() => void) | null>(null);

  // network info state
  const [netInfo, setNetInfo] = useState<NetworkInfo | null>(null);
  const [netLoading, setNetLoading] = useState(false);
  const [netError, setNetError] = useState<string | null>(null);

  // device blocking state
  const [blockedIPs, setBlockedIPs] = useState<Set<string>>(new Set());
  const [blockingIP, setBlockingIP] = useState<string | null>(null);
  const [confirmBlock, setConfirmBlock] = useState<string | null>(null);

  // ── window state ──
  useEffect(() => {
    let active = true;
    window.api?.window
      .getState()
      .then((state) => {
        if (active && state) setIsMaximized(state.isMaximized);
      })
      .catch(() => {});
    const offMax = window.api?.window.onMaximized(() => setIsMaximized(true));
    const offRestore = window.api?.window.onRestored(() =>
      setIsMaximized(false),
    );
    return () => {
      active = false;
      offMax?.();
      offRestore?.();
    };
  }, []);

  // ── auto-load network info on mount ──
  useEffect(() => {
    loadNetworkInfo();
    // load blocked IPs
    window.api?.device
      .getBlocked()
      .then((res) => {
        if (res?.data) setBlockedIPs(new Set(res.data));
      })
      .catch(() => {});
  }, []);

  useEffect(
    () => () => {
      cleanupRef.current?.();
    },
    [],
  );

  // ── load network info ──
  const loadNetworkInfo = useCallback(async () => {
    setNetLoading(true);
    setNetError(null);
    try {
      const res = await window.api?.network.getInfo();
      if (!res || res.error) {
        setNetError(res?.error ?? "Failed to get network info");
      } else {
        setNetInfo(res.data);
      }
    } catch (err: any) {
      setNetError(err?.message ?? "Unexpected error");
    } finally {
      setNetLoading(false);
    }
  }, []);

  // ── block / unblock device ──
  const handleBlockToggle = useCallback(
    async (ip: string) => {
      const isBlocked = blockedIPs.has(ip);
      if (!isBlocked) {
        // If not yet confirmed, show confirmation
        if (confirmBlock !== ip) {
          setConfirmBlock(ip);
          return;
        }
      }
      setConfirmBlock(null);
      setBlockingIP(ip);
      try {
        const res = isBlocked
          ? await window.api?.device.unblock(ip)
          : await window.api?.device.block(ip);
        if (res?.error) {
          setNetError(res.error);
        } else {
          setBlockedIPs((prev) => {
            const next = new Set(prev);
            if (isBlocked) next.delete(ip);
            else next.add(ip);
            return next;
          });
        }
      } catch (err: any) {
        setNetError(err?.message ?? "Failed to update block status");
      } finally {
        setBlockingIP(null);
      }
    },
    [blockedIPs, confirmBlock],
  );

  // ── start speed test ──
  const handleStart = useCallback(async () => {
    if (isTesting) return;
    setPhase("ping");
    setLiveSpeed(0);
    setResult(null);
    setError(null);

    cleanupRef.current?.();
    const off = window.api?.speedTest.onPhase(({ phase: p, speed }) => {
      setPhase(p as Phase);
      if (typeof speed === "number") setLiveSpeed(speed);
    });
    cleanupRef.current = off ?? null;

    try {
      const res = await window.api?.speedTest.run();
      cleanupRef.current?.();
      cleanupRef.current = null;
      if (!res || res.error) {
        setPhase("error");
        setError(res?.error ?? "Speed test failed");
      } else {
        setResult(res.data);
        setLiveSpeed(0);
        setPhase("done");
      }
    } catch (err: any) {
      cleanupRef.current?.();
      cleanupRef.current = null;
      setPhase("error");
      setError(err?.message ?? "Unexpected error");
    }
  }, [isTesting]);

  // ── derived ──
  const displaySpeed =
    phase === "download" || phase === "upload"
      ? liveSpeed
      : phase === "done" && result
        ? result.download
        : 0;

  const phaseLabel: Record<string, string> = {
    idle: "Ready to test",
    ping: "Testing Ping…",
    download: "Testing Download…",
    upload: "Testing Upload…",
    done: "Test Complete",
    error: "Error",
  };

  const circumference = 2 * Math.PI * 110;
  const maxSpeed = 200;
  const speedRatio = Math.min(displaySpeed / maxSpeed, 1);
  const dashOffset = circumference * (1 - speedRatio);

  const handleMinimize = () => window.api?.window.minimize();
  const handleMaximize = () => window.api?.window.toggleMaximize();
  const handleClose = () => window.api?.window.close();

  return (
    <div className="window">
      {/* ── title bar ── */}
      <header className="titlebar">
        <div className="drag-region">
          <svg
            className="title-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
          </svg>
          <span className="app-title">NetPulse</span>
        </div>
        <div className="window-controls">
          <button
            className="control-btn"
            onClick={handleMinimize}
            aria-label="Minimize"
          >
            <svg width="10" height="1" viewBox="0 0 10 1">
              <rect width="10" height="1" fill="currentColor" />
            </svg>
          </button>
          <button
            className="control-btn"
            onClick={handleMaximize}
            aria-label={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect
                  x="0"
                  y="2"
                  width="8"
                  height="8"
                  rx="1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <rect
                  x="2"
                  y="0"
                  width="8"
                  height="8"
                  rx="1"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10">
                <rect
                  x="0.5"
                  y="0.5"
                  width="9"
                  height="9"
                  rx="1.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            )}
          </button>
          <button
            className="control-btn close"
            onClick={handleClose}
            aria-label="Close"
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <path
                d="M1 1l8 8M9 1l-8 8"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </header>

      <div className="content-layout">
        {/* ── sidebar ── */}
        <nav className="sidebar">
          {/* IP card */}
          <div className="ip-card">
            <div className="ip-card-label">Public IP</div>
            <div className="ip-card-value">{netInfo?.public.ip ?? "…"}</div>
            {netInfo?.public.city && (
              <div className="ip-card-loc">
                {netInfo.public.city}, {netInfo.public.country}
              </div>
            )}
            {netInfo?.public.org && (
              <div className="ip-card-isp">{netInfo.public.org}</div>
            )}
          </div>

          {/* tabs */}
          <div className="nav-tabs">
            <button
              className={`nav-tab ${tab === "speed" ? "active" : ""}`}
              onClick={() => setTab("speed")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              Speed Test
            </button>
            <button
              className={`nav-tab ${tab === "network" ? "active" : ""}`}
              onClick={() => setTab("network")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              Network Info
            </button>
            <button
              className={`nav-tab ${tab === "devices" ? "active" : ""}`}
              onClick={() => setTab("devices")}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83" />
              </svg>
              Devices ({netInfo?.devices.length ?? 0})
            </button>
          </div>

          {/* local IP */}
          {netInfo?.local[0] && (
            <div className="local-ip-badge">
              <span className="local-ip-label">Local</span>
              <span className="local-ip-val">{netInfo.local[0].ip}</span>
            </div>
          )}

          <button
            className="refresh-btn"
            onClick={loadNetworkInfo}
            disabled={netLoading}
          >
            <svg
              className={netLoading ? "spin" : ""}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
            {netLoading ? "Scanning…" : "Refresh"}
          </button>
        </nav>

        {/* ── main panel ── */}
        <main className="main-panel">
          {/* speed test tab */}
          {tab === "speed" && (
            <div className="speed-tab">
              <div className="gauge-wrapper">
                <svg className="gauge-svg" viewBox="0 0 240 240">
                  <defs>
                    <linearGradient
                      id="gaugeGrad"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="100%"
                    >
                      <stop offset="0%" stopColor="#06b6d4" />
                      <stop offset="50%" stopColor="#22d3ee" />
                      <stop offset="100%" stopColor="#67e8f9" />
                    </linearGradient>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <circle className="gauge-bg" cx="120" cy="120" r="110" />
                  <circle
                    className={`gauge-fill ${isTesting ? "pulse" : ""}`}
                    cx="120"
                    cy="120"
                    r="110"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    filter={displaySpeed > 0 ? "url(#glow)" : undefined}
                  />
                </svg>
                <div className="gauge-label">
                  <span className="gauge-value">{displaySpeed.toFixed(1)}</span>
                  <span className="gauge-unit">Mbps</span>
                </div>
              </div>

              <p className={`phase-text ${isTesting ? "blink" : ""}`}>
                {phaseLabel[phase]}
              </p>

              <div className="results-row">
                <div
                  className={`result-card ${phase === "ping" ? "active" : ""}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  <span className="result-label">Ping</span>
                  <span className="result-value">
                    {result ? `${result.ping}` : "—"}
                  </span>
                  <span className="result-unit">ms</span>
                </div>
                <div
                  className={`result-card ${phase === "download" ? "active" : ""}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span className="result-label">Download</span>
                  <span className="result-value">
                    {result ? `${result.download}` : "—"}
                  </span>
                  <span className="result-unit">Mbps</span>
                </div>
                <div
                  className={`result-card ${phase === "upload" ? "active" : ""}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  <span className="result-label">Upload</span>
                  <span className="result-value">
                    {result ? `${result.upload}` : "—"}
                  </span>
                  <span className="result-unit">Mbps</span>
                </div>
              </div>

              {error && <p className="error-msg">{error}</p>}

              <button
                className="start-btn"
                disabled={isTesting}
                onClick={handleStart}
              >
                {isTesting ? (
                  <>
                    <svg
                      className="spin btn-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                    Testing…
                  </>
                ) : (
                  <>
                    <svg
                      className="btn-icon"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polygon points="5 3 19 12 5 21" />
                    </svg>
                    {result ? "Test Again" : "Start Test"}
                  </>
                )}
              </button>
            </div>
          )}

          {/* network info tab */}
          {tab === "network" && (
            <div className="network-tab">
              {netError && <p className="error-msg">{netError}</p>}

              {netInfo && (
                <>
                  <div className="info-section">
                    <h2 className="section-title">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      Public Connection
                    </h2>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-key">IP Address</span>
                        <span className="info-val mono">
                          {netInfo.public.ip}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Location</span>
                        <span className="info-val">
                          {netInfo.public.city}
                          {netInfo.public.region
                            ? `, ${netInfo.public.region}`
                            : ""}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Country</span>
                        <span className="info-val">
                          {netInfo.public.country}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">ISP</span>
                        <span className="info-val">{netInfo.public.org}</span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Timezone</span>
                        <span className="info-val">
                          {netInfo.public.timezone}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="info-section">
                    <h2 className="section-title">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                        <circle cx="12" cy="20" r="1" />
                      </svg>
                      Local Network
                    </h2>
                    <div className="info-grid">
                      {netInfo.local.map((iface, i) => (
                        <div key={i} className="info-item span-full">
                          <span className="info-key">{iface.interface}</span>
                          <div className="info-val-group">
                            <span className="info-val mono">{iface.ip}</span>
                            <span className="info-val-sub">
                              MAC: {iface.mac} · Mask: {iface.netmask}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="info-section">
                    <h2 className="section-title">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <rect x="4" y="4" width="16" height="16" rx="2" />
                        <rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" />
                        <line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" />
                        <line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" />
                        <line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" />
                        <line x1="1" y1="14" x2="4" y2="14" />
                      </svg>
                      System
                    </h2>
                    <div className="info-grid">
                      <div className="info-item">
                        <span className="info-key">Hostname</span>
                        <span className="info-val">
                          {netInfo.system.hostname}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Platform</span>
                        <span className="info-val">
                          {netInfo.system.platform} ({netInfo.system.arch})
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">CPU</span>
                        <span className="info-val">
                          {netInfo.system.cpuModel}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Cores</span>
                        <span className="info-val">
                          {netInfo.system.cpuCores}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Memory</span>
                        <span className="info-val">
                          {fmtBytes(netInfo.system.freeMemory)} /{" "}
                          {fmtBytes(netInfo.system.totalMemory)}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-key">Uptime</span>
                        <span className="info-val">
                          {fmtUptime(netInfo.system.uptime)}
                        </span>
                      </div>
                    </div>
                  </div>
                </>
              )}

              {netLoading && !netInfo && (
                <div className="loading-state">
                  <svg
                    className="spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span>Scanning network…</span>
                </div>
              )}
            </div>
          )}

          {/* devices tab */}
          {tab === "devices" && (
            <div className="devices-tab">
              <div className="devices-header">
                <h2 className="section-title">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v4m0 14v4M4.22 4.22l2.83 2.83m9.9 9.9l2.83 2.83M1 12h4m14 0h4M4.22 19.78l2.83-2.83m9.9-9.9l2.83-2.83" />
                  </svg>
                  Devices on Network
                </h2>
                <span className="device-count">
                  {netInfo?.devices.length ?? 0} found
                </span>
              </div>

              {netLoading && !netInfo && (
                <div className="loading-state">
                  <svg
                    className="spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  <span>Scanning for devices…</span>
                </div>
              )}

              {netInfo && netInfo.devices.length === 0 && (
                <div className="empty-state">
                  No devices found on the local network.
                </div>
              )}

              {netInfo && netInfo.devices.length > 0 && (
                <div className="device-list">
                  <div className="device-row device-row-header">
                    <span>IP Address</span>
                    <span>MAC Address</span>
                    <span>Hostname</span>
                    <span>Vendor</span>
                    <span>Action</span>
                  </div>
                  {netInfo.devices.map((d, i) => {
                    const isBlocked = blockedIPs.has(d.ip);
                    const isOwnIP = netInfo.local.some((l) => l.ip === d.ip);
                    const isProcessing = blockingIP === d.ip;
                    const isConfirming = confirmBlock === d.ip;
                    return (
                      <div
                        key={i}
                        className={`device-row ${isBlocked ? "blocked" : ""}`}
                      >
                        <span className="mono">{d.ip}</span>
                        <span className="mono dim">{d.mac}</span>
                        <span>{d.hostname || "—"}</span>
                        <span className="dim">{d.vendor || "Unknown"}</span>
                        <span className="device-action">
                          {isOwnIP ? (
                            <span className="own-badge">You</span>
                          ) : isProcessing ? (
                            <svg
                              className="spin action-spinner"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                            >
                              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                            </svg>
                          ) : isConfirming ? (
                            <div className="confirm-actions">
                              <button
                                className="confirm-yes"
                                onClick={() => handleBlockToggle(d.ip)}
                                title="Confirm block"
                              >
                                ✓
                              </button>
                              <button
                                className="confirm-no"
                                onClick={() => setConfirmBlock(null)}
                                title="Cancel"
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <button
                              className={`block-btn ${isBlocked ? "unblock" : ""}`}
                              onClick={() => handleBlockToggle(d.ip)}
                              title={
                                isBlocked ? "Unblock device" : "Block device"
                              }
                            >
                              {isBlocked ? (
                                <>
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                                  </svg>
                                  Unblock
                                </>
                              ) : (
                                <>
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <circle cx="12" cy="12" r="10" />
                                    <line
                                      x1="4.93"
                                      y1="4.93"
                                      x2="19.07"
                                      y2="19.07"
                                    />
                                  </svg>
                                  Block
                                </>
                              )}
                            </button>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {netError && <p className="error-msg">{netError}</p>}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
