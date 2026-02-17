const { exec } = require("child_process");

// Store traffic data per IP
const trafficData = new Map();

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
 * Get active network connections and simulate traffic data.
 * Real per-IP traffic monitoring requires special drivers on Windows.
 * This provides a working demo with realistic simulated data.
 */
async function updateTrafficData() {
  try {
    const now = Date.now();
    
    // Get all known device IPs from the trafficData keys (populated by main process)
    const knownDevices = Array.from(trafficData.keys());
    
    // Also try to get active connections
    let activeIPs = new Set();
    try {
      const netstatOutput = await run('netstat -n -p TCP');
      const lines = netstatOutput.split('\n').slice(4);
      
      lines.forEach(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[3] === 'ESTABLISHED') {
          const remoteAddr = parts[2];
          const remoteIP = remoteAddr.split(':')[0];
          
          if (remoteIP && 
              !remoteIP.startsWith('127.') && 
              !remoteIP.startsWith('::') && 
              remoteIP !== '0.0.0.0' &&
              /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(remoteIP)) {
            activeIPs.add(remoteIP);
          }
        }
      });
    } catch (err) {
      // If netstat fails, just use existing known devices
      console.log('Netstat failed, using known devices:', err.message);
    }
    
    // Combine active IPs with any known devices 
    const allIPs = new Set([...activeIPs, ...knownDevices]);
    
    // Generate realistic traffic data for all IPs (including local network devices)
    allIPs.forEach(ip => {
      const existing = trafficData.get(ip) || {
        downloadSpeed: 0,
        uploadSpeed: 0,
        totalDownload: 0,
        totalUpload: 0,
        lastSeen: now,
        lastUpdate: now
      };

      const timeDelta = (now - existing.lastUpdate) / 1000;

      // Create more realistic traffic patterns
      const isActive = activeIPs.has(ip) || Math.random() < 0.3; // 30% chance for local devices to be "active"
      
      if (isActive) {
        // Simulate realistic traffic patterns
        const baseDownload = Math.random() * 1000000; // 0-1 MB/s base
        const baseUpload = Math.random() * 200000;    // 0-200 KB/s base
        
        // Add some spikes occasionally (15% chance)
        const downloadMultiplier = Math.random() < 0.15 ? (2 + Math.random() * 6) : (0.1 + Math.random() * 0.9);
        const uploadMultiplier = Math.random() < 0.15 ? (2 + Math.random() * 3) : (0.1 + Math.random() * 0.9);
        
        existing.downloadSpeed = Math.floor(baseDownload * downloadMultiplier);
        existing.uploadSpeed = Math.floor(baseUpload * uploadMultiplier);
      } else {
        // Gradually reduce speeds for inactive devices
        existing.downloadSpeed = Math.floor(existing.downloadSpeed * 0.8);
        existing.uploadSpeed = Math.floor(existing.uploadSpeed * 0.8);
      }
      
      // Accumulate totals
      if (timeDelta > 0) {
        existing.totalDownload += existing.downloadSpeed * timeDelta;
        existing.totalUpload += existing.uploadSpeed * timeDelta;
      }
      
      existing.lastSeen = now;
      existing.lastUpdate = now;
      
      trafficData.set(ip, existing);
    });

    // Clean up very old entries (inactive for 60+ seconds)
    for (const [ip, data] of trafficData.entries()) {
      if (now - data.lastSeen > 60000 && data.downloadSpeed === 0 && data.uploadSpeed === 0) {
        trafficData.delete(ip);
      }
    }

    console.log(`Traffic data updated for ${allIPs.size} devices`);
    return trafficData;
  } catch (err) {
    console.log('Traffic monitoring error:', err.message);
    return trafficData;
  }
}

/**
 * Get current traffic data for all monitored devices
 */
function getTrafficData() {
  const result = {};
  for (const [ip, data] of trafficData.entries()) {
    result[ip] = {
      downloadSpeed: data.downloadSpeed || 0, // bytes/sec
      uploadSpeed: data.uploadSpeed || 0,      // bytes/sec
      totalDownload: data.totalDownload || 0,  // total bytes
      totalUpload: data.totalUpload || 0,      // total bytes
      lastSeen: data.lastSeen || 0
    };
  }
  return result;
}

/**
 * Seed traffic monitoring with known device IPs from network discovery
 */
function seedDeviceIPs(devices) {
  const now = Date.now();
  devices.forEach(device => {
    if (!trafficData.has(device.ip)) {
      trafficData.set(device.ip, {
        downloadSpeed: 0,
        uploadSpeed: 0,
        totalDownload: 0,
        totalUpload: 0,
        lastSeen: now,
        lastUpdate: now
      });
    }
  });
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
  seedDeviceIPs
};