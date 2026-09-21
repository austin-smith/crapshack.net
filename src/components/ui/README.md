# UI controls

Astro-native controls inspired by shadcn's [Button](https://ui.shadcn.com/docs/components/base/button),
[Toggle](https://ui.shadcn.com/docs/components/base/toggle),
[Button Group](https://ui.shadcn.com/docs/components/base/button-group), and
[Slider](https://ui.shadcn.com/docs/components/base/slider).
These use native HTML rather than requiring a client framework.

## Styling ownership

- `src/styles/tokens.css` owns the site theme. `global.css` owns resets, global utilities, and site-wide rules.
- Shared UI styles live beside their components inside `@layer components`. Most use scoped Astro styles; `button.css` is imported by `buttonVariants()` so native buttons and links share the same rules.
- `Layout.astro` declares the cascade layer order inline before bundled styles. Component CSS can arrive before Tailwind's reset; the explicit order keeps the reset below components and utilities above them.
- `Button` owns button dimensions, typography, icon sizing, variants, focus, hover, and disabled styles. It has no press movement or scaling. `Toggle` composes it and owns selected states.
- `ButtonGroup` scopes its parent and uses `:global()` only for slotted children. Its logical borders support RTL.
- Consumers use variants and sizes for appearance and `class` for layout. Native HTML attributes pass through to the rendered element.
- `ContextMenu` owns styles for its `ContextMenuEntry` children. Root-anchored `:global()` selectors cross that component boundary and style slotted triggers/icons; the document-level pointer lock is global because it targets `html`/`body`.
- `scrollbar-none` remains a global utility shared by ScreenshotGallery and AppLinks. Gallery-specific decoration stays in ScreenshotGallery.
- Sidebar and settings-specific styles live with Sidebar, SettingsDialog, ThemeToggle, and WeatherToggle. The two preview controls import their shared frame styles from `components/preference-preview.css`; dynamically created weather particles use scoped-parent `:global()` selectors. These existing site styles retain their utility-layer priority.

Astro's [scoped styles and class forwarding](https://docs.astro.build/en/guides/styling/)
keep styles with their component. Forwarding attributes also preserves the parent's Astro scope for layout classes.

## Button and ButtonGroup

```astro
<ButtonGroup ariaLabel="Playback">
  <Button variant="outline" size="icon" aria-label="Previous">
    <StepBack aria-hidden="true" />
  </Button>
  <Button variant="outline">Play</Button>
</ButtonGroup>
<Button variant="dashed"><Shuffle data-icon="inline-start" aria-hidden="true" /> Random</Button>
```

Button variants: `default` (brand fill), `secondary` (subtle fill and border), `outline`, `ghost` (unbordered), `dashed`.

Text buttons have four sizes. Icon buttons have small and regular square sizes:

| Scale | Text button | Icon button | Height |
| --- | --- | --- | --- |
| Regular | `md` (default) | `icon` | 36px |
| Small | `sm` | `icon-sm` | 32px |
| Large | `lg` | — | 40px |
| Extra large | `xl` | — | 56px |

All use 14px text and 16px icons. Dimensions remain consistent across viewport sizes. Use the small scale for compact text buttons such as app-directory actions. Use the regular scale for standalone actions and playback controls. Blonky’s emote buttons use extra large; its random button uses large.
The default type is `button`; pass `type="submit"` for form submission. Use native `disabled` to disable a control.
Always label icon-only controls with `aria-label` or `aria-labelledby`. Decorative icons are hidden from assistive technology; the component owns their size.
ButtonGroup is a labeled horizontal group, using native Tab navigation.

Links that look like buttons use the same styles while retaining native link behavior:

```astro
---
import { buttonVariants } from './button';
---
<a href="/download" class={buttonVariants({ variant: 'secondary' })}>Download</a>
```

Do not add `role="button"` to navigation links. Consumers may supply placement and layout classes, but should not override button padding, height, typography, colors, borders, or icon sizes. Appearance differences belong to the shared variants.

## CopyButton

```astro
<CopyButton text={command} label="Copy install command" />
<CopyButton targetId="docker-command" label="Copy deployment command" class="absolute top-3 right-3" />
```

Composes `Button` with `variant="secondary"` and `size="icon-sm"`. Supply exactly one source:
`text` for a literal string (including multiline text), or `targetId` to read an element's current `textContent` on each click.
Use `targetId` when a selector or other interaction changes the displayed snippet. A missing target reports failure rather than copying an empty string.

`label` is the button's accessible name. `class` positions the wrapper; other native button attributes (including `id` and `disabled`) go to the button.
Copying does not submit forms. Enter/Space use native button activation. A pending write ignores duplicate clicks without removing keyboard focus.
After success, the check icon lasts two seconds; another completed copy restarts that interval. A live status announces success, and a persistent visible error allows retry after failure.
The delegated controller initializes once, works with later-added controls, and uses the shared clipboard helper. The helper restores focus/selection and removes its temporary textarea even when fallback copying fails.

## Toggle

```astro
<!-- Owns its state. -->
<Toggle variant="outline" defaultPressed>Show labels</Toggle>

<!-- The page controller owns its state. -->
<Toggle id="show-grid" variant="dashed" pressed={false}>Grid</Toggle>
```

Toggle variants: `default` (unbordered), `outline`, `dashed` (dashed when off, solid when on).
Sizes match Button. Selection is represented only by `aria-pressed`.

`toggle-change` bubbles with `detail: { pressed: boolean }`. It requests the next state and is cancelable.
Without a `pressed` prop, Toggle applies the requested state after dispatch unless the event was canceled.
With `pressed`, the controller must update `aria-pressed`; the prop supplies the initial state and opts into controlled behavior, not client reactivity.

```ts
import type { ToggleChangeEvent } from '../../lib/ui/toggle';

const toggle = document.querySelector<HTMLButtonElement>('#show-grid');
toggle?.addEventListener('toggle-change', ((event: ToggleChangeEvent) => {
  const { pressed } = event.detail;
  // Apply the requested application state, then reflect it in the control.
  toggle.setAttribute('aria-pressed', String(pressed));
}) as EventListener);
```

Native Enter/Space activation is retained. The delegated listener initializes once and handles controls added after page navigation.
Toggle is a button, not a form checkbox; use a checkbox for submitted boolean form values.
The existing `ToggleGroup` is a separate radio selector with its own sliding indicator and `{ value }` change event. It is not interchangeable with independent toggles.

## Slider

```astro
<Slider id="position" aria-label="Position" min={0} max={100} step={1} value={0} />
```

A single-value native range input. It preserves native keyboard, touch, form, `input`, and `change` behavior.
Use a label, `aria-label`, or `aria-labelledby`. A controller can set `.value`, `.max`, `.disabled`, and `aria-valuetext` directly.
Formatting duration or displaying an infinity indicator belongs to the consumer.

## Surface colors and Dropdown

Controls fall back to site theme tokens. A contrasting surface may supply these inherited semantic properties:

- `--ui-control-color`, `--ui-control-muted`, `--ui-control-border`
- `--ui-control-surface` (dropdown menu)
- `--ui-control-hover`, `--ui-control-selected`, `--ui-control-selected-hover`
- `--ui-control-focus`

Define these on the surrounding surface, not separately on each button. The Blonky page demonstrates this mapping.
Dropdown has one shared size: 36px-high triggers and options with 14px text. It has no size prop. The `default` and `outline` variants control appearance only; consumers can set layout width through `class`.
Component-specific `--dropdown-*` hooks remain available for cases not covered by the variants; prefer the shared surface properties first.
