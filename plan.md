# abc-gui — Implementation Plan

A fully-featured WYSIWYG editor for ABC notation (v2.1), delivered as a
framework-agnostic TypeScript npm package. The editor renders an ABC source
string as SVG music notation, lets the user select individual musical
elements, edit their properties in a structured property panel (following the
ABC 2.1 standard), and emits the updated ABC source through a callback.

Reference: https://abcnotation.com/wiki/abc:standard:v2.1

---

## 1. Package shape

- Language: **TypeScript**, compiled to ES2019 modules + UMD bundle.
- **No framework dependency** — plain DOM APIs only.
- Single runtime dependency: **`abcjs`** for the actual music engraving
  (producing SVG). We only use it as a renderer; parsing/editing is our own
  so we preserve the raw text mapping needed for WYSIWYG editing.
- CSS is shipped alongside the JS; imports are side-effect free.

Public API:

```ts
import { mount, AbcEditor, AbcEditorOptions } from "abc-gui";

const editor = mount(document.getElementById("host")!, {
  value: "X:1\nT:Example\nM:4/4\nL:1/8\nK:G\n|GABc d2e2|",
  onChange: (abc: string) => { /* … */ },
});
editor.setValue(newAbc);
editor.destroy();
```

Entry points:
- `dist/index.esm.js`
- `dist/index.umd.js` (global `AbcGui`)
- `dist/index.d.ts`
- `dist/abc-gui.css`

## 2. High-level architecture

```
                ┌─────────────────────────────┐
                │         AbcEditor           │
                │  (controller / root view)   │
                └──────────────┬──────────────┘
                               │
        ┌──────────────┬───────┴────────┬──────────────┐
        ▼              ▼                ▼              ▼
     Toolbar        ScoreView        PropertyPanel   RawView
   (unicode btns)   (abcjs SVG +     (dispatch by     (textarea,
                    click mapping)    element type)    always in sync)
                               │
                               ▼
                        ┌────────────┐
                        │ AbcDocument│  ← single source of truth
                        │  (tokens + │     token stream with
                        │   model)   │     source ranges
                        └────────────┘
```

### 2.1 AbcDocument (core model)

- A **token stream** parsed from the ABC source. Every token records its
  `[start, end)` character range in the original text so the editor can
  perform surgical edits without reformatting the rest of the document.
- Tokens are grouped by *tune* (a reference number field `X:` begins one)
  and within a tune by *line* and *voice*.
- Mutations go through `AbcDocument.replace(range, newText)` which
  re-parses and fires `change`. The editor always re-renders from the
  authoritative text, so the model never drifts from the source.

Token kinds we support (ABC 2.1):

