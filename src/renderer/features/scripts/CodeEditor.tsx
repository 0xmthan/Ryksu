import React, { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { indentWithTab } from '@codemirror/commands'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { ryksuEditor } from './ryksuEditor'

type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  // Cmd/Ctrl+S.
  onSave: () => void
  label: string
}

// A JavaScript editor (CodeMirror) with syntax colors, and completions and hover help for the ryksu API.
// `value` from outside replaces what's shown, such as when another script is picked.
const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, onSave, label }) => {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const callbacks = useRef({ onChange, onSave })
  callbacks.current = { onChange, onSave }

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                callbacks.current.onSave()
                return true
              },
            },
          ]),
          javascript(),
          ryksuEditor,
          EditorView.contentAttributes.of({ 'aria-label': label }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
          }),
        ],
      }),
    })
    view.current = editor
    return () => {
      editor.destroy()
      view.current = null
    }
    // Built once; the effect below keeps the text in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
    }
  }, [value])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden bg-neutral-950/60" />
}

export default CodeEditor
