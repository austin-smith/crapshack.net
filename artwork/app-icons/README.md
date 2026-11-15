# App icon artwork

Sources for the `/app-icons` gallery. The site reads only `catalog.json` and the
finished files in `public/app-icons/`, so its build needs neither Python nor a
graphics app.

## Layout

- `catalog.json`: every icon, with names, credits, and optional `opticalSources`
  and `housing` settings. `collections` holds each app's icons as its variants;
  `icons` holds standalone icons, which belong to no app. The gallery sorts its
  icons itself: apps A–Z with each app's icons A–Z, then the standalone icons
  A–Z. `publicDir` and the IDs set every path: a variant's sources live in
  `<collection>/<variant>/`, and it publishes
  `public/<publicDir>/<collection>/<variant>.icns` with its previews in
  `<variant>/` beside it. A standalone icon's sources live in `<icon>/`, and it
  publishes `public/<publicDir>/<icon>.icns` with its previews in `<icon>/`, so
  its ID can't be a collection's.
- `generate.py`: an icon's source. It holds every setting and writes `icon.svg`,
  or `icon.png` when the icon is only raster artwork. There is one per icon, or
  one per collection when variants share a build.
- `icon.svg` or `icon.png`: generated, and the build input; don't edit it by
  hand. An SVG is self-contained and layered. A PNG is the finished 1024px
  master, composited in Pillow, so it's published without being resampled.
  BitDream's, PlexBar's, PlayStation 2's, and PlayStation 3's icons are PNGs.
- `optical-*/`: simpler artwork for small sizes, mapped by `opticalSources`. Its
  `render.png` is the saved render that verification checks against.
- `references/`: original artwork the generators read. It is not published.

## Change an icon

The scripts need Python, VectorCraft CLI, and the packages in
`requirements.txt`:

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

BitDream's icons are the app's own alternates. To refresh them after the app's
`.icon` documents change, pass its `AppIcons` folder with `--export`, which
needs Xcode's Icon Composer:

```sh
~/.venvs/app-icons/bin/python artwork/app-icons/bitdream/generate.py --export ../BitDream/AppIcons
```

PlexBar's icons come from PlexBar Studio's `.icon` documents the same way; pass
its `Studio/Resources` folder:

```sh
~/.venvs/app-icons/bin/python artwork/app-icons/plexbar/generate.py --export ../PlexBar/Studio/Resources
```

To see an SVG icon's layers, open its `icon.svg` in VectorCraft or PhotoCraft.
Make changes in `generate.py`, which overwrites the source.

The PlayStation 2 and PlayStation 3 consoles are Blender renders,
`references/playstation-2-render.png` and `references/playstation-3-render.png`,
which their `generate.py` read. Each icon's `render/` holds the model and the
script that renders it from the official logos in `references/`. They also need
Blender 5.3, and macOS's Helvetica for the PlayStation 2 or its Superclarendon
for the PlayStation 3. Every render's noise differs, so re-render only to change
a console:

```sh
~/.venvs/app-icons/bin/python artwork/app-icons/playstation-2/render/render.py
~/.venvs/app-icons/bin/python artwork/app-icons/playstation-3/render/render.py
```

## Verify

`build.py` without `--rebuild` checks every preview size and all ten ICNS
representations. It also confirms that every icon has exactly one source, that
every SVG is self-contained, that a PNG icon's master is exactly its `icon.png`,
that the reference housing is unchanged where a collection has a `housing`
setting, that IDs are unique, and that `public/app-icons/` holds no other files
(hidden ones such as `.DS_Store` aside). It modifies nothing.
`--rebuild` renders the SVGs with VectorCraft CLI (pass `--vectorcraft PATH` if
it isn't on `PATH`), takes each `icon.png` as it is, and, once the whole set
verifies, replaces
`public/app-icons/` outright, so a removed or renamed icon leaves nothing behind.
It also rewrites each `optical-*/render.png`; commit them with the rest.

## Attribution

Original artwork belongs to its owners, credited per collection or standalone
icon in `catalog.json` and on the gallery. These icons adapt that artwork and
claim no ownership or license over it. Collections of our own apps' icons, such
as BitDream's and PlexBar's, have no credits.
