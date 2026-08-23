#!/usr/bin/env node
/**
 * Stub ffmpeg for tests: ignores its arguments and copies stdin -> stdout.
 * Used via FFMPEG_BIN=<this file> so the media-path tests exercise the spawn /
 * pipe / broadcast wiring without a real ffmpeg install.
 */
process.stdin.on('data', (c) => {
  try {
    process.stdout.write(c);
  } catch {
    /* stdout closed */
  }
});
process.stdin.on('end', () => process.exit(0));
