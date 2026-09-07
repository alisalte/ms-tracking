# Known Limitations

## MD300 / media

- Native A9A dialback live video is not reliable on MD300; live path is AB2 + MediaMTX + HLS (`docs/implementation/MDVR_LIVE_VIDEO.md`).
- AB4 playback publishes to `<camera key>/pb`, not the live key. Using the live key shows live video instead of the clip.
- HEVC on some cameras is transcoded to H.264 in MediaMTX (~5–10 s before HLS is ready).
- Alarm evidence (DMS JPEG + clip) is loaded only after the operator asks; it is not auto-fetched when the alarm is raised.
- Manual photo capture from the alarm drawer (`D03`) happens after the event, not at the DMS trigger instant.
- C90 configures DMS alert volume and which behaviors fire; it does not define photo/video capture duration.
- Event 126 packets may include a `photoName`. If the device did not store that file, D00 fails.

## Platform vs device

Whether MD300 actually writes a snapshot and a short event clip at DMS time depends on device firmware/settings. The platform currently consumes files if they exist; it does not own a confirmed “on every DMS alarm, capture N-second driver clip” device policy.

## Changelog

- 2026-09-07: Initial limitations, including DMS evidence capture gap.
