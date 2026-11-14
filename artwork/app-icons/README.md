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
- `generate.py`: an icon's source. It holds every setting and writes `icon.svg`.
  There is one per icon, or one per collection when variants share a build.
- `icon.svg`: generated, self-contained, and layered. This is the build input;
  don't edit it by hand.
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

To see an icon's layers, open its `icon.svg` in VectorCraft or PhotoCraft. Make
changes in `generate.py`, which overwrites the SVG.

PlayStation 2's console is a Blender render,
`references/playstation-2-render.png`, which its `generate.py` reads.
`playstation-2/render/` holds the model and the script that renders it from the
official logos in `references/`. It also needs Blender 5.3 and macOS's
Helvetica. Every render's noise differs, so re-render only to change the
console:

```sh
~/.venvs/app-icons/bin/python artwork/app-icons/playstation-2/render/render.py
```

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

Original artwork belongs to its owners, credited per collection or standalone
icon in `catalog.json` and on the gallery. These icons adapt that artwork and
claim no ownership or license over it. Collections of our own apps' icons, such
as BitDream's and PlexBar's, have no credits.
