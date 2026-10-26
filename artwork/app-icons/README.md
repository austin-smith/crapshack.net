# App icon artwork

Sources for the `/app-icons` gallery. The site reads only `catalog.json` and the
finished files in `public/app-icons/`, so its build needs neither Python nor a
graphics app.

## Layout

- `catalog.json`: every collection and variant, with names, credits, and
  optional `opticalSources` and `housing` settings. `publicDir` and the IDs set
  every path: a variant's sources live in `<collection>/<variant>/`, and it
  publishes `public/<publicDir>/<collection>/<variant>.icns` with its previews
  in `<variant>/` beside it.
- `generate.py`: an icon's source. It holds every setting and writes `icon.svg`.
  There is one per variant, or one per collection when variants share a build.
- `icon.svg`: generated, self-contained, and layered. This is the build input;
  don't edit it by hand.
- `optical-*/`: simpler artwork for small sizes, mapped by `opticalSources`. Its
  `render.png` is the saved render that verification checks against.
- `references/`: original artwork the generators read. It is not published.

## Change an icon

The scripts need Python 3.12 or newer, the packages pinned in
`requirements.txt`, and VectorCraft CLI 0.16.0. Other versions can encode the
same pixels into different bytes. Set up an environment outside the repo once,
checking that `python3 --version` reports 3.12 or newer (macOS's built-in one is
3.9):

```sh
python3 -m venv ~/.venvs/app-icons
~/.venvs/app-icons/bin/pip install -r artwork/app-icons/requirements.txt
```

Edit the icon's `generate.py`, or the data it reads, then run it and rebuild:

```sh
~/.venvs/app-icons/bin/python artwork/app-icons/<path>/generate.py
~/.venvs/app-icons/bin/python artwork/app-icons/build.py --rebuild
```

Pass `--out DIR` to a generator to write somewhere else for comparison.
To see an icon's layers, open its `icon.svg` in VectorCraft or PhotoCraft. Make
changes in `generate.py`, which overwrites the SVG.

## Verify

`build.py` without `--rebuild` checks every preview size and all ten ICNS
representations. It also confirms that every SVG is self-contained and titled
from the catalog, that the reference housing is unchanged where a collection has
a `housing` setting, that IDs are unique, and that `public/app-icons/` holds no
other files (hidden ones such as `.DS_Store` aside). It modifies nothing.
`--rebuild` renders the SVGs with VectorCraft CLI (pass `--vectorcraft PATH` if
it isn't on `PATH`) and, once the whole set verifies, replaces
`public/app-icons/` outright, so a removed or renamed icon leaves nothing behind.
It also rewrites each `optical-*/render.png`; commit them with the rest.

## Attribution

Original artwork belongs to its owners, credited per collection in
`catalog.json` and on the gallery. These icons adapt that artwork and claim no
ownership or license over it.
