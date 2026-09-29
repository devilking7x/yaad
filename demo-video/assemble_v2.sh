#!/bin/bash
# Yaad demo video v2 — fixed A/V sync + 1080p high quality.
# Fix vs v1: narration was starting during the 3s title card, so voice ran
# 3 seconds ahead of the visuals. Now 3s of silence is prepended to the
# narration so each segment starts exactly when its slide starts.
set -e
D=~/workspace/yaad/demo-video
S=$D/shots; A=$D/audio; T=$D/tmp2
FONTB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
FONTN=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
mkdir -p "$T"

for i in 1 2 3 4 5 6; do
  eval "D$i=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $A/seg$i.mp3)"
done
TOTAL=$(awk "BEGIN{print 3 + $D1 + $D2 + $D3 + $D4 + $D5 + $D6 + 5}")
echo "Narration total: $(awk "BEGIN{print $D1+$D2+$D3+$D4+$D5+$D6}")s | Video total: ${TOTAL}s"

S3A=$(awk "BEGIN{print $D3*0.55}"); S3B=$(awk "BEGIN{print $D3-$S3A}")
S5A=$(awk "BEGIN{print $D5*0.55}"); S5B=$(awk "BEGIN{print $D5-$S5A}")
PLAN="01|$D1 02|$D2 03|$S3A 05|$S3B 06|$D4 08|$S5A 07|$S5B 04|$D6"

# Slides: upscale source to 4K-ish canvas, then smooth zoom/pan downsampled to 1080p
i=0
for item in $PLAN; do
  shot=${item%%|*}; dur=${item##*|}; i=$((i+1))
  FR=$(awk "BEGIN{print int($dur*30)}")
  if [ $((i % 2)) -eq 0 ]; then
    ZF="z='1+0.08*on/$FR':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
  else
    ZF="z=1.05:x='(iw-iw/zoom)*on/$FR':y='ih/2-(ih/zoom/2)'"
  fi
  ffmpeg -y -v error -loop 1 -framerate 30 -i "$S/shot$shot.png" \
    -vf "scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,zoompan=$ZF:d=$FR:s=1920x1080:fps=30" \
    -frames:v $FR -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -t "$dur" "$T/slide$(printf %02d $i).mp4"
  echo "slide $i (shot$shot, ${dur}s) done"
done

printf 'Yaad' > "$T/t1.txt"
printf 'The AI that never forgets' > "$T/t2.txt"
printf 'Try the live demo' > "$T/e1.txt"
printf 'github.com/devilking7x/yaad' > "$T/e2.txt"
ffmpeg -y -v error -f lavfi -i color=c=0x0b0b10:s=1920x1080:r=30:d=3 \
  -vf "drawtext=fontfile=$FONTB:textfile=$T/t1.txt:fontsize=132:fontcolor=0xD4AF37:x=(w-text_w)/2:y=(h-text_h)/2-90,drawtext=fontfile=$FONTN:textfile=$T/t2.txt:fontsize=56:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+90" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -t 3 "$T/title.mp4"
ffmpeg -y -v error -f lavfi -i color=c=0x0b0b10:s=1920x1080:r=30:d=5 \
  -vf "drawtext=fontfile=$FONTB:textfile=$T/e1.txt:fontsize=96:fontcolor=0xD4AF37:x=(w-text_w)/2:y=(h-text_h)/2-75,drawtext=fontfile=$FONTN:textfile=$T/e2.txt:fontsize=44:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+60" \
  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p -t 5 "$T/end.mp4"

{ echo "file '$T/title.mp4'"; for k in $(seq 1 8); do echo "file '$T/slide$(printf %02d $k).mp4'"; done; echo "file '$T/end.mp4'"; } > "$T/list.txt"
ffmpeg -y -v error -f concat -safe 0 -i "$T/list.txt" -c copy "$T/body.mp4"

# Narration with 3s leading silence -> segment boundaries align exactly with slide boundaries
ffmpeg -y -v error -i "$A/seg1.mp3" -i "$A/seg2.mp3" -i "$A/seg3.mp3" -i "$A/seg4.mp3" -i "$A/seg5.mp3" -i "$A/seg6.mp3" \
  -filter_complex "[0:a][1:a][2:a][3:a][4:a][5:a]concat=n=6:v=0:a=1,adelay=3000:all=1,apad=whole_dur=$TOTAL[a]" \
  -map "[a]" -c:a aac -b:a 160k "$T/narr_full.m4a"

ffmpeg -y -v error -i "$T/body.mp4" -i "$T/narr_full.m4a" -c:v copy -c:a aac -b:a 160k -movflags +faststart "$D/yaad-demo-v2.mp4"

echo "--- VERIFY ---"
VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$D/yaad-demo-v2.mp4")
VRES=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$D/yaad-demo-v2.mp4" | tr '\n' 'x')
SIZE=$(du -h "$D/yaad-demo-v2.mp4" | cut -f1)
echo "duration: ${VDUR}s | res: $VRES | size: $SIZE"
# Sync spot-check: audio energy should be ~silent during title (t=1) and active during slide1 (t=10)
for t in 1 10 60 120; do
  e=$(ffmpeg -v error -ss $t -t 2 -i "$D/yaad-demo-v2.mp4" -map a -af astats=metadata=1 -f null - 2>&1 | grep -oP 'RMS level dB:\s*\K-?[0-9.]+' | head -1)
  echo "t=${t}s audio RMS: ${e:-n/a} dB"
done
MID=$(awk "BEGIN{print $VDUR/2}"); ENDF=$(awk "BEGIN{print $VDUR-2}")
ffmpeg -y -v error -ss 10 -i "$D/yaad-demo-v2.mp4" -frames:v 1 "$T/check_slide1.png"
ffmpeg -y -v error -ss "$MID" -i "$D/yaad-demo-v2.mp4" -frames:v 1 "$T/check_mid.png"
ffmpeg -y -v error -ss "$ENDF" -i "$D/yaad-demo-v2.mp4" -frames:v 1 "$T/check_end.png"
echo "DONE: $D/yaad-demo-v2.mp4"
