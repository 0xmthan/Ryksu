import React, { useMemo } from 'react'
import type { ChatMessage } from '../types'

type ChatPanelProps = {
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => void
  isSendingChat: boolean
  fullHeight?: boolean
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
  fullHeight = false,
}) => {
  const emptyStateCopy = useMemo(
    () =>
      chatMessages.length === 0
        ? 'No messages yet. Start the conversation!'
        : 'You are caught up. Load older messages to browse history.',
    [chatMessages.length]
  )

  const groupedMessages = useMemo(() => {
    if (chatMessages.length === 0) {
      return []
    }

    const groups: Array<{
      author: string
      timestamp: number
      messages: ChatMessage[]
    }> = []

    for (const message of chatMessages) {
      const bucket = Math.floor(message.timestamp / 60000)
      const lastGroup = groups[groups.length - 1]
      if (lastGroup && lastGroup.author === message.author && lastGroup.timestamp === bucket) {
        lastGroup.messages.push(message)
      } else {
        groups.push({
          author: message.author,
          timestamp: bucket,
          messages: [message],
        })
      }
    }

    return groups
  }, [chatMessages])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onChatSubmit()
  }

  return (
    <section
      className={`flex flex-1 flex-col rounded-3xl border border-neutral-800 bg-neutral-900/70 shadow-md ${
        fullHeight ? 'h-full w-full' : ''
      }`}
    >
      <header className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-neutral-50">Server Chat</h2>
          <p className="text-xs text-neutral-400">Live feed from your current connection.</p>
        </div>
      </header>

      <div className="flex-1 px-5 py-4">
        {groupedMessages.length === 0 ? (
          <p
            className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/70 px-4 py-6
              text-center text-sm text-neutral-500"
          >
            {emptyStateCopy}
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {groupedMessages.map((group) => {
              const timestamp = new Date(group.timestamp * 60000)
              const timeLabel = timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
              const firstMessage = group.messages[0]
              const isSystem = firstMessage.type === 'system'
              const authorIsRyksu =
                group.author.trim().toLowerCase() === 'ryksu' ||
                firstMessage.author.trim().toLowerCase() === 'ryksu'
              return (
                <li
                  key={`${group.messages[0].id}-group`}
                  className={`flex flex-col gap-1 rounded-xl border border-neutral-800/70 bg-neutral-900/80
                    p-3 ${isSystem ? 'text-neutral-300' : 'text-neutral-50'}`}
                >
                  <div
                    className="flex items-center justify-between text-[0.68rem] uppercase tracking-[0.22em]
                      text-neutral-500"
                  >
                    <span className={authorIsRyksu ? 'text-purple-300' : undefined}>{group.author}</span>
                    <span className="text-neutral-400">{timeLabel}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {group.messages.map((entry) => (
                      <p key={entry.id} className="text-sm leading-relaxed text-neutral-200">
                        {entry.text}
                      </p>
                    ))}
                  </div>
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
  )
}

export default ChatPanel
