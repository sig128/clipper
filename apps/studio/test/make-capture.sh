#!/bin/sh
# Builds the 3-minute test capture the studio tests use: calm footage, a loud
# colorful burst at 0:55, a letterboxed "cutscene" from 1:40 to 2:10 and a loud
# white flash at 2:30. Run from this folder: sh make-capture.sh
ffmpeg -v error -y \
 -f lavfi -i "color=c=0x1d2433:s=1280x720:d=55:r=30" -f lavfi -i "testsrc2=s=1280x720:d=7:r=30" \
 -f lavfi -i "color=c=0x263044:s=1280x720:d=38:r=30" -f lavfi -i "color=c=0x5a4636:s=1280x720:d=30:r=30" \
 -f lavfi -i "color=c=0x1d2433:s=1280x720:d=20:r=30" -f lavfi -i "color=c=white:s=1280x720:d=6:r=30" \
 -f lavfi -i "color=c=0x22283a:s=1280x720:d=24:r=30" \
 -f lavfi -i "anoisesrc=d=55:c=pink:a=0.02:r=48000" -f lavfi -i "sine=f=880:d=7:r=48000" \
 -f lavfi -i "anoisesrc=d=88:c=pink:a=0.02:r=48000" -f lavfi -i "anoisesrc=d=6:c=white:a=0.7:r=48000" \
 -f lavfi -i "anoisesrc=d=24:c=pink:a=0.02:r=48000" \
 -filter_complex "[0:v]drawbox=x=200:y=300:w=120:h=60:color=0x8899aa:t=fill[v0];[1:v]null[v1];[2:v]drawbox=x=600:y=300:w=120:h=60:color=0x8899aa:t=fill[v2];[3:v]crop=1280:540:0:90,pad=1280:720:0:90:black,drawbox=x=500:y=300:w=200:h=120:color=0xd0a070:t=fill[v3];[4:v]null[v4];[5:v]null[v5];[6:v]null[v6];[v0][v1][v2][v3][v4][v5][v6]concat=n=7:v=1:a=0[v];[8:a]volume=0.8[a1];[7:a][a1][9:a][10:a][11:a]concat=n=5:v=0:a=1[a]" \
 -map "[v]" -map "[a]" -c:v libvpx -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus -b:a 64k gta_test_capture.webm
