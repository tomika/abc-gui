# abc-gui

Fully-featured WYSIWYG editor for [ABC music notation](https://abcnotation.com/wiki/abc:standard:v2.1), distributed as a framework-free TypeScript npm package.

- Renders the score with [abcjs](https://www.npmjs.com/package/abcjs).
- Click any element (note, rest, chord, bar, header field) to edit its properties in a structured panel built from the ABC v2.1 standard.
- Every element also exposes a raw-text editor, so anything not (yet) covered by the structured UI can still be edited.
- Unicode glyphs on all buttons → language-independent UI.
- No React / Angular / Vue.

## Install

Install directly from GitHub:

```sh
npm install github:tomika/abc-gui
```


## Usage

```ts
import { mount } from "abc-gui";
import "abc-gui/style.css";

const editor = mount(document.getElementById("host")!, {
  value: "X:1\nT:Example\nM:4/4\nL:1/8\nK:G\n|GABc d2ef|",
  locale: "en",
  theme: "light",
  chordEditor: async (seed) => ({
    chordName: "Cm7",
    chordMidiValues: [60, 63, 67, 70]
  }),
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
The demo initializes theme from your system color-scheme preference (`prefers-color-scheme`), and shows a first-run splash screen built from `editor.getTutorialHtml()` (click the **Help** button to reopen).

## API

```ts
mount(container: HTMLElement, options?: {
  value?: string;
  onChange?: (abc: string) => void;
  hideRawView?: boolean;
  locale?: "en" | "hu" | Strings;
  theme?: "light" | "dark";
  /**
   * Injection point for an external chord-selector UI. When provided,
   * small "…" buttons appear next to chord-symbol annotations and inside
   * the chord-note tab bar. Clicking one invokes this callback with the
   * current chord (ABC text) as a seed. The host application is
   * responsible for showing whatever chord-picker UI it likes and
   * resolving the promise with the chosen chord name and the MIDI values
   * of its notes.
   */
  chordEditor?: (chord: string) => Promise<{
    chordName: string;
    chordMidiValues: number[];
  }>;
}): AbcEditor;

interface AbcEditor {
  getValue(): string;
  setValue(abc: string, options?: { silent?: boolean }): void;
  setLocale(locale: "en" | "hu" | Strings): void;
  setTheme(theme: "light" | "dark"): void;
  /**
   * Return a short HTML usage tutorial in the currently active locale.
   * Suitable for dropping into a splash-screen or help dialog.
   */
  getTutorialHtml(): string;
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
