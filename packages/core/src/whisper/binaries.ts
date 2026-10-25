import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface FindBinaryOptions {
  /** Explicit path from the app config ($TACET_WHISPER_BIN). Must exist when given. */
  readonly explicit?: string | undefined
  /** Folders with a bundled build (the desktop app passes its resources folder). */
  readonly bundledDirs?: readonly string[]
  /** The PATH to search last. */
  readonly searchPath: string
  readonly platform: NodeJS.Platform
}

const exe = (name: string, platform: NodeJS.Platform) =>
  platform === 'win32' ? `${name}.exe` : name

const HOMEBREW = ['/opt/homebrew/bin', '/usr/local/bin']

function find(
  name: string,
  opts: FindBinaryOptions,
  extraDirs: readonly string[],
): string | undefined {
  if (opts.explicit) {
    if (!existsSync(opts.explicit)) throw new Error(`${name} not found at ${opts.explicit}`)
    return opts.explicit
  }
  const dirs = [
    ...(opts.platform === 'darwin' ? HOMEBREW : []),
    ...extraDirs,
    ...opts.searchPath.split(delimiter).filter(Boolean),
  ]
  return dirs.map((d) => join(d, exe(name, opts.platform))).find((p) => existsSync(p))
}

/** whisper.cpp CLI, or undefined. Order: explicit, Homebrew on macOS, bundled build, PATH. */
export function findWhisperOrUndefined(opts: FindBinaryOptions): string | undefined {
  return find('whisper-cli', opts, opts.bundledDirs ?? [])
}

/** whisper.cpp CLI; throws with install instructions when there is none. */
export function findWhisper(opts: FindBinaryOptions): string {
  const found = findWhisperOrUndefined(opts)
  if (!found) {
    throw new Error(
      'whisper.cpp not found. Install it (macOS: `brew install whisper-cpp`) or set TACET_WHISPER_BIN to a whisper-cli binary.',
    )
  }
  return found
}

/** ffmpeg is optional: only needed to read formats whisper.cpp cannot (m4a, webm, mp4). */
export function findFfmpeg(opts: FindBinaryOptions): string | undefined {
  return find('ffmpeg', opts, [])
}
