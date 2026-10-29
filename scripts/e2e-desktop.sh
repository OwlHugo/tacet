#!/usr/bin/env bash
# End-to-end check of the desktop app on a real machine: records ~60 s with the microphone and the
# system audio fed from the two WAVs of a case (nothing plays on the speakers), then runs the whole
# pipeline (whisper.cpp + Ollama) and writes the Markdown. Fails when a saved track is more than a
# second shorter than the recording: past ~30 s macOS once slowed the capture clock (73 s saved as 48).
#   LOOPBACK=1 plays the other side on the speakers instead, to check the real system capture.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case_dir="$root/evals/cases/02-hiring-en"
out="${TACET_OUTPUT_DIR:-$(mktemp -d)/notes}"
seconds="${SECONDS_TO_RECORD:-60}"
mkdir -p "$out"

# The case is ~20 s: pad both tracks with silence so the fake devices run for the whole recording.
padded="$(mktemp -d)"
for t in me others; do
  ffmpeg -loglevel error -y -i "$case_dir/$t.wav" -af "apad=whole_dur=$((seconds + 5))" "$padded/$t.wav"
done

cd "$root/apps/desktop"
pnpm run build >/dev/null

player=""
fake_system="$padded/others.wav"
if [ "${LOOPBACK:-0}" = "1" ]; then
  fake_system=""
  if command -v afplay >/dev/null; then player="afplay"
  elif command -v paplay >/dev/null; then player="paplay"; fi
fi

TACET_OUTPUT_DIR="$out" TACET_AUTORECORD="$seconds" TACET_FAKE_MIC="$padded/me.wav" \
  TACET_FAKE_SYSTEM="$fake_system" TACET_HIDDEN=1 \
  npx electron . 2>&1 | tee "$out/app.log" &
app=$!

# Wait until capture is running, then play the other side of the call.
for _ in $(seq 1 60); do
  grep -q "\[tacet\] recording" "$out/app.log" 2>/dev/null && break
  sleep 0.5
done
if [ -n "$player" ]; then "$player" "$case_dir/others.wav" & fi
wait $app || true

echo
echo "notes folder: $out"
ls -1 "$out"
# Both tracks must reach the transcript: a line from each side of the call.
for who in Me Others; do
  grep -q "^\*\*[0-9:]* $who:\*\*" "$out"/*.md || { echo "no $who line in the notes" >&2; exit 1; }
done
# Every saved track lasts the whole recording.
shopt -s nullglob
latest="$(ls -td "$out"/.tacet/audio/*/ | head -1)"
wavs=("$latest"*.wav)
[ "${#wavs[@]}" -eq 2 ] || { echo "expected 2 saved tracks, found ${#wavs[@]}" >&2; exit 1; }
for wav in "${wavs[@]}"; do
  got="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")"
  awk -v g="$got" -v s="$seconds" 'BEGIN { exit !(g >= s - 1) }' ||
    { echo "$wav lasts ${got}s, the recording was ${seconds}s" >&2; exit 1; }
  echo "$(basename "$wav"): ${got}s of ${seconds}s"
done
