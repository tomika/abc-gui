/**
 * Property panel: renders editors for the currently selected element.
 *
 * Dispatching is driven by abcjs' `el_type` plus a micro-parser of the raw
 * source span to pick up syntax abcjs doesn't preserve literally (octave
 * marks, raw length fraction, etc.). Every editor also shows a raw-text
 * fallback so anything not yet covered can still be edited.
 */

import { AbcDocument, AbcElement } from "../model/document.js";
import {
  ParsedNote,
  ParsedChord,
  ParsedRest,
  ParsedInfoField,
  ElementPrefix,
  ParsedAnnotation,
  readNote,
  readRest,
  readChord,
  readInfoLine,
  readInlineField,
  readPrefix,
  writeNote,
  writeRest,
  writeChord,
  writeInfoLine,
  writeInlineField,
  writePrefix,
  ACCIDENTALS,
  ACCIDENTAL_GLYPH,
  Accidental,
  BAR_TYPES,
  DECORATIONS
} from "../parser/element.js";
import { el, clear, button } from "./dom.js";

export interface Selection {
  startChar: number;
  endChar: number;
  abcelem?: AbcElement | null;
}

export class PropertyPanel {
  private host: HTMLElement;
  private doc: AbcDocument;
  private current: Selection | null = null;
  private pendingAnnotationFocusIndex: number | null = null;
  private chordActiveTab = 0;

  constructor(host: HTMLElement, doc: AbcDocument) {
    this.host = host;
    this.doc = doc;
    this.host.classList.add("abc-gui-panel");
    this.render();
  }

