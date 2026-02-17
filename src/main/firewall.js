const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Track blocked IPs in memory (survives until app exits)
const blockedIPs = new Set();

const RULE_PREFIX = "NetPulse_Block_";

/** Run a shell command and return stdout */
function run(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout.trim());
    });
  });
}

/**
 * Run a command elevated (as admin) on Windows.
 * Writes a temp .bat script, launches it via PowerShell Start-Process -Verb RunAs,
 * waits for it to finish, and reads back the exit code.
 */
function runElevated(cmd) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const batFile = path.join(os.tmpdir(), `netpulse_${id}.bat`);
    const doneFile = path.join(os.tmpdir(), `netpulse_${id}.done`);
    const errFile = path.join(os.tmpdir(), `netpulse_${id}.err`);

    // Batch script: run the command, write exit code to .done, or error to .err
    const script = `@echo off\r\n${cmd}\r\nif %ERRORLEVEL% NEQ 0 (\r\n  echo %ERRORLEVEL% > "${errFile}"\r\n) else (\r\n  echo 0 > "${doneFile}"\r\n)\r\ndel "%~f0"\r\n`;

    fs.writeFileSync(batFile, script, "utf8");

    // Launch elevated via PowerShell
    const psCmd = `powershell -NoProfile -Command "Start-Process -FilePath '${batFile}' -Verb RunAs -WindowStyle Hidden -Wait"`;
    exec(psCmd, { timeout: 30000 }, (err) => {
      // Small delay to let file writes flush
      setTimeout(() => {
        const success = fs.existsSync(doneFile);
        const failed = fs.existsSync(errFile);

        // Cleanup
        try {
          fs.unlinkSync(doneFile);
        } catch {}
        try {
          fs.unlinkSync(errFile);
        } catch {}
        try {
          fs.unlinkSync(batFile);
        } catch {}

        if (err && !success) {
          reject(new Error("Elevation was cancelled or failed"));
        } else if (failed && !success) {
          reject(new Error("Command failed with non-zero exit code"));
        } else {
          resolve("OK");
        }
      }, 300);
    });
  });
}

/**
 * Block a device by IP using Windows Firewall rules.
 * Creates inbound + outbound rules that drop all traffic to/from the IP.
 * Requires admin privileges on Windows.
 */
async function blockDevice(ip) {
  if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error("Invalid IP address");
  }

  const ruleName = `${RULE_PREFIX}${ip}`;

  if (process.platform === "win32") {
    // Block inbound + outbound in one elevated batch
    await runElevated(
      `netsh advfirewall firewall add rule name="${ruleName}_In" dir=in action=block remoteip=${ip} enable=yes && netsh advfirewall firewall add rule name="${ruleName}_Out" dir=out action=block remoteip=${ip} enable=yes`,
    );
  } else {
    // Linux / macOS fallback using iptables / pf
    if (process.platform === "linux") {
      await run(`sudo iptables -A INPUT -s ${ip} -j DROP`);
      await run(`sudo iptables -A OUTPUT -d ${ip} -j DROP`);
    } else if (process.platform === "darwin") {
      await run(
        `echo "block drop from ${ip} to any" | sudo pfctl -a netpulse -f -`,
      );
      await run(
        `echo "block drop from any to ${ip}" | sudo pfctl -a netpulse -f -`,
      );
    }
  }

  blockedIPs.add(ip);
}

/**
 * Unblock a device by IP – removes the firewall rules.
 */
async function unblockDevice(ip) {
  if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
    throw new Error("Invalid IP address");
  }

  const ruleName = `${RULE_PREFIX}${ip}`;

  if (process.platform === "win32") {
    // Remove inbound + outbound rules in one elevated batch
    await runElevated(
      `netsh advfirewall firewall delete rule name="${ruleName}_In" & netsh advfirewall firewall delete rule name="${ruleName}_Out"`,
    ).catch(() => {});
  } else if (process.platform === "linux") {
    await run(`sudo iptables -D INPUT -s ${ip} -j DROP`).catch(() => {});
    await run(`sudo iptables -D OUTPUT -d ${ip} -j DROP`).catch(() => {});
  } else if (process.platform === "darwin") {
    await run(`sudo pfctl -a netpulse -F rules`).catch(() => {});
  }

  blockedIPs.delete(ip);
}

/** Get the set of currently blocked IPs */
function getBlockedIPs() {
  return [...blockedIPs];
}

/** Check if an IP is blocked */
function isBlocked(ip) {
  return blockedIPs.has(ip);
}

/**
 * Sync blocked state from actual firewall rules on startup.
 * Reads existing NetPulse rules so the UI reflects reality.
 */
async function syncBlockedFromFirewall() {
  if (process.platform !== "win32") return;

  try {
    const out = await run(
      `netsh advfirewall firewall show rule name=all dir=in | findstr /C:"${RULE_PREFIX}"`,
    );
    const regex = new RegExp(`${RULE_PREFIX}([\\d.]+)_In`, "g");
    let m;
    while ((m = regex.exec(out)) !== null) {
      blockedIPs.add(m[1]);
    }
  } catch {
    // no rules found – that's fine
  }
}

module.exports = {
  blockDevice,
  unblockDevice,
  getBlockedIPs,
  isBlocked,
  syncBlockedFromFirewall,
};
