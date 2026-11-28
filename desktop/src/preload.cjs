// Ponte mínima e explícita entre a janela de configurações e o processo principal.
// Preload em CommonJS (exigido pelo sandbox do Electron).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rumo", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (input) => ipcRenderer.invoke("settings:save", input),
  pickFolder: () => ipcRenderer.invoke("settings:pick-folder"),
});