  setSelection(
    sel: Selection | null,
    opts: { preserveChordTab?: boolean } = {}
  ): void {
    // When the selection moves to a different element, reset the chord
    // tab index so a freshly-clicked chord starts on its first note.
    if (
      !opts.preserveChordTab &&
      (
        !sel ||
        !this.current ||
        sel.startChar !== this.current.startChar ||
        sel.endChar !== this.current.endChar
      )
    ) {
      this.chordActiveTab = 0;
    }
    this.current = sel;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  // ------------------------------------------------------------------
  // Top-level rendering
  // ------------------------------------------------------------------

  private render(): void {
    clear(this.host);
    if (!this.current) {
      this.host.append(
        el("div", { class: "abc-gui-panel-empty" }, [
          "Click a note, rest, bar, or header line to edit its properties."
        ])
      );
      return;
    }
    const { startChar, endChar } = this.current;
    const raw = this.doc.slice(startChar, endChar);

    // Peel off leading decorations / chord symbols / annotations / grace
    // notes. abcjs includes these in the note's startChar..endChar range.
    // We also tolerate trailing whitespace that abcjs sometimes includes.
    const leadingWs = raw.match(/^\s*/)![0].length;
    const trailingWs = raw.match(/\s*$/)![0].length;
    const inner = raw.slice(leadingWs, raw.length - trailingWs);
    const prefix = readPrefix(inner, 0);
    const coreStart = startChar + leadingWs + prefix.end;
    const coreEnd = endChar - trailingWs;
    const core = this.doc.slice(coreStart, coreEnd);
    const kind = this.classify(core);

    const header = el("div", { class: "abc-gui-panel-header" }, [
      el("span", { class: "abc-gui-kind" }, [kindLabel(kind)]),
      el("span", { class: "abc-gui-range" }, [`${startChar}…${endChar}`])
    ]);
    this.host.append(header);

    // Show editors for attached prefix components. Always present for
    // note/rest/chord so the user can add annotations / decorations /
    // grace-notes even when none are currently attached.
    const supportsPrefix =
      kind === "note" || kind === "chord" || kind === "rest";

    if (supportsPrefix) {
      this.host.append(
        this.prefixEditor(prefix, coreStart, (next) => {
          const prefixText = writePrefix(next);
          // Replace the old prefix region (from startChar up to coreStart)
          // with the newly-serialized one.
          this.applyRange(startChar, coreStart, prefixText);
        })
      );
      // Group / binding row (triplets, slurs, ties) — these tokens live
      // OUTSIDE the element span abcjs reports, so we edit them through
      // the document directly while keeping the element selected.
      this.host.append(this.bindingRow(startChar, endChar));
    }

    switch (kind) {
      case "note":
        this.renderNoteEditor(core, coreStart, coreEnd);
        break;
      case "chord":
        this.renderChordEditor(core, coreStart, coreEnd);
        break;
      case "rest":
        this.renderRestEditor(core, coreStart, coreEnd);
        break;
      case "bar":
        this.renderBarEditor(core, coreStart, coreEnd);
        break;
      case "info-line":
        this.renderInfoFieldEditor(core, coreStart, coreEnd, /*inline*/ false);
        break;
      case "inline-field":
        this.renderInfoFieldEditor(core, coreStart, coreEnd, /*inline*/ true);
        break;
      default:
        this.renderDecorationsForElement(core, coreStart, coreEnd);
    }

    // Raw fallback — always present (covers the WHOLE selection, prefix + core).
    this.host.append(this.buildRawEditor(raw, startChar, endChar));
  }

  private classify(raw: string):
    | "note"
    | "chord"
    | "rest"
    | "bar"
    | "info-line"
    | "inline-field"
    | "other" {
    // Trim surrounding whitespace-indices that abcjs sometimes includes.
    const s = raw.trim();
    if (!s) return "other";
    if (/^\[[A-Za-z]:.+\]$/.test(s)) return "inline-field";
    if (/^[A-Za-z]:.*$/m.test(s) && !/[|\[]/.test(s[0]!)) {
      // header lines are at most a single logical line
      if (!/\n/.test(s)) return "info-line";
    }
    if (s.startsWith("[") && s.includes("]")) return "chord";
    if (/^[zxZX]/.test(s)) return "rest";
    if (/^[|:\[\].]/.test(s[0]!) && /^[|:\[\].0-9,\-]+$/.test(s)) return "bar";
    if (readNote(s, 0)) return "note";
    return "other";
  }

  // ------------------------------------------------------------------
  // Editors
  // ------------------------------------------------------------------

  private renderNoteEditor(raw: string, start: number, end: number) {
    const parsed = readNote(raw.trim(), 0);
    if (!parsed) return;
    const apply = (patch: Partial<ParsedNote>) => {
      const next: ParsedNote = { ...parsed, ...patch };
      this.applyRange(start, end, writeNote(next));
    };
    this.host.append(
      this.accidentalRow(parsed.accidental, (a) => apply({ accidental: a })),
      this.pitchRow(parsed.letter, (l) => apply({ letter: l })),
      this.octaveRow(parsed.octave, (o) => apply({ octave: o })),
      this.unitLengthInfoRow(start, parsed.num, parsed.den),
      this.lengthRow(start, parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      ),
      this.dotRow(start, parsed.num, parsed.den, (n, d) => apply({ num: n, den: d }))
    );
  }

  private renderChordEditor(raw: string, start: number, end: number) {
    const parsed = readChord(raw.trim(), 0);
    if (!parsed) return;
    const applyChord = (c: ParsedChord) => {
      this.applyRange(start, end, writeChord(c));
    };
    // Chord-level length
    this.host.append(
      el("div", { class: "abc-gui-section-title" }, ["Chord length"]),
      this.unitLengthInfoRow(start, parsed.num, parsed.den),
      this.lengthRow(start, parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      }),
      this.dotRow(start, parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      })
    );
    // Per-note tab view. The active tab index is persisted on the panel
    // so that editing a note's attribute (which re-renders the whole
    // panel) doesn't bounce the user back to the first tab.
    this.host.append(
      el("div", { class: "abc-gui-section-title" }, ["Notes in chord"])
    );
    const initialTab = Math.max(
      0,
      Math.min(this.chordActiveTab, parsed.notes.length - 1)
    );
    const tabBar = el("div", { class: "abc-gui-chord-tabs" });
    const pane = el("div", { class: "abc-gui-chord-pane" });

    const renderTab = (idx: number) => {
      this.chordActiveTab = idx;
      // Rebuild tab buttons
      clear(tabBar);
      parsed.notes.forEach((n, i) => {
        const tab = button(
          writeNote(n),
          `Edit note ${i + 1}`,
          () => renderTab(i),
          { active: i === idx, className: "abc-gui-chord-tab" }
        );
        tabBar.append(tab);
      });
      // Add-note "+" tab
      tabBar.append(
        button("＋", "Add note to chord", () => {
          this.chordActiveTab = parsed.notes.length; // select the new note
          const next: ParsedChord = {
            ...parsed,
            notes: [...parsed.notes, { accidental: "", letter: "C", octave: 0, num: 1, den: 1 }]
          };
          applyChord(next);
        }, { className: "abc-gui-chord-tab abc-gui-chord-tab-add" })
      );
      // Rebuild pane content
      clear(pane);
      const note = parsed.notes[idx];
      const update = (patch: Partial<ParsedNote>) => {
        const next: ParsedChord = { ...parsed, notes: parsed.notes.slice() };
        next.notes[idx] = { ...note, ...patch };
        applyChord(next);
      };
      pane.append(
        this.accidentalRow(note.accidental, (a) => update({ accidental: a })),
        this.pitchRow(note.letter, (l) => update({ letter: l })),
        this.octaveRow(note.octave, (o) => update({ octave: o }))
      );
      if (parsed.notes.length > 1) {
        pane.append(
          button("✕ Remove note", `Remove note ${idx + 1} from chord`, () => {
            // After removal, keep the tab index in range.
            this.chordActiveTab = Math.max(0, idx - 1);
            const next: ParsedChord = {
              ...parsed,
              notes: parsed.notes.filter((_, i) => i !== idx)
            };
            applyChord(next);
          }, { className: "abc-gui-chord-note-remove" })
        );
      }
    };

    renderTab(initialTab);
    this.host.append(tabBar, pane);
  }

