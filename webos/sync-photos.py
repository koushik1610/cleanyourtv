#!/usr/bin/env python3
"""Bring the Favorites album in Apple Photos into the Photos app for the TV (photos-app/).

Exports each favourite photo once (Photos downloads it from iCloud if needed), then writes a
1920x1080 slide per photo into photos-app/photos/ (the whole photo centred, the space around it
filled with a blurred, darkened copy of itself) and a square thumbnail into photos-app/thumbs/.
Videos become an MP4 next to their slide (made from one frame, as the backdrop behind the video);
avconvert turns HDR into the SDR the TV plays. photos-app/photos.js lists them. Anything removed
from Favorites is removed here too.

    venv/bin/python sync-photos.py

Needs: pip install pillow, and ffmpeg for the video frames. The first run asks to let this app
control Photos: allow it.
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageEnhance, ImageFilter, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "photos-cache", "originals")   # full-size exports, kept between runs
APP = os.path.join(HERE, "photos-app")
SLIDES = os.path.join(APP, "photos")
THUMBS = os.path.join(APP, "thumbs")
LIST_JS = os.path.join(APP, "photos.js")
SIZE = (1920, 1080)
THUMB = 320
VIDEO = (".mov", ".mp4", ".m4v")


def osascript(script):
    return subprocess.run(["osascript", "-e", script], check=True, capture_output=True, text=True).stdout


def favourites():
    """(Photos id, is a video) for everything in the Favorites album, in album order."""
    out = osascript('''tell application "Photos"
  set out to ""
  repeat with m in media items of (favorites album)
    set out to out & (id of m) & tab & (filename of m) & linefeed
  end repeat
  return out
end tell''')
    favs = []
    for line in out.splitlines():
        pid, _, name = line.partition("\t")
        if pid:
            favs.append((pid, name.lower().endswith(VIDEO)))
    return favs


def key(pid):
    return pid.split("/")[0]   # "UUID/L0/001" -> "UUID"


def export(pid, dest, video):
    """Exports the edited version: a photo as JPEG (not the HEIC original), a video as 1080p MP4."""
    with tempfile.TemporaryDirectory() as tmp:
        osascript(f'tell application "Photos" to export {{media item id "{pid}"}} '
                  f'to (POSIX file "{tmp}") without using originals')
        files = [f for f in os.listdir(tmp) if f.lower().endswith(VIDEO) == video]
        if not files:
            raise RuntimeError("nothing exported")
        src = os.path.join(tmp, files[0])
        if video:
            sdr = os.path.join(tmp, "sdr.mp4")
            subprocess.run(["avconvert", "-s", src, "-p", "Preset1920x1080", "-o", sdr, "--replace"],
                           check=True, capture_output=True, text=True)
            shrink(sdr, dest)
        else:
            shutil.move(src, dest)


def shrink(src, dest):
    """Re-encodes at the size the TV shows it (a portrait clip is only 1080 tall there) and a sane
    bitrate: iPhone clips are ~16 Mbit/s, which would make every install slow."""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src,
                    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30",
                    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-maxrate", "6M", "-bufsize", "12M",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dest],
                   check=True, capture_output=True, text=True)


def frame(video, dest):
    """A still from a second in (or the first frame of a shorter clip), for the thumbnail and backdrop."""
    for at in ("1", "0"):
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", at, "-i", video, "-frames:v", "1", dest],
                       capture_output=True)
        if os.path.exists(dest):
            return
    raise RuntimeError("no frame")


def slide(src, dest, thumb):
    img = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    ImageOps.fit(img, (THUMB, THUMB), Image.LANCZOS).save(thumb, "JPEG", quality=80)
    # Backdrop: the photo stretched to cover, blurred at a small size (cheap, and smoother).
    small = ImageOps.fit(img, (192, 108))
    back = small.filter(ImageFilter.GaussianBlur(6)).resize(SIZE, Image.BILINEAR)
    back = ImageEnhance.Brightness(back).enhance(0.45)
    front = ImageOps.contain(img, SIZE, Image.LANCZOS)
    back.paste(front, ((SIZE[0] - front.width) // 2, (SIZE[1] - front.height) // 2))
    back.save(dest, "JPEG", quality=82)


def main():
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(SLIDES, exist_ok=True)
    os.makedirs(THUMBS, exist_ok=True)
    was_running = subprocess.run(["pgrep", "-x", "Photos"], capture_output=True).returncode == 0
    try:
        favs = favourites()
        print(f"{len(favs)} favourite photos")
        for n, (pid, video) in enumerate(favs, 1):
            orig = os.path.join(CACHE, key(pid) + (".mp4" if video else ".jpg"))
            if os.path.exists(orig):
                continue
            print(f"  exporting {n}/{len(favs)}", flush=True)
            try:
                export(pid, orig, video)
            except (subprocess.CalledProcessError, RuntimeError) as e:
                print(f"  skipped {pid}: {getattr(e, 'stderr', '') or e}".strip())
    finally:
        if not was_running:
            subprocess.run(["osascript", "-e", 'tell application "Photos" to quit'], capture_output=True)

    keep, names = set(), []
    for pid, video in favs:
        k = key(pid)
        orig = os.path.join(CACHE, k + (".mp4" if video else ".jpg"))
        out, thumb = os.path.join(SLIDES, k + ".jpg"), os.path.join(THUMBS, k + ".jpg")
        if not os.path.exists(orig):
            continue
        if not (os.path.exists(out) and os.path.exists(thumb)):
            if video:
                still = os.path.join(CACHE, k + ".frame.jpg")
                frame(orig, still)
                slide(still, out, thumb)
                os.remove(still)
            else:
                slide(orig, out, thumb)
        if video and not os.path.exists(os.path.join(SLIDES, k + ".mp4")):
            shutil.copy(orig, os.path.join(SLIDES, k + ".mp4"))
        keep.add(k)
        names.append(k + (".mp4" if video else ".jpg"))

    # Unfavourited: drop the export, the slide and the video.
    for folder in (CACHE, SLIDES, THUMBS):
        for f in os.listdir(folder):
            if f.split(".")[0] not in keep:
                os.remove(os.path.join(folder, f))

    # In album order; the file only changes when the favourites do. A .mp4 is a video, shown on the
    # .jpg slide of the same name.
    with open(LIST_JS, "w") as f:
        f.write("// Generated by sync-photos.py: the Apple Photos Favorites album.\n")
        f.write("window.TV_PHOTOS = [\n" + ",\n".join(f' "{n}"' for n in names) + "\n];\n")
    print(f"{len(names)} photos and videos in photos-app/")


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        sys.exit(f"Photos didn't answer: {e.stderr.strip()}")
