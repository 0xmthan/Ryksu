import type { Registry } from 'prismarine-registry'
import { chatFor } from './chatLoader'

export type FriendlyError = { code?: string; message: string }

// Kick reasons arrive as chat components (JSON strings or NBT), not Error objects.
export const kickReasonToText = (reason: unknown, registry: Registry | null | undefined): string => {
  if (!reason || !registry) {
    return typeof reason === 'string' ? reason : ''
  }

  try {
    return chatFor(registry).fromNotch(reason as string).toString().trim()
  } catch {
    return typeof reason === 'string' ? reason : ''
  }
}

const describeConnectionTarget = (host: unknown, port: unknown) => {
  if (!host && !port) {
    return 'the server'
  }

  if (host && port) {
    return `${host}:${port}`
  }

  return String(host ?? `port ${port}`)
}

// The fields read off whatever was thrown: Node socket errors, AggregateErrors, plain objects.
type ErrorLike = {
  message?: unknown
  code?: string
  errors?: unknown
  address?: string
  port?: number | string
}

const collectErrorMessages = (candidate: unknown) => {
  const messages: string[] = []
  const seen = new Set<string>()

  const addMessage = (value: unknown) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    messages.push(trimmed)
  }

  const inspect = (error: unknown): void => {
    if (!error) {
      return
    }

    if (Array.isArray(error)) {
      error.forEach(inspect)
      return
    }

    if (typeof error === 'string') {
      addMessage(error)
      return
    }

    const value = error as ErrorLike
    if (error instanceof AggregateError && Array.isArray(error.errors)) {
      inspect(error.errors)
    }

    if (Array.isArray(value.errors)) {
      inspect(value.errors)
    }

    const message = typeof value.message === 'string' ? value.message.trim() : ''
    if (message) {
      addMessage(message)
    } else if (value.code) {
      addMessage(value.code)
    }
  }

  inspect(candidate)
  return messages
}

export const normaliseError = (
  error: unknown,
  { host, port }: { host?: string; port?: number | string } = {}
): FriendlyError => {
  if (!error) {
    return { message: 'The bot encountered an unknown error.' }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  const value = error as ErrorLike
  const code =
    value.code || (Array.isArray(value.errors) ? (value.errors[0] as ErrorLike | undefined)?.code : undefined)

  if (code === 'ECONNREFUSED') {
    const target = describeConnectionTarget(value.address ?? host ?? 'the server', value.port ?? port ?? '')
    return {
      code,
      message: `Could not connect to ${target}. The server refused the connection.`,
    }
  }

  if (code === 'ECONNRESET') {
    return {
      code,
      message: 'The connection was closed by the server.',
    }
  }

  const messages = collectErrorMessages(error)
  if (messages.length > 0) {
    return {
      code,
      message: messages.join(' '),
    }
  }

  return {
    code,
    message: 'The bot encountered an unexpected error.',
  }
}
