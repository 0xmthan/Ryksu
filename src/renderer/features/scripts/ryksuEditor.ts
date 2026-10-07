import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete'
import { javascriptLanguage } from '@codemirror/lang-javascript'
import { syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { EditorView, hoverTooltip } from '@codemirror/view'
import { AUTOMATION_LABELS, AUTOMATIONS, SCRIPT_CALLS, type ScriptCall } from '../../../shared/scriptApi'

// The app's neutral greys with a sky accent, around One Dark's syntax colors.
const appTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', color: '#e5e5e5', fontSize: '12px' },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', lineHeight: '1.6' },
    '.cm-content': { caretColor: '#38bdf8' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#38bdf8' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(56, 189, 248, 0.2)',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#525252', borderRight: '1px solid #262626' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a3a3a3' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(56, 189, 248, 0.25)' },
    '.cm-foldPlaceholder': { backgroundColor: '#262626', border: 'none', color: '#a3a3a3' },
    '.cm-tooltip': {
      backgroundColor: '#171717',
      border: '1px solid #404040',
      borderRadius: '6px',
      color: '#d4d4d4',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(56, 189, 248, 0.2)',
      color: '#fff',
    },
    '.cm-completionDetail': { color: '#737373', fontStyle: 'normal' },
    '.cm-completionInfo': { maxWidth: '18rem', padding: '6px 8px' },
    '.cm-panels': { backgroundColor: '#171717', color: '#d4d4d4' },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid #262626' },
    '.cm-textfield': { backgroundColor: '#0a0a0a', border: '1px solid #404040', borderRadius: '4px' },
    '.cm-button': { backgroundImage: 'none', backgroundColor: '#262626', border: '1px solid #404040' },
    '.cm-searchMatch': { backgroundColor: 'rgba(250, 204, 21, 0.2)' },
    '.ryksu-doc': { padding: '6px 8px', maxWidth: '20rem', fontSize: '11px', lineHeight: '1.5' },
    '.ryksu-doc code': { display: 'block', marginBottom: '2px', color: '#bae6fd' },
  },
  { dark: true }
)

const describeCall = (call: ScriptCall) => (call.waits ? `${call.doc} Use it with await.` : call.doc)

const callCompletions: Completion[] = SCRIPT_CALLS.map((call) => ({
  label: call.name,
  type: 'method',
  detail: call.signature.slice(call.name.length),
  info: describeCall(call),
}))

const toggleCompletions: Completion[] = AUTOMATIONS.map((name) => ({
  label: name,
  type: 'constant',
  detail: AUTOMATION_LABELS[name],
}))

const topLevelCompletions: Completion[] = [
  {
    label: 'ryksu',
    type: 'variable',
    detail: 'the bot',
    info: 'Everything a script can do. Type ryksu. to see it.',
  },
  snippetCompletion('async function start() {\n\t${}\n}', {
    label: 'start',
    type: 'function',
    detail: 'runs when turned on',
  }),
  snippetCompletion('async function stop() {\n\t${}\n}', {
    label: 'stop',
    type: 'function',
    detail: 'runs when turned off',
  }),
]

const ryksuCompletions = (context: CompletionContext): CompletionResult | null => {
  const member = context.matchBefore(/\bryksu\.\w*$/)
  if (member) {
    return { from: member.from + 'ryksu.'.length, options: callCompletions, validFor: /^\w*$/ }
  }
  const toggle = context.matchBefore(/\bsetToggle\(\s*['"`]\w*$/)
  if (toggle) {
    return {
      from: toggle.from + toggle.text.search(/['"`]/) + 1,
      options: toggleCompletions,
      validFor: /^\w*$/,
    }
  }
  const word = context.matchBefore(/(?<![.\w])\w+$/)
  if (!word && !context.explicit) return null
  return { from: word?.from ?? context.pos, options: topLevelCompletions, validFor: /^\w*$/ }
}

// Hovering a ryksu call shows how to call it and what it does.
const ryksuHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos)
  for (const match of line.text.matchAll(/\bryksu\.(\w+)/g)) {
    const from = line.from + match.index! + 'ryksu.'.length
    const to = from + match[1].length
    const call = SCRIPT_CALLS.find((candidate) => candidate.name === match[1])
    if (!call || pos < from || pos > to) continue
    return {
      pos: from,
      end: to,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'ryksu-doc'
        const signature = document.createElement('code')
        signature.textContent = `${call.waits ? 'await ' : ''}ryksu.${call.signature}`
        dom.append(signature, describeCall(call))
        return { dom }
      },
    }
  }
  return null
})

// The editor's look and what it knows about scripts.
export const ryksuEditor = [
  appTheme,
  syntaxHighlighting(oneDarkHighlightStyle),
  javascriptLanguage.data.of({ autocomplete: ryksuCompletions }),
  ryksuHover,
]
