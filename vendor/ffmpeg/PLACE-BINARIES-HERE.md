# ffmpeg binaries

`npm run build:win` copies this folder into the installer (`resources/bin`), so the app can extract
subtitles and convert audio without anything installed on the user's PC.

The two binaries are not in the repository (each is over 100 MB). Before building, download a Windows
build of FFmpeg (the project uses the "essentials" GPL build from https://www.gyan.dev/ffmpeg/builds/,
see `README-ffmpeg.txt` for the exact version) and put these two files here:

- `ffmpeg.exe`
- `ffprobe.exe`

They are ignored by git (`.gitignore`). Keep `LICENSE-ffmpeg.txt` and `README-ffmpeg.txt` next to them:
the installer ships FFmpeg, so its license and source information travel with it.
