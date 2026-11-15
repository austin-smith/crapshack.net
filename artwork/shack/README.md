# Shack

Source for the picture of the island on the `/experiments` page. The site reads
only `src/assets/shack/island.webp`, so its build does not run the game.

- `capture.mjs`: starts the site's dev server, plays the game's first morning
  in Chrome (the tin sheet across the two crates, as the game's own tests do,
  from the same seed), and renders that frame twice, over a black sky and over
  a white one. Where the two differ, the sky shows through, so it writes the
  island with a clear background, cropped to it. It leaves out the game's guides
  and dry-ground marks, and every cloud but those under the island.

The sky the picture sits on is drawn by the page, from the colours in
`src/components/shack-palette.css`, which the game reads too.

## Recapture

After a change to how the island looks:

```sh
node artwork/shack/capture.mjs
```

It needs Chrome, as the game's tests do.
