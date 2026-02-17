const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { runSpeedTest } = require("./speedtest");
const { getNetworkInfo } = require("./network");
const {
  blockDevice,
  unblockDevice,
  getBlockedIPs,
  syncBlockedFromFirewall,
} = require("./firewall");

const isDev = !app.isPackaged || process.env.NODE_ENV === "development";
const devServerURL = process.env.VITE_DEV_SERVER_URL;

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1050,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on("maximize", () => {
    win.webContents.send("window:maximized");
  });

  win.on("unmaximize", () => {
    win.webContents.send("window:restored");
  });

  if (isDev && devServerURL) {
    win.loadURL(devServerURL);
    win.webContents.openDevTools({ mode: "detach" });
    return;
  }

  win.loadFile(path.join(__dirname, "../../dist/index.html"));
};

app.whenReady().then(async () => {
  // Sync firewall state from existing rules
  await syncBlockedFromFirewall().catch(() => {});
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.on("window:minimize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return;
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});

ipcMain.on("window:close", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window?.close();
});

ipcMain.handle("window:get-state", (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return { isMaximized: window?.isMaximized() ?? false };
});

ipcMain.handle("network:get-info", async () => {
  try {
    const info = await getNetworkInfo();
    return { data: info };
  } catch (err) {
    return { error: err.message || "Failed to get network info" };
  }
});

let speedTestRunning = false;

ipcMain.handle("speedtest:run", async (event) => {
  if (speedTestRunning) {
    return { error: "A speed test is already running" };
  }
  speedTestRunning = true;
  try {
    const result = await runSpeedTest((phase, speed) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send("speedtest:phase", { phase, speed });
      }
    });
    return { data: result };
  } catch (err) {
    return { error: err.message || "Speed test failed" };
  } finally {
    speedTestRunning = false;
  }
});

// ── device blocking ──
ipcMain.handle("device:block", async (_event, ip) => {
  try {
    await blockDevice(ip);
    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to block device" };
  }
});

ipcMain.handle("device:unblock", async (_event, ip) => {
  try {
    await unblockDevice(ip);
    return { success: true };
  } catch (err) {
    return { error: err.message || "Failed to unblock device" };
  }
});

ipcMain.handle("device:get-blocked", () => {
  return { data: getBlockedIPs() };
});
