const { contextBridge, ipcRenderer } = require('electron');

const registerListener = (channel, callback) => {
  const listener = (_event, data) => {
    callback(data);
  };

  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('window-controls', 'minimize'),
  close: () => ipcRenderer.send('window-controls', 'close'),
  bot: {
    connect: (options) => ipcRenderer.invoke('bot:connect', options),
    disconnect: () => ipcRenderer.invoke('bot:disconnect'),
    getSnapshot: () => ipcRenderer.invoke('bot:getSnapshot'),
    subscribe: () => ipcRenderer.send('bot:subscribe'),
    onStatus: (callback) => registerListener('bot:status', callback),
    onState: (callback) => registerListener('bot:state', callback),
    getSupportedVersions: () => ipcRenderer.invoke('bot:getSupportedVersions'),
    onChat: (callback) => registerListener('bot:chat', callback),
    onChatHistory: (callback) => registerListener('bot:chatHistory', callback),
    getChatHistory: () => ipcRenderer.invoke('bot:getChatHistory'),
    sendChat: (message) => ipcRenderer.invoke('bot:sendChat', message),
    setArmorManagerEnabled: (enabled) => ipcRenderer.invoke('bot:setArmorManagerEnabled', enabled),
    setAutoEatEnabled: (enabled) => ipcRenderer.invoke('bot:setAutoEatEnabled', enabled),
    setAutoEatOptions: (options) => ipcRenderer.invoke('bot:setAutoEatOptions', options),
    getAutoEatOptions: () => ipcRenderer.invoke('bot:getAutoEatOptions'),
  },
});
