const https = require("https");
const http = require("http");
const { URL } = require("url");

// ---------- helpers ----------

/** Measure TCP+TLS handshake latency to speed.cloudflare.com */
function measurePing(attempts = 5) {
  return new Promise((resolve, reject) => {
    const results = [];
    let completed = 0;

    const doPing = () => {
      const start = performance.now();
      const req = https.request(
        {
          hostname: "speed.cloudflare.com",
          port: 443,
          path: "/__down?bytes=0",
          method: "GET",
          timeout: 5000,
        },
        (res) => {
          res.resume();
          res.on("end", () => {
            results.push(performance.now() - start);
            completed++;
            if (completed < attempts) doPing();
            else finish();
          });
        },
      );
      req.on("error", (err) => {
        completed++;
        if (completed < attempts) doPing();
        else finish();
      });
      req.on("timeout", () => {
        req.destroy();
        completed++;
        if (completed < attempts) doPing();
        else finish();
      });
      req.end();
    };

    const finish = () => {
      if (results.length === 0)
        return reject(new Error("Ping failed – no internet connection"));
      results.sort((a, b) => a - b);
      // take median
      const median = results[Math.floor(results.length / 2)];
      resolve(parseFloat(median.toFixed(1)));
    };

    doPing();
  });
}

/** Download from Cloudflare speed endpoint and measure throughput */
function measureDownload(onProgress, durationMs = 10000) {
  return new Promise((resolve, reject) => {
    const chunkSize = 25_000_000; // 25 MB chunks
    let totalBytes = 0;
    const startTime = performance.now();
    let stopped = false;
    let activeReq = null;

    const timer = setTimeout(() => {
      stopped = true;
      if (activeReq) activeReq.destroy();
    }, durationMs);

    const doDownload = () => {
      if (stopped) return finish();

      activeReq = https.get(
        `https://speed.cloudflare.com/__down?bytes=${chunkSize}`,
        { timeout: durationMs + 2000 },
        (res) => {
          res.on("data", (chunk) => {
            totalBytes += chunk.length;
            const elapsed = (performance.now() - startTime) / 1000;
            const mbps = (totalBytes * 8) / (elapsed * 1_000_000);
            if (onProgress) onProgress(parseFloat(mbps.toFixed(2)));
          });
          res.on("end", () => {
            if (!stopped) doDownload();
            else finish();
          });
          res.on("error", () => finish());
        },
      );
      activeReq.on("error", () => finish());
      activeReq.on("timeout", () => {
        activeReq.destroy();
        finish();
      });
    };

    const finish = () => {
      clearTimeout(timer);
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed === 0 || totalBytes === 0)
        return reject(new Error("Download test failed"));
      const mbps = (totalBytes * 8) / (elapsed * 1_000_000);
      resolve(parseFloat(mbps.toFixed(2)));
    };

    doDownload();
  });
}

/** Upload random data to Cloudflare speed endpoint and measure throughput */
function measureUpload(onProgress, durationMs = 10000) {
  return new Promise((resolve, reject) => {
    const chunkSize = 2_000_000; // 2 MB per request
    const payload = Buffer.alloc(chunkSize, "x");
    let totalBytes = 0;
    const startTime = performance.now();
    let stopped = false;
    let activeReq = null;

    const timer = setTimeout(() => {
      stopped = true;
      if (activeReq) activeReq.destroy();
    }, durationMs);

    const doUpload = () => {
      if (stopped) return finish();

      const options = {
        hostname: "speed.cloudflare.com",
        path: "/__up",
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": chunkSize,
        },
        timeout: durationMs + 2000,
      };

      activeReq = https.request(options, (res) => {
        res.resume();
        res.on("end", () => {
          totalBytes += chunkSize;
          const elapsed = (performance.now() - startTime) / 1000;
          const mbps = (totalBytes * 8) / (elapsed * 1_000_000);
          if (onProgress) onProgress(parseFloat(mbps.toFixed(2)));
          if (!stopped) doUpload();
          else finish();
        });
        res.on("error", () => finish());
      });

      activeReq.on("error", () => finish());
      activeReq.on("timeout", () => {
        activeReq.destroy();
        finish();
      });
      activeReq.write(payload);
      activeReq.end();
    };

    const finish = () => {
      clearTimeout(timer);
      const elapsed = (performance.now() - startTime) / 1000;
      if (elapsed === 0 || totalBytes === 0)
        return reject(new Error("Upload test failed"));
      const mbps = (totalBytes * 8) / (elapsed * 1_000_000);
      resolve(parseFloat(mbps.toFixed(2)));
    };

    doUpload();
  });
}

// ---------- public ----------

/**
 * Run a full speed test. Calls `onPhase(phase, currentSpeedMbps)` to report
 * live progress during download/upload phases.
 *
 * Returns { ping, download, upload }
 */
async function runSpeedTest(onPhase) {
  // Phase 1 – Ping
  onPhase?.("ping", null);
  const ping = await measurePing();

  // Phase 2 – Download
  onPhase?.("download", 0);
  const download = await measureDownload(
    (speed) => onPhase?.("download", speed),
    12000,
  );

  // Phase 3 – Upload
  onPhase?.("upload", 0);
  const upload = await measureUpload(
    (speed) => onPhase?.("upload", speed),
    10000,
  );

  onPhase?.("done", null);
  return { ping, download, upload };
}

module.exports = { runSpeedTest };
