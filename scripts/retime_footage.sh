#!/usr/bin/env bash
# Converts a slow-clock screen capture of Live Motion into real-time 60 fps footage.
# The app ran with its clock slowed to RATE (e.g. 0.05), so each real second holds 1/RATE frames of motion.
# usage: scripts/retime_footage.sh <capture.mkv> <out.mp4> <rate>
set -euo pipefail
in=$1; out=$2; rate=$3
nice -n 19 ffmpeg -nostdin -loglevel error -y -i "$in" \
  -vf "mpdecimate=hi=1:lo=1:frac=0:max=0,setpts=PTS*${rate},fps=60" \
  -c:v libx264 -threads 1 -preset slow -crf 14 -pix_fmt yuv420p -movflags +faststart -an "$out"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$out"