  private renderRestEditor(raw: string, start: number, end: number) {
    const parsed = readRest(raw.trim(), 0);
    if (!parsed) return;
    const apply = (patch: Partial<ParsedRest>) => {
      const next: ParsedRest = { ...parsed, ...patch };
      this.applyRange(start, end, writeRest(next));
    };
    const variantRow = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Kind"])
    ]);
    const variants: { v: ParsedRest["variant"]; glyph: string; title: string }[] = [
      { v: "z", glyph: "𝄽", title: "rest (z)" },
      { v: "x", glyph: "×", title: "invisible rest (x)" },
      { v: "Z", glyph: "𝄻", title: "whole-measure rest (Z)" },
      { v: "X", glyph: "⌀", title: "invisible whole-measure rest (X)" }
    ];
    for (const v of variants) {
      variantRow.append(
        button(v.glyph, v.title, () => apply({ variant: v.v }), {
          active: parsed.variant === v.v
        })
      );
    }
    this.host.append(
      variantRow,
      this.unitLengthInfoRow(start, parsed.num, parsed.den),
      this.lengthRow(start, parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      )
    );
  }

  private renderBarEditor(raw: string, start: number, end: number) {
    const current = raw.trim();
    // Strip trailing volta numbers (e.g. |:1,2,3 → |:) for button matching.
    const barLine = current.replace(/[0-9,\-]+$/, "");

    const row = el("div", { class: "abc-gui-row abc-gui-bar-row" });
    for (const b of BAR_TYPES) {
      row.append(
        button(
          b.label,
          b.title,
          () => this.applyRange(start, end, b.value),
          { active: barLine === b.value }
        )
      );
    }
    this.host.append(row);
  }

  private renderInfoFieldEditor(
    raw: string,
    start: number,
    end: number,
    inline: boolean
  ) {
    const parsed = inline
      ? readInlineField(raw.trim())
      : readInfoLine(raw.trim());
    if (!parsed) return;
    const write = (f: ParsedInfoField) =>
      inline ? writeInlineField(f) : writeInfoLine(f);
    const apply = (patch: Partial<ParsedInfoField>) => {
      this.applyRange(start, end, write({ ...parsed, ...patch }));
    };

    // Dedicated editors for common fields.
    switch (parsed.name) {
      case "K":
        this.host.append(this.keyEditor(parsed.value, (v) => apply({ value: v })));
        break;
      case "M":
        this.host.append(this.meterEditor(parsed.value, (v) => apply({ value: v })));
        break;
      case "L":
        this.host.append(this.unitLengthEditor(parsed.value, (v) => apply({ value: v })));
        break;
      case "Q":
        this.host.append(this.tempoEditor(parsed.value, (v) => apply({ value: v })));
        break;
      default: {
        // Plain text editor for T:, C:, X:, V:, etc.
        const input = el("input", {
          class: "abc-gui-input",
          value: parsed.value
        }) as HTMLInputElement;
        input.addEventListener("input", () => apply({ value: input.value }));
        this.host.append(
          el("div", { class: "abc-gui-row" }, [
            el("span", { class: "abc-gui-label" }, [
              parsed.name + ":"
            ]),
            input
          ])
        );
      }
    }
  }

  private renderDecorationsForElement(_raw: string, _start: number, _end: number) {
    // Unknown element kinds have no dedicated editor; the raw-text editor
    // below still lets the user modify the span freely.
  }

  /**
   * Group / binding row for a note, chord, or rest. These tokens — triplet
   * marker `(3`, slur start `(`, slur end `)`, and tie `-` — live OUTSIDE
   * the element span abcjs reports (they are span-level, not element-level
   * syntax), so we detect them by inspecting the raw source immediately
   * before/after the element and toggle them via `applyAround` so the
   * element stays selected after the edit.
   */
  private bindingRow(start: number, end: number): HTMLElement {
    const v = this.doc.value;

    // Find the nearest non-whitespace position to the LEFT of `start` so we
    // can recognize triplet/slur prefixes that the user spaced apart.
    let leftEnd = start; // exclusive end of the gap
    let leftStart = start;
    while (leftStart > 0 && (v[leftStart - 1] === " " || v[leftStart - 1] === "\t")) {
      leftStart--;
    }
    // Triplet: "(3" immediately before (skipping whitespace).
    const hasTriplet =
      leftStart >= 2 &&
      v[leftStart - 2] === "(" &&
      v[leftStart - 1] === "3";
    // Slur start: "(" immediately before (and NOT followed by a digit so we
    // don't confuse it with a tuplet marker).
    const hasSlurStart =
      !hasTriplet &&
      leftStart >= 1 &&
      v[leftStart - 1] === "(" &&
      !(leftStart < v.length && /[0-9]/.test(v[leftStart] ?? ""));

    // Find the nearest non-whitespace position to the RIGHT of `end`.
    let rightStart = end;
    while (rightStart < v.length && (v[rightStart] === " " || v[rightStart] === "\t")) {
      rightStart++;
    }
    const hasSlurEnd = v[rightStart] === ")";
    // Tie: "-" attached after the element (possibly after a slur close).
    let tieProbe = rightStart;
    if (v[tieProbe] === ")") tieProbe++;
    while (tieProbe < v.length && (v[tieProbe] === " " || v[tieProbe] === "\t")) tieProbe++;
    const hasTie = v[tieProbe] === "-";

    const row = el("div", { class: "abc-gui-row abc-gui-binding-row" }, [
      el("span", { class: "abc-gui-label" }, ["Group"])
    ]);

    // Triplet (3 — toggle by inserting/removing "(3" right before the element.
    row.append(
      button(
        "(3",
        hasTriplet
          ? "remove triplet marker"
          : "start triplet (this note + next two)",
        () => {
          if (hasTriplet) {
            this.applyAround(leftStart - 2, leftStart, "", start, end);
          } else {
            this.applyAround(start, start, "(3", start, end);
          }
        },
        { active: hasTriplet }
      )
    );

    // Slur start (
    row.append(
      button(
        "(",
        hasSlurStart ? "remove slur start" : "start slur",
        () => {
          if (hasSlurStart) {
            this.applyAround(leftStart - 1, leftStart, "", start, end);
          } else {
            this.applyAround(start, start, "(", start, end);
          }
        },
        { active: hasSlurStart }
      )
    );

    // Slur end )
    row.append(
      button(
        ")",
        hasSlurEnd ? "remove slur end" : "end slur",
        () => {
          if (hasSlurEnd) {
            this.applyAround(rightStart, rightStart + 1, "", start, end);
          } else {
            this.applyAround(end, end, ")", start, end);
          }
        },
        { active: hasSlurEnd }
      )
    );

    // Tie ⌒ (suffix `-`)
    row.append(
      button(
        "⌒",
        hasTie ? "remove tie to next note" : "tie to next note",
        () => {
          if (hasTie) {
            this.applyAround(tieProbe, tieProbe + 1, "", start, end);
          } else {
            this.applyAround(end, end, "-", start, end);
          }
        },
        { active: hasTie }
      )
    );

    return row;
  }

  // ------------------------------------------------------------------
  // Reusable widgets
  // ------------------------------------------------------------------

  private accidentalRow(current: Accidental, onChange: (a: Accidental) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Accidental"])
    ]);
    for (const a of ACCIDENTALS) {
      row.append(
        button(
          a === "" ? "∅" : ACCIDENTAL_GLYPH[a],
          a === "" ? "no accidental" : a,
          () => onChange(a),
          { active: current === a }
        )
      );
    }
    return row;
  }

  private pitchRow(current: string, onChange: (letter: string) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Pitch"])
    ]);
    for (const L of ["C", "D", "E", "F", "G", "A", "B"]) {
      row.append(button(L, `pitch ${L}`, () => onChange(L), { active: current === L }));
    }
    return row;
  }

  private octaveRow(current: number, onChange: (o: number) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Octave"]),
      button("⇊", "down octave", () => onChange(current - 1)),
      el("span", { class: "abc-gui-readout" }, [String(current)]),
      button("⇈", "up octave", () => onChange(current + 1))
    ]);
    return row;
  }

  /**
   * A read-only row that shows the effective `L:` (unit note length) in
   * force at `offsetInDoc`, plus the absolute duration of the current note
   * (= num × L / den) as an irreducible fraction. This makes the length
   * buttons below (which are relative to L:) meaningful to the user and
   * clarifies that L: is a positional, stateful directive that can change
   * anywhere in the tune.
   */
  private unitLengthInfoRow(
    offsetInDoc: number,
    num: number,
    den: number
  ): HTMLElement {
    const L = this.doc.unitLengthAt(offsetInDoc);
    // Absolute duration = (num / den) × (L.num / L.den) = (num·L.num) / (den·L.den)
    const an = num * L.num;
    const ad = den * L.den;
    const g = gcd(an, ad);
    const absolute = `${an / g}/${ad / g}`;
    return el("div", { class: "abc-gui-row abc-gui-unitlen" }, [
      el("span", { class: "abc-gui-label" }, ["Unit (L:)"]),
      el(
        "span",
        {
          class: "abc-gui-readout",
          title:
            "Effective unit note length at this position. L: is stateful — the most recent L: (header, body, or inline) wins."
        },
        [`${L.num}/${L.den}`]
      ),
      el("span", { class: "abc-gui-muted" }, [
        "→ note duration = ",
        absolute
      ])
    ]);
  }

  private lengthRow(
    offsetInDoc: number,
    num: number,
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Length"])
    ]);
    // Buttons express ABSOLUTE note durations (whole, half, quarter, …) so
    // the glyph the user sees matches the actual rhythmic value regardless
    // of the effective `L:` directive. The stored value in the source is
    // always the ratio relative to L:, so we convert both ways here.
    const L = this.doc.unitLengthAt(offsetInDoc);
    const g0 = gcd(num * L.num, den * L.den);
    const absNum = (num * L.num) / g0;
    const absDen = (den * L.den) / g0;
    const dottedBase = this.dottedBaseRelativeAt(offsetInDoc, num, den);
    let baseAbsNum = absNum;
    let baseAbsDen = absDen;
    if (dottedBase) {
      const gb = gcd(dottedBase.num * L.num, dottedBase.den * L.den);
      baseAbsNum = (dottedBase.num * L.num) / gb;
      baseAbsDen = (dottedBase.den * L.den) / gb;
    }
    for (const p of ABSOLUTE_LENGTH_PRESETS) {
      // relative length = absolute ÷ L
      const relN = p.num * L.den;
      const relD = p.den * L.num;
      const gr = gcd(relN, relD);
      const rn = relN / gr;
      const rd = relD / gr;
      const isExact = p.num === absNum && p.den === absDen;
      const isBaseForDotted =
        !!dottedBase && p.num === baseAbsNum && p.den === baseAbsDen;
      row.append(
        button(p.glyph, `${p.title} (= ${rn}/${rd} × L)`, () => onChange(rn, rd), {
          active: isExact || isBaseForDotted
        })
      );
    }
    // Free-form (still relative to L:, matching the stored source form).
    const numInput = el("input", {
      class: "abc-gui-input abc-gui-input-small",
      value: String(num),
      type: "number",
      min: "1"
    }) as HTMLInputElement;
    const denInput = el("input", {
      class: "abc-gui-input abc-gui-input-small",
      value: String(den),
      type: "number",
      min: "1"
    }) as HTMLInputElement;
    const syncFree = () => {
      const n = Math.max(1, parseInt(numInput.value, 10) || 1);
      const d = Math.max(1, parseInt(denInput.value, 10) || 1);
      onChange(n, d);
    };
    numInput.addEventListener("change", syncFree);
    denInput.addEventListener("change", syncFree);
    row.append(numInput, el("span", {}, ["/"]), denInput);
    return row;
  }

  /** Toggle dotted rhythm against known base-length presets.
   *
   * We treat a value as dotted when it matches (base × 3/2) for one of the
   * panel's canonical base presets at the current effective L:. This avoids
   * false negatives like 3/1 (dotted quarter when L:1/8), which the old
   * "3/even" heuristic misses.
   */
  private dotRow(
    offsetInDoc: number,
    num: number,
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const dottedBase = this.dottedBaseRelativeAt(offsetInDoc, num, den);
    const isDotted = !!dottedBase;
    return el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Dot"]),
      button(
        "·",
        "toggle dotted length (×3/2)",
        () => {
          if (dottedBase) onChange(dottedBase.num, dottedBase.den);
          else onChange(num * 3, den * 2);
        },
        { active: isDotted }
      )
    ]);
  }

  /**
   * If current relative length equals (presetBase × 3/2) at this position's
   * effective L:, return that base relative fraction; otherwise null.
   */
  private dottedBaseRelativeAt(
    offsetInDoc: number,
    num: number,
    den: number
  ): { num: number; den: number } | null {
    const cg = gcd(num, den);
    const cnum = num / cg;
    const cden = den / cg;
    const L = this.doc.unitLengthAt(offsetInDoc);
    for (const p of ABSOLUTE_LENGTH_PRESETS) {
      // Base in source-relative terms: base = presetAbsolute ÷ L.
      const relN = p.num * L.den;
      const relD = p.den * L.num;
      const rg = gcd(relN, relD);
      const bnum = relN / rg;
      const bden = relD / rg;

      // Dotted candidate = base × 3/2.
      const dotN = bnum * 3;
      const dotD = bden * 2;
      const dg = gcd(dotN, dotD);
      if (dotN / dg === cnum && dotD / dg === cden) {
        return { num: bnum, den: bden };
      }
    }
    return null;
  }

  /**
   * Edit the prefix attached to a note / rest / chord — namely the chord
   * symbols and annotations (`"Gm"`, `"^text"`), decorations (`!trill!`),
   * and grace notes (`{cd}`) that abcjs folds into the element's startChar
   * range. `onChange` is called with the full updated prefix object.
   */
  private prefixEditor(
    prefix: ElementPrefix,
    _coreStart: number,
    onChange: (next: ElementPrefix) => void
  ): HTMLElement {
    const wrap = el("div", { class: "abc-gui-prefix" });
    wrap.append(
      el("div", { class: "abc-gui-section-title" }, ["Attached"])
    );

    // Annotations / chord symbols --------------------------------------
    const annoRow = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ['Chord / text'])
    ]);
    prefix.annotations.forEach((a, idx) => {
      const placeSel = el("select", { class: "abc-gui-input" }) as HTMLSelectElement;
      for (const [v, label, title] of [
        ["", "♩", "chord symbol"],
        ["^", "↑", "above"],
        ["_", "↓", "below"],
        ["<", "←", "left"],
        [">", "→", "right"],
        ["@", "@", "free placement"]
      ] as const) {
        const o = el("option", { value: v, title }, [label]) as HTMLOptionElement;
        if (v === a.placement) o.selected = true;
        placeSel.append(o);
      }
      const textInput = el("input", {
        class: "abc-gui-input",
        value: a.text
      }) as HTMLInputElement;
      if (this.pendingAnnotationFocusIndex === idx) {
        // Defer focus until the row has been attached to the document.
        queueMicrotask(() => {
          textInput.focus();
          textInput.setSelectionRange(0, textInput.value.length);
        });
        this.pendingAnnotationFocusIndex = null;
      }
      const fire = () => {
        const next = cloneAnnotations(prefix);
        next.annotations[idx] = {
          ...a,
          placement: placeSel.value as ParsedAnnotation["placement"],
          text: textInput.value,
          raw: ""
        };
        onChange(next);
      };
      placeSel.addEventListener("change", fire);
      textInput.addEventListener("change", fire);
      const removeBtn = button("✕", "remove", () => {
        const next = cloneAnnotations(prefix);
        next.annotations.splice(idx, 1);
        onChange(next);
      });
      annoRow.append(placeSel, textInput, removeBtn);
    });
    annoRow.append(
      button('＋"…"', "add chord symbol or annotation", () => {
        const next = cloneAnnotations(prefix);
        this.pendingAnnotationFocusIndex = next.annotations.length;
        next.annotations.push({ raw: '""', placement: "", text: "" });
        onChange(next);
      })
    );
    wrap.append(annoRow);

    // Decorations ------------------------------------------------------
    // Render every supported decoration in canonical order, highlighting
    // the ones already attached. Click on a highlighted button removes
    // that decoration; click on an inactive one adds it. The active
    // styling already conveys "click to remove" — no extra ✕ glyph.
    const decoRow = el("div", { class: "abc-gui-row abc-gui-deco-row" }, [
      el("span", { class: "abc-gui-label" }, ["Decorations"])
    ]);
    for (const d of DECORATIONS) {
      const isActive = prefix.decorations.includes(d.name);
      decoRow.append(
        button(
          d.symbol,
          isActive ? `remove ${d.title}` : `add ${d.title}`,
          () => {
            const next = cloneDecorations(prefix);
            if (isActive) {
              const idx = next.decorations.indexOf(d.name);
              if (idx >= 0) next.decorations.splice(idx, 1);
            } else {
              next.decorations.push(d.name);
            }
            onChange(next);
          },
          { active: isActive }
        )
      );
    }
    // Any non-canonical decorations (custom !names!) appear after the
    // standard set so the user can still remove them; click to remove.
    prefix.decorations.forEach((name) => {
      if (DECORATIONS.some((d) => d.name === name)) return;
      decoRow.append(
        button(
          name,
          `remove ${name}`,
          () => {
            const next = cloneDecorations(prefix);
            const idx = next.decorations.indexOf(name);
            if (idx >= 0) next.decorations.splice(idx, 1);
            onChange(next);
          },
          { active: true }
        )
      );
    });
    wrap.append(decoRow);

    // Grace notes ------------------------------------------------------
    const graceRow = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Grace"])
    ]);
    const graceInput = el("input", {
      class: "abc-gui-input",
      value: prefix.grace ?? "",
      placeholder: "e.g. cd"
    }) as HTMLInputElement;
    graceInput.addEventListener("change", () => {
      const next = cloneGrace(prefix);
      next.grace = graceInput.value ? graceInput.value : null;
      onChange(next);
    });
    graceRow.append(graceInput);
    if (prefix.grace !== null) {
      graceRow.append(
        button("✕", "remove grace notes", () => {
          const next = cloneGrace(prefix);
          next.grace = null;
          onChange(next);
        })
      );
    }
    wrap.append(graceRow);

    return wrap;
  }

  // ---- Info-field editors ------------------------------------------------

  private keyEditor(value: string, onChange: (v: string) => void): HTMLElement {
    // Parse K: value into primary key token + trailing modifiers. Example:
    //   "G clef=bass"
    //   "Dmix transpose=2 clef=treble"
    const tokens = value.trim().split(/\s+/).filter((t) => t.length > 0);
    const keyToken = tokens[0] ?? "C";
    const modifiers = tokens.slice(1);

    // Parse primary key token: "G", "Gm", "Gmaj", "G#mix", "Ddor", etc.
    const m = /^([A-Ga-g])([#b]?)([A-Za-z]*)/.exec(keyToken) || [];
    let tonic = (m[1] || "C").toUpperCase();
    let acc = m[2] || "";
    let mode = (m[3] || "maj").toLowerCase();
    const modes = ["maj", "min", "m", "dor", "phr", "lyd", "mix", "aeo", "loc"];

    // Pull out clef=... but keep all other modifiers untouched.
    const remainingMods: string[] = [];
    let clef = "";
    for (const tok of modifiers) {
      const c = /^clef\s*=\s*(.+)$/i.exec(tok);
      if (c) {
        clef = c[1]!.toLowerCase();
      } else {
        remainingMods.push(tok);
      }
    }

    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["K:"])
    ]);
    const fire = () => {
      const key = tonic + acc + (mode === "maj" ? "" : mode);
      const parts = [key, ...remainingMods];
      if (clef) parts.push(`clef=${clef}`);
      onChange(parts.join(" "));
    };

    const tonicSel = el("select", { class: "abc-gui-input" }) as HTMLSelectElement;
    for (const L of ["A", "B", "C", "D", "E", "F", "G"]) {
      const o = el("option", { value: L }, [L]) as HTMLOptionElement;
      if (L === tonic) o.selected = true;
      tonicSel.append(o);
    }
    tonicSel.addEventListener("change", () => {
      tonic = tonicSel.value;
      fire();
    });

    const accSel = el("select", { class: "abc-gui-input" }) as HTMLSelectElement;
    for (const [val, label] of [["", "♮"], ["#", "♯"], ["b", "♭"]] as const) {
      const o = el("option", { value: val }, [label]) as HTMLOptionElement;
      if (val === acc) o.selected = true;
      accSel.append(o);
    }
    accSel.addEventListener("change", () => {
      acc = accSel.value;
      fire();
    });

    const modeSel = el("select", { class: "abc-gui-input" }) as HTMLSelectElement;
    for (const md of modes) {
      const o = el("option", { value: md }, [md]) as HTMLOptionElement;
      if (md === mode) o.selected = true;
      modeSel.append(o);
    }
    modeSel.addEventListener("change", () => {
      mode = modeSel.value;
      fire();
    });

    const clefSel = el("select", { class: "abc-gui-input" }) as HTMLSelectElement;
    for (const [val, label] of [
      ["", "clef: (none)"],
      ["treble", "clef: treble"],
      ["bass", "clef: bass"],
      ["alto", "clef: alto"],
      ["tenor", "clef: tenor"],
      ["perc", "clef: percussion"],
      ["none", "clef: none"]
    ] as const) {
      const o = el("option", { value: val }, [label]) as HTMLOptionElement;
      if (val === clef) o.selected = true;
      clefSel.append(o);
    }
    clefSel.addEventListener("change", () => {
      clef = clefSel.value;
      fire();
    });

    row.append(tonicSel, accSel, modeSel, clefSel);
    return row;
  }

  private meterEditor(value: string, onChange: (v: string) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["M:"])
    ]);
    for (const preset of ["2/4", "3/4", "4/4", "6/8", "9/8", "12/8", "C", "C|"]) {
      row.append(
        button(preset, `meter ${preset}`, () => onChange(preset), {
          active: value === preset
        })
      );
    }
    const input = el("input", {
      class: "abc-gui-input",
      value
    }) as HTMLInputElement;
    input.addEventListener("input", () => onChange(input.value));
    row.append(input);
    return row;
  }

  private unitLengthEditor(value: string, onChange: (v: string) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["L:"])
    ]);
    for (const preset of ["1/1", "1/2", "1/4", "1/8", "1/16", "1/32"]) {
      row.append(
        button(preset, `unit length ${preset}`, () => onChange(preset), {
          active: value === preset
        })
      );
    }
    return row;
  }

  private tempoEditor(value: string, onChange: (v: string) => void): HTMLElement {
    // Q:1/4=120 — offer beat fraction + BPM inputs with fallback to free text.
    const m = /^(\d+)\/(\d+)\s*=\s*(\d+)/.exec(value);
    const beatNum = m ? m[1]! : "1";
    const beatDen = m ? m[2]! : "4";
    const bpm = m ? m[3]! : "120";
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Q:"])
    ]);
    const nInput = el("input", {
      class: "abc-gui-input abc-gui-input-small",
      value: beatNum,
      type: "number",
      min: "1"
    }) as HTMLInputElement;
    const dInput = el("input", {
      class: "abc-gui-input abc-gui-input-small",
      value: beatDen,
      type: "number",
      min: "1"
    }) as HTMLInputElement;
    const bInput = el("input", {
      class: "abc-gui-input abc-gui-input-small",
      value: bpm,
      type: "number",
      min: "1"
    }) as HTMLInputElement;
    const sync = () => {
      onChange(`${nInput.value}/${dInput.value}=${bInput.value}`);
    };
    nInput.addEventListener("change", sync);
    dInput.addEventListener("change", sync);
    bInput.addEventListener("change", sync);
    row.append(nInput, el("span", {}, ["/"]), dInput, el("span", {}, ["="]), bInput);
    return row;
  }

  // ---- Raw fallback ------------------------------------------------------

  private buildRawEditor(raw: string, start: number, end: number): HTMLElement {
    const wrap = el("div", { class: "abc-gui-raw" });
    wrap.append(
      el("div", { class: "abc-gui-section-title" }, ["Raw element text"])
    );
    const ta = el("textarea", { class: "abc-gui-raw-input" }) as HTMLTextAreaElement;
    ta.value = raw;
    const commit = () => {
      if (ta.value !== raw) {
        this.applyRange(start, end, ta.value);
      }
    };
    ta.addEventListener("blur", commit);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) commit();
    });
    wrap.append(ta);
    return wrap;
  }

  // ---- Utility -----------------------------------------------------------

  /** Perform a document edit and update this panel's selection tracking so
   *  the char range stays consistent with the new text.
   *
   *  When the edit is fully contained within the current selection (the
   *  common case for prefix-only edits — adding a decoration, annotation,
   *  or grace-note group to a selected note), the selection is preserved
   *  and its end is shifted by the size delta. This keeps the whole
   *  newly-decorated element selected so the property panel keeps showing
   *  the same note. Other edits re-anchor the selection on the freshly
   *  inserted text. */
  private applyRange(start: number, end: number, newText: string): void {
    const oldSel = this.current;
    this.doc.replace(start, end, newText);
    const delta = newText.length - (end - start);
    if (
      oldSel &&
      start >= oldSel.startChar &&
      end <= oldSel.endChar &&
      !(start === oldSel.startChar && end === oldSel.endChar)
    ) {
      this.current = {
        startChar: oldSel.startChar,
        endChar: oldSel.endChar + delta
      };
    } else {
      this.current = { startChar: start, endChar: start + newText.length };
    }
    this.render();
  }

  /**
   * Edit the document while keeping the selection anchored on a known
   * element span [elemStart, elemEnd). Used by the binding row, whose
   * tokens (triplet/slur/tie) live OUTSIDE the element's own range, so
   * `applyRange`'s in-element heuristic does not fit. Adjusts the saved
   * span by the size delta based on whether the edit is before, inside, or
   * after the element.
   */
  private applyAround(
    modStart: number,
    modEnd: number,
    newText: string,
    elemStart: number,
    elemEnd: number
  ): void {
    this.doc.replace(modStart, modEnd, newText);
    const delta = newText.length - (modEnd - modStart);
    let newStart = elemStart;
    let newEnd = elemEnd;
    if (modEnd <= elemStart) {
      newStart += delta;
      newEnd += delta;
    } else if (modStart >= elemEnd) {
      // Edit fully after the element — element span unchanged.
    } else {
      // Edit overlaps the element — shift the end only.
      newEnd += delta;
    }
    this.current = { startChar: newStart, endChar: newEnd };
    this.render();
  }
}

