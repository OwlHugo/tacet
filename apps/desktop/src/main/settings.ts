import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Settings } from '../shared/ipc';

const file = () => join(app.getPath('userData'), 'settings.json');

export function defaults(): Settings {
  return {
    outputDir: join(app.getPath('documents'), 'Tacet'),
    whisperModel: 'base',
    language: 'auto',
    llmModel: 'qwen2.5:7b',
    shortcut: 'CommandOrControl+Shift+M',
    keepAudio: true,
  };
}

export function loadSettings(): Settings {
  const base = defaults();
  if (process.env.TACET_OUTPUT_DIR) base.outputDir = process.env.TACET_OUTPUT_DIR;
  if (!existsSync(file())) return base;
  return { ...base, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>) };
}

export function saveSettings(s: Settings): void {
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(file(), JSON.stringify(s, null, 2));
}
