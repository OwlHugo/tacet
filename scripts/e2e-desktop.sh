#!/usr/bin/env bash
# End-to-end check of the desktop app on a real machine: records ~22 s with the microphone fed from
# a WAV while the other side of the call plays on the speakers (captured by system loopback), then
# runs the whole pipeline (whisper.cpp + Ollama) and writes the Markdown.
#   PLAYBACK=0 skips the speaker playback (system track stays silent).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case_dir="$root/evals/cases/02-hiring-en"
out="${TACET_OUTPUT_DIR:-$(mktemp -d)/notes}"
seconds="${SECONDS_TO_RECORD:-22}"
mkdir -p "$out"

cd "$root/apps/desktop"
pnpm run build >/dev/null

player=""
if [ "${PLAYBACK:-1}" = "0" ]; then :
elif command -v afplay >/dev/null; then player="afplay"
elif command -v paplay >/dev/null; then player="paplay"; fi

TACET_OUTPUT_DIR="$out" TACET_AUTORECORD="$seconds" TACET_FAKE_MIC="$case_dir/me.wav" TACET_HIDDEN=1 \
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
