const { contextBridge, ipcRenderer } = require("electron");

const windowApi = {
  minimize: () => ipcRenderer.send("window:minimize"),
  toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
  close: () => ipcRenderer.send("window:close"),
  getState: () => ipcRenderer.invoke("window:get-state"),
  onMaximized: (callback) => {
    ipcRenderer.on("window:maximized", callback);
    return () => ipcRenderer.removeListener("window:maximized", callback);
  },
  onRestored: (callback) => {
    ipcRenderer.on("window:restored", callback);
    return () => ipcRenderer.removeListener("window:restored", callback);
  },
};

const speedTestApi = {
  run: () => ipcRenderer.invoke("speedtest:run"),
  onPhase: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("speedtest:phase", handler);
    return () => ipcRenderer.removeListener("speedtest:phase", handler);
  },
};

const networkApi = {
  getInfo: () => ipcRenderer.invoke("network:get-info"),
};

const deviceApi = {
  block: (ip) => ipcRenderer.invoke("device:block", ip),
  unblock: (ip) => ipcRenderer.invoke("device:unblock", ip),
  getBlocked: () => ipcRenderer.invoke("device:get-blocked"),
};

const trafficApi = {
  getData: () => ipcRenderer.invoke("traffic:get-data"),
  start: () => ipcRenderer.invoke("traffic:start"),
  stop: () => ipcRenderer.invoke("traffic:stop"),
};

contextBridge.exposeInMainWorld("api", {
  window: windowApi,
  speedTest: speedTestApi,
  network: networkApi,
  device: deviceApi,
  traffic: trafficApi,
});
