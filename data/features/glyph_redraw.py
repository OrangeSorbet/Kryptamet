"""Re-draws a real 28x28 character the way the /live drawing strip renders strokes (digit_canvas.js
renderGlyph): the character's centre line (skeleton of a 4x upscale) traced with an even round pen whose
width is a share of the box, at 4x resolution, averaged 4x4 down to 28x28, darkest ink stretched to 255.

Used to train emnist_logreg on drawn-style copies of the real training images (augmentation derived from
real data, not a synthetic dataset), so the model also knows strokes as the strip draws them."""
import numpy as np
from scipy import ndimage
from skimage.morphology import skeletonize

S = 4          # render scale, as GLYPH_SCALE in digit_canvas.js
N = 28
R = N * S


def centre_points(img):
    """Centre-line points of a 28x28 character, in 28-pixel units (the strokes renderGlyph receives)."""
    big = ndimage.zoom(np.asarray(img, dtype=float).reshape(N, N), S, order=1) > 100
    ys, xs = np.nonzero(skeletonize(big))
    return xs / S, ys / S


def render(xs, ys, framing):
    """renderGlyph for dot strokes: bbox of the points fitted to box - pen, centred (center="box"),
    anti-aliased round pen, no blur (the EMNIST setting), 4x4 average, peak -> 255."""
    if len(xs) == 0:
        return np.zeros(N * N, dtype=np.uint8)
    pen = framing["pen"] * framing["box"] * S
    span = max(xs.max() - xs.min(), ys.max() - ys.min(), 1e-6)
    s = max(0.0, framing["box"] * S - pen) / span
    px = R / 2 + (xs - (xs.min() + xs.max()) / 2) * s
    py = R / 2 + (ys - (ys.min() + ys.max()) / 2) * s
    # Distance from every 4x pixel centre to the nearest centre-line point; ink where it is within the pen.
    grid = np.ones((R, R), dtype=bool)
    grid[np.clip(np.round(py - 0.5).astype(int), 0, R - 1), np.clip(np.round(px - 0.5).astype(int), 0, R - 1)] = False
    dist = ndimage.distance_transform_edt(grid)
    ink = np.clip(pen / 2 - dist + 0.5, 0, 1)
    small = ink.reshape(N, S, N, S).mean(axis=(1, 3))
    peak = small.max() or 1
    return np.round(small * 255 / peak).astype(np.uint8).ravel()


def redraw(img, framing):
    return render(*centre_points(img), framing)
