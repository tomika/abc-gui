# abc-gui

Fully-featured WYSIWYG editor for [ABC music notation](https://abcnotation.com/wiki/abc:standard:v2.1), distributed as a framework-free TypeScript npm package.

- Renders the score with [abcjs](https://www.npmjs.com/package/abcjs).
- Click any element (note, rest, chord, bar, header field) to edit its properties in a structured panel built from the ABC v2.1 standard.
- Every element also exposes a raw-text editor, so anything not (yet) covered by the structured UI can still be edited.
- Unicode glyphs on all buttons → language-independent UI.
- No React / Angular / Vue.

## Install

```sh
npm install abc-gui abcjs
```

## Usage

```ts
import { mount } from "abc-gui";
import "abc-gui/style.css";

const editor = mount(document.getElementById("host")!, {
  value: "X:1\nT:Example\nM:4/4\nL:1/8\nK:G\n|GABc d2ef|",
  onChange: (abc) => console.log("new abc:", abc)
});

editor.setValue(newAbc);   // replace programmatically
editor.getValue();          // read the current source
editor.destroy();           // tear down
```

In the browser via the UMD bundle:

```html
<link rel="stylesheet" href="abc-gui/dist/abc-gui.css" />
<script src="https://cdn.jsdelivr.net/npm/abcjs@6/dist/abcjs-basic-min.js"></script>
<script>window.abcjs = window.ABCJS;</script>
<script src="abc-gui/dist/index.iife.js"></script>
<script>
  AbcGui.mount(document.getElementById("host"), { value: "X:1\nK:C\n|CDE|" });
</script>
```

**[Live demo](https://tomika.github.io/abc-gui/demo/)** — auto-deployed from `master` via GitHub Pages.

Open [`demo/index.html`](./demo/index.html) locally after `npm run build` for an offline runnable demo.

## API

```ts
mount(container: HTMLElement, options?: {
  value?: string;
  onChange?: (abc: string) => void;
  hideRawView?: boolean;
}): AbcEditor;

interface AbcEditor {
  getValue(): string;
  setValue(abc: string, options?: { silent?: boolean }): void;
  destroy(): void;
}
```

## Supported edits (Phase 1)

| Element       | Structured editors                                                    |
|---------------|-----------------------------------------------------------------------|
| Note          | accidental, pitch letter, octave, length, dotted toggle, decorations  |
| Rest          | kind (`z` / `x` / `Z` / `X`), length                                  |
| Chord `[...]` | per-note accidental/pitch/octave, add/remove notes, chord length      |
| Bar line      | `|`, `||`, `[|`, `|]`, `|:`, `:|`, `::`, `.|`, `|1`, `|2`, `[1`, `[2` |
| `K:` field    | tonic, accidental, mode                                                |
| `M:` field    | presets + free text                                                    |
| `L:` field    | unit-length presets                                                    |
| `Q:` field    | beat fraction + BPM                                                    |
| `T:`, `C:`, `X:`, `V:`, etc. | plain text                                              |
| Any element   | raw-text fallback editor, decorations palette                         |

## Scripts

- `npm run build` — produce ESM + CJS bundles and `.d.ts` into `dist/`.
- `npm run typecheck` — TypeScript check only.
- `npm run test` — run unit tests (vitest).

## License

MIT
