"""One-time import of the owner's publicly published portfolio assets.

Only performs GET requests. The generated site never needs this script or
Readymag/Kinescope connections. Existing files are retained on repeated runs.
"""
import concurrent.futures
import json
import re
import shutil
import subprocess
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'source'
ASSETS = ROOT / 'assets'
for sub in ['images', 'fonts', 'videos', 'documents']:
    (ASSETS / sub).mkdir(parents=True, exist_ok=True)


def download(url, path):
    if not path.exists() or not path.stat().st_size:
        subprocess.run(['curl', '-fsSL', '--retry', '2', '--max-time', '120', url,
                        '-o', str(path)], check=True)
    return path


widgets = [w for name in ['1', 'zvuk', 'yango', '4']
           for w in json.loads((SOURCE / (name + '.json')).read_text())]
urls = set()
video_ids = set()
for w in widgets:
    for mode in [w, w.get('viewport_phone_portrait', {})]:
        picture = mode.get('picture') or {}
        if picture.get('url'):
            urls.add(picture['url'])
    if w['type'] == 'iframe':
        video_ids.add(re.search(r'kinescope.io/embed/([^"?]+)', w['code'])[1])


def image_asset(url):
    path = ASSETS / 'images' / Path(urlparse(url).path).name
    download(url, path)
    return url, '/' + str(path.relative_to(ROOT))


with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    image_map = dict(pool.map(image_asset, sorted(urls)))
print(f'Imported {len(image_map)} images', flush=True)

for css in SOURCE.glob('custom_*.css'):
    url = re.search(r'url\("([^"]+)"\)', css.read_text())[1]
    extension = Path(urlparse(url).path).suffix
    download(url, ASSETS / 'fonts' / (css.stem + extension))


def video_asset(video_id):
    html = download('https://kinescope.io/embed/' + video_id,
                    SOURCE / ('video-' + video_id + '.html')).read_text()
    options = json.JSONDecoder().raw_decode(html.split('var playerOptions = ', 1)[1])[0]
    item = options['playlist'][0]
    stream = item['sources']['hls']['src']
    master = download(stream, SOURCE / ('video-' + video_id + '-master.m3u8')).read_text()
    choices = []
    lines = master.splitlines()
    for i, line in enumerate(lines):
        if line.startswith('#EXT-X-STREAM-INF:'):
            width, height = map(int, re.search(r'RESOLUTION=(\d+)x(\d+)', line).groups())
            choices.append((width * height, urljoin(stream, lines[i + 1])))
    media_url = max(choices)[1]
    media = download(media_url, SOURCE / ('video-' + video_id + '-media.m3u8')).read_text()
    # The public stream references a complete fragmented MP4. Background videos
    # are intentionally muted in the published player; no player SDK is required.
    mp4_url = re.search(r'#EXT-X-MAP:URI="([^"]+)"', media)[1]
    path = ASSETS / 'videos' / (video_id + '.mp4')
    download(mp4_url, path)
    poster_url = item['poster']['src']['src']
    poster = ASSETS / 'videos' / (video_id + '.jpg')
    download(poster_url, poster)
    print(f'Imported video: {item["title"]} ({path.stat().st_size // 1024} KB)', flush=True)
    return video_id, {'src': '/' + str(path.relative_to(ROOT)),
                      'poster': '/' + str(poster.relative_to(ROOT)),
                      'title': item['title'], 'duration': item['meta']['duration'],
                      'behaviour': options['behaviour']}


with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    videos = dict(pool.map(video_asset, sorted(video_ids)))

local = Path('/Users/saveme/Library/Mobile Documents/com~apple~CloudDocs/Design/Portfolio 2025')
for original, target in [('Favicon.png', 'favicon.png'), ('OG Image.png', 'og-image.png'),
                         ('Roma Zhigarev CV.pdf', 'documents/roma-zhigarev-cv.pdf')]:
    shutil.copy2(local / original, ASSETS / target)

(SOURCE / 'asset-map.json').write_text(json.dumps({'images': image_map, 'videos': videos},
                                                ensure_ascii=False, indent=2))
print('All portfolio assets are local.', flush=True)
