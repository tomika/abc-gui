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
  DECORATIONS,
  LENGTH_PRESETS
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

  constructor(host: HTMLElement, doc: AbcDocument) {
    this.host = host;
    this.doc = doc;
    this.host.classList.add("abc-gui-panel");
    this.render();
  }

  setSelection(sel: Selection | null): void {
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
    if (/^[|:\[\].]/.test(s[0]!) && /^[|:\[\].0-9]+$/.test(s)) return "bar";
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
      this.lengthRow(parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      ),
      this.dotRow(parsed.num, parsed.den, (n, d) => apply({ num: n, den: d }))
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
      this.lengthRow(parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      }),
      this.dotRow(parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      })
    );
    // Per-note list
    this.host.append(
      el("div", { class: "abc-gui-section-title" }, ["Notes in chord"])
    );
    parsed.notes.forEach((note, idx) => {
      const row = el("div", { class: "abc-gui-chord-note-row" });
      const update = (patch: Partial<ParsedNote>) => {
        const next: ParsedChord = { ...parsed };
        next.notes = parsed.notes.slice();
        next.notes[idx] = { ...note, ...patch };
        applyChord(next);
      };
      // Header row with an explicit "Note N" label and a prominent remove
      // button so the remove action is always visible regardless of how the
      // accidental / pitch / octave rows below wrap.
      const noteLabel = writeNote(note);
      const header = el("div", { class: "abc-gui-chord-note-header" }, [
        el("span", { class: "abc-gui-chord-note-title" }, [
          `Note ${idx + 1}`,
          el("span", { class: "abc-gui-muted" }, [` (${noteLabel})`])
        ]),
        button(
          "✕",
          `Remove note ${idx + 1} (${noteLabel}) from chord`,
          () => {
            if (parsed.notes.length <= 1) return;
            const next: ParsedChord = { ...parsed };
            next.notes = parsed.notes.filter((_, i) => i !== idx);
            applyChord(next);
          },
          { className: "abc-gui-chord-note-remove" }
        )
      ]);
      row.append(
        header,
        this.accidentalRow(note.accidental, (a) => update({ accidental: a })),
        this.pitchRow(note.letter, (l) => update({ letter: l })),
        this.octaveRow(note.octave, (o) => update({ octave: o }))
      );
      this.host.append(row);
    });
    this.host.append(
      button("＋ Add note", "Add note to chord", () => {
        const next: ParsedChord = { ...parsed };
        next.notes = [
          ...parsed.notes,
          { accidental: "", letter: "C", octave: 0, num: 1, den: 1 }
        ];
        applyChord(next);
      }, { className: "abc-gui-chord-add" })
    );
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
      this.lengthRow(parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      )
    );
  }

  private renderBarEditor(raw: string, start: number, end: number) {
    const current = raw.trim();
    const row = el("div", { class: "abc-gui-row abc-gui-bar-row" });
    for (const b of BAR_TYPES) {
      row.append(
        button(
          b.label,
          b.title,
          () => this.applyRange(start, end, b.value),
          { active: current === b.value }
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
    num: number,
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Length"])
    ]);
    for (const p of LENGTH_PRESETS) {
      row.append(
        button(p.glyph, p.title, () => onChange(p.num, p.den), {
          active: p.num === num && p.den === den
        })
      );
    }
    // Free-form
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

  /** Toggle a dotted rhythm (multiply num by 3, den by 2 — or inverse).
   *  A fraction is dotted iff, in lowest terms, num = 3 and den is even
   *  (i.e. equals 3/2 × 1/2^k). Examples: 3/2, 3/4, 3/8, 3/16. 9/8 is NOT
   *  dotted (reduced numerator = 9). */
  private dotRow(
    num: number,
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const g = gcd(num, den);
    const rn = num / g;
    const rd = den / g;
    const isDotted = rn === 3 && rd % 2 === 0;
    return el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["Dot"]),
      button(
        "·",
        "toggle dotted length (×3/2)",
        () => {
          if (isDotted) onChange(num / 3, den / 2);
          else onChange(num * 3, den * 2);
        },
        { active: isDotted }
      )
    ]);
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
        next.annotations.push({ raw: '""', placement: "", text: "" });
        onChange(next);
      })
    );
    wrap.append(annoRow);

    // Decorations ------------------------------------------------------
    const decoRow = el("div", { class: "abc-gui-row abc-gui-deco-row" }, [
      el("span", { class: "abc-gui-label" }, ["Decorations"])
    ]);
    prefix.decorations.forEach((name, idx) => {
      const meta = DECORATIONS.find((d) => d.name === name);
      decoRow.append(
        button(
          (meta ? meta.symbol : name) + " ✕",
          `remove ${name}`,
          () => {
            const next = cloneDecorations(prefix);
            next.decorations.splice(idx, 1);
            onChange(next);
          },
          { active: true }
        )
      );
    });
    for (const d of DECORATIONS) {
      if (prefix.decorations.includes(d.name)) continue;
      decoRow.append(
        button(d.symbol, `add ${d.title}`, () => {
          const next = cloneDecorations(prefix);
          next.decorations.push(d.name);
          onChange(next);
        })
      );
    }
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
    // Parse "G", "Gm", "Gmaj", "G#mix", "Ddor", etc.
    const m = /^([A-Ga-g])([#b]?)([A-Za-z]*)/.exec(value) || [];
    let tonic = (m[1] || "C").toUpperCase();
    let acc = m[2] || "";
    let mode = (m[3] || "maj").toLowerCase();
    const modes = ["maj", "min", "m", "dor", "phr", "lyd", "mix", "aeo", "loc"];

    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, ["K:"])
    ]);
    const fire = () => onChange(tonic + acc + (mode === "maj" ? "" : mode));
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

    row.append(tonicSel, accSel, modeSel);
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
   *  the char range stays consistent with the new text. */
  private applyRange(start: number, end: number, newText: string): void {
    this.doc.replace(start, end, newText);
    const newEnd = start + newText.length;
    this.current = { startChar: start, endChar: newEnd };
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

function cloneAnnotations(p: ElementPrefix): ElementPrefix {
  return { ...p, annotations: p.annotations.map((a) => ({ ...a })) };
}
function cloneDecorations(p: ElementPrefix): ElementPrefix {
  return { ...p, decorations: p.decorations.slice() };
}
function cloneGrace(p: ElementPrefix): ElementPrefix {
  return { ...p };
}
