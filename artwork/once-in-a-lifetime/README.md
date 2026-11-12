# Once in a lifetime

Source for the `/experiments/once-in-a-lifetime` page: a drawing, animated
from its own pen strokes. The site reads only
`src/data/once-in-a-lifetime.json`, so its build needs no Python.

- `references/`: the drawing, as two screenshots that overlap. `lower.png`
  carries on from `upper.png`.
- `trace.py`: follows the centre of every line in the drawing and writes the
  strokes: each one's ink, its width, and its points.

The motion itself lives in `src/lib/once-in-a-lifetime.ts`. The figure stands
still; every line is redrawn a little differently several times a second.

## Retrace

```sh
python3 -m venv ~/.venvs/once-in-a-lifetime
~/.venvs/once-in-a-lifetime/bin/pip install -r artwork/once-in-a-lifetime/requirements.txt
~/.venvs/once-in-a-lifetime/bin/python artwork/once-in-a-lifetime/trace.py parts.png
```

`parts.png` is optional. The tracer names each stroke for the part of the
figure it belongs to (`head`, `tie`, a lyric word such as `right3`, or `body`)
to decide the order strokes are written in; the picture shows every stroke
coloured by part, which is the quickest way to check the regions in `part_of`
after changing them.
