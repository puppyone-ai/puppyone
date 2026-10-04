# Cloud Format Playback Samples

These samples contain two seconds of digital silence or a solid navy frame.
They contain no recorded voices, people or user files. FFmpeg is needed only
to regenerate them, not to run the acceptance tests.

Audio uses `anullsrc=r=44100:cl=mono`, duration 2 seconds, with the following
encoders: WAV `pcm_s16le`, MP3 `libmp3lame`, OGG `vorbis -strict experimental`, OPUS/WEBA
`libopus` (WEBA uses the WebM container), M4A/AAC `aac`, FLAC `flac`, and AIFF
`pcm_s16be`.

MP4, MOV and 3GP use `color=c=0x102a43:size=160x96:rate=10:duration=2`,
`libx264`, `yuv420p`, without audio. OGG uses stereo silence; other samples
may use mono or stereo silence. No OGV fixture has been generated.
The neighboring `samples/pane-contract.webm` supplies the VP8 baseline.
`navy.avif` is one 64x64 navy frame encoded with `libsvtav1` and `yuv420p`.

The acceptance runner compares the Chromium decoder's in-memory baseline
with the actual Cloud editor's signed HTTPS input. A decoder rejection is
recorded separately from a Cloud transport or renderer regression. MIME and
container recognition alone must not be described as playback acceptance.
