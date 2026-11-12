# Blonky ribbon

An animated GIF of Blonky idling in a hand-drawn circle, with a "crapshack"
ribbon across his belly. He breathes, sways, and blinks on a seamless
nine-second loop at his usual 8 fps. Outside the circle and ribbon is transparent.

- `frame.ts`: draws one frame. It uses Blonky's own ink drawing from
  `src/lib/blonky`, so he matches the site, and draws the circle, the ribbon,
  and the ribbon's lettering with the same pen. Every setting is a constant at
  the top of the file.
- `render.mjs`: bundles `frame.ts`, draws every frame in headless Chromium,
  and encodes them into `blonky-ribbon.gif`.
- `blonky-ribbon.gif`: the output. Don't edit it by hand; change
  `frame.ts` and render again.

## Render

The script needs Node, ffmpeg on the `PATH`, and esbuild and Playwright. Those
two live outside the repo so the site's build never needs them. Set them up
once:

```sh
npm install --prefix ~/.cache/blonky-ribbon esbuild@0.28.2 playwright@1.58.2
~/.cache/blonky-ribbon/node_modules/.bin/playwright install chromium-headless-shell
```

Then, from the repo root:

```sh
node artwork/blonky-ribbon/render.mjs
```

It writes `artwork/blonky-ribbon/blonky-ribbon.gif`, or the path given as its
first argument. Give a `.png` path, optionally followed by a frame number and a
width, to draw a single frame instead. To use tools from another folder, set
`BLONKY_RIBBON_TOOLS` to it. To use another Chromium build, set
`BLONKY_RIBBON_CHROMIUM` to its executable.

## How it loops

- **Pose.** His idle motion doesn't repeat every nine seconds, so each frame
  blends his pose at `t` toward his pose at `t - 9`. That way the last frame
  leads straight into the first. Blinks are left out of the blend, since
  blending them would leave his eyes half shut.
- **Line boil.** His lines boil to fresh noise every frame. Jumping from the
  last frame's noise back to the first's would make a visible twitch at the
  wrap, so the boil runs forward for half the loop and back for the rest.
