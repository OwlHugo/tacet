/**
 * Download a prebuilt whisper.cpp into resources/bin so electron-builder ships it.
 * macOS has no official prebuilt CLI: the app uses Homebrew's whisper-cli or TACET_WHISPER_BIN.
 * Windows and Linux get the official release binaries.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

const TAG = 'b5454'
const OUT = join(import.meta.dirname, '..', 'resources', 'bin')
const ASSETS: Readonly<Record<string, string>> = {
  'win32-x64': 'whisper-bin-x64.zip',
  'win32-arm64': 'whisper-bin-win-cpu-arm64.zip',
  'linux-x64': 'whisper-bin-ubuntu-x64.tar.gz',
  'linux-arm64': 'whisper-bin-ubuntu-arm64.tar.gz',
}
const BINARY = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'
const KEEP = /^(whisper-cli(\.exe)?|.*\.(dll|so(\.\d+)*)|LICENSE)$/
// Windows' own bsdtar reads .zip; the GNU tar that Git Bash puts first on PATH reads neither .zip nor
// "C:\..." (it takes "C:" for a remote host).
function tar(): string {
  if (process.platform !== 'win32') return 'tar'
  const root = process.env['SystemRoot']
  if (root === undefined) throw new Error('SystemRoot is not set: cannot find Windows tar.exe')
  return join(root, 'System32', 'tar.exe')
}

/** The folder inside the extracted archive that holds whisper-cli. */
function folderWithBinary(dir: string): string | undefined {
  const entries = readdirSync(dir, { withFileTypes: true })
  if (entries.some((e) => e.isFile() && e.name === BINARY)) return dir
  for (const e of entries.filter((x) => x.isDirectory())) {
    const found = folderWithBinary(join(dir, e.name))
    if (found) return found
  }
  return undefined
}

mkdirSync(OUT, { recursive: true })
const asset = ASSETS[`${process.platform}-${process.arch}`]
if (!asset) {
  writeFileSync(
    join(OUT, 'README.txt'),
    'macOS uses whisper-cli from Homebrew (brew install whisper-cpp) or TACET_WHISPER_BIN.\n',
  )
  console.log(`[fetch-whisper] no prebuilt for ${process.platform}-${process.arch}, skipping`)
} else if (existsSync(join(OUT, BINARY))) {
  console.log('[fetch-whisper] already present')
} else {
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${asset}`
  const work = join(tmpdir(), `tacet-whisper-${Date.now()}`)
  mkdirSync(work, { recursive: true })
  console.log(`[fetch-whisper] ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`)
  writeFileSync(join(work, asset), Buffer.from(await res.arrayBuffer()))
  execFileSync(tar(), ['-xf', asset], { cwd: work })
  const bin = folderWithBinary(work)
  if (!bin) throw new Error(`${BINARY} not found in ${asset}`)
  // The Linux archive ships libfoo.so -> libfoo.so.1 symlinks: copy what each one points to, as a file.
  // Only targets inside the archive, and only files: anything else is a broken release, so stop.
  // Everything is checked before the first copy, so a bad release never leaves a half-filled bin/
  // that the next run would take as "already present".
  const root = realpathSync(work)
  const files = readdirSync(bin)
    .filter((n) => KEEP.test(n))
    .map((f) => ({ f, src: realpathSync(join(bin, f)) }))
  for (const { f, src } of files)
    if (!src.startsWith(root + sep) || !statSync(src).isFile())
      throw new Error(`${asset}: ${f} does not point to a file inside the archive (${src})`)
  for (const { f, src } of files) copyFileSync(src, join(OUT, f))
  rmSync(work, { recursive: true, force: true })
  console.log(`[fetch-whisper] installed into ${OUT}`)
}
