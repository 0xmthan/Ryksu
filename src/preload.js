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
  openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
  bot: {
    connect: (options) => ipcRenderer.invoke('bot:connect', options),
    disconnect: () => ipcRenderer.invoke('bot:disconnect'),
    getSnapshot: () => ipcRenderer.invoke('bot:getSnapshot'),
    subscribe: () => ipcRenderer.send('bot:subscribe'),
    onStatus: (callback) => registerListener('bot:status', callback),
    onState: (callback) => registerListener('bot:state', callback),
    getSupportedVersions: () => ipcRenderer.invoke('bot:getSupportedVersions'),
    onChat: (callback) => registerListener('bot:chat', callback),
    onPathfinderOptions: (callback) => registerListener('bot:pathfinderOptions', callback),
    onChatHistory: (callback) => registerListener('bot:chatHistory', callback),
    getChatHistory: () => ipcRenderer.invoke('bot:getChatHistory'),
    sendChat: (message) => ipcRenderer.invoke('bot:sendChat', message),
    useBed: () => ipcRenderer.invoke('bot:useBed'),
    pickUpBed: () => ipcRenderer.invoke('bot:pickUpBed'),
    dismissBedPickup: () => ipcRenderer.invoke('bot:dismissBedPickup'),
    startMining: (options) => ipcRenderer.invoke('bot:startMining', options),
    stopMining: () => ipcRenderer.invoke('bot:stopMining'),
    getWorldView: () => ipcRenderer.invoke('bot:getWorldView'),
    getSkin: (url) => ipcRenderer.invoke('bot:getSkin', url),
    attackEntity: (entityId) => ipcRenderer.invoke('bot:attackEntity', entityId),
    openDoor: (location, standLocation) => ipcRenderer.invoke('bot:openDoor', location, standLocation),
    inventoryAction: (action) => ipcRenderer.invoke('bot:inventoryAction', action),
    onWorld: (callback) => registerListener('bot:world', callback),
    onMotion: (callback) => registerListener('bot:motion', callback),
    setArmorManagerEnabled: (enabled) => ipcRenderer.invoke('bot:setArmorManagerEnabled', enabled),
    setAutoEatEnabled: (enabled) => ipcRenderer.invoke('bot:setAutoEatEnabled', enabled),
    setAutoToolEnabled: (enabled) => ipcRenderer.invoke('bot:setAutoToolEnabled', enabled),
    setAutoShieldEnabled: (enabled) => ipcRenderer.invoke('bot:setAutoShieldEnabled', enabled),
    setAutoEatOptions: (options) => ipcRenderer.invoke('bot:setAutoEatOptions', options),
    getAutoEatOptions: () => ipcRenderer.invoke('bot:getAutoEatOptions'),
    setPathfinderOptions: (options) => ipcRenderer.invoke('bot:setPathfinderOptions', options),
    getPathfinderOptions: () => ipcRenderer.invoke('bot:getPathfinderOptions'),
    setPvpOptions: (options) => ipcRenderer.invoke('bot:setPvpOptions', options),
    getPvpOptions: () => ipcRenderer.invoke('bot:getPvpOptions'),
  },
});
