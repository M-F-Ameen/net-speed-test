const { exec } = require("child_process");

// Store traffic data per IP
const trafficData = new Map();
let lastError = null;

/**
 * Execute a shell command and return stdout
 */
function run(cmd, requiresAdmin = false) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        const errorMsg = stderr || err.message;
        const isPermissionError = errorMsg.includes('Access is denied') || 
                                errorMsg.includes('permission') || 
                                errorMsg.includes('elevated') ||
                                errorMsg.includes('administrator');
        
        if (isPermissionError && requiresAdmin) {
          reject(new Error(`PERMISSION_REQUIRED: ${errorMsg}`));
        } else {
          reject(new Error(errorMsg));
        }
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

/**
 * Get network interface statistics using Windows commands
 */
async function getNetworkInterfaceStats() {
  try {
    // Try wmic first (built-in, usually works without admin)
    const cmd = 'wmic path Win32_PerfRawData_Tcpip_NetworkInterface get Name,BytesReceivedPerSec,BytesSentPerSec /format:csv';
    const output = await run(cmd);
    
    const lines = output.split('\n').filter(line => line.includes(','));
    const interfaces = {};
    
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length >= 4) {
        const name = parts[2]?.trim();
        const bytesReceived = parseInt(parts[1]) || 0;
        const bytesSent = parseInt(parts[3]) || 0;
        
        if (name && !name.includes('Loopback') && !name.includes('Isatap')) {
          interfaces[name] = {
            bytesReceived,
            bytesSent,
            timestamp: Date.now()
          };
        }
      }
    }
    
    return interfaces;
  } catch (err) {
    // Try typeperf as fallback (requires admin for detailed counters)
    try {
      const cmd = 'typeperf "\\Network Interface(*)\\Bytes Received/sec" "\\Network Interface(*)\\Bytes Sent/sec" -sc 1';
      const output = await run(cmd, true);
      
      // Parse typeperf output
      const interfaces = {};
      const lines = output.split('\n');
      
      for (const line of lines) {
        if (line.includes(',') && !line.includes('PDH')) {
          const parts = line.split(',');
          if (parts.length >= 2) {
            const counterPath = parts[0].replace(/"/g, '').trim();
            const value = parseFloat(parts[1].replace(/"/g, '')) || 0;
            
            // Extract interface name
            const match = counterPath.match(/\\Network Interface\(([^)]+)\)\\(.+)/);
            if (match) {
              const [, interfaceName, counterType] = match;
              if (!interfaceName.includes('Loopback') && interfaceName !== '_Total') {
                if (!interfaces[interfaceName]) {
                  interfaces[interfaceName] = { timestamp: Date.now() };
                }
                
                if (counterType.includes('Bytes Received')) {
                  interfaces[interfaceName].bytesReceived = value;
                } else if (counterType.includes('Bytes Sent')) {
                  interfaces[interfaceName].bytesSent = value;
                }
              }
            }
          }
        }
      }
      
      return interfaces;
    } catch (perfErr) {
      throw new Error(`Unable to access network interface statistics. WMIC failed: ${err.message}. Typeperf failed: ${perfErr.message}`);
    }
  }
}

/**
 * Get active network connections with detailed info
 */
async function getActiveConnections() {
  try {
    // Try netstat with -b for process info (requires admin)
    let output;
    let hasProcessInfo = false;
    
    try {
      output = await run('netstat -b -n -o -p TCP', true);
      hasProcessInfo = true;
    } catch {
      // Fallback to basic netstat
      output = await run('netstat -n -o -p TCP');
    }
    
    const connections = new Map();
    const lines = output.split('\n');
    let currentConnection = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('TCP')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4 && parts[3] === 'ESTABLISHED') {
          const localAddr = parts[1];
          const remoteAddr = parts[2];
          const pid = parts[4] || 'unknown';
          const remoteIP = remoteAddr.split(':')[0];
          
          if (remoteIP && 
              !remoteIP.startsWith('127.') && 
              !remoteIP.startsWith('::') && 
              remoteIP !== '0.0.0.0' &&
              /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(remoteIP)) {
            
            currentConnection = {
              localAddr,
              remoteAddr,
              pid,
              process: 'Unknown',
              lastSeen: Date.now()
            };
            
            connections.set(remoteIP, currentConnection);
          }
        }
      } else if (hasProcessInfo && currentConnection && line.startsWith('[') && line.endsWith(']')) {
        // Process name from -b output
        currentConnection.process = line.replace(/[\[\]]/g, '');
      }
    }
    
    return { connections, hasProcessInfo };
  } catch (err) {
    throw new Error(`Failed to get active connections: ${err.message}`);
  }
}

/**
 * Update traffic data with REAL network monitoring only
 */