function kindLabel(k: string): string {
  switch (k) {
    case "note": return "♪ Note";
    case "chord": return "♫ Chord";
    case "rest": return "𝄽 Rest";
    case "bar": return "∣ Bar line";
    case "info-line": return "≡ Info field";
    case "inline-field": return "[≡] Inline field";
    default: return "• Element";
  }
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    [a, b] = [b, a % b];
  }
  return a || 1;
}

/**
 * Length presets expressed as ABSOLUTE note durations (fraction of a whole
 * note). The property panel converts these to/from the relative `num/den`
 * stored in the ABC source using the effective `L:` at the note's position,
 * so the glyph a user sees on an active button always matches the note's
 * audible/visual duration — even when `L:` changes mid-tune.
 */
const ABSOLUTE_LENGTH_PRESETS: {
  num: number;
  den: number;
  glyph: string;
  title: string;
}[] = [
  { num: 2, den: 1, glyph: "𝅜", title: "breve (double whole)" },
  { num: 1, den: 1, glyph: "𝅝", title: "whole" },
  { num: 1, den: 2, glyph: "𝅗𝅥", title: "half" },
  { num: 1, den: 4, glyph: "♩", title: "quarter" },
  { num: 1, den: 8, glyph: "♪", title: "eighth" },
  { num: 1, den: 16, glyph: "𝅘𝅥𝅯", title: "sixteenth" },
  { num: 1, den: 32, glyph: "𝅘𝅥𝅰", title: "thirty-second" }
];

function cloneAnnotations(p: ElementPrefix): ElementPrefix {
  return { ...p, annotations: p.annotations.map((a) => ({ ...a })) };
}
function cloneDecorations(p: ElementPrefix): ElementPrefix {
  return { ...p, decorations: p.decorations.slice() };
}
function cloneGrace(p: ElementPrefix): ElementPrefix {
  return { ...p };
}
