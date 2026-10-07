// The API the preload exposes to the window as window.electronAPI. It's built here, apart from the preload,
// so the window can take its type without loading Electron's types (which bring in Node's).
import type { EventChannels, InvokeArgs, InvokeChannel, InvokeResult, SendChannels } from '../shared/ipc'

// The parts of Electron's ipcRenderer the API uses.
export type IpcRendererLike = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
  removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): unknown
}

type Args<C extends InvokeChannel> = InvokeArgs<C>

export const createElectronAPI = (ipcRenderer: IpcRendererLike) => {
  const invoke = <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>) =>
    ipcRenderer.invoke(channel, ...args) as Promise<InvokeResult<C>>

  const send = <C extends keyof SendChannels>(channel: C, ...args: SendChannels[C]) =>
    ipcRenderer.send(channel, ...args)

  const registerListener = <C extends keyof EventChannels>(
    channel: C,
    callback: (data: EventChannels[C]) => void
  ) => {
    const listener = (_event: unknown, data: unknown) => {
      callback(data as EventChannels[C])
    }

    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }

  return {
    getAppInfo: () => invoke('app:getInfo'),
    copyAppInfo: () => invoke('app:copyInfo'),
    checkForUpdates: () => invoke('app:checkForUpdates'),
    getUnlimitedFps: () => invoke('app:getUnlimitedFps'),
    setUnlimitedFps: (...args: Args<'app:setUnlimitedFps'>) => invoke('app:setUnlimitedFps', ...args),
    getControlApi: () => invoke('app:getControlApi'),
    setControlApi: (...args: Args<'app:setControlApi'>) => invoke('app:setControlApi', ...args),
    minimize: () => send('window-controls', 'minimize'),
    close: () => send('window-controls', 'close'),
    openExternal: (...args: Args<'system:openExternal'>) => invoke('system:openExternal', ...args),
    grabPointer: () => invoke('window:grabPointer'),
    pingServer: (...args: Args<'server:ping'>) => invoke('server:ping', ...args),
    bot: {
      connect: (...args: Args<'bot:connect'>) => invoke('bot:connect', ...args),
      disconnect: () => invoke('bot:disconnect'),
      subscribe: () => send('bot:subscribe'),
      onStatus: (callback: (status: EventChannels['bot:status']) => void) =>
        registerListener('bot:status', callback),
      onState: (callback: (state: EventChannels['bot:state']) => void) =>
        registerListener('bot:state', callback),
      getSupportedVersions: () => invoke('bot:getSupportedVersions'),
      onChat: (callback: (entry: EventChannels['bot:chat']) => void) =>
        registerListener('bot:chat', callback),
      onPathfinderOptions: (callback: (options: EventChannels['bot:pathfinderOptions']) => void) =>
        registerListener('bot:pathfinderOptions', callback),
      onNotice: (callback: (text: EventChannels['bot:notice']) => void) =>
        registerListener('bot:notice', callback),
      onBuildCells: (callback: (cells: EventChannels['bot:buildCells']) => void) =>
        registerListener('bot:buildCells', callback),
      onBreaking: (callback: (state: EventChannels['bot:breaking']) => void) =>
        registerListener('bot:breaking', callback),
      onChatHistory: (callback: (entries: EventChannels['bot:chatHistory']) => void) =>
        registerListener('bot:chatHistory', callback),
      getChatHistory: () => invoke('bot:getChatHistory'),
      sendChat: (...args: Args<'bot:sendChat'>) => invoke('bot:sendChat', ...args),
      useBed: () => invoke('bot:useBed'),
      pickUpBed: () => invoke('bot:pickUpBed'),
      dismissBedPickup: () => invoke('bot:dismissBedPickup'),
      startMining: (...args: Args<'bot:startMining'>) => invoke('bot:startMining', ...args),
      stopMining: () => invoke('bot:stopMining'),
      getMineableBlocks: () => invoke('bot:getMineableBlocks'),
      toggleMiningChest: (...args: Args<'bot:toggleMiningChest'>) => invoke('bot:toggleMiningChest', ...args),
      getWorldView: () => invoke('bot:getWorldView'),
      getMaps: (...args: Args<'bot:getMaps'>) => invoke('bot:getMaps', ...args),
      getSkin: (...args: Args<'bot:getSkin'>) => invoke('bot:getSkin', ...args),
      lookupPlayerName: (...args: Args<'bot:lookupPlayerName'>) => invoke('bot:lookupPlayerName', ...args),
      getPlayerSkin: (...args: Args<'bot:getPlayerSkin'>) => invoke('bot:getPlayerSkin', ...args),
      getPlayerList: () => invoke('bot:getPlayerList'),
      attackEntity: (...args: Args<'bot:attackEntity'>) => invoke('bot:attackEntity', ...args),
      followEntity: (...args: Args<'bot:followEntity'>) => invoke('bot:followEntity', ...args),
      setTrustedPlayers: (...args: Args<'bot:setTrustedPlayers'>) => invoke('bot:setTrustedPlayers', ...args),
      setRenderDistance: (...args: Args<'bot:setRenderDistance'>) => invoke('bot:setRenderDistance', ...args),
      firstPerson: {
        look: (...args: SendChannels['bot:firstPersonLook']) => send('bot:firstPersonLook', ...args),
        hit: (...args: Args<'bot:firstPersonHit'>) => invoke('bot:firstPersonHit', ...args),
        dig: (...args: Args<'bot:firstPersonDig'>) => invoke('bot:firstPersonDig', ...args),
        stopDig: () => send('bot:firstPersonStopDig'),
        place: (...args: Args<'bot:firstPersonPlace'>) => invoke('bot:firstPersonPlace', ...args),
      },
      setMovementControls: (...args: Args<'bot:setMovementControls'>) =>
        invoke('bot:setMovementControls', ...args),
      interactBlock: (...args: Args<'bot:interactBlock'>) => invoke('bot:interactBlock', ...args),
      inventoryAction: (...args: Args<'bot:inventoryAction'>) => invoke('bot:inventoryAction', ...args),
      buildAction: (...args: Args<'bot:buildAction'>) => invoke('bot:buildAction', ...args),
      cancelBuild: () => invoke('bot:cancelBuild'),
      openTrader: (...args: Args<'bot:openTrader'>) => invoke('bot:openTrader', ...args),
      trade: (...args: Args<'bot:trade'>) => invoke('bot:trade', ...args),
      closeTrader: () => invoke('bot:closeTrader'),
      onWorld: (callback: (view: EventChannels['bot:world']) => void) =>
        registerListener('bot:world', callback),
      onMotion: (callback: (motion: EventChannels['bot:motion']) => void) =>
        registerListener('bot:motion', callback),
      onSelfMotion: (callback: (motion: EventChannels['bot:selfMotion']) => void) =>
        registerListener('bot:selfMotion', callback),
      setArmorManagerEnabled: (...args: Args<'bot:setArmorManagerEnabled'>) =>
        invoke('bot:setArmorManagerEnabled', ...args),
      setAutoEatEnabled: (...args: Args<'bot:setAutoEatEnabled'>) => invoke('bot:setAutoEatEnabled', ...args),
      setAutoToolEnabled: (...args: Args<'bot:setAutoToolEnabled'>) =>
        invoke('bot:setAutoToolEnabled', ...args),
      setAutoShieldEnabled: (...args: Args<'bot:setAutoShieldEnabled'>) =>
        invoke('bot:setAutoShieldEnabled', ...args),
      setAutoEatOptions: (...args: Args<'bot:setAutoEatOptions'>) => invoke('bot:setAutoEatOptions', ...args),
      setPathfinderOptions: (...args: Args<'bot:setPathfinderOptions'>) =>
        invoke('bot:setPathfinderOptions', ...args),
      setPvpOptions: (...args: Args<'bot:setPvpOptions'>) => invoke('bot:setPvpOptions', ...args),
    },
    scripts: {
      getState: () => invoke('scripts:getState'),
      save: (...args: Args<'scripts:save'>) => invoke('scripts:save', ...args),
      delete: (...args: Args<'scripts:delete'>) => invoke('scripts:delete', ...args),
      start: (...args: Args<'scripts:start'>) => invoke('scripts:start', ...args),
      stop: () => invoke('scripts:stop'),
      onState: (callback: (state: EventChannels['scripts:state']) => void) =>
        registerListener('scripts:state', callback),
    },
  }
}

export type ElectronAPI = ReturnType<typeof createElectronAPI>
