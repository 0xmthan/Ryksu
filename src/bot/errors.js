const loadPrismarineChat = require('prismarine-chat')

// Kick reasons arrive as chat components (JSON strings or NBT), not Error objects.
const kickReasonToText = (reason, registry) => {
  if (!reason || !registry) {
    return typeof reason === 'string' ? reason : ''
  }

  try {
    return loadPrismarineChat(registry).fromNotch(reason).toString().trim()
  } catch {
    return typeof reason === 'string' ? reason : ''
  }
}

const describeConnectionTarget = (host, port) => {
  if (!host && !port) {
    return 'the server'
  }

  if (host && port) {
    return `${host}:${port}`
  }

  return host ?? `port ${port}`
}

const collectErrorMessages = (candidate) => {
  const messages = []
  const seen = new Set()

  const addMessage = (value) => {
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!trimmed || seen.has(trimmed)) {
      return
    }
    seen.add(trimmed)
    messages.push(trimmed)
  }

  const inspect = (error) => {
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

    if (error instanceof AggregateError && Array.isArray(error.errors)) {
      inspect(error.errors)
    }

    if (Array.isArray(error.errors)) {
      inspect(error.errors)
    }

    const message = typeof error.message === 'string' ? error.message.trim() : ''
    if (message) {
      addMessage(message)
    } else if (error.code) {
      addMessage(error.code)
    }
  }

  inspect(candidate)
  return messages
}

const normaliseError = (error, { host, port } = {}) => {
  if (!error) {
    return { message: 'The bot encountered an unknown error.' }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  const code = error.code || (Array.isArray(error.errors) ? error.errors[0]?.code : undefined)

  if (code === 'ECONNREFUSED') {
    const target =
      describeConnectionTarget(error.address ?? host ?? 'the server', error.port ?? port ?? '')
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

module.exports = {
  kickReasonToText,
  normaliseError,
}
