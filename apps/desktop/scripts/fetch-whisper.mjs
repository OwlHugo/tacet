#!/usr/bin/env node
// Download a prebuilt whisper.cpp for the current platform into resources/bin so electron-builder ships it.
// macOS has no official prebuilt CLI: the app uses Homebrew's whisper-cli (`brew install whisper-cpp`)
// or TACET_WHISPER_BIN. Windows and Linux get the official release binaries.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = process.env.WHISPER_CPP_TAG ?? 'b5454';
const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'resources', 'bin');
mkdirSync(out, { recursive: true });

const assets = {
  'win32-x64': 'whisper-bin-x64.zip',
  'win32-arm64': 'whisper-bin-win-cpu-arm64.zip',
  'linux-x64': 'whisper-bin-ubuntu-x64.tar.gz',
  'linux-arm64': 'whisper-bin-ubuntu-arm64.tar.gz',
};
const key = `${process.platform}-${process.arch}`;
const asset = assets[key];
if (!asset) {
  writeFileSync(join(out, 'README.txt'), 'macOS uses whisper-cli from Homebrew (brew install whisper-cpp) or TACET_WHISPER_BIN.\n');
  console.log(`[fetch-whisper] no prebuilt for ${key}, skipping`);
  process.exit(0);
}
if (existsSync(join(out, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'))) {
  console.log('[fetch-whisper] already present');
  process.exit(0);
}
const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${asset}`;
const work = join(tmpdir(), `tacet-whisper-${Date.now()}`);
mkdirSync(work, { recursive: true });
const archive = join(work, asset);
console.log(`[fetch-whisper] ${url}`);
const res = await fetch(url);
if (!res.ok) throw new Error(`download failed: ${res.status}`);
writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
execFileSync('tar', ['-xf', archive, '-C', work]);

// Find the folder that holds whisper-cli and copy the binary with its shared libraries.
function find(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const r = find(p);
      if (r) return r;
    } else if (/^whisper-cli(\.exe)?$/.test(e.name)) return dir;
  }
}
const bin = find(work);
if (!bin) throw new Error('whisper-cli not found in archive');
const keep = /^(whisper-cli(\.exe)?|.*\.(dll|so(\.\d+)*)|LICENSE)$/;
for (const f of readdirSync(bin)) if (keep.test(f)) cpSync(join(bin, f), join(out, f), { dereference: true });
rmSync(work, { recursive: true, force: true });
console.log(`[fetch-whisper] installed into ${out}`);
