import { useState } from 'react'
import { audioFiles } from './format.ts'
import { api } from './platform.ts'

/** Drag a .wav/.m4a/.mp3 anywhere on the window. The overlay shows while a file is over it. */
export function useAudioDrop(onImported: (id: string) => void, onError: (message: string) => void) {
  const [over, setOver] = useState(false)
  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setOver(false)
      const [file] = audioFiles(e.dataTransfer.files)
      if (!file) return onError('Drop a .wav, .m4a or .mp3 file.')
      // A failed import is broadcast as the recorder's error state, which the record button shows.
      void api.importAudio(file).then(onImported, () => undefined)
    },
  }
  return { over, handlers }
}

export function ImportButton({
  disabled,
  onImported,
}: {
  disabled: boolean
  onImported: (id: string) => void
}) {
  return (
    <button
      type="button"
      className="import"
      disabled={disabled}
      // Failures show up as the recorder's error state, like a failed recording.
      onClick={() =>
        void api.importAudioDialog().then(
          (id) => id && onImported(id),
          () => undefined,
        )
      }
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
      <span>.wav · .m4a · .mp3, processed on this machine</span>
    </div>
  )
}
