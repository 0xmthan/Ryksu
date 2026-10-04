const { contextBridge, ipcRenderer } = require('electron')

const registerListener = (channel, callback) => {
  const listener = (_event, data) => {
    callback(data)
  }

  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  copyAppInfo: () => ipcRenderer.invoke('app:copyInfo'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
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
    onNotice: (callback) => registerListener('bot:notice', callback),
    onBuildCells: (callback) => registerListener('bot:buildCells', callback),
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
    lookupPlayerName: (uuid) => ipcRenderer.invoke('bot:lookupPlayerName', uuid),
    getPlayerSkin: (name) => ipcRenderer.invoke('bot:getPlayerSkin', name),
    getPlayerList: () => ipcRenderer.invoke('bot:getPlayerList'),
    attackEntity: (entityId) => ipcRenderer.invoke('bot:attackEntity', entityId),
    followEntity: (entityId) => ipcRenderer.invoke('bot:followEntity', entityId),
    setMovementControls: (controls) => ipcRenderer.invoke('bot:setMovementControls', controls),
    openDoor: (location, standLocation) => ipcRenderer.invoke('bot:openDoor', location, standLocation),
    interactBlock: (position) => ipcRenderer.invoke('bot:interactBlock', position),
    inventoryAction: (action) => ipcRenderer.invoke('bot:inventoryAction', action),
    buildAction: (action) => ipcRenderer.invoke('bot:buildAction', action),
    cancelBuild: () => ipcRenderer.invoke('bot:cancelBuild'),
    openTrader: (entityId) => ipcRenderer.invoke('bot:openTrader', entityId),
    trade: (index, count) => ipcRenderer.invoke('bot:trade', index, count),
    closeTrader: () => ipcRenderer.invoke('bot:closeTrader'),
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
})
