import React from 'react'
import ChatPanel from './ChatPanel'
import StatsSummary from './StatsSummary'
import type { BotSnapshot, ChatMessage } from '../types'

type ConnectedSnapshot = Extract<BotSnapshot, { connected: true }>

type DashboardProps = {
  snapshot: ConnectedSnapshot
  chatMessages: ChatMessage[]
  chatInput: string
  onChatInputChange: (value: string) => void
  onChatSubmit: () => void
  isSendingChat: boolean
  showChat: boolean
}

const Dashboard: React.FC<DashboardProps> = ({
  snapshot,
  chatMessages,
  chatInput,
  onChatInputChange,
  onChatSubmit,
  isSendingChat,
  showChat,
}) => {
  return (
    <div className="flex flex-1 flex-col bg-neutral-950/60 text-neutral-100">
      <div className="flex items-start justify-between px-6 pt-6">
        {!showChat ? <StatsSummary snapshot={snapshot} /> : null}
      </div>

      <div className="flex flex-1 px-6 py-6">
        {showChat ? (
          <ChatPanel
            chatMessages={chatMessages}
            chatInput={chatInput}
            onChatInputChange={onChatInputChange}
            onChatSubmit={onChatSubmit}
            isSendingChat={isSendingChat}
            fullHeight
          />
        ) : null}
      </div>
    </div>
  )
}

export default Dashboard
