const os = require("os");
const https = require("https");
const http = require("http");
const { exec } = require("child_process");
const dns = require("dns");
const net = require("net");

// ── Get public IP + geo info ──
function getPublicIP() {
  return new Promise((resolve) => {
    const req = https.get(
      "https://ipinfo.io/json",
      { timeout: 6000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const info = JSON.parse(data);
            resolve({
              ip: info.ip || "Unknown",
              city: info.city || "",
              region: info.region || "",
              country: info.country || "",
              org: info.org || "",
              timezone: info.timezone || "",
            });
          } catch {
            resolve({
              ip: "Unknown",
              city: "",
              region: "",
              country: "",
              org: "",
              timezone: "",
            });
          }
        });
      },
    );
    req.on("error", () =>
      resolve({
        ip: "Unknown",
        city: "",
        region: "",
        country: "",
        org: "",
        timezone: "",
      }),
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({
        ip: "Unknown",
        city: "",
        region: "",
        country: "",
        org: "",
        timezone: "",
      });
    });
  });
}

// ── Get local network interfaces ──
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        results.push({
          interface: name,
          ip: addr.address,
          mac: addr.mac,
          netmask: addr.netmask,
        });
      }
    }
  }
  return results;
}

// ── Get system info ──
function getSystemInfo() {
  const cpus = os.cpus();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: os.uptime(),
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    cpuModel: cpus.length > 0 ? cpus[0].model : "Unknown",
    cpuCores: cpus.length,
  };
}

// ── ARP table scan (cross-platform) ──
function getArpTable() {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const cmd = isWin ? "arp -a" : "arp -a";

    exec(cmd, { timeout: 10000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);

      const devices = [];
      const lines = stdout.split("\n");

      for (const line of lines) {
        // Windows: 192.168.1.1  00-aa-bb-cc-dd-ee  dynamic
        // Unix:    ? (192.168.1.1) at aa:bb:cc:dd:ee:ff on en0
        let match;
        if (isWin) {
          match = line.match(
            /^\s*([\d.]+)\s+([\da-fA-F]{2}[:-][\da-fA-F]{2}[:-][\da-fA-F]{2}[:-][\da-fA-F]{2}[:-][\da-fA-F]{2}[:-][\da-fA-F]{2})\s+(\w+)/,
          );
          if (match) {
            const mac = match[2].toLowerCase();
            // Filter out broadcast / incomplete
            if (mac !== "ff-ff-ff-ff-ff-ff" && mac !== "ff:ff:ff:ff:ff:ff") {
              devices.push({
                ip: match[1],
                mac,
                type: match[3] || "unknown",
              });
            }
          }
        } else {
          match = line.match(
            /\(([\d.]+)\)\s+at\s+([\da-fA-F]{2}:[\da-fA-F]{2}:[\da-fA-F]{2}:[\da-fA-F]{2}:[\da-fA-F]{2}:[\da-fA-F]{2})/,
          );
          if (match) {
            devices.push({
              ip: match[1],
              mac: match[2].toLowerCase(),
              type: "dynamic",
            });
          }
        }
      }

      resolve(devices);
    });
  });
}

// ── Quick TCP port probe to wake up ARP entries ──
function probeSubnet(localIp, concurrency = 30) {
  return new Promise((resolve) => {
    const parts = localIp.split(".");
    if (parts.length !== 4) return resolve();

    const prefix = parts.slice(0, 3).join(".");
    const targets = [];
    for (let i = 1; i <= 254; i++) {
      targets.push(`${prefix}.${i}`);
    }

    let idx = 0;
    let active = 0;
    let done = false;

    const next = () => {
      while (active < concurrency && idx < targets.length) {
        const ip = targets[idx++];
        active++;
        const sock = new net.Socket();
        sock.setTimeout(300);
        sock.once("connect", () => sock.destroy());
        sock.once("timeout", () => sock.destroy());
        sock.once("error", () => {});
        sock.once("close", () => {
          active--;
          if (idx < targets.length) next();
          else if (active === 0 && !done) {
            done = true;
            resolve();
          }
        });
        sock.connect(80, ip);
      }
      if (idx >= targets.length && active === 0 && !done) {
        done = true;
        resolve();
      }
    };

    next();
  });
}

// ── Try reverse DNS for device hostnames ──
async function resolveHostnames(devices) {
  const promises = devices.map(
    (d) =>
      new Promise((resolve) => {
        dns.reverse(d.ip, (err, hostnames) => {
          resolve({
            ...d,
            hostname: err || !hostnames?.length ? "" : hostnames[0],
          });
        });
      }),
  );
  return Promise.all(promises);
}

// ── Get MAC vendor prefix (first 3 octets → OUI lookup) ──
function getVendorHint(mac) {
  // We'll do a best-effort lookup via macvendors.co (free, no key needed)
  return new Promise((resolve) => {
    const cleanMac = mac.replace(/[:-]/g, "").substring(0, 6).toUpperCase();
    const req = https.get(
      `https://api.macvendors.com/${encodeURIComponent(mac)}`,
      { timeout: 3000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode === 200 && body && !body.includes("Not Found")) {
            resolve(body.trim());
          } else {
            resolve("");
          }
        });
      },
    );
    req.on("error", () => resolve(""));
    req.on("timeout", () => {
      req.destroy();
      resolve("");
    });
  });
}

// ── Batch vendor lookups with rate-limiting ──
async function addVendorInfo(devices) {
  // macvendors.com has a rate limit, so only look up first 20 unique MACs
  const seen = new Set();
  const vendorMap = {};

  for (const d of devices) {
    if (!seen.has(d.mac) && seen.size < 20) {
      seen.add(d.mac);
    }
  }

  // Sequential with tiny delay to avoid rate-limit
  for (const mac of seen) {
    vendorMap[mac] = await getVendorHint(mac);
    await new Promise((r) => setTimeout(r, 120));
  }

  return devices.map((d) => ({
    ...d,
    vendor: vendorMap[d.mac] || "",
  }));
}

// ── Main export ──

async function getNetworkInfo() {
  const [publicInfo, localInterfaces, systemInfo] = await Promise.all([
    getPublicIP(),
    Promise.resolve(getLocalNetworkInfo()),
    Promise.resolve(getSystemInfo()),
  ]);

  // Probe subnet to populate ARP cache, then read ARP
  const primaryLocal = localInterfaces[0];
  if (primaryLocal) {
    await probeSubnet(primaryLocal.ip);
    // Small delay for ARP entries to settle
    await new Promise((r) => setTimeout(r, 500));
  }

  let devices = await getArpTable();
  devices = await resolveHostnames(devices);
  devices = await addVendorInfo(devices);

  return {
    public: publicInfo,
    local: localInterfaces,
    system: systemInfo,
    devices,
  };
}

module.exports = { getNetworkInfo };
