# Video download helpers

AuraView bundles the pinned Windows x64 tools described in `scripts/video-tools.json`.
Run `npm run prepare:video-tools` to fetch them from their official GitHub releases.
The script verifies each archive's SHA-256 before installing any executable and
checks the installed files on subsequent builds. Binaries are excluded from Git.

- yt-dlp: https://github.com/yt-dlp/yt-dlp (Windows executable: GPLv3+;
  see https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt).
- Deno: https://github.com/denoland/deno (MIT;
  accompanying Deno-LICENSE.txt).
- FFmpeg shared GPL build: https://github.com/yt-dlp/FFmpeg-Builds
  (GPLv3+, accompanying FFmpeg-LICENSE.txt).
  Corresponding source and build scripts:
  https://github.com/FFmpeg/FFmpeg/tree/2668cb6e31 and
  https://github.com/yt-dlp/FFmpeg-Builds/releases/tag/autobuild-2026-10-22-18-33.

These tools run locally. Session cookies are kept only in a temporary job folder
and removed when that job finishes, fails, or is cancelled. They are never sent
to a third-party download service. DRM extraction is not enabled.

The yt-dlp Windows executable's license and third-party notices accompany this
file as yt-dlp-LICENSE.txt and yt-dlp-THIRD_PARTY_LICENSES.txt.
