const nbt = require('prismarine-nbt')

// AuthMe 6 on Paper can show its login/register dialog during the configuration phase, before the
// player joins, and holds the connection until the dialog's submit button sends the input values.
const SUBMIT_ACTION = /^authme:prejoin-(login|register)\/submit$/

const findSubmitAction = (value) => {
  if (typeof value === 'string') {
    return SUBMIT_ACTION.test(value) ? value : null
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      const match = findSubmitAction(child)
      if (match) {
        return match
      }
    }
  }
  return null
}

const writeVarInt = (value) => {
  const bytes = []
  do {
    let byte = value & 0x7f
    value >>>= 7
    if (value !== 0) {
      byte |= 0x80
    }
    bytes.push(byte)
  } while (value !== 0)
  return Buffer.from(bytes)
}

// minecraft-data defines the payload as a boolean-prefixed optional NBT, but the game expects a
// VarInt length prefix (PrismarineJS/minecraft-data#1222). Patch the bytes while that schema is in use.
const hasBooleanPrefixedPayload = (client) => {
  try {
    const { types } = require('minecraft-data')(client.version).protocol
    const fields = types.packet_common_custom_click_action?.[1] ?? []
    const payload = fields.find((field) => field.name === 'nbt')
    return JSON.stringify(payload?.type) === JSON.stringify(['option', 'anonymousNbt'])
  } catch {
    return false
  }
}

const writeCustomClick = (client, id, payload) => {
  if (!hasBooleanPrefixedPayload(client)) {
    client.write('custom_click_action', { id, nbt: payload })
    return
  }

  const withPayload = client.serializer.createPacketBuffer({ name: 'custom_click_action', params: { id, nbt: payload } })
  const withoutPayload = client.serializer.createPacketBuffer({ name: 'custom_click_action', params: { id } })
  // Both buffers share the packet id and action id; they differ only after the optional's boolean byte.
  const head = withoutPayload.subarray(0, withoutPayload.length - 1)
  const nbtBytes = withPayload.subarray(withoutPayload.length)
  client.writeRaw(Buffer.concat([head, writeVarInt(nbtBytes.length), nbtBytes]))
}

const getInputKeys = (dialog) =>
  (Array.isArray(dialog?.inputs) ? dialog.inputs : [])
    .map((input) => input?.key)
    .filter((key) => typeof key === 'string')

const attachPreJoinLogin = (client, password, onStatus) => {
  const answered = new Set()

  const handleDialog = (packet, meta) => {
    if (meta?.state !== 'configuration') {
      return
    }

    let dialog
    try {
      dialog = nbt.simplify(packet.dialog)
    } catch {
      return
    }

    const action = findSubmitAction(dialog)
    if (!action) {
      return
    }

    const isRegister = action.includes('register')
    if (!password) {
      onStatus('The server is asking for a password. Set a server password to log in automatically.')
      return
    }

    const keys = getInputKeys(dialog)
    if (keys.includes('email')) {
      onStatus('The server is asking for an email address, which Ryksu cannot fill in automatically.')
      return
    }

    // AuthMe re-shows the dialog when it rejects the input; don't resend the same values forever.
    if (answered.has(action)) {
      onStatus(`The server rejected the ${isRegister ? 'registration' : 'login'}. Check the server password.`)
      return
    }
    answered.add(action)

    const values = {}
    for (const key of keys) {
      values[key] = nbt.string(password)
    }

    writeCustomClick(client, action, nbt.comp(values))
    onStatus(isRegister ? 'Registering on the server login screen…' : 'Logging in on the server login screen…')
  }

  client.on('show_dialog', handleDialog)
  return () => client.removeListener('show_dialog', handleDialog)
}

module.exports = { attachPreJoinLogin }
