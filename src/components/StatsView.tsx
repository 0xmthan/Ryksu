import React, { useEffect, useRef } from 'react'

import StatsSummary from './StatsSummary'
import type { BotSnapshot, BotStatus, ChatMessage } from '../types/bot'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type StatsViewProps = {
  snapshot: ConnectedSnapshot
  status: BotStatus
  onDisconnect: () => void
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => void
  isSendingChat: boolean
}

const StatsView: React.FC<StatsViewProps> = ({
  snapshot,
  status,
  onDisconnect,
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
}) => {
  const chatViewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const viewport = chatViewportRef.current
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [chatMessages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onChatSubmit()
  }

  return (
    <div className="flex flex-1 flex-col bg-stats-gradient text-purple-100">
      <div className="flex flex-1 justify-center overflow-y-auto py-6">
        <div className="flex w-full max-w-4xl flex-col gap-4 px-3">
          <StatsSummary snapshot={snapshot} status={status} />

          <section
            className="flex flex-1 flex-col rounded-3xl border border-purple-900/45 bg-panel p-4 shadow-panel
              backdrop-blur"
          >
            <header className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-purple-100">Server Chat</h2>
                <p className="text-[0.7rem] text-purple-200/70">Stay in sync with the world.</p>
              </div>
            </header>
            <div
              ref={chatViewportRef}
              className="mt-3 flex-1 overflow-y-auto rounded-2xl border border-purple-900/30 bg-chat-panel p-3"
            >
              {chatMessages.length === 0 ? (
                <p className="text-sm text-purple-200/60">No messages yet. Start the conversation!</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm">
                  {chatMessages.map((entry) => {
                    const timestamp = new Date(entry.timestamp)
                    const timeLabel = timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    const isSystem = entry.type === 'system'
                    return (
                      <li
                        key={entry.id}
                        className={`flex flex-col gap-1 rounded-xl border border-purple-900/30 bg-chat-bubble p-3 ${
                          isSystem ? 'text-purple-200/80' : 'text-purple-100'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[0.7rem] uppercase tracking-[0.2em]">
                          <span>{entry.author}</span>
                          <span className="text-purple-300/60">{timeLabel}</span>
                        </div>
                        <p className="text-sm leading-relaxed">{entry.text}</p>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <form onSubmit={handleSubmit} className="mt-3 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(event) => onChatInputChange(event.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-full border border-purple-900/40 bg-input-surface px-4 py-2 text-sm
                  text-purple-100 transition focus:border-purple-500 focus:outline-none focus:ring-2
                  focus:ring-purple-500/50 disabled:opacity-60"
                disabled={isSendingChat}
              />
              <button
                type="submit"
                disabled={isSendingChat || !chatInput.trim()}
                className="rounded-full bg-purple-600 px-5 py-2 text-sm font-semibold text-ink transition
                  hover:bg-purple-500 focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-purple-300
                  disabled:cursor-not-allowed disabled:bg-purple-500/50 disabled:text-purple-900"
              >
                {isSendingChat ? 'Sending…' : 'Send'}
              </button>
            </form>
          </section>
        </div>
      </div>

      <footer className="border-t border-purple-900/30 bg-footer px-6 py-4 text-right">
        <button
          type="button"
          onClick={onDisconnect}
          className="inline-flex items-center justify-center rounded-full border border-purple-500/60
            bg-transparent px-4 py-2 text-sm font-semibold text-purple-200 transition hover:bg-purple-700/20
            focus-visible:outline focus-visible:outline-offset-2 focus-visible:outline-purple-400"
        >
          Disconnect
        </button>
      </footer>
    </div>
  )
}

export default StatsView
