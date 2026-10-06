// The parse error minecraft-protocol throws when a server plugin sends a player_info packet it doesn't
// understand. Once connected it's harmless; the main process drops it and the window shows this instead.
export const PLUGIN_PACKET_WARNING = 'The server or one of its plugins sent a packet Ryksu could not parse.'

export const isPluginPacketError = (message: string) =>
  message.includes('Chunk size is') && message.includes('partial packet') && message.includes('player_info')
