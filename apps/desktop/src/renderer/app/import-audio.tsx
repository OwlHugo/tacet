import { useRef, useState } from 'react'
import { IMPORT_EXTENSIONS_LABEL } from '../../shared/audio-files.ts'
import { audioFiles } from './format.ts'
import { api } from './platform.ts'

/** Outcome of an import the user started: the new meeting id, or the error it failed with. */
export interface ImportCallbacks {
  readonly onStart: () => void
  readonly onImported: (id: string) => void
  readonly onError: (e: unknown) => void
}

/**
 * Drag a file anywhere on the window. dragenter/dragleave fire for every child the pointer crosses,
 * so the overlay counts them and hides when the count is back to zero (left the window) or on drop.
 */
export function useAudioDrop(cb: ImportCallbacks) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  const reset = () => {
    depth.current = 0
    setOver(false)
  }
  const handlers = {
    onDragEnter: (e: React.DragEvent) => {
      e.preventDefault()
      depth.current += 1
      setOver(true)
    },
    onDragOver: (e: React.DragEvent) => e.preventDefault(),
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      reset()
      const [file] = audioFiles(e.dataTransfer.files)
      cb.onStart()
      if (!file) return cb.onError(new Error(`Drop a ${IMPORT_EXTENSIONS_LABEL} file.`))
      void api.importAudio(file).then(cb.onImported, cb.onError)
    },
  }
  return { over, handlers }
}

export function ImportButton({ disabled, ...cb }: { disabled: boolean } & ImportCallbacks) {
  return (
    <button
      type="button"
      className="import"
      disabled={disabled}
      onClick={() => {
        cb.onStart()
        void api.importAudioDialog().then((id) => id && cb.onImported(id), cb.onError)
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Import audio
    </button>
  )
}

export function DropOverlay() {
  return (
    <div className="drop">
      <p>Drop audio to transcribe</p>
      <span>{IMPORT_EXTENSIONS_LABEL.replace(/,| or/g, ' ·')}, processed on this machine</span>
    </div>
  )
}
