import React, { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { StoredTranscriptMeta } from '../../../shared/types'

type SavedChatsProps = {
  transcripts: StoredTranscriptMeta[]
  onDelete: (key: string) => void
}

const SavedChats: React.FC<SavedChatsProps> = ({ transcripts, onDelete }) => {
  const [selectedKey, setSelectedKey] = useState<string | null>(
    transcripts.length > 0 ? transcripts[0].key : null
  )

  const selectedTranscript = useMemo(
    () => transcripts.find((entry) => entry.key === selectedKey) ?? null,
    [selectedKey, transcripts]
  )

  useEffect(() => {
    if (transcripts.length === 0) {
      setSelectedKey(null)
      return
    }

    if (selectedKey && transcripts.some((entry) => entry.key === selectedKey)) {
      return
    }

    setSelectedKey(transcripts[0].key)
  }, [selectedKey, transcripts])

  return (
    <div className="flex h-full w-full flex-col bg-neutral-950 text-neutral-200">
      <header className="flex items-center border-b border-neutral-800 px-6 py-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-neutral-100">Saved Chats</h1>
          <p className="text-xs text-neutral-400">
            Review stored chat transcripts per server. Delete entries you no longer need.
          </p>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-72 border-r border-neutral-800 bg-neutral-900/60">
          <ul className="divide-y divide-neutral-800">
            {transcripts.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-neutral-500">No transcripts saved yet.</li>
            ) : (
              transcripts.map((entry) => {
                const isActive = entry.key === selectedKey
                return (
                  <li key={entry.key}>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(entry.key)}
                      className={`flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm
                        transition hover:bg-neutral-800/60 ${
                          isActive ? 'bg-neutral-800/60 text-neutral-100' : 'text-neutral-300'
                        }`}
                    >
                      <span className="truncate">{entry.label}</span>
                      <span className="text-[0.6rem] uppercase tracking-[0.2em] text-neutral-500">
                        {entry.messages.length}
                      </span>
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </aside>

        <main className="flex flex-1 flex-col">
          {selectedTranscript ? (
            <div className="flex flex-col h-full">
              <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-3">
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold text-neutral-100">{selectedTranscript.label}</h2>
                  <p className="text-xs text-neutral-500">
                    {selectedTranscript.messages.length} stored messages.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onDelete(selectedTranscript.key)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border
                    border-rose-500/60 text-rose-200 transition hover:bg-rose-500/10 focus-visible:outline
                    focus-visible:outline-offset-2 focus-visible:outline-rose-400"
                  aria-label="Delete transcript"
                  title="Delete transcript"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" strokeWidth={1.9} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {selectedTranscript.messages.length === 0 ? (
                  <p
                    className="rounded-2xl border border-dashed border-neutral-800 bg-neutral-900/70 px-4 py-6
                      text-center text-sm text-neutral-500"
                  >
                    No messages stored for this transcript.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {selectedTranscript.messages.map((entry) => {
                      const timestamp = new Date(entry.timestamp)
                      const timeLabel = timestamp.toLocaleString(['en-US'], {
                        year: '2-digit',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                      return (
                        <li
                          key={entry.id}
                          className="flex flex-col gap-1 rounded-xl border border-neutral-800/70
                            bg-neutral-900/80 p-3 text-neutral-200"
                        >
                          <div
                            className="flex items-center justify-between text-[0.68rem] uppercase
                              tracking-[0.22em] text-neutral-500"
                          >
                            <span>{entry.author}</span>
                            <span className="text-neutral-400">{timeLabel}</span>
                          </div>
                          <p className="text-sm leading-relaxed">{entry.text}</p>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
              Select a transcript to view its messages.
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default SavedChats
