# Same as it ever was

Source for the `/experiments/same-as-it-ever-was` page: a drawing, animated
from its own pen strokes. The site reads only
`src/data/same-as-it-ever-was.json`, so its build needs no Python.

- `references/`: the drawing, as two screenshots that overlap. `lower.png`
  carries on from `upper.png`.
- `trace.py`: follows the centre of every line in the drawing and writes the
  strokes: each one's ink, its width, and its points.

The motion itself lives in `src/lib/same-as-it-ever-was.ts`. The figure stands
still; every line is redrawn a little differently several times a second.

## Retrace

```sh
python3 -m venv ~/.venvs/same-as-it-ever-was
~/.venvs/same-as-it-ever-was/bin/pip install -r artwork/same-as-it-ever-was/requirements.txt
~/.venvs/same-as-it-ever-was/bin/python artwork/same-as-it-ever-was/trace.py parts.png
```

`parts.png` is optional. The tracer names each stroke for the part of the
figure it belongs to (`head`, `tie`, a lyric word such as `right3`, or `body`)
to decide the order strokes are written in; the picture shows every stroke
coloured by part, which is the quickest way to check the regions in `part_of`
after changing them.
