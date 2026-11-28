// Ponte mínima da janela principal do aplicativo (o painel do agente aberto no app).
// Só expõe ações do próprio app: ver o atalho atual e abrir a configuração do atalho.
// No dock dentro do OBS esta ponte não existe, e a linha do atalho fica escondida.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("rumoApp", {
  hotkey: () => ipcRenderer.invoke("app:hotkey"),
  openSettings: () => ipcRenderer.invoke("app:open-settings"),
});
