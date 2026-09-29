#!/bin/bash
# Assemble Yaad demo video from screenshots + pre-rendered narration.
# Requires: shots/shot01.png ... shot08.png (1280px+ wide). Exits 1 listing missing shots.
set -e
D=~/workspace/yaad/demo-video
S=$D/shots; A=$D/audio; T=$D/tmp
FONTB=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
FONTN=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
mkdir -p "$T"

# 0. Check shots
missing=0
for n in 01 02 03 04 05 06 07 08; do
  [ -f "$S/shot$n.png" ] || { echo "MISSING: shots/shot$n.png"; missing=1; }
done
[ $missing -eq 0 ] || { echo "Add the missing screenshots, then re-run."; exit 1; }

# 1. Measure narration durations
for i in 1 2 3 4 5 6; do
  eval "D$i=$(ffprobe -v error -show_entries format=duration -of csv=p=0 $A/seg$i.mp3)"
done
TOTAL=$(awk "BEGIN{print 3 + $D1 + $D2 + $D3 + $D4 + $D5 + $D6 + 5}")
echo "Narration total: $(awk "BEGIN{print $D1+$D2+$D3+$D4+$D5+$D6}")s | Video total: ${TOTAL}s"

# 2. Slide plan: shot|duration
# seg1->shot01 (hero), seg2->shot02 (Mumbai->Delhi chat), seg3->shot03+shot05 (dream + skill drafts),
# seg4->shot06 (run_code), seg5->shot08+shot07 (research + graph), seg6->shot01 reuse w/ end
S3A=$(awk "BEGIN{print $D3*0.55}"); S3B=$(awk "BEGIN{print $D3-$S3A}")
S5A=$(awk "BEGIN{print $D5*0.55}"); S5B=$(awk "BEGIN{print $D5-$S5A}")
PLAN="01|$D1 02|$D2 03|$S3A 05|$S3B 06|$D4 08|$S5A 07|$S5B 04|$D6"

# 3. Build slides with subtle alternating zoom/pan
i=0
for item in $PLAN; do
  shot=${item%%|*}; dur=${item##*|}; i=$((i+1))
  FR=$(awk "BEGIN{print int($dur*25)}")
  if [ $((i % 2)) -eq 0 ]; then
    ZF="z='1+0.09*on/$FR':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"   # zoom in
  else
    ZF="z=1.06:x='(iw-iw/zoom)*on/$FR':y='ih/2-(ih/zoom/2)'"            # pan right
  fi
  ffmpeg -y -v error -loop 1 -framerate 25 -i "$S/shot$shot.png" \
    -vf "scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,zoompan=$ZF:d=$FR:s=1280x720:fps=25" \
    -frames:v $FR -c:v libx264 -preset medium -pix_fmt yuv420p -t "$dur" "$T/slide$(printf %02d $i).mp4"
  echo "slide $i (shot$shot, ${dur}s) done"
done

# 4. Title card (3s) + end card (5s)
printf 'Yaad' > "$T/t1.txt"
printf 'The AI that never forgets' > "$T/t2.txt"
printf 'Try the live demo' > "$T/e1.txt"
printf 'github.com/devilking7x/yaad' > "$T/e2.txt"
ffmpeg -y -v error -f lavfi -i color=c=0x0b0b10:s=1280x720:r=25:d=3 \
  -vf "drawtext=fontfile=$FONTB:textfile=$T/t1.txt:fontsize=88:fontcolor=0xD4AF37:x=(w-text_w)/2:y=(h-text_h)/2-60,drawtext=fontfile=$FONTN:textfile=$T/t2.txt:fontsize=38:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+60" \
  -c:v libx264 -preset medium -pix_fmt yuv420p -t 3 "$T/title.mp4"
ffmpeg -y -v error -f lavfi -i color=c=0x0b0b10:s=1280x720:r=25:d=5 \
  -vf "drawtext=fontfile=$FONTB:textfile=$T/e1.txt:fontsize=64:fontcolor=0xD4AF37:x=(w-text_w)/2:y=(h-text_h)/2-50,drawtext=fontfile=$FONTN:textfile=$T/e2.txt:fontsize=30:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+40" \
  -c:v libx264 -preset medium -pix_fmt yuv420p -t 5 "$T/end.mp4"

# 5. Concat video
{ echo "file '$T/title.mp4'"; for k in $(seq 1 8); do echo "file '$T/slide$(printf %02d $k).mp4'"; done; echo "file '$T/end.mp4'"; } > "$T/list.txt"
ffmpeg -y -v error -f concat -safe 0 -i "$T/list.txt" -c copy "$T/body.mp4"

# 6. Concat + pad narration to full length
ffmpeg -y -v error -i "$A/seg1.mp3" -i "$A/seg2.mp3" -i "$A/seg3.mp3" -i "$A/seg4.mp3" -i "$A/seg5.mp3" -i "$A/seg6.mp3" \
  -filter_complex "[0:a][1:a][2:a][3:a][4:a][5:a]concat=n=6:v=0:a=1,apad=whole_dur=$TOTAL[a]" -map "[a]" -c:a aac -b:a 128k "$T/narr_full.m4a"

# 7. Mux
ffmpeg -y -v error -i "$T/body.mp4" -i "$T/narr_full.m4a" -c:v copy -c:a aac -b:a 128k -movflags +faststart "$D/yaad-demo.mp4"

# 8. Verify
echo "--- VERIFY ---"
VDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$D/yaad-demo.mp4")
VSTREAMS=$(ffprobe -v error -show_entries stream=codec_type -of csv=p=0 "$D/yaad-demo.mp4" | tr '\n' ' ')
SIZE=$(du -h "$D/yaad-demo.mp4" | cut -f1)
echo "duration: ${VDUR}s | streams: $VSTREAMS | size: $SIZE"
awk "BEGIN{exit !( $VDUR >= 90 && $VDUR <= 210 )}" && echo "DURATION OK (1:30-3:30)" || { echo "DURATION FAIL"; exit 1; }
echo "$VSTREAMS" | grep -q video && echo "$VSTREAMS" | grep -q audio && echo "STREAMS OK" || { echo "STREAMS FAIL"; exit 1; }
MID=$(awk "BEGIN{print $VDUR/2}"); ENDF=$(awk "BEGIN{print $VDUR-2}")
ffmpeg -y -v error -ss 1 -i "$D/yaad-demo.mp4" -frames:v 1 "$T/check_start.png"
ffmpeg -y -v error -ss "$MID" -i "$D/yaad-demo.mp4" -frames:v 1 "$T/check_mid.png"
ffmpeg -y -v error -ss "$ENDF" -i "$D/yaad-demo.mp4" -frames:v 1 "$T/check_end.png"
echo "frames extracted to $T/check_{start,mid,end}.png"
echo "DONE: $D/yaad-demo.mp4"
