#!/usr/bin/env bash
# End-to-end check of the desktop app on a real machine: records ~22 s with the microphone and the
# system audio fed from the two WAVs of a case (nothing plays on the speakers), then runs the whole
# pipeline (whisper.cpp + Ollama) and writes the Markdown.
#   LOOPBACK=1 plays the other side on the speakers instead, to check the real system capture.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case_dir="$root/evals/cases/02-hiring-en"
out="${TACET_OUTPUT_DIR:-$(mktemp -d)/notes}"
seconds="${SECONDS_TO_RECORD:-22}"
mkdir -p "$out"

cd "$root/apps/desktop"
pnpm run build >/dev/null

player=""
fake_system="$case_dir/others.wav"
if [ "${LOOPBACK:-0}" = "1" ]; then
  fake_system=""
  if command -v afplay >/dev/null; then player="afplay"
  elif command -v paplay >/dev/null; then player="paplay"; fi
fi

TACET_OUTPUT_DIR="$out" TACET_AUTORECORD="$seconds" TACET_FAKE_MIC="$case_dir/me.wav" \
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