async function updateTrafficData() {
  const now = Date.now();
  const errors = [];
  let realDataAvailable = false;
  
  // Clear previous error
  lastError = null;
  
  try {
    // Get real network interface statistics
    const interfaces = await getNetworkInterfaceStats();
    console.log(`✓ Got network interface statistics for ${Object.keys(interfaces).length} interfaces`);
    realDataAvailable = true;
    
    // TODO: For real per-IP traffic, we need to correlate interface stats with connections
    // This is complex and typically requires packet capture tools like WinPcap/Npcap
    
  } catch (err) {
    errors.push(`Interface stats: ${err.message}`);
    console.error('Failed to get network interface stats:', err.message);
  }
  
  try {
    // Get active connections (this works without admin)
    const { connections, hasProcessInfo } = await getActiveConnections();
    console.log(`✓ Found ${connections.size} active connections${hasProcessInfo ? ' with process info' : ''}`);
    
    // Store connection info (but without per-IP traffic data, as that requires packet capture)
    for (const [ip, conn] of connections) {
      trafficData.set(ip, {
        downloadSpeed: 0,    // Cannot get real per-IP data without packet capture
        uploadSpeed: 0,      // Cannot get real per-IP data without packet capture
        totalDownload: 0,    // Cannot get real per-IP data without packet capture
        totalUpload: 0,      // Cannot get real per-IP data without packet capture
        lastSeen: conn.lastSeen,
        process: conn.process,
        pid: conn.pid,
        localAddr: conn.localAddr,
        remoteAddr: conn.remoteAddr,
        status: 'active-connection',
        dataType: 'connection-only'
      });
    }
    
    realDataAvailable = true;
  } catch (err) {
    errors.push(`Connection stats: ${err.message}`);
    console.error('Failed to get connection stats:', err.message);
  }
  
  // Clean up old connection data
  for (const [ip, data] of trafficData.entries()) {
    if (now - data.lastSeen > 30000) {
      trafficData.delete(ip);
    }
  }
  
  // If no real data could be obtained, return error
  if (!realDataAvailable) {
    const isPermissionIssue = errors.some(e => e.includes('PERMISSION_REQUIRED') || e.includes('Access is denied'));
    
    lastError = {
      type: 'DATA_ACCESS_FAILED',
      message: 'Unable to access real network traffic data',
      errors: errors,
      requiresAdmin: isPermissionIssue,
      recommendation: isPermissionIssue ? 
        'Run NetPulse as Administrator to access detailed network statistics' :
        'Network monitoring tools may not be available on this system',
      timestamp: now
    };
    
    return lastError;
  }
  
  // If we have partial data, include warnings
  if (errors.length > 0) {
    return {
      data: Object.fromEntries(trafficData),
      warnings: errors,
      limitedAccess: true,
      message: 'Limited network data available - per-IP traffic requires packet capture tools',
      note: 'Showing active connections only. Real traffic monitoring needs WinPcap/Npcap or similar tools.'
    };
  }
  
  return { 
    data: Object.fromEntries(trafficData),
    dataType: 'real-connections-only',
    note: 'Real per-IP traffic data requires packet capture. Showing active connections.'
  };
}

/**
 * Get current traffic data
 */
function getTrafficData() {
  if (lastError) {
    return { error: lastError };
  }
  
  const result = {};
  for (const [ip, data] of trafficData.entries()) {
    result[ip] = {
      downloadSpeed: data.downloadSpeed || 0,
      uploadSpeed: data.uploadSpeed || 0,
      totalDownload: data.totalDownload || 0,
      totalUpload: data.totalUpload || 0,
      lastSeen: data.lastSeen || 0,
      process: data.process,
      pid: data.pid,
      status: data.status,
      dataType: data.dataType
    };
  }
  return { data: result };
}

/**
 * Seed traffic monitoring with known device IPs
 */
function seedDeviceIPs(devices) {
  // Only seed if we don't have connection data for these IPs
  devices.forEach(device => {
    if (!trafficData.has(device.ip)) {
      trafficData.set(device.ip, {
        downloadSpeed: 0,
        uploadSpeed: 0,
        totalDownload: 0,
        totalUpload: 0,
        lastSeen: Date.now(),
        status: 'local-device',
        dataType: 'no-traffic-data',
        hostname: device.hostname,
        mac: device.mac
      });
    }
  });
}

/**
 * Start traffic monitoring
 */
let monitoringInterval = null;

function startTrafficMonitoring(intervalMs = 5000) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }
  
  // Initial update
  updateTrafficData();
  
  // Periodic updates (less frequent for real data to avoid hammering system)
  monitoringInterval = setInterval(() => {
    updateTrafficData().catch(err => {
      console.error('Traffic monitoring error:', err);
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