"""Trace the drawing into the pen strokes the page redraws.

Reads the two screenshots in references/, follows the centre of every pen line
and writes src/data/same-as-it-ever-was.json. Each stroke is named for the part
of the figure it belongs to; the names only decide the order strokes are written
in, and are not written themselves. Pass a path to also save a picture of the
strokes coloured by part.

Usage: python artwork/same-as-it-ever-was/trace.py [parts.png]
"""
import colorsys
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from skimage.morphology import skeletonize

HERE = Path(__file__).parent
OUT = HERE.parents[1] / 'src/data/same-as-it-ever-was.json'

# The lower screenshot continues the upper one at this offset, at the same scale.
LOWER_AT = (74, 1272)
# Other doodles on the page start right of here.
FIGURE_RIGHT = 700
PAPER = 30

# In painting order: the outline goes over the colours.
INKS = ('blue', 'yellow', 'red', 'white')
# A hand and the shorts share one traced line; cut it where the hand ends.
CUTS = [(549, 1765)]

WORDS = {
    # each test takes a stroke centre (x, y) and names the word it belongs to, in sung order
    'top': lambda x, y: 0 if y > 315 else 1 if y > 222 else 2 if x < 255 else 3 if x < 322 else 4,
    'right': lambda x, y: 0 if y < 650 else 1 if y < 707 else 2 if y < 758 else 3 if y < 853 else 4,
    'left': lambda x, y: 0 if y >= 792 else 1 if y >= 750 else 2 if y >= 707 else 3 if y >= 628 else 4,
}


# Centreline tracing ------------------------------------------------------------

N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def _edges(sk):
    pts = set(map(tuple, np.argwhere(sk)))

    def nb(p):
        return [(p[0] + dy, p[1] + dx) for dy, dx in N8 if (p[0] + dy, p[1] + dx) in pts]

    deg = {p: len(nb(p)) for p in pts}
    nodes = {p for p in pts if deg[p] != 2}
    seen = set()
    out = []
    for n in nodes:
        for q in nb(n):
            if (n, q) in seen:
                continue
            path = [n, q]
            seen.add((n, q))
            prev, cur = n, q
            while cur not in nodes:
                nxt = [r for r in nb(cur) if r != prev]
                if not nxt:
                    break
                prev, cur = cur, nxt[0]
                path.append(cur)
            seen.add((path[-1], path[-2]))
            out.append(path)
    # closed loops that touch no node
    used = set(p for path in out for p in path)
    for p in pts:
        if p in used or p in nodes:
            continue
        path = [p]
        used.add(p)
        prev, cur = None, p
        while True:
            nxt = [r for r in nb(cur) if r != prev and r not in used]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            used.add(cur)
            path.append(cur)
        path.append(p)
        out.append(path)
    return out, deg


def _length(path):
    return sum(math.dist(path[i], path[i + 1]) for i in range(len(path) - 1))


def _direction(path, at_end, span=7):
    """Unit vector pointing out of the path at one end."""
    if at_end:
        a, b = path[max(0, len(path) - 1 - span)], path[-1]
    else:
        a, b = path[min(len(path) - 1, span)], path[0]
    d = (b[0] - a[0], b[1] - a[1])
    n = math.hypot(*d) or 1
    return (d[0] / n, d[1] / n)


