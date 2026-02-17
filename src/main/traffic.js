const { exec } = require("child_process");
const os = require("os");

// Store traffic data per IP
const trafficData = new Map();
const lastSampleTime = new Map();

/**
 * Execute a shell command and return stdout
 */
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

/**
 * Parse Windows netstat output to get per-connection traffic.
 * Uses netstat -e and Get-Counter for network interface stats.
 */
async function getWindowsTrafficData() {
  try {
    // Get network interface statistics using PowerShell
    const psCmd = `powershell -NoProfile -Command "Get-Counter -Counter '\\Network Interface(*)\\Bytes Total/sec', '\\Network Interface(*)\\Bytes Received/sec', '\\Network Interface(*)\\Bytes Sent/sec' | ForEach-Object { $_.CounterSamples | Where-Object { $_.InstanceName -notlike '*Loopback*' -and $_.InstanceName -notlike '*isatap*' -and $_.InstanceName -ne '_Total' } | ForEach-Object { Write-Output ($_.InstanceName + '|' + $_.Path + '|' + $_.CookedValue) } }"`;

    const output = await run(psCmd);
    const lines = output.split("\n").filter((line) => line.trim());

    const interfaceStats = {};
    lines.forEach((line) => {
      const [iface, path, value] = line.split("|");
      if (!interfaceStats[iface]) interfaceStats[iface] = {};

      if (path.includes("Bytes Received/sec")) {
        interfaceStats[iface].bytesReceived = parseFloat(value) || 0;
      } else if (path.includes("Bytes Sent/sec")) {
        interfaceStats[iface].bytesSent = parseFloat(value) || 0;
      }
    });

    return interfaceStats;
  } catch (err) {
    return {};
  }
}

/**
 * Get active network connections with traffic estimation.
 * This is a simplified approach - real per-IP traffic requires more complex monitoring.
 */
async function getConnectionTraffic() {
  if (process.platform !== "win32") {
    return {};
  }

  try {
    // Get active TCP connections
    const netstatOutput = await run("netstat -n -p TCP");
    const lines = netstatOutput.split("\n").slice(4); // Skip header

    const connections = {};
    lines.forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && parts[1] !== "Proto") {
        const localAddr = parts[1];
        const remoteAddr = parts[2];
        const state = parts[3];

        if (state === "ESTABLISHED" && remoteAddr !== "0.0.0.0:0") {
          const remoteIP = remoteAddr.split(":")[0];
          if (
            remoteIP &&
            !remoteIP.startsWith("127.") &&
            !remoteIP.startsWith("::")
          ) {
            connections[remoteIP] = {
              localAddr,
              remoteAddr,
              state,
              lastSeen: Date.now(),
            };
          }
        }
      }
    });

    return connections;
  } catch (err) {
    return {};
  }
}

/**
 * Estimate traffic per device using interface stats and active connections.
 * This is an approximation since we can't easily get per-IP granular traffic on Windows without special drivers.
 */
async function updateTrafficData() {
  const interfaceStats = await getWindowsTrafficData();
  const connections = await getConnectionTraffic();
  const now = Date.now();

  // Get primary network interface stats
  const primaryInterface = Object.keys(interfaceStats).find(
    (name) =>
      name.toLowerCase().includes("ethernet") ||
      name.toLowerCase().includes("wi-fi") ||
      name.toLowerCase().includes("wireless"),
  );

  if (!primaryInterface || !interfaceStats[primaryInterface]) {
    return trafficData;
  }

  const { bytesReceived = 0, bytesSent = 0 } = interfaceStats[primaryInterface];

  // Calculate total traffic delta since last measurement
  const lastTotal = trafficData.get("_total") || {
    download: 0,
    upload: 0,
    timestamp: now,
  };
  const timeDelta = (now - lastTotal.timestamp) / 1000; // seconds

  if (timeDelta > 0) {
    const downloadDelta = Math.max(0, bytesReceived - lastTotal.download);
    const uploadDelta = Math.max(0, bytesSent - lastTotal.upload);

    // Store total interface stats
    trafficData.set("_total", {
      download: bytesReceived,
      upload: bytesSent,
      timestamp: now,
    });

    // Distribute traffic among active connections (rough estimation)
    const activeIPs = Object.keys(connections);
    if (activeIPs.length > 0) {
      const downloadPerIP = downloadDelta / activeIPs.length;
      const uploadPerIP = uploadDelta / activeIPs.length;

      activeIPs.forEach((ip) => {
        const existing = trafficData.get(ip) || {
          downloadSpeed: 0,
          uploadSpeed: 0,
          totalDownload: 0,
          totalUpload: 0,
          lastSeen: now,
        };

        // Calculate speeds (bytes per second)
        existing.downloadSpeed = downloadPerIP / timeDelta;
        existing.uploadSpeed = uploadPerIP / timeDelta;
        existing.totalDownload += downloadPerIP;
        existing.totalUpload += uploadPerIP;
        existing.lastSeen = now;

        trafficData.set(ip, existing);
      });
    }

    // Clean up old entries (older than 30 seconds)
    for (const [ip, data] of trafficData.entries()) {
      if (ip !== "_total" && now - data.lastSeen > 30000) {
        trafficData.delete(ip);
      }
    }
  }

  return trafficData;
}

/**
 * Get current traffic data for all monitored devices
 */
function getTrafficData() {
  const result = {};
  for (const [ip, data] of trafficData.entries()) {
    if (ip !== "_total") {
      result[ip] = {
        downloadSpeed: data.downloadSpeed || 0, // bytes/sec
        uploadSpeed: data.uploadSpeed || 0, // bytes/sec
        totalDownload: data.totalDownload || 0, // total bytes
        totalUpload: data.totalUpload || 0, // total bytes
        lastSeen: data.lastSeen || 0,
      };
    }
  }
  return result;
}

/**
 * Start traffic monitoring with periodic updates
 */
let monitoringInterval = null;

function startTrafficMonitoring(intervalMs = 3000) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  // Initial update
  updateTrafficData();

  // Periodic updates
  monitoringInterval = setInterval(() => {
    updateTrafficData().catch(() => {
      // Ignore errors in background monitoring
    });
  }, intervalMs);
}

function stopTrafficMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

module.exports = {
  startTrafficMonitoring,
  stopTrafficMonitoring,
  getTrafficData,
  updateTrafficData,
};
