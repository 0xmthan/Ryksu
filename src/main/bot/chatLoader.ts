import loadPrismarineChat from 'prismarine-chat'
import type { Registry } from 'prismarine-registry'

// prismarine-chat's loader takes a registry as well as a version string, but its typings only list the string.
export const chatFor = (registry: Registry) => loadPrismarineChat(registry as unknown as string)
