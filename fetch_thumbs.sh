#!/bin/sh
# Saves YouTube thumbnails locally so /videos/ makes zero external requests.
# Safe to run from anywhere — it cds to its own folder first.

cd "$(dirname "$0")" || { echo "could not cd to script folder"; exit 1; }
echo "working in: $(pwd)"

mkdir -p assets/thumbs || { echo "could not create assets/thumbs"; exit 1; }

ok=0
fail=0
for id in xYI5_1Sp0NA lUun8i7JH1U 3kGgY0xltvc CF7HHaT03rM _vNsSAMYqks mhxor1t-iik PyplFYsNzXg EAtYpckRLwo At2Ikw3Cg2c
do
  out="assets/thumbs/$id.jpg"
  curl -fsSL -o "$out" "https://img.youtube.com/vi/$id/maxresdefault.jpg" 2>/dev/null
  size=$(wc -c < "$out" 2>/dev/null || echo 0)
  if [ "$size" -lt 5000 ]; then
    curl -fsSL -o "$out" "https://img.youtube.com/vi/$id/hqdefault.jpg" 2>/dev/null
    size=$(wc -c < "$out" 2>/dev/null || echo 0)
  fi
  if [ "$size" -lt 1000 ]; then
    echo "  FAIL  $id"
    rm -f "$out"
    fail=$((fail+1))
  else
    echo "  ok    $id  ($size bytes)"
    ok=$((ok+1))
  fi
done

echo ""
echo "$ok downloaded, $fail failed  ->  $(pwd)/assets/thumbs"