def _join(paths, reach=2.3, max_turn=65):
    """Greedily join paths end to end where the pen plainly carried on through a junction."""
    paths = [list(p) for p in paths]
    cos_limit = math.cos(math.radians(max_turn))
    while True:
        ends = []
        for i, p in enumerate(paths):
            if p is None or (p[0] == p[-1] and len(p) > 3):
                continue
            ends.append((p[0], i, False))
            ends.append((p[-1], i, True))
        grid = {}
        for e in ends:
            grid.setdefault((e[0][0] // 4, e[0][1] // 4), []).append(e)
        dirs = {(i, at_end): _direction(paths[i], at_end) for _, i, at_end in ends}
        cands = []
        for pt, i, at_end in ends:
            di = dirs[(i, at_end)]
            for gy in (-1, 0, 1):
                for gx in (-1, 0, 1):
                    for pt2, j, at_end2 in grid.get((pt[0] // 4 + gy, pt[1] // 4 + gx), []):
                        if j <= i or math.dist(pt, pt2) > reach:
                            continue
                        dj = dirs[(j, at_end2)]
                        straight = -(di[0] * dj[0] + di[1] * dj[1])
                        if straight > cos_limit:
                            cands.append((straight, i, at_end, j, at_end2))
        if not cands:
            break
        # one round: straightest pairs first, each path joined at most once per round
        touched = set()
        for _, i, ei, j, ej in sorted(cands, reverse=True):
            if i in touched or j in touched:
                continue
            touched.update((i, j))
            a = paths[i] if ei else paths[i][::-1]
            b = paths[j][::-1] if ej else paths[j]
            if a[-1] == b[0]:
                b = b[1:]
            paths[i] = a + b
            paths[j] = None
    return [p for p in paths if p is not None]


def _rdp(points, eps):
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = points[s]
        bx, by = points[e]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, index = 0, None
        for k in range(s + 1, e):
            px, py = points[k]
            d = abs(dx * (py - ay) - dy * (px - ax)) / norm if norm else math.hypot(px - ax, py - ay)
            if d > worst:
                worst, index = d, k
        if index is not None and worst > eps:
            keep[index] = True
            stack += [(s, index), (index, e)]
    return [p for p, k in zip(points, keep) if k]


def _smooth(path):
    """Light 1-2-1 smoothing to take the pixel staircase off a skeleton path."""
    if len(path) < 4:
        return path
    inner = [((a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4) for a, p, b in zip(path, path[1:], path[2:])]
    return [path[0], *inner, path[-1]]


def trace(mask, min_spur=5.0, min_len=3.0, eps=0.55, max_turn=65):
    sk = skeletonize(mask)
    dist = ndimage.distance_transform_edt(mask)
    edges, deg = _edges(sk)
    # drop skeleton spurs: short edges with a free end hanging off a junction
    kept = []
    for e in edges:
        free = deg[e[0]] == 1 or deg[e[-1]] == 1
        hangs = deg[e[0]] >= 3 or deg[e[-1]] >= 3
        if free and hangs and _length(e) < min_spur:
            continue
        kept.append(e)
    # de-duplicate edges traced from both ends
    uniq = {}
    for e in kept:
        key = (min(e[0], e[-1]), max(e[0], e[-1]), len(e))
        uniq.setdefault(key, e)
    paths = _join(list(uniq.values()), max_turn=max_turn)
    # a dot thins to one pixel with no edge; keep it as a dab
    paths += [[p, p] for p, d in deg.items() if d == 0]
    out = []
    for p in paths:
        if _length(p) < min_len and len(p) != 2:
            continue
        if len(p) == 2 and p[0] != p[1]:
            continue
        width = 2 * float(np.median([dist[y, x] for y, x in p]))
        xy = [(x + 0.5, y + 0.5) for y, x in p]
        if len(p) == 2:
            xy[1] = (xy[1][0] + 1, xy[1][1])
        xy = _smooth(_smooth(xy))
        out.append({'pts': _rdp(xy, eps), 'w': width})
    return out


# The drawing ---------------------------------------------------------------------


def composite(upper, lower):
    a = np.asarray(Image.open(upper).convert('RGB'))
    b = np.asarray(Image.open(lower).convert('RGB'))
    dx, dy = LOWER_AT
    out = np.full((dy + b.shape[0], a.shape[1], 3), PAPER, np.uint8)
    out[:a.shape[0]] = a
    out[dy:dy + b.shape[0], dx:dx + b.shape[1]] = b
    out[:, FIGURE_RIGHT:] = PAPER
    return out


def classify(img):
    f = img.astype(np.float32) / 255
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    mx, mn = f.max(axis=2), f.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1e-6)
    colored = (sat >= 0.25) & (mx > 0.25)
    # Colours keep only the stroke core, so neighbouring scribble lines stay separate.
    return {
        'white': (sat < 0.25) & (mx > 0.3),
        'blue': colored & (b > r) & (b >= g * 0.9) & (mx > 0.48),
        'red': colored & (r > b) & (g < r * 0.6) & (mx > 0.62),
        'yellow': colored & (r > b) & (g >= r * 0.6) & (b < r * 0.5) & (mx > 0.56),
    }


def clean(mask, min_area):
    lab, n = ndimage.label(mask, structure=np.ones((3, 3)))
    area = ndimage.sum(mask, lab, range(1, n + 1))
    return np.isin(lab, [i + 1 for i, a in enumerate(area) if a >= min_area])


def under_white(mask, white, reach=4):
    """Carry a colour under the white line drawn over it, so no gap shows when the lines stray apart."""
    grown = ndimage.binary_dilation(mask, iterations=reach)
    return mask | (white & ndimage.binary_erosion(grown, iterations=reach))


def length(pts):
    return sum(math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def split_at(strokes, cut, reach=6):
    out = []
    for s in strokes:
        near = [math.dist(p, cut) for p in s['pts']]
        i = int(np.argmin(near))
        if near[i] > reach or i in (0, len(near) - 1):
            out.append(s)
            continue
        out.append({**s, 'pts': s['pts'][:i + 1]})
        out.append({**s, 'pts': s['pts'][i:]})
    return out


def part_of(pts):
    """Name the part of the figure a white stroke belongs to."""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    small = max(x1 - x0, y1 - y0) < 48 and length(pts) < 100

    def inside(ax, ay, bx, by):
        return ax <= x0 and x1 <= bx and ay <= y0 and y1 <= by

    if y0 < 900:
        if math.dist((cx, cy), (295, 347)) < 26:
            return 'eyeL'
        if math.dist((cx, cy), (463, 332)) < 26:
            return 'eyeR'
        if inside(340, 530, 525, 625):
            return 'mouth'
        if inside(395, 690, 485, 735):
            return 'chin'
        if small and inside(85, 45, 390, 405):
            return f"top{WORDS['top'](cx, cy)}"
        if small and inside(455, 550, 640, 925):
            return f"right{WORDS['right'](cx, cy)}"
        if small and inside(150, 550, 390, 895):
            return f"left{WORDS['left'](cx, cy)}"
        return 'head'
    if inside(395, 955, 472, 1455):
        return 'tie'
    if inside(150, 1350, 225, 1530):
        return 'armLU'
    if inside(130, 1480, 335, 1920) and x0 < 300:
        return 'armLF'
    if inside(590, 1330, 640, 1560):
        return 'armRU'
    if inside(590, 1480, 650, 1720) or inside(495, 1660, 670, 1840):
        return 'armRF'
    return 'body'


def sung_order(part, pts):
    """Sort key that walks a phrase the way it reads: clockwise round the head."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    if part.startswith('top'):
        return math.atan2(cy - 420, cx - 400)
    return cy if part.startswith('right') else -cy


def main(debug_path=None):
    img = composite(HERE / 'references/upper.png', HERE / 'references/lower.png')
    masks = classify(img)
    white = clean(masks['white'], 3)
    strokes = []
    for s in trace(white):
        strokes.append({**s, 'ink': 'white'})
    for cut in CUTS:
        strokes = split_at(strokes, cut)
    for s in strokes:
        s['part'] = part_of(s['pts'])
    for ink in INKS[:-1]:
        mask = clean(masks[ink], 12)
        if ink == 'yellow':
            mask[:1700] = False
        if ink == 'red':
            mask[:, :380] = False
        for s in trace(under_white(mask, white), min_spur=4, eps=0.7, max_turn=50):
            strokes.append({**s, 'ink': ink, 'part': 'tie' if ink == 'red' else 'body'})

    lyric = lambda s: s['part'][:3] in ('top', 'rig', 'lef')
    strokes.sort(key=lambda s: (INKS.index(s['ink']), lyric(s), s['part'] if lyric(s) else '', sung_order(s['part'], s['pts']) if lyric(s) else 0))
    parts = sorted({s['part'] for s in strokes})
    rows = []
    for s in strokes:
        width = round(max(2.6, min(s['w'] - 1, 12)) * 10)
        flat = [round(v) for p in s['pts'] for v in p]
        rows.append([INKS.index(s['ink']), width, *flat])
    with open(OUT, 'w') as f:
        json.dump({'inks': INKS, 'strokes': rows}, f, separators=(',', ':'))
    points = sum((len(r) - 2) // 2 for r in rows)
    print(f'{len(rows)} strokes, {points} points -> {OUT}')
    for name in parts:
        print(f'  {name}: {sum(1 for s in strokes if s["part"] == name)}')

    if debug_path:
        scale = 2
        im = Image.new('RGB', (img.shape[1] * scale, img.shape[0] * scale), (20, 20, 20))
        d = ImageDraw.Draw(im)
        for s in strokes:
            if s['ink'] != 'white':
                continue
            hue = parts.index(s['part']) * 0.618 % 1
            col = (200, 200, 200) if s['part'] == 'body' else tuple(int(c * 255) for c in colorsys.hsv_to_rgb(hue, 0.85, 1))
            d.line([(x * scale, y * scale) for x, y in s['pts']], fill=col, width=3)
        im.save(debug_path)


if __name__ == '__main__':
    main(*sys.argv[1:])
