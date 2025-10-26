import type { ChatMessage } from './types/bot';

export {};

declare global {
  interface Window {
    electronAPI: {
      minimize: () => void;
      close: () => void;
      bot: {
        connect: (
          options: {
            host: string;
            port?: number | string;
            username: string;
            accountType: 'offline' | 'online';
            password?: string;
            offlinePassword?: string;
            version?: string;
          }
        ) => Promise<{ ok: boolean; message?: string }>;
        disconnect: () => Promise<{ ok: boolean }>;
        getSnapshot: () => Promise<
          | {
              connected: true;
              health: number;
              food: number;
              saturation: number;
              position: { x: number; y: number; z: number } | null;
            }
          | { connected: false }
        >;
        getSupportedVersions: () => Promise<string[]>;
        subscribe: () => void;
        onStatus: (callback: (status: { stage: string; message?: string }) => void) => () => void;
        onState: (
          callback: (
            state:
              | {
                  connected: true;
                  health: number;
                  food: number;
                  saturation: number;
                  position: { x: number; y: number; z: number } | null;
                }
              | { connected: false }
          ) => void
        ) => () => void;
        onChat: (callback: (entry: ChatMessage) => void) => () => void;
        onChatHistory: (callback: (entries: ChatMessage[]) => void) => () => void;
        getChatHistory: () => Promise<ChatMessage[]>;
        sendChat: (message: string) => Promise<{ ok: boolean; message?: string }>;
      };
    };
  }
}
