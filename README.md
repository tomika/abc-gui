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
  abcjsOptions: { germanAlphabet: false },
  chordEditor: async (seed) => ({
    chordName: "Cm7",
    chordMidiValues: [60, 63, 67, 70]
  }),
  chordVerifier: (chordName, germanAlphabet) => {
    // Example strict verifier: root + optional accidental + known quality.
    const normalized = germanAlphabet
      ? chordName.replace(/^H/, "B").replace(/^B(?!b)/, "Bb")
      : chordName;
    return /^\(?[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?\d*(?:\/[A-G](?:#|b)?)?\)?$/i
      .test(normalized.trim());
  },
  onChange: (abc) => console.log("new abc:", abc)
});

editor.setValue(newAbc);   // replace programmatically
editor.getValue();          // read the current source
editor.setAbcjsOptions({ germanAlphabet: true });
editor.destroy();           // tear down
```

In the browser via the IIFE bundle:

```html
<link rel="stylesheet" href="abc-gui/dist/abc-gui.css" />
<script src="https://cdn.jsdelivr.net/npm/abcjs@6/dist/abcjs-basic-min.js"></script>
<script>window.abcjs = window.ABCJS;</script>
<script src="abc-gui/dist/index.iife.js"></script>
<script>
  AbcGui.mount(document.getElementById("host"), { value: "X:1\nK:C\n|CDE|" });
</script>
```

**[Live demo](https://tomika.github.io/abc-gui/demo/)** — auto-deployed via GitHub Pages.

Open [`demo/index.html`](./demo/index.html) locally after `npm run build` for an offline runnable demo.
The demo initializes theme from your system color-scheme preference (`prefers-color-scheme`), and shows a first-run splash screen built from `editor.getTutorialHtml()` (click the **Help** button to reopen).
It also switches abcjs note naming to `germanAlphabet` while Hungarian UI is selected.

## abcjs options header

Click **⚙** in the editor toolbar to open the header settings (tooltip:
**Header settings**, or **Fejlécparaméterek** in Hungarian). The form includes
swing (a slider from 50 to 75, plus a number field that also accepts decimals
such as `66.67`), playback tempo, instrument
selectors, accompaniment volumes and score appearance. It also works
when the raw ABC pane is hidden. **Apply** saves the settings; **Cancel** or Escape
discards the draft. **Reset settings**, followed by Apply, removes the header.
The **Advanced: all options (JSON)** section exposes additional abcjs parameters
and preserves settings not covered by the form. All changes support undo/redo.

An optional JSON object at the start of the source, followed by a line containing
`---`, sets abcjs rendering and playback options:

```abc
{ "swing": 65 }
---
Q:1/4=120
K:F
M:4/4
"F"z2AA BABd|"C"cGEc "Bb"BFDB|"F/A"AFCA "Gm"GABA|
```

This header is an abc-gui extension to ABC notation. abcjs expects settings as
JavaScript API parameters: abc-gui reads the JSON and forwards supported data
options to the parser, renderer and [`CreateSynth.init({ options: ... })`](https://docs.abcjs.net/audio/synthesized-sound#init-synthoptions).
For example, `swing`, `chordsOff`, `program` and `qpm` control playback, while
`jazzchords`, `scale` and `format` control engraving. Host-provided `abcjsOptions`
override header values for rendering. Complete parsing, selection and the
editor's click handler always remain enabled.

Playback accepts `swing`, `qpm`, `defaultQpm`, `program`, `midiTranspose`, `channel`,
`chordsOff`, `voicesOff`, `bassprog`, `chordprog`, `bassvol`, `chordvol`, `gchord`,
`drum`, `drumBars`, `drumIntro`, `drumOff`, `pan`, `fadeLength` and
`soundFontVolumeMultiplier`, with matching data types. Rendering accepts the
appearance controls in the dialog, standard font/format settings, wrapping,
line breaks, colors and spacing. Unknown keys, callbacks, parser-control
switches and document-provided `soundFontUrl` values are preserved in the JSON
but never passed to abcjs.

The [abcjs swing example](https://paulrosen.github.io/abcjs/examples/editor-swing.html)
defines swing as the percentage of a note pair occupied by the first note:
`50` or less means straight timing, `65` gives a 65:35 ratio, approximately `66.67`
gives triplet swing, and abcjs caps it at `75`. Any non-negative number is
accepted, including decimals. In meters with denominator 4 it affects
eighth notes; with denominator 8 it affects sixteenth notes. The written score
stays unchanged.

The JSON can span multiple lines. It stays intact in `getValue()`, `onChange`,
note edits and undo/redo. Changing or removing it refreshes playback options.
Invalid JSON is ignored with one browser-console diagnostic per invalid-header episode, while the ABC body
remains editable and playable.

### Host defaults

The host application can supply a default for any header option, and decide
per option whether the user may change it:

```ts
const editor = mount(host, {
  headerOptionDefaults: {
    swing: { value: 60 },                  // the header may override it
    program: { value: 24 },                // nylon guitar unless the header says otherwise
    qpm: { value: 100, editable: false },  // fixed: the header cannot change it
  },
});

editor.setHeaderOptionDefaults({ swing: { value: 65 } }); // replaces all defaults
```

For each option, the value comes from the first source that sets it:

1. `abcjsOptions` given by the host (rendering only)
2. a default with `editable: false`
3. the document header
4. a default with `editable: true` (the default)
5. the abcjs built-in default

Defaults are never written into the document, so `getValue()` returns only what
the user wrote. Defaults are checked like header values; invalid or
unsupported entries are ignored with a console warning. `format` and `wrap` are
replaced as a whole, not merged key by key.

In the header settings dialog:

- Editable defaults appear as the placeholder or as the **Default (…)** choice.
  The swing and volume sliders rest at the default value.
- Fixed values, from `editable: false` or from header keys in `abcjsOptions`, are
  read-only and show the value the host sets. Apply refuses a draft that changes
  them, including through the JSON editor. **Reset settings** keeps the
  document's own entries for them, so the document still carries those values
  into contexts where they are editable.
- If the raw ABC pane is used to set a fixed option in the header, the header
  value is kept in the text but has no effect.

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
  /**
   * Optional stricter validator for attached chord symbols ("...").
   * If omitted, abc-gui falls back to abcjs-compatible permissive checking.
   * `chordName` is the text as shown in the UI.
   */
  chordVerifier?: (chordName: string, germanAlphabet: boolean) => boolean;
  /**
   * Forwarded to abcjs.renderAbc (e.g. germanAlphabet, jazzchords,
   * visualTranspose, scale, staffwidth, format, ...). Keys the options
   * header also supports are fixed and shown read-only in the settings dialog.
   */
  abcjsOptions?: AbcVisualParams;
  /**
   * Defaults for the options header, per option: `value` applies when the
   * header does not set it; `editable: false` fixes it (see "Host defaults").
   */
  headerOptionDefaults?: HeaderOptionDefaults;
}): AbcEditor;

type HeaderOptionDefaults = {
  [K in HeaderOptionKey]?: { value: HeaderOptionValues[K]; editable?: boolean };
};

interface AbcEditor {
  getValue(): string;
  setValue(abc: string, options?: { silent?: boolean }): void;
  setLocale(locale: "en" | "hu" | Strings): void;
  setTheme(theme: "light" | "dark"): void;
  setAbcjsOptions(params: AbcVisualParams): void;
  /** Replace the options-header defaults; re-renders the score. */
  setHeaderOptionDefaults(defaults: HeaderOptionDefaults): void;
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
