import React, { useEffect, useMemo, useRef } from 'react'

import StatsSummary from './StatsSummary'
import type { BotSnapshot, ChatMessage } from '../types/bot'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type DashboardProps = {
  snapshot: ConnectedSnapshot
  chatMessages: ChatMessage[]
  hasOlderMessages: boolean
  onLoadOlderMessages: () => number
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => void
  isSendingChat: boolean
}

const Dashboard: React.FC<DashboardProps> = ({
  snapshot,
  chatMessages,
  hasOlderMessages,
  onLoadOlderMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
}) => {
  const chatViewportRef = useRef<HTMLDivElement | null>(null)
  const isLoadingOlderRef = useRef(false)
  const lastMessageIdRef = useRef<string | null>(null)

  const emptyStateCopy = useMemo(
    () =>
      chatMessages.length === 0
        ? 'No messages yet. Start the conversation!'
        : 'Scroll up to browse earlier history.',
    [chatMessages.length]
  )

  useEffect(() => {
    const viewport = chatViewportRef.current
    if (!viewport) {
      lastMessageIdRef.current = chatMessages.length ? chatMessages[chatMessages.length - 1].id : null
      return
    }

    const newestId = chatMessages.length ? chatMessages[chatMessages.length - 1].id : null
    const wasNearBottom = viewport.scrollHeight - (viewport.scrollTop + viewport.clientHeight) < 96

    if (newestId && newestId !== lastMessageIdRef.current && wasNearBottom) {
      requestAnimationFrame(() => {
        const target = chatViewportRef.current
        if (target) {
          target.scrollTop = target.scrollHeight
        }
      })
    }

    lastMessageIdRef.current = newestId
  }, [chatMessages])

  useEffect(() => {
    const viewport = chatViewportRef.current
    if (!viewport) {
      return
    }

    const handleScroll = () => {
      if (!hasOlderMessages || isLoadingOlderRef.current) {
        return
      }

      if (viewport.scrollTop > 48) {
        return
      }

      isLoadingOlderRef.current = true
      const previousHeight = viewport.scrollHeight
      const previousTop = viewport.scrollTop
      const added = onLoadOlderMessages()

      requestAnimationFrame(() => {
        const currentViewport = chatViewportRef.current
        if (!currentViewport) {
          isLoadingOlderRef.current = false
          return
        }

        const heightDelta = currentViewport.scrollHeight - previousHeight
        if (added > 0) {
          currentViewport.scrollTop = previousTop + heightDelta
        }
        isLoadingOlderRef.current = false
      })
    }

    viewport.addEventListener('scroll', handleScroll)
    return () => {
      viewport.removeEventListener('scroll', handleScroll)
    }
  }, [hasOlderMessages, onLoadOlderMessages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onChatSubmit()
  }

  return (
    <div className="flex flex-1 flex-col bg-neutral-950/60 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-8">
        <div className="self-start">
          <StatsSummary snapshot={snapshot} />
        </div>

        <section
          className="flex flex-1 flex-col rounded-3xl border border-neutral-800 bg-neutral-900/70 shadow-md"
        >
          <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold text-neutral-50">Server Chat</h2>
              <p className="text-xs text-neutral-400">
                History stays per server. Scroll up to pull earlier messages.
              </p>
            </div>
          </header>

          <div ref={chatViewportRef} className="flex-1 overflow-y-auto px-5 py-4">
            {chatMessages.length === 0 ? (
              <p
                className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/70 px-4 py-6
                  text-center text-sm text-neutral-500"
              >
                {emptyStateCopy}
              </p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {hasOlderMessages ? (
                  <li className="py-2 text-center text-[0.65rem] uppercase tracking-[0.28em] text-neutral-500">
                    Keep scrolling for more history
                  </li>
                ) : null}
                {chatMessages.map((entry) => {
                  const timestamp = new Date(entry.timestamp)
                  const timeLabel = timestamp.toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  const isSystem = entry.type === 'system'
                  return (
                    <li
                      key={entry.id}
                      className={`flex flex-col gap-1 rounded-xl border border-neutral-800/70
                        bg-neutral-900/80 p-3 ${isSystem ? 'text-neutral-300' : 'text-neutral-50'}`}
                    >
                      <div
                        className="flex items-center justify-between text-[0.68rem] uppercase
                          tracking-[0.22em] text-neutral-500"
                      >
                        <span>{entry.author}</span>
                        <span className="text-neutral-400">{timeLabel}</span>
                      </div>
                      <p className="text-sm leading-relaxed text-neutral-200">{entry.text}</p>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <form onSubmit={handleSubmit} className="border-t border-neutral-800 px-5 py-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(event) => onChatInputChange(event.target.value)}
                placeholder="Type a message..."
                className="flex-1 rounded-full border border-neutral-800 bg-neutral-950/70 px-4 py-2 text-sm
                  text-neutral-100 transition focus:border-sky-500 focus:outline-none focus:ring-2
                  focus:ring-sky-500/30 disabled:opacity-60"
                disabled={isSendingChat}
              />
              <button
                type="submit"
                disabled={isSendingChat || !chatInput.trim()}
                className="rounded-full bg-sky-500 px-5 py-2 text-sm font-semibold text-neutral-950 transition
                  hover:bg-sky-400 focus-visible:outline focus-visible:outline-offset-2
                  focus-visible:outline-sky-400 disabled:cursor-not-allowed disabled:bg-neutral-800
                  disabled:text-neutral-500"
              >
                {isSendingChat ? 'Sending…' : 'Send'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  )
}

export default Dashboard
