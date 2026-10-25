#!/usr/bin/env node
// Builds the eval set from eval/scripts.json with macOS `say`. The generated audio is committed,
// so CI on Linux and Windows runs the same files without TTS.
//
// Every case has two tracks on a shared timeline, like a real call: me.wav (microphone) and
// others.wav (system audio), 16 kHz mono PCM so no decoder is needed in CI. Lines alternate between the tracks with a short gap.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = JSON.parse(readFileSync(join(root, 'eval', 'scripts.json'), 'utf8'));
const out = join(root, 'eval', 'dataset');
const GAP = 0.6;

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const seconds = (file) => Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).trim());

for (const c of scripts) {
  const dir = join(out, c.id);
  const work = join(tmpdir(), `tacet-eval-${c.id}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  mkdirSync(dir, { recursive: true });

  let t = 0.5;
  const placed = { Me: [], Others: [] };
  const reference = [];
  c.lines.forEach((line, i) => {
    const aiff = join(work, `${i}.aiff`);
    sh('say', ['-v', c.voices[line.speaker], '-r', String(c.rate ?? 185), '-o', aiff, line.text]);
    const wav = join(work, `${i}.wav`);
    sh('ffmpeg', ['-loglevel', 'error', '-y', '-i', aiff, '-ar', '16000', '-ac', '1', wav]);
    placed[line.speaker].push({ wav, at: t });
    reference.push({ ...line, start: Math.round(t * 100) / 100 });
    t += seconds(wav) + GAP;
  });
  const total = t + 0.5;

  for (const [speaker, file] of [
    ['Me', 'me.wav'],
    ['Others', 'others.wav'],
  ]) {
    const parts = placed[speaker];
    const args = ['-loglevel', 'error', '-y', '-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=16000:cl=mono'];
    parts.forEach((p) => args.push('-i', p.wav));
    const delays = parts.map((p, i) => `[${i + 1}]adelay=${Math.round(p.at * 1000)}:all=1[d${i}]`);
    const mix = `[0]${parts.map((_, i) => `[d${i}]`).join('')}amix=inputs=${parts.length + 1}:normalize=0,atrim=0:${total}[out]`;
    args.push('-filter_complex', [...delays, mix].join(';'), '-map', '[out]', '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', join(dir, file));
    sh('ffmpeg', args);
  }

  writeFileSync(
    join(dir, 'case.json'),
    JSON.stringify(
      {
        id: c.id,
        title: c.title,
        language: c.language,
        tracks: [
          { file: 'me.wav', speaker: 'Me' },
          { file: 'others.wav', speaker: 'Others' },
        ],
        reference,
        expected_actions: c.expected_actions,
      },
      null,
      2,
    ) + '\n',
  );
  rmSync(work, { recursive: true, force: true });
  console.log(`${c.id}: ${total.toFixed(1)}s`);
}
