import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../../shared/types'
import PlayerHead from '../../components/PlayerHead'

type ChatPanelProps = {
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => Promise<boolean>
  isSendingChat: boolean
  open: boolean
  onClose: () => void
  hidden?: boolean
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
  open,
  onClose,
  hidden = false,
}) => {
  const input = useRef<HTMLInputElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const submitted = useRef<string[]>([])
  const historyIndex = useRef(0)
  const draft = useRef('')
  const [now, setNow] = useState(Date.now())
  const [unread, setUnread] = useState(false)
  const close = () => {
    onChatInputChange('')
    onClose()
  }

  useEffect(() => {
    if (open) {
      input.current?.focus()
      historyIndex.current = submitted.current.length
      draft.current = chatInput
      atBottom.current = true
      if (log.current) log.current.scrollTop = log.current.scrollHeight
      setUnread(false)
    }
  }, [open])
  useEffect(() => {
    if (open) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open])
  useLayoutEffect(() => {
    if (!open || !log.current) return
    if (atBottom.current) log.current.scrollTop = log.current.scrollHeight
    else setUnread(true)
  }, [chatMessages, open])

  const visible = open
    ? chatMessages
    : chatMessages.filter((message) => now - message.timestamp < 10000).slice(-8)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!chatInput.trim() || isSendingChat) return
    const message = chatInput.trim()
    if (await onChatSubmit()) {
      if (submitted.current[submitted.current.length - 1] !== message) submitted.current.push(message)
      historyIndex.current = submitted.current.length
      onClose()
    }
  }
  return (
    <section
      aria-label="Server chat"
      className={`absolute bottom-12 left-3 z-30 w-[min(560px,calc(100%_-_24px))] font-mono text-[13px]
        leading-5 ${open ? '' : 'pointer-events-none'} ${hidden ? 'hidden' : ''}`}
    >
      <div
        ref={log}
        role={open ? 'log' : undefined}
        aria-live="polite"
        aria-relevant="additions"
        onScroll={() => {
          const element = log.current
          if (!element) return
          atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
          if (atBottom.current) setUnread(false)
        }}
        className={
          open
            ? `max-h-[min(360px,55vh)] min-h-16 overflow-y-auto rounded-t-lg bg-neutral-950/65 px-3 py-2
              backdrop-blur-xl`
            : 'flex flex-col items-start'
        }
      >
        {visible.map((message) => (
          <p
            key={message.id}
            className={`${open ? 'py-0.5' : 'bg-neutral-950/55 px-2 py-0.5'} break-words whitespace-pre-wrap
            text-neutral-100 [text-shadow:1px_1px_2px_#000]`}
            style={
              !open
                ? { opacity: Math.min(1, Math.max(0, (10000 - (now - message.timestamp)) / 2000)) }
                : undefined
            }
          >
            {message.player && <PlayerHead name={message.player} className="mr-1.5 -mt-px align-middle" />}
            {message.position === 'client' && <span className="text-purple-300">[{message.author}] </span>}
            {message.text}
          </p>
        ))}
        {open && !visible.length && <p className="text-neutral-500">No messages yet.</p>}
      </div>
      {open && (
        <>
          {unread && (
            <button
              type="button"
              className="absolute right-2 bottom-12 rounded bg-neutral-800/90 px-2 py-1 text-xs text-sky-300"
              onClick={() => {
                if (log.current) log.current.scrollTop = log.current.scrollHeight
                atBottom.current = true
                setUnread(false)
              }}
            >
              New messages ↓
            </button>
          )}
          <form
            onSubmit={submit}
            className="mt-1 flex items-center rounded-b-lg border border-white/10 bg-neutral-950/85 px-3 py-2
              backdrop-blur-xl"
          >
            <span aria-hidden className="mr-2 text-neutral-500">
              &gt;
            </span>
            <input
              ref={input}
              aria-label="Chat message"
              value={chatInput}
              maxLength={256}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                onChatInputChange(event.target.value)
                historyIndex.current = submitted.current.length
                draft.current = event.target.value
              }}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  close()
                  return
                }
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                if (historyIndex.current === submitted.current.length) draft.current = chatInput
                historyIndex.current = Math.max(
                  0,
                  Math.min(
                    submitted.current.length,
                    historyIndex.current + (event.key === 'ArrowUp' ? -1 : 1)
                  )
                )
                onChatInputChange(submitted.current[historyIndex.current] ?? draft.current)
              }}
              className="min-w-0 flex-1 bg-transparent text-neutral-100 outline-none"
            />
            {isSendingChat && (
              <span role="status" className="ml-2 text-[10px] text-neutral-500">
                Sending…
              </span>
            )}
          </form>
        </>
      )}
    </section>
  )
}
export default ChatPanel