| Kind              | Syntax examples                                   |
|-------------------|---------------------------------------------------|
| `info-field`      | `X:1`, `T:Title`, `C:Composer`, `K:Gm`, `M:3/4`, `L:1/8`, `Q:1/4=120`, `V:1 clef=treble`, `Z:…`, `N:…`, `P:…`, `R:…`, `W:…` |
| `inline-field`    | `[K:D]`, `[M:6/8]`, `[V:2]` inside the music body |
| `note`            | `^A,,2`, `=c'/2`, `_b3/2` (accidental, letter, octave marks, length) |
| `rest`            | `z`, `z2`, `z/2`, `x`, `Z4`                        |
| `chord`           | `[CEG]2`, `[^F=Ac']/2`                             |
| `bar`             | `|`, `||`, `[|`, `|]`, `:|`, `|:`, `::`, `.|`, `[1`, `[2`, `|1`, `|2` |
| `tie`             | `-`                                                |
| `slur-open` / `slur-close` | `(`, `)`                                 |
| `tuplet`          | `(3`, `(3:2:3`                                     |
| `grace-open/close`| `{`, `{/`, `}`                                     |
| `decoration`      | `!trill!`, `!fermata!`, `+staccato+`, shorthand `.`, `~`, `H`, `L`, `M`, `O`, `P`, `S`, `T`, `u`, `v` |
| `chord-symbol`    | `"Am7"`, `"^guitar"`                               |
| `annotation`      | `"@text"`, `"_below"`, `"^above"`, `"<left"`, `">right"` |
| `broken-rhythm`   | `>`, `<`, `>>`, `<<`                               |
| `space` / `eol`   | whitespace, line breaks (with `\` continuation)    |
| `comment`         | `% …`                                              |
| `stylesheet`      | `%%directive …`                                    |

### 2.2 Parser

A hand-written scanner operating on characters. Because ABC is line-oriented
and context-sensitive (header vs. body, in-chord, in-grace), the parser
tracks a small state machine:

1. Split source into lines (preserve CR/LF).
2. Header mode: lines matching `^[A-Za-z]:` are info fields until `K:`
   (which terminates the header and switches to body mode).
3. Body mode: scan music line; handle embedded `[X:…]` inline fields,
   `%…` comments, `\` continuations, and `w:` / `W:` lyric lines.
4. Inside the body, a small tokenizer recognizes the kinds above. It
   keeps a stack for chord `[]`, grace `{}`, and slur nesting so we can
   surface structured selections.

Every token carries:

```ts
interface Token {
  kind: TokenKind;
  start: number;  // offset in original text
  end: number;
  text: string;
  // Kind-specific parsed fields, e.g. for `note`:
  accidental?: "^^"|"^"|"="|"_"|"__";
  letter?: string;       // A–G, a–g
  octave?: number;       // signed count of `,` / `'` applied to letter case
  numerator?: number;    // length numerator (default 1)
  denominator?: number;  // length denominator (default 1)
  dots?: number;         // for `>`/`<` broken rhythm applied to pair
  tiedToNext?: boolean;
  decorations?: string[];
  chordSymbol?: string;  // the `"Am"` attached before the note
  annotation?: string;
}
```

### 2.3 Serializer

Because every token remembers its source range, the serializer for a *single*
element rebuilds only that element's text from its structured fields. The
`AbcDocument.replace(range, newText)` is then called to splice. This keeps
user formatting (spacing, line breaks, comments) untouched outside the edit.

## 3. Rendering & hit-testing

- Call `ABCJS.renderAbc(host, src, params, renderParams, engraverParams)` on
  every change (debounced). Use `add_classes: true` so abcjs emits CSS
  classes on each note/rest/bar group.
- Register a `clickListener` via abcjs — it provides `abcelem` which
  contains `startChar`/`endChar` offsets into the source. We map those
  offsets to our token(s):
  - Find token(s) fully covered by `[startChar, endChar]`.
  - If the click lands on a grouped chord/tuplet, the property panel shows
    the group; a breadcrumb exposes the contained notes.
- Selection is visualized by toggling a CSS class on the clicked `<g>` and
  by highlighting the matching range in the raw-text view.

Keyboard shortcuts (focus on score):

| Key             | Action (Unicode labels in tooltips) |
|-----------------|-------------------------------------|
| `←` / `→`       | Previous / next element             |
| `↑` / `↓`       | Transpose selected note ±1 semitone |
| `Shift+↑/↓`     | Transpose octave                    |
| `+` / `-`       | Lengthen / shorten (×2, /2)         |
| `.`             | Toggle dot / staccato dispatcher    |
| `Delete`        | Remove element                      |
| `Ctrl+Z/Y`      | Undo / redo                         |

## 4. Property panel

The panel is a dispatcher keyed on token kind. Every editor is built from a
small set of primitive widgets (all with Unicode labels):

- Length selector: row of buttons — `𝅝` `𝅗𝅥` `♩` `♪` `♬` `𝅘𝅥𝅲` plus `.` dot
  toggle and free numerator/denominator inputs.
- Accidental: `𝄫` `♭` `♮` `♯` `𝄪` (and “none”).
- Octave: `⬇⬇` `⬇` `·` `⬆` `⬆⬆` (adjusting `,` / `'` and case).
- Articulations / decorations: toggle chips for `staccato .`, `tenuto -`,
  `accent >`, `marcato ^`, `fermata 𝄐`, `trill 𝆖`, `turn 𝆗`, `roll ~`, …
- Tie: checkbox labelled `⌒`.
- Slur open/close: `(` `)` checkboxes.
- Tuplet ratio: inputs `p:q:r`.
- Chord symbol: text input (e.g. `Am7`), plus quick buttons `♯`/`♭` for
  bass.
- Grace-note builder (mini sub-editor).
- Raw text field: always present at the bottom of the panel so a user can
  drop into raw editing for any element (per the requirement).

Per-kind dispatch:

| Token kind    | Editors shown                                                                      |
|---------------|-------------------------------------------------------------------------------------|
| `note`        | accidental, pitch-letter, octave, length, dots, tie, decorations, chord symbol, annotation |
| `rest`        | kind (`z`/`x`/`Z`), length                                                          |
| `chord`       | list of member notes (each reusing the note editor), length on the chord            |
| `bar`         | type selector (`|`, `||`, `[|`, `|]`, `|:`, `:|`, `::`, `[1`, `[2`, `.|`)          |
| `tuplet`      | `p:q:r` inputs                                                                      |
| `slur-open`/`slur-close` | (informational; delete button)                                           |
| `grace`       | toggle acciaccatura `{/…}` vs appoggiatura `{…}`, inner note editor list            |
| `decoration`  | choose from palette                                                                 |
| `chord-symbol`| text                                                                                |
| `annotation`  | position (`^`/`_`/`<`/`>`/`@`) + text                                                |
| `info-field`  | per-field editor:                                                                   |
|               | • `K:` — tonic (C..B), accidental, mode (maj/min/dor/mix/…), explicit accidentals   |
|               | • `M:` — numerator/denominator or `C`/`C|`                                          |
|               | • `L:` — unit-length presets (`1/4`, `1/8`, `1/16`)                                 |
|               | • `Q:` — beat note + BPM (and optional text)                                        |
|               | • `V:` — id, clef, name, subname, stafflines                                         |
|               | • `T:`/`C:`/`Z:`/`N:`/`R:`/`W:`/`w:` — plain text                                   |
|               | • `X:` — integer                                                                    |
| `stylesheet`  | raw-only with known `%%directive` hints                                             |
| `comment`     | raw-only                                                                            |

## 5. Toolbar (Unicode-only)

Organized in groups; every button has `title=` for accessibility and a
Unicode glyph for language independence:

- Insert: `♪` note, `𝄽` rest, `[♪]` chord, `∣` bar, `(3` tuplet, `⌒` tie,
  `⌢` slur, `{♪}` grace, `♮`/`♯`/`♭` accidentals, `"Am"` chord symbol,
  `𝄐` fermata, `·` staccato.
- Structure: `K:` key, `M:` meter, `L:` length, `Q:` tempo, `V:` voice,
  `X:` new tune, `T:` title.
- Edit: `↶` undo, `↷` redo, `⌫` delete, `⇡`/`⇣` octave, `⇑`/`⇓` semitone,
  `×2`/`÷2` length, `✎` raw edit toggle.
- View: `🔍+` / `🔍−` zoom, `⇵` show/hide raw pane.

## 6. Raw view & round-trip

A read/write textarea bound to the same document. Typing there updates the
model, which re-renders the score. Programmatic edits (from the property
panel) update the textarea in place. This is the canonical fallback for
anything the structured editors don't yet cover and satisfies the
requirement that *any* element's raw content be editable.

## 7. Change callback contract

- `onChange(abc: string)` fires after every mutation (raw or structured),
  debounced by ~50 ms.
- `setValue(abc: string, { silent? })` replaces the document without
  firing change when `silent`.
- `getValue()` returns current ABC source.
- `on('select', (el) => …)` and `on('error', (err) => …)` events.

## 8. Build, test, lint

- `tsc` for type-checking and `.d.ts` emission.
- `esbuild` (dev dep) to produce ESM + UMD bundles.
- `vitest` for unit tests:
  - Tokenizer round-trip on a corpus of tunes.
  - Structured edits preserve untouched source regions exactly.
  - Property-panel edits produce expected ABC fragments.
- `eslint` + `prettier` (minimal shared configs).

## 9. Deliverables

1. `package.json` with `main`, `module`, `types`, `exports`.
2. `src/` TypeScript sources (parser, model, editor, panel, renderer).
3. `demo/index.html` — loads the UMD bundle and shows the editor editing a
   small tune with a live callback console.
4. `README.md` — usage, API, supported features, keyboard map.
5. `plan.md` — this file.

## 10. Phased delivery

This PR lands the foundation end-to-end so the package is importable and
the round-trip works for the most common elements. Subsequent PRs extend
coverage for the long tail (multi-voice layout, stylesheet directives,
lyrics alignment, etc.).

- **Phase 1 (this PR)**: scaffold, parser for header + body (notes, rests,
  chords, bars, decorations, ties, slurs, tuplets, grace, chord symbols,
  annotations, info-fields, inline-fields), abcjs render + click mapping,
  property panel with editors for note / rest / chord / bar / tuplet /
  decoration / chord-symbol / K / M / L / Q / T / X / V, raw view,
  Unicode toolbar for insert-note/rest/bar and accidentals, onChange
  callback, demo page, unit tests.
- **Phase 2**: undo/redo history, keyboard navigation, annotations editor,
  full decorations palette, lyrics (`w:`) alignment, voice/staff UI,
  stylesheet directive editors.
- **Phase 3**: drag-to-reorder, note drag-pitch on SVG, MIDI preview
  integration (via abcjs' synth).
