import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

function onPath(name: string): string | undefined {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exe(name));
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export interface ResolveOptions {
  /** Directories with a bundled whisper.cpp build (the desktop app passes its resources folder). */
  bundledDirs?: string[];
}

/**
 * Find a whisper.cpp CLI. Order: $TACET_WHISPER_BIN, Homebrew on macOS, bundled build, PATH.
 */
export function resolveWhisperBinary(opts: ResolveOptions = {}): string {
  const fromEnv = process.env.TACET_WHISPER_BIN;
  if (fromEnv) {
    if (!existsSync(fromEnv)) throw new Error(`TACET_WHISPER_BIN points to a missing file: ${fromEnv}`);
    return fromEnv;
  }
  const candidates: string[] = [];
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli');
  for (const dir of opts.bundledDirs ?? []) candidates.push(join(dir, exe('whisper-cli')));
  const found = candidates.find((c) => existsSync(c)) ?? onPath('whisper-cli');
  if (!found) {
    throw new Error(
      'whisper.cpp not found. Install it (macOS: `brew install whisper-cpp`) or set TACET_WHISPER_BIN to a whisper-cli binary.',
    );
  }
  return found;
}

export function resolveFfmpeg(): string | undefined {
  const fromEnv = process.env.TACET_FFMPEG_BIN;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  if (process.platform === 'darwin') {
    for (const c of ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']) if (existsSync(c)) return c;
  }
  return onPath('ffmpeg');
}
