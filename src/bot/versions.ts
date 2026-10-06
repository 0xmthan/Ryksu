import minecraftData from 'minecraft-data'

export const SUPPORTED_VERSIONS: string[] = (minecraftData.supportedVersions?.pc ?? []).slice().reverse()

export const getSupportedVersions = () => SUPPORTED_VERSIONS
