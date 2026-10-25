/** The audio Tacet can import. The one list the dialog, the drop zone and the IPC schema share. */
export const IMPORT_EXTENSIONS = ['wav', 'm4a', 'mp3'] as const

const EXTENSION = new RegExp(`\\.(${IMPORT_EXTENSIONS.join('|')})$`, 'i')

export const isImportableAudio = (name: string): boolean => EXTENSION.test(name)

/** ".wav, .m4a or .mp3", for messages. */
export const IMPORT_EXTENSIONS_LABEL = IMPORT_EXTENSIONS.map((e) => `.${e}`)
  .join(', ')
  .replace(/, ([^,]+)$/, ' or $1')
