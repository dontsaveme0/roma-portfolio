#!/usr/bin/env python3
"""Create smaller media without resizing; originals remain available for lightboxes.

Run manually with Python 3.9+ after installing scripts/media-requirements.txt.
The normal Node build uses the checked-in results and needs no media tools.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

import imageio_ffmpeg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
ASSETS = json.loads((ROOT / 'source/asset-map.json').read_text())
MANIFEST = ROOT / 'source/media-optimized.json'
REPORT = ROOT / 'verification/media-quality.json'


def local(url):
    return ROOT / url.lstrip('/')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ffmpeg(*args):
    result = subprocess.run([FFMPEG, '-hide_banner', '-nostdin', *map(str, args)],
                            capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr[-4000:])
    return result.stderr


def similarity(source, candidate, image=False):
    conversion = 'format=gbrp' if image else 'setpts=PTS-STARTPTS'
    log = ffmpeg('-threads', '2', '-i', source, '-threads', '2', '-i', candidate,
                 '-filter_complex_threads', '2', '-filter_complex',
                 f'[0:v]{conversion}[a];[1:v]{conversion}[b];[a][b]ssim',
                 '-an', '-f', 'null', '-')
    return float(re.findall(r'All:([\d.]+)', log)[-1])


def publish(source_url, candidate, details):
    source = local(source_url)
    details.update(originalBytes=source.stat().st_size)
    if candidate is None or candidate.stat().st_size >= source.stat().st_size:
        details.update(outputBytes=source.stat().st_size, optimized=False)
        print(f'Kept original: {source.name}', flush=True)
        return source_url, None, details
    digest = sha(candidate)
    kind = 'videos' if candidate.suffix == '.mp4' else 'images'
    target = ROOT / 'assets/optimized' / kind / f'{source.stem}-{digest[:12]}{candidate.suffix}'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(candidate.read_bytes())
    details.update(outputBytes=target.stat().st_size, optimized=True)
    record = {'src': '/' + target.relative_to(ROOT).as_posix(),
              'sourceSha256': sha(source), 'outputSha256': digest}
    print(f'{source.name}: {source.stat().st_size:,} -> {target.stat().st_size:,}', flush=True)
    return source_url, record, details


def optimize_image(url):
    source = local(url)
    with Image.open(source) as original, tempfile.TemporaryDirectory() as directory:
        assert original.getexif().get(274, 1) == 1, f'Normalize orientation first: {url}'
        image = original.convert('RGBA' if 'A' in original.getbands() or 'transparency' in original.info else 'RGB')
        options = {'method': 6, 'icc_profile': original.info.get('icc_profile', b'')}
        lossless = Path(directory) / 'lossless.webp'
        image.save(lossless, 'WEBP', lossless=True, exact=True, **options)
        with Image.open(lossless) as decoded:
            assert decoded.convert(image.mode).tobytes() == image.tobytes(), url
            assert decoded.info.get('icc_profile', b'') == options['icc_profile'], url
        candidates = [(lossless, {'encoding': 'lossless WebP', 'ssim': 1.0})]
        # PNG graphics always stay pixel-exact. JPEGs may use high-quality WebP.
        if original.format == 'JPEG':
            for quality in (95, 98, 100):
                candidate = Path(directory) / f'q{quality}.webp'
                image.save(candidate, 'WEBP', quality=quality, **options)
                if candidate.stat().st_size >= min(source.stat().st_size, lossless.stat().st_size):
                    break
                score = similarity(source, candidate, image=True)
                if score >= 0.99:
                    candidates.append((candidate, {'encoding': f'WebP quality {quality}', 'ssim': score}))
                    break
            # JPEG 4:4:4 can retain fine colored edges better than lossy WebP.
            for quality in (95, 98):
                candidate = Path(directory) / f'q{quality}.jpg'
                image.save(candidate, 'JPEG', quality=quality, subsampling=0,
                           optimize=True, progressive=True, icc_profile=options['icc_profile'])
                smallest = min(source.stat().st_size, *(p.stat().st_size for p, _ in candidates))
                if candidate.stat().st_size >= smallest:
                    break
                score = similarity(source, candidate, image=True)
                if score >= 0.99:
                    candidates.append((candidate, {'encoding': f'JPEG quality {quality}, 4:4:4', 'ssim': score}))
                    break
        chosen, details = min(candidates, key=lambda item: item[0].stat().st_size)
        details.update(width=original.width, height=original.height)
        return publish(url, chosen, details)


def video_metadata(path):
    reader = imageio_ffmpeg.read_frames(str(path))
    try:
        return next(reader)
    finally:
        reader.close()


def optimize_video(url):
    source = local(url)
    before = video_metadata(source)
    frames_before, seconds_before = imageio_ffmpeg.count_frames_and_secs(str(source))
    with tempfile.TemporaryDirectory() as directory:
        details = {'width': before['size'][0], 'height': before['size'][1],
                   'fps': before['fps'], 'frames': frames_before, 'seconds': seconds_before}
        for crf in (18, 16):
            candidate = Path(directory) / 'video.mp4'
            ffmpeg('-loglevel', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a?',
                   '-c:v', 'libx264', '-crf', crf, '-preset', 'slow', '-threads', '4',
                   '-c:a', 'copy', '-movflags', '+faststart', candidate)
            if candidate.stat().st_size >= source.stat().st_size:
                return publish(url, None, details)
            after = video_metadata(candidate)
            assert before['size'] == after['size'] and before['fps'] == after['fps'], url
            assert before['pix_fmt'] == after['pix_fmt'], url
            frames_after, seconds_after = imageio_ffmpeg.count_frames_and_secs(str(candidate))
            assert frames_before == frames_after and abs(seconds_before - seconds_after) < 0.001, url
            score = similarity(source, candidate)
            if score >= 0.99:
                details.update(encoding=f'H.264 CRF {crf}', ssim=score)
                return publish(url, candidate, details)
        return publish(url, None, details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['images', 'videos', 'all'], default='all')
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {'version': 1, 'files': {}}
    report = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    jobs = []
    if args.kind in ('images', 'all'):
        images = set(ASSETS['images'].values()) | {v['poster'] for v in ASSETS['videos'].values()}
        jobs.extend((optimize_image, url) for url in sorted(images))
    if args.kind in ('videos', 'all'):
        jobs.extend((optimize_video, v['src']) for v in ASSETS['videos'].values())
    REPORT.parent.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=2) as pool:
        for url, record, details in pool.map(lambda job: job[0](job[1]), jobs):
            if record:
                manifest['files'][url] = record
            else:
                manifest['files'].pop(url, None)
            report[url] = details
            MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
            REPORT.write_text(json.dumps(report, indent=2) + '\n')
    original = sum(v['originalBytes'] for v in report.values())
    optimized = sum(v['outputBytes'] for v in report.values())
    print(f'Total: {original:,} -> {optimized:,} bytes ({(1-optimized/original)*100:.1f}% smaller)')


if __name__ == '__main__':
    main()
