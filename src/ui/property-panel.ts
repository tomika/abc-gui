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
  isAbcjsMidiChord,
  ACCIDENTALS,
  ACCIDENTAL_GLYPH,
  Accidental,
  BAR_TYPES,
  DECORATIONS
} from "../parser/element.js";
import { el, clear, button } from "./dom.js";
import { Strings } from "../i18n.js";

export interface Selection {
  startChar: number;
  endChar: number;
  abcelem?: AbcElement | null;
}

/**
 * External chord-picker callback. When provided to the editor, a "…"
 * button is shown next to the chord-symbol add button and next to the
 * chord-note add button. The callback is invoked with the current chord
 * text (annotation text or raw chord notes) and should resolve with the
 * new chord name (used when adding a chord symbol annotation) and the
 * MIDI note values (used when updating the notes inside a `[...]`
 * chord).
 */
export type ChordEditorCallback = (
  chord: string
) => Promise<{ chordName: string; chordMidiValues: number[] }>;

/**
 * Optional external chord validation callback.
 * Receives the chord text as shown in the UI and whether German note naming
 * is active, so hosts can apply stricter, domain-specific validation rules.
 */
export type ChordVerifierCallback = (
  chordName: string,
  germanAlphabet: boolean
) => boolean;

interface SelectionContext {
  selStart: number;
  selEnd: number;
  coreStart: number;
  coreEnd: number;
  core: string;
  kind:
    | "note"
    | "chord"
    | "rest"
    | "bar"
    | "info-line"
    | "inline-field"
    | "other";
  prefix: ElementPrefix;
}

export class PropertyPanel {
  private host: HTMLElement;
  private doc: AbcDocument;
  private strings: Strings;
  private current: Selection | null = null;
  private pendingAnnotationFocusIndex: number | null = null;
  private chordActiveTab = 0;
  private chordEditor: ChordEditorCallback | null = null;
  private chordVerifier: ChordVerifierCallback | null = null;
  private decoExpanded = false;
  /** When true, display the letter "B" as "H" (German note-naming
   *  convention), matching abcjs's `germanAlphabet` render option.
   *  Only affects UI labels — underlying ABC source stays in A–G. */
  private germanAlphabet = false;

  constructor(
    host: HTMLElement,
    doc: AbcDocument,
    strings: Strings,
    chordEditor: ChordEditorCallback | null = null,
    chordVerifier: ChordVerifierCallback | null = null
  ) {
    this.host = host;
    this.doc = doc;
    this.strings = strings;
    this.chordEditor = chordEditor;
    this.chordVerifier = chordVerifier;
    this.host.classList.add("abc-gui-panel");
    this.render();
  }

  setStrings(strings: Strings): void {
    this.strings = strings;
    this.render();
  }

  /** Toggle German note-name display (B → H). Re-renders the panel. */
  setGermanAlphabet(v: boolean): void {
    const next = !!v;
    if (this.germanAlphabet === next) return;
    this.germanAlphabet = next;
    this.render();
  }

  /** Map an ABC letter (A–G) to its displayed label under the current
   *  note-naming convention. */
  private displayLetter(letter: string): string {
    if (this.germanAlphabet && letter.toUpperCase() === "B") {
      return letter === "b" ? "h" : "H";
    }
    return letter;
  }

  /**
   * Convert German chord notation to standard ABC notation.
   * In German notation "B" means Bb and "H" means B natural.
   * Step 1: replace every "B" not already followed by "b" with "Bb".
   * Step 2: replace every "H" with "B".
   * Applying step 1 before step 2 ensures a freshly-inserted "B" (from H)
   * is never subsequently expanded to "Bb".
   */
  private preprocessGermanChordText(text: string): string {
    return text.replace(/B(?!b)/g, "Bb").replace(/H/g, "B");
  }

  /**
   * Convert stored standard ABC chord notation back to German display form.
   * This is the inverse of `preprocessGermanChordText`:
   * Step 1: replace every "B" not followed by "b" with "H" (B natural → H).
   * Step 2: replace every "Bb" with "B" (Bb → German B).
   */
  private postprocessGermanChordText(text: string): string {
    return text.replace(/B(?!b)/g, "H").replace(/Bb/g, "B");
  }

  private kindLabel(k: string): string {
    const s = this.strings.panel.kind;
    switch (k) {
      case "note": return s.note;
      case "chord": return s.chord;
      case "rest": return s.rest;
      case "bar": return s.bar;
      case "info-line": return s.infoLine;
      case "inline-field": return s.inlineField;
      default: return s.other;
    }
  }

  /** Translate a canonical length preset (identified by its English `title`
   *  from `ABSOLUTE_LENGTH_PRESETS`) into the active locale. */
  private lengthTitle(p: { title: string }): string {
    const L = this.strings.lengths;
    switch (p.title) {
      case "breve (double whole)": return L.breve;
      case "whole": return L.whole;
      case "half": return L.half;
      case "quarter": return L.quarter;
      case "eighth": return L.eighth;
      case "sixteenth": return L.sixteenth;
      case "thirty-second": return L.thirtysecond;
      default: return p.title;
    }
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
      this.decoExpanded = false;
    }
    this.current = sel;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  /**
   * Trigger property-panel actions from keyboard shortcuts.
   * Returns true when the key was handled.
   */
  handleShortcut(key: string, opts: { shiftKey?: boolean } = {}): boolean {
    const ctx = this.resolveSelectionContext();
    if (!ctx) return false;

    if (key >= "1" && key <= "9") {
      return this.applyLengthShortcut(ctx, parseInt(key, 10));
    }

    if (key === "ArrowUp" || key === "ArrowDown") {
      const dir = key === "ArrowUp" ? 1 : -1;
      if (opts.shiftKey) {
        // Shift: chromatic semitone.
        return this.transposePitchShortcut(ctx, dir);
      }
      // Default: diatonic step in current key.
      return this.transposeDiatonicShortcut(ctx, dir);
    }

    if (key === "PageUp" || key === "PageDown") {
      const delta = key === "PageUp" ? 1 : -1;
      return this.shiftOctaveShortcut(ctx, delta);
    }

    if (key.length === 1) {
      const upper = key.toUpperCase();
      if (/^[A-G]$/.test(upper)) {
        return this.applyPitchLetterShortcut(ctx, upper);
      }
    }

    if (key === "(" || key === ")" || key === "-") {
      return this.toggleBindingShortcut(ctx, key);
    }
    if (key === "+" || key === "Add") {
      return this.addAttachedTextShortcut(ctx);
    }
    if (key === ".") {
      return this.toggleDotShortcut(ctx);
    }

    return false;
  }

  private addAttachedTextShortcut(ctx: SelectionContext): boolean {
    if (!(ctx.kind === "note" || ctx.kind === "chord" || ctx.kind === "rest")) {
      return false;
    }
    const next = cloneAnnotations(ctx.prefix);
    this.pendingAnnotationFocusIndex = next.annotations.length;
    next.annotations.push({ raw: '""', placement: "", text: "" });
    this.applyRange(ctx.selStart, ctx.coreStart, writePrefix(next));
    return true;
  }

  private toggleDotShortcut(ctx: SelectionContext): boolean {
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      const base = this.dottedBaseRelativeAt(
        ctx.coreStart,
        parsed.num,
        parsed.den
      );
      const next = base
        ? { ...parsed, num: base.num, den: base.den }
        : { ...parsed, num: parsed.num * 3, den: parsed.den * 2 };
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeNote(next));
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed) return false;
      const base = this.dottedBaseRelativeAt(
        ctx.coreStart,
        parsed.num,
        parsed.den
      );
      const next = base
        ? { ...parsed, num: base.num, den: base.den }
        : { ...parsed, num: parsed.num * 3, den: parsed.den * 2 };
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord(next));
      return true;
    }
    if (ctx.kind === "rest") {
      const parsed = readRest(ctx.core.trim(), 0);
      if (!parsed) return false;
      const base = this.dottedBaseRelativeAt(
        ctx.coreStart,
        parsed.num,
        parsed.den
      );
      const next = base
        ? { ...parsed, num: base.num, den: base.den }
        : { ...parsed, num: parsed.num * 3, den: parsed.den * 2 };
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeRest(next));
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  // Top-level rendering
  // ------------------------------------------------------------------

  private render(): void {
    clear(this.host);
    if (!this.current) {
      this.host.append(
        el("div", { class: "abc-gui-panel-empty" }, [
          this.strings.panel.emptyHint
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
    const prefixEnd = startChar + leadingWs + prefix.end;
    const rawCoreEnd = endChar - trailingWs;
    const coreRange = this.normalizeCoreRange(prefixEnd, rawCoreEnd);
    const coreStart = coreRange.coreStart;
    const coreEnd = coreRange.coreEnd;
    const core = this.doc.slice(coreStart, coreEnd);
    const kind = this.classify(core);

    const header = el("div", { class: "abc-gui-panel-header" }, [
      el("span", { class: "abc-gui-kind" }, [this.kindLabel(kind)]),
      el("span", { class: "abc-gui-range" }, [`${startChar}…${endChar}`])
    ]);
    this.host.append(header);

    // Show editors for attached prefix components. Always present for
    // note/rest/chord so the user can add annotations / decorations /
    // grace-notes even when none are currently attached.
    const supportsPrefix =
      kind === "note" || kind === "chord" || kind === "rest";

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

    if (supportsPrefix) {
      // Group / binding row (triplets, slurs, ties) — these tokens live
      // OUTSIDE the element span abcjs reports, so we edit them through
      // the document directly while keeping the element selected.
      this.host.append(this.separator());
      this.host.append(this.bindingRow(coreStart, coreEnd));
      // Attached chord symbols / annotations / decorations / grace notes.
      this.host.append(this.separator());
      this.host.append(
        this.prefixEditor(prefix, prefixEnd, (next) => {
          const prefixText = writePrefix(next);
          // Replace the old prefix region (from startChar up to prefixEnd)
          // with the newly-serialized one.
          this.applyRange(startChar, prefixEnd, prefixText);
        })
      );
    }

    // Raw fallback — always present (covers the WHOLE selection, prefix + core).
    this.host.append(this.buildRawEditor(raw, startChar, endChar));
  }

  private separator(): HTMLElement {
    return el("hr", { class: "abc-gui-sep" });
  }

  private resolveSelectionContext(): SelectionContext | null {
    if (!this.current) return null;
    const selStart = this.current.startChar;
    const selEnd = this.current.endChar;
    const raw = this.doc.slice(selStart, selEnd);
    const leadingWs = raw.match(/^\s*/)![0].length;
    const trailingWs = raw.match(/\s*$/)![0].length;
    const inner = raw.slice(leadingWs, raw.length - trailingWs);
    const prefix = readPrefix(inner, 0);
    const prefixEnd = selStart + leadingWs + prefix.end;
    const rawCoreEnd = selEnd - trailingWs;
    const coreRange = this.normalizeCoreRange(prefixEnd, rawCoreEnd);
    const coreStart = coreRange.coreStart;
    const coreEnd = coreRange.coreEnd;
    const core = this.doc.slice(coreStart, coreEnd);
    const kind = this.classify(core);
    return { selStart, selEnd, coreStart, coreEnd, core, kind, prefix };
  }

  /**
   * abcjs usually reports binding markers (tuplet/slur/tie) outside an
   * element span, but in some cases a marker can be included in the
   * selected range (e.g. "(e"). Exclude those wrappers from the editable
   * core so note/chord/rest parsing still works.
   */
  private normalizeCoreRange(
    coreStart: number,
    coreEnd: number
  ): { coreStart: number; coreEnd: number } {
    const v = this.doc.value;
    let s = coreStart;
    let e = coreEnd;

    const tupletLen = this.parseTupletMarkerLengthAt(s, e);
    if (tupletLen > 0) s += tupletLen;
    if (s < e && v[s] === "(") s += 1;

    if (e > s && v[e - 1] === "-") e -= 1;
    if (e > s && v[e - 1] === ")") e -= 1;

    return { coreStart: s, coreEnd: e };
  }

  /** Parse tuplet marker length at `start`: (p), (p:q), or (p:q:r). */
  private parseTupletMarkerLengthAt(start: number, end: number): number {
    const v = this.doc.value;
    if (start >= end || v[start] !== "(") return 0;
    let i = start + 1;
    let digitsStart = i;
    while (i < end && /[0-9]/.test(v[i]!)) i++;
    if (i === digitsStart) return 0;
    let parts = 1;
    while (parts < 3 && i < end && v[i] === ":") {
      i++;
      digitsStart = i;
      while (i < end && /[0-9]/.test(v[i]!)) i++;
      if (i === digitsStart) return 0;
      parts++;
    }
    return i - start;
  }

  private applyPitchLetterShortcut(
    ctx: SelectionContext,
    letter: string
  ): boolean {
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeNote({ ...parsed, letter }));
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed || parsed.notes.length === 0) return false;
      const idx = Math.max(0, Math.min(this.chordActiveTab, parsed.notes.length - 1));
      parsed.notes[idx] = { ...parsed.notes[idx]!, letter };
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord(parsed));
      return true;
    }
    return false;
  }

  private shiftOctaveShortcut(ctx: SelectionContext, delta: number): boolean {
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeNote({ ...parsed, octave: parsed.octave + delta }));
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed || parsed.notes.length === 0) return false;
      const idx = Math.max(0, Math.min(this.chordActiveTab, parsed.notes.length - 1));
      const note = parsed.notes[idx]!;
      parsed.notes[idx] = { ...note, octave: note.octave + delta };
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord(parsed));
      return true;
    }
    return false;
  }

  private transposePitchShortcut(
    ctx: SelectionContext,
    semitoneDelta: number
  ): boolean {
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(
        ctx.coreStart,
        ctx.coreEnd,
        writeNote(transposeParsedNote(parsed, semitoneDelta))
      );
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed || parsed.notes.length === 0) return false;
      const idx = Math.max(0, Math.min(this.chordActiveTab, parsed.notes.length - 1));
      parsed.notes[idx] = transposeParsedNote(parsed.notes[idx]!, semitoneDelta);
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord(parsed));
      return true;
    }
    return false;
  }

  private transposeDiatonicShortcut(
    ctx: SelectionContext,
    dir: 1 | -1
  ): boolean {
    // We don't need to add accidentals — leaving the new letter bare lets
    // the prevailing key signature (detected by the renderer at this offset)
    // govern its pitch, so the step is naturally a half- or whole-tone as
    // the current key dictates.
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      const stepped = diatonicStepNote(parsed, dir);
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeNote(stepped));
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed || parsed.notes.length === 0) return false;
      const idx = Math.max(0, Math.min(this.chordActiveTab, parsed.notes.length - 1));
      parsed.notes[idx] = diatonicStepNote(parsed.notes[idx]!, dir);
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord(parsed));
      return true;
    }
    return false;
  }

  /**
   * Step the selected element's length one preset shorter (`dir = -1`) or
   * longer (`dir = +1`), based on the canonical absolute-length presets.
   * Preserves a dotted modifier when present.
   */
  stepLength(dir: 1 | -1): boolean {
    const ctx = this.resolveSelectionContext();
    if (!ctx) return false;
    if (ctx.kind !== "note" && ctx.kind !== "chord" && ctx.kind !== "rest") {
      return false;
    }
    const cur = (() => {
      if (ctx.kind === "note") {
        const p = readNote(ctx.core.trim(), 0);
        return p ? { num: p.num, den: p.den } : null;
      }
      if (ctx.kind === "chord") {
        const p = readChord(ctx.core.trim(), 0);
        return p ? { num: p.num, den: p.den } : null;
      }
      const p = readRest(ctx.core.trim(), 0);
      return p ? { num: p.num, den: p.den } : null;
    })();
    if (!cur) return false;
    const L = this.doc.unitLengthAt(ctx.coreStart);
    const dotted = this.dottedBaseRelativeAt(ctx.coreStart, cur.num, cur.den);
    const baseRel = dotted ?? cur;
    // Locate base in absolute presets.
    const absN = baseRel.num * L.num;
    const absD = baseRel.den * L.den;
    let idx = -1;
    for (let i = 0; i < ABSOLUTE_LENGTH_PRESETS.length; i++) {
      const p = ABSOLUTE_LENGTH_PRESETS[i]!;
      // Compare as fractions: p.num/p.den == absN/absD ⇔ p.num*absD == p.den*absN
      if (p.num * absD === p.den * absN) {
        idx = i;
        break;
      }
    }
    // Presets are ordered longest → shortest. dir=+1 means longer (idx-1),
    // dir=-1 means shorter (idx+1). If current isn't on a preset, snap to the
    // nearest reasonable one.
    if (idx < 0) {
      // Find closest by absolute duration.
      const ratio = absN / absD;
      let best = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < ABSOLUTE_LENGTH_PRESETS.length; i++) {
        const p = ABSOLUTE_LENGTH_PRESETS[i]!;
        const d = Math.abs(p.num / p.den - ratio);
        if (d < bestDiff) {
          bestDiff = d;
          best = i;
        }
      }
      idx = best;
    }
    const nextIdx = idx + (dir === 1 ? -1 : 1);
    if (nextIdx < 0 || nextIdx >= ABSOLUTE_LENGTH_PRESETS.length) return false;
    const next = ABSOLUTE_LENGTH_PRESETS[nextIdx]!;
    // Convert next absolute → relative, apply dot if original was dotted.
    const relN = next.num * L.den;
    const relD = next.den * L.num;
    const g0 = gcd(relN, relD);
    let newNum = relN / g0;
    let newDen = relD / g0;
    if (dotted) {
      newNum = newNum * 3;
      newDen = newDen * 2;
      const g = gcd(newNum, newDen);
      newNum /= g;
      newDen /= g;
    }
    if (ctx.kind === "note") {
      const p = readNote(ctx.core.trim(), 0)!;
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeNote({ ...p, num: newNum, den: newDen }));
      return true;
    }
    if (ctx.kind === "chord") {
      const p = readChord(ctx.core.trim(), 0)!;
      this.applyRange(ctx.coreStart, ctx.coreEnd, writeChord({ ...p, num: newNum, den: newDen }));
      return true;
    }
    const p = readRest(ctx.core.trim(), 0)!;
    this.applyRange(ctx.coreStart, ctx.coreEnd, writeRest({ ...p, num: newNum, den: newDen }));
    return true;
  }

  private applyLengthShortcut(ctx: SelectionContext, digit: number): boolean {
    const preset = LENGTH_SHORTCUT_FRACTIONS[digit - 1];
    if (!preset) return false;
    if (ctx.kind === "note") {
      const parsed = readNote(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(
        ctx.coreStart,
        ctx.coreEnd,
        writeNote({ ...parsed, num: preset.num, den: preset.den })
      );
      return true;
    }
    if (ctx.kind === "chord") {
      const parsed = readChord(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(
        ctx.coreStart,
        ctx.coreEnd,
        writeChord({ ...parsed, num: preset.num, den: preset.den })
      );
      return true;
    }
    if (ctx.kind === "rest") {
      const parsed = readRest(ctx.core.trim(), 0);
      if (!parsed) return false;
      this.applyRange(
        ctx.coreStart,
        ctx.coreEnd,
        writeRest({ ...parsed, num: preset.num, den: preset.den })
      );
      return true;
    }
    return false;
  }

  private toggleDecorationShortcut(
    ctx: SelectionContext,
    name: string
  ): boolean {
    if (!(ctx.kind === "note" || ctx.kind === "chord" || ctx.kind === "rest")) {
      return false;
    }
    const next = cloneDecorations(ctx.prefix);
    const idx = next.decorations.indexOf(name);
    if (idx >= 0) next.decorations.splice(idx, 1);
    else next.decorations.push(name);
    this.applyRange(ctx.selStart, ctx.coreStart, writePrefix(next));
    return true;
  }

  private toggleBindingShortcut(
    ctx: SelectionContext,
    key: "(" | ")" | "-"
  ): boolean {
    if (!(ctx.kind === "note" || ctx.kind === "chord" || ctx.kind === "rest")) {
      return false;
    }
    const b = this.bindingState(ctx.coreStart, ctx.coreEnd);
    if (key === "(") {
      if (b.hasSlurStart) {
        this.applyAround(b.leftStart - 1, b.leftStart, "", ctx.selStart, ctx.selEnd);
      } else {
        this.applyAround(ctx.selStart, ctx.selStart, "(", ctx.selStart, ctx.selEnd);
      }
      return true;
    }
    if (key === ")") {
      if (b.hasSlurEnd) {
        this.applyAround(b.rightStart, b.rightStart + 1, "", ctx.selStart, ctx.selEnd);
      } else {
        this.applyAround(ctx.selEnd, ctx.selEnd, ")", ctx.selStart, ctx.selEnd);
      }
      return true;
    }
    if (b.hasTie) {
      this.applyAround(b.tieProbe, b.tieProbe + 1, "", ctx.selStart, ctx.selEnd);
    } else {
      this.applyAround(ctx.selEnd, ctx.selEnd, "-", ctx.selStart, ctx.selEnd);
    }
    return true;
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
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.note]),
      this.accidentalRow(parsed.accidental, (a) => apply({ accidental: a })),
      this.pitchRow(parsed.letter, (l) => apply({ letter: l })),
      this.octaveRow(parsed.octave, (o) => apply({ octave: o })),
      this.separator(),
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.noteLength]),
      this.unitLengthInfoRow(start, parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      ),
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
    // Per-note tab view comes first so the note's accidental/pitch/octave
    // appear at the top — mirroring the single-note editor's layout.
    this.host.append(
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.notesInChord])
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
          this.strings.panel.hints.editNote(i + 1),
          () => renderTab(i),
          { active: i === idx, className: "abc-gui-chord-tab" }
        );
        tabBar.append(tab);
      });
      // Add-note "+" tab
      tabBar.append(
        button("＋", this.strings.panel.hints.addNoteToChord, () => {
          this.chordActiveTab = parsed.notes.length; // select the new note
          const next: ParsedChord = {
            ...parsed,
            notes: [...parsed.notes, { accidental: "", letter: "C", octave: 0, num: 1, den: 1 }]
          };
          applyChord(next);
        }, { className: "abc-gui-chord-tab abc-gui-chord-tab-add" })
      );
      if (this.chordEditor) {
        tabBar.append(
          button("…", this.strings.panel.hints.pickChordNotes, () => {
            const cb = this.chordEditor;
            if (!cb) return;
            // Seed the picker with the chord's current notes written back
            // to ABC form (no brackets, no length) so the callback can
            // recognize the current pitch content.
            const seed = parsed.notes
              .map((n) => writeNote({ ...n, num: 1, den: 1 }))
              .join("");
            cb(seed).then((res) => {
              if (!res || !Array.isArray(res.chordMidiValues)) return;
              const newNotes = res.chordMidiValues.map(midiToNote);
              if (newNotes.length === 0) return;
              this.chordActiveTab = 0;
              applyChord({ ...parsed, notes: newNotes });
            }).catch(() => { /* user cancelled */ });
          }, { className: "abc-gui-chord-tab" })
        );
      }
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
          button(this.strings.panel.hints.removeNote, this.strings.panel.hints.removeNoteN(idx + 1), () => {
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
    // Chord-level duration — appears after the per-note pane to match the
    // unified property order (acc/pitch/oct → unit/length/dot → …).
    this.host.append(
      this.separator(),
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.chordLength]),
      this.unitLengthInfoRow(start, parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      }),
      this.lengthRow(start, parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      }),
      this.dotRow(start, parsed.num, parsed.den, (n, d) => {
        applyChord({ ...parsed, num: n, den: d });
      })
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
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.kind])
    ]);
    const rv = this.strings.panel.hints.restVariant;
    const variants: { v: ParsedRest["variant"]; glyph: string; title: string }[] = [
      { v: "z", glyph: "𝄽", title: rv.z },
      { v: "x", glyph: "×", title: rv.x },
      { v: "Z", glyph: "𝄻", title: rv.Z },
      { v: "X", glyph: "⌀", title: rv.X }
    ];
    for (const v of variants) {
      variantRow.append(
        button(v.glyph, v.title, () => apply({ variant: v.v }), {
          active: parsed.variant === v.v
        })
      );
    }
    this.host.append(
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.rest]),
      variantRow,
      this.separator(),
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.restLength]),
      this.unitLengthInfoRow(start, parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      ),
      this.lengthRow(start, parsed.num, parsed.den, (n, d) =>
        apply({ num: n, den: d })
      ),
      this.dotRow(start, parsed.num, parsed.den, (n, d) =>
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
      const t = this.strings.barTypes[b.value as keyof typeof this.strings.barTypes] ?? b.title;
      row.append(
        button(
          b.label,
          t,
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
    const b = this.bindingState(start, end);

    // Group / binding row (triplets, slurs, ties).
    const row = el("div", { class: "abc-gui-row abc-gui-binding-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.group])
    ]);

    const hints = this.strings.panel.hints;
    // Triplet (3 — toggle by inserting/removing "(3" right before the element.
    row.append(
      button(
        "(3",
        b.hasTriplet ? hints.triplet.remove : hints.triplet.add,
        () => {
          if (b.hasTriplet) {
            this.applyAround(b.leftStart - 2, b.leftStart, "", start, end);
          } else {
            this.applyAround(start, start, "(3", start, end);
          }
        },
        { active: b.hasTriplet }
      )
    );

    // Slur start (
    row.append(
      button(
        "(",
        b.hasSlurStart ? hints.slurStart.remove : hints.slurStart.add,
        () => {
          if (b.hasSlurStart) {
            this.applyAround(b.leftStart - 1, b.leftStart, "", start, end);
          } else {
            this.applyAround(start, start, "(", start, end);
          }
        },
        { active: b.hasSlurStart }
      )
    );

    // Slur end )
    row.append(
      button(
        ")",
        b.hasSlurEnd ? hints.slurEnd.remove : hints.slurEnd.add,
        () => {
          if (b.hasSlurEnd) {
            this.applyAround(b.rightStart, b.rightStart + 1, "", start, end);
          } else {
            this.applyAround(end, end, ")", start, end);
          }
        },
        { active: b.hasSlurEnd }
      )
    );

    // Tie ⌒ (suffix `-`)
    row.append(
      button(
        "⌒",
        b.hasTie ? hints.tie.remove : hints.tie.add,
        () => {
          if (b.hasTie) {
            this.applyAround(b.tieProbe, b.tieProbe + 1, "", start, end);
          } else {
            this.applyAround(end, end, "-", start, end);
          }
        },
        { active: b.hasTie }
      )
    );

    return row;
  }

  private bindingState(start: number, end: number): {
    leftStart: number;
    rightStart: number;
    tieProbe: number;
    hasTriplet: boolean;
    hasSlurStart: boolean;
    hasSlurEnd: boolean;
    hasTie: boolean;
  } {
    const v = this.doc.value;

    let leftStart = start;
    while (leftStart > 0 && (v[leftStart - 1] === " " || v[leftStart - 1] === "\t")) {
      leftStart--;
    }
    const hasTriplet =
      leftStart >= 2 &&
      v[leftStart - 2] === "(" &&
      v[leftStart - 1] === "3";
    const hasSlurStart =
      !hasTriplet &&
      leftStart >= 1 &&
      v[leftStart - 1] === "(" &&
      !(leftStart < v.length && /[0-9]/.test(v[leftStart] ?? ""));

    let rightStart = end;
    while (rightStart < v.length && (v[rightStart] === " " || v[rightStart] === "\t")) {
      rightStart++;
    }
    const hasSlurEnd = v[rightStart] === ")";
    let tieProbe = rightStart;
    if (v[tieProbe] === ")") tieProbe++;
    while (tieProbe < v.length && (v[tieProbe] === " " || v[tieProbe] === "\t")) tieProbe++;
    const hasTie = v[tieProbe] === "-";

    return {
      leftStart,
      rightStart,
      tieProbe,
      hasTriplet,
      hasSlurStart,
      hasSlurEnd,
      hasTie
    };
  }

  // ------------------------------------------------------------------
  // Reusable widgets
  // ------------------------------------------------------------------

  private accidentalRow(current: Accidental, onChange: (a: Accidental) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.accidental])
    ]);
    for (const a of ACCIDENTALS) {
      row.append(
        button(
          a === "" ? "∅" : ACCIDENTAL_GLYPH[a],
          a === "" ? this.strings.panel.hints.noAccidental : a,
          () => onChange(a),
          { active: current === a }
        )
      );
    }
    return row;
  }

  private pitchRow(current: string, onChange: (letter: string) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.pitch])
    ]);
    for (const L of ["C", "D", "E", "F", "G", "A", "B"]) {
      row.append(button(this.displayLetter(L), this.strings.panel.hints.pitchOf(L), () => onChange(L), { active: current === L }));
    }
    return row;
  }

  private octaveRow(current: number, onChange: (o: number) => void): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.octave]),
      button("⇊", this.strings.panel.hints.octaveDown, () => onChange(current - 1)),
      el("span", { class: "abc-gui-readout" }, [String(current)]),
      button("⇈", this.strings.panel.hints.octaveUp, () => onChange(current + 1))
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
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const L = this.doc.unitLengthAt(offsetInDoc);
    // Absolute duration = (num / den) × (L.num / L.den) = (num·L.num) / (den·L.den)
    const an = num * L.num;
    const ad = den * L.den;
    const g = gcd(an, ad);
    const absolute = `${an / g}/${ad / g}`;
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
    return el("div", { class: "abc-gui-row abc-gui-unitlen" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.unitL]),
      el(
        "span",
        {
          class: "abc-gui-readout",
          title: this.strings.panel.hints.unitL
        },
        [`${L.num}/${L.den}`]
      ),
      el("span", { class: "abc-gui-muted" }, ["×"]),
      numInput,
      el("span", {}, ["/"]),
      denInput,
      el("span", { class: "abc-gui-muted", title: absolute }, ["= " + absolute])
    ]);
  }

  private lengthRow(
    offsetInDoc: number,
    num: number,
    den: number,
    onChange: (n: number, d: number) => void
  ): HTMLElement {
    const row = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.length])
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
        button(p.glyph, this.strings.panel.hints.lengthPresetTitle(this.lengthTitle(p), rn, rd), () => onChange(rn, rd), {
          active: isExact || isBaseForDotted
        })
      );
    }
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
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.dot]),
      button(
        "·",
        this.strings.panel.hints.dotToggle,
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
      el("div", { class: "abc-gui-section-title" }, [this.strings.panel.section.attached])
    );

    // Annotations / chord symbols --------------------------------------
    // One row per annotation, plus a trailing row with the add-button.
    // Keeping each annotation on its own row makes the narrow panel width
    // (label + ~7 small controls) fit without wrapping mid-annotation.
    prefix.annotations.forEach((a, idx) => {
      const labelText = idx === 0 ? this.strings.panel.labels.chordText : "";
      const row = el("div", { class: "abc-gui-row" }, [
        el("span", { class: "abc-gui-label" }, [labelText])
      ]);
      const placeSel = el("select", { class: "abc-gui-input abc-gui-input-small" }) as HTMLSelectElement;
      const ann = this.strings.panel.annotation;
      for (const [v, label, title] of [
        ["", "♩", ann.chordSymbol],
        ["^", "↑", ann.above],
        ["_", "↓", ann.below],
        ["<", "←", ann.left],
        [">", "→", ann.right],
        ["@", "@", ann.freePlacement]
      ] as const) {
        const o = el("option", { value: v, title }, [label]) as HTMLOptionElement;
        if (v === a.placement) o.selected = true;
        placeSel.append(o);
      }
      const isChordSymbol = a.placement === "";
      // Display value: reverse-convert German notation only for chord symbols
      // so non-chord annotations are preserved verbatim.
      const displayText = (this.germanAlphabet && isChordSymbol)
        ? this.postprocessGermanChordText(a.text)
        : a.text;
      // Chord symbols (placement="") that are non-empty but not MIDI-playable
      // by abcjs get a visual warning.
      const isInvalidChord =
        isChordSymbol &&
        a.text.length > 0 &&
        !(
          this.chordVerifier
            ? this.chordVerifier(displayText, this.germanAlphabet)
            : isAbcjsMidiChord(a.text)
        );
      const textInput = el("input", {
        class: "abc-gui-input abc-gui-input-flex" +
          (isInvalidChord ? " abc-gui-input-invalid" : ""),
        value: displayText
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
        const rawText = textInput.value;
        next.annotations[idx] = {
          ...a,
          placement: placeSel.value as ParsedAnnotation["placement"],
          text: (this.germanAlphabet && placeSel.value === "")
            ? this.preprocessGermanChordText(rawText)
            : rawText,
          raw: ""
        };
        onChange(next);
      };
      placeSel.addEventListener("change", fire);
      textInput.addEventListener("change", fire);
      textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          // Let blur trigger the existing `change` commit exactly once.
          this.focusEditorFromPanel();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          // Revert uncommitted text edits before leaving the field.
          textInput.value = displayText;
          placeSel.value = a.placement;
          this.focusEditorFromPanel();
        }
      });
      const removeBtn = button("✕", this.strings.panel.hints.remove, () => {
        const next = cloneAnnotations(prefix);
        next.annotations.splice(idx, 1);
        onChange(next);
      });
      row.append(placeSel, textInput);
      if (this.chordEditor && a.placement === "") {
        row.append(
          button("…", this.strings.panel.hints.pickChordSymbol, () => {
            const cb = this.chordEditor;
            if (!cb) return;
            cb(textInput.value).then((res) => {
              if (!res || typeof res.chordName !== "string") return;
              const next = cloneAnnotations(prefix);
              next.annotations[idx] = {
                ...a,
                placement: "",
                text: res.chordName,
                raw: ""
              };
              onChange(next);
            }).catch(() => { /* user cancelled */ });
          })
        );
      }
      row.append(removeBtn);
      wrap.append(row);
    });
    // Trailer row: label shown only when there are no annotations, plus
    // the add-annotation button.
    const addRow = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [
        prefix.annotations.length === 0 ? this.strings.panel.labels.chordText : ""
      ])
    ]);
    addRow.append(
      button('＋"…"', this.strings.panel.hints.addAnnotation, () => {
        const next = cloneAnnotations(prefix);
        this.pendingAnnotationFocusIndex = next.annotations.length;
        next.annotations.push({ raw: '""', placement: "", text: "" });
        onChange(next);
      })
    );
    wrap.append(addRow);

    // Decorations ------------------------------------------------------
    // Show the six most commonly used decorations on the primary row. A
    // trailing "…" button reveals the rest in additional rows below.
    // Click on a highlighted button removes that decoration; click on an
    // inactive one adds it. The active styling conveys "click to remove"
    // — no extra ✕ glyph.
    const renderDeco = (d: typeof DECORATIONS[number]): HTMLElement => {
      const isActive = prefix.decorations.includes(d.name);
      const locTitle = (this.strings.decorations as Record<string, string>)[d.name] ?? d.title;
      return button(
        d.symbol,
        isActive ? this.strings.panel.hints.removeX(locTitle) : locTitle,
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
      );
    };
    const common = DECORATIONS.filter((d) => DECO_COMMON.includes(d.name))
      .sort((a, b) => DECO_COMMON.indexOf(a.name) - DECO_COMMON.indexOf(b.name));
    const rare = DECORATIONS.filter((d) => !DECO_COMMON.includes(d.name));
    const decoRow = el("div", { class: "abc-gui-row abc-gui-deco-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.decorations])
    ]);
    for (const d of common) decoRow.append(renderDeco(d));
    // Promote any active rare decoration to the primary row so users can
    // always see/remove what's attached without expanding.
    const activeRare = rare.filter((d) => prefix.decorations.includes(d.name));
    for (const d of activeRare) decoRow.append(renderDeco(d));
    const hiddenRare = rare.filter((d) => !prefix.decorations.includes(d.name));
    if (hiddenRare.length > 0) {
      decoRow.append(
        button(
          "…",
          this.decoExpanded
            ? this.strings.panel.hints.collapseDecorations
            : this.strings.panel.hints.expandDecorations,
          () => {
            this.decoExpanded = !this.decoExpanded;
            this.render();
          },
          { active: this.decoExpanded }
        )
      );
    }
    wrap.append(decoRow);
    if (this.decoExpanded && hiddenRare.length > 0) {
      // Show all remaining decorations in as many rows as needed.
      // We keep 7 buttons per row to match the panel width target.
      const perRow = 7;
      for (let i = 0; i < hiddenRare.length; i += perRow) {
        const extraRow = el("div", { class: "abc-gui-row abc-gui-deco-row abc-gui-deco-extra" }, [
          el("span", { class: "abc-gui-label" }, [])
        ]);
        for (const d of hiddenRare.slice(i, i + perRow)) extraRow.append(renderDeco(d));
        wrap.append(extraRow);
      }
    }
    // Any non-canonical decorations (custom !names!) appear after the
    // standard set so the user can still remove them; click to remove.
    const customRow = el("div", { class: "abc-gui-row abc-gui-deco-row" }, [
      el("span", { class: "abc-gui-label" }, [])
    ]);
    let hasCustom = false;
    prefix.decorations.forEach((name) => {
      if (DECORATIONS.some((d) => d.name === name)) return;
      hasCustom = true;
      customRow.append(
        button(
          name,
          this.strings.panel.hints.removeX(name),
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
    if (hasCustom) wrap.append(customRow);

    // Grace notes ------------------------------------------------------
    const graceRow = el("div", { class: "abc-gui-row" }, [
      el("span", { class: "abc-gui-label" }, [this.strings.panel.labels.grace])
    ]);
    const graceInput = el("input", {
      class: "abc-gui-input abc-gui-input-flex",
      value: prefix.grace ?? "",
      placeholder: this.strings.panel.grace.placeholder
    }) as HTMLInputElement;
    graceInput.addEventListener("change", () => {
      const next = cloneGrace(prefix);
      next.grace = graceInput.value ? graceInput.value : null;
      onChange(next);
    });
    graceRow.append(graceInput);
    if (prefix.grace !== null) {
      graceRow.append(
        button("✕", this.strings.panel.hints.removeGraceNotes, () => {
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
      const o = el("option", { value: L }, [this.displayLetter(L)]) as HTMLOptionElement;
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
    const ck = this.strings.panel.keyEditor;
    for (const [val, label] of [
      ["", ck.clefNone],
      ["treble", ck.clefTreble],
      ["bass", ck.clefBass],
      ["alto", ck.clefAlto],
      ["tenor", ck.clefTenor],
      ["perc", ck.clefPerc],
      ["none", ck.clefNoneExplicit]
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
        button(preset, this.strings.panel.hints.meterPreset(preset), () => onChange(preset), {
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
        button(preset, this.strings.panel.hints.unitLengthPreset(preset), () => onChange(preset), {
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
    const row = el("div", { class: "abc-gui-row abc-gui-raw" });
    row.append(
      el("span", { class: "abc-gui-label" }, [this.strings.panel.section.rawElement])
    );
    const input = el("input", {
      class: "abc-gui-input abc-gui-input-flex abc-gui-raw-input",
      type: "text",
      value: raw
    }) as HTMLInputElement;
    const commit = () => {
      if (input.value !== raw) {
        this.applyRange(start, end, input.value);
      }
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
      }
    });
    row.append(input);
    return row;
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

  private focusEditorFromPanel(): void {
    const root = this.host.closest(".abc-gui-root") as HTMLElement | null;
    if (!root) return;
    const focusOnce = () => {
      const svg = root.querySelector(".abc-gui-score svg") as SVGElement | null;
      if (svg) {
        if (!svg.hasAttribute("tabindex")) svg.setAttribute("tabindex", "-1");
        const focusFn = (svg as unknown as { focus?: (opts?: FocusOptions) => void }).focus;
        if (typeof focusFn === "function") {
          try {
            focusFn.call(svg, { preventScroll: true });
          } catch {
            focusFn.call(svg);
          }
          return;
        }
      }
      try {
        root.focus({ preventScroll: true });
      } catch {
        root.focus();
      }
    };
    // Focus now, and retry after DOM updates that happen on change/re-render.
    focusOnce();
    queueMicrotask(focusOnce);
    setTimeout(focusOnce, 40);
  }
}

// kindLabel moved into PropertyPanel as a strings-aware method.

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

const LENGTH_SHORTCUT_FRACTIONS: { num: number; den: number }[] = [
  { num: 16, den: 1 },
  { num: 8, den: 1 },
  { num: 4, den: 1 },
  { num: 2, den: 1 },
  { num: 1, den: 1 },
  { num: 1, den: 2 },
  { num: 1, den: 4 },
  { num: 1, den: 8 },
  { num: 1, den: 16 }
];

/**
 * Decoration names considered "commonly used" — displayed on the primary
 * decorations row. All other decorations are hidden behind a "…" expander.
 * Order reflects rough usage frequency in folk / classical ABC sources.
 */
const DECO_COMMON: string[] = [
  "staccato",
  "accent",
  "tenuto",
  "fermata",
  "trill",
  "marcato"
];

function transposeParsedNote(note: ParsedNote, semitoneDelta: number): ParsedNote {
  const midi = parsedNoteToMidi(note);
  const nextMidi = midi + semitoneDelta;
  const { letter, accidental, octave } = midiToParsedPitch(nextMidi);
  return { ...note, letter, accidental, octave };
}

function parsedNoteToMidi(note: ParsedNote): number {
  const base = basePitchClass(note.letter);
  return note.octave * 12 + base + accidentalDelta(note.accidental);
}

function midiToParsedPitch(midi: number): {
  letter: string;
  accidental: Accidental;
  octave: number;
} {
  const octave = Math.floor(midi / 12);
  const pc = ((midi % 12) + 12) % 12;
  switch (pc) {
    case 0: return { letter: "C", accidental: "", octave };
    case 1: return { letter: "C", accidental: "^", octave };
    case 2: return { letter: "D", accidental: "", octave };
    case 3: return { letter: "D", accidental: "^", octave };
    case 4: return { letter: "E", accidental: "", octave };
    case 5: return { letter: "F", accidental: "", octave };
    case 6: return { letter: "F", accidental: "^", octave };
    case 7: return { letter: "G", accidental: "", octave };
    case 8: return { letter: "G", accidental: "^", octave };
    case 9: return { letter: "A", accidental: "", octave };
    case 10: return { letter: "A", accidental: "^", octave };
    default: return { letter: "B", accidental: "", octave };
  }
}

function accidentalDelta(acc: Accidental): number {
  switch (acc) {
    case "^^": return 2;
    case "^": return 1;
    case "_": return -1;
    case "__": return -2;
    default: return 0;
  }
}

function basePitchClass(letter: string): number {
  switch (letter.toUpperCase()) {
    case "C": return 0;
    case "D": return 2;
    case "E": return 4;
    case "F": return 5;
    case "G": return 7;
    case "A": return 9;
    default: return 11;
  }
}

const DIATONIC_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];

/**
 * Step a note one diatonic position up/down. The new note carries no
 * explicit accidental — the prevailing key signature governs its pitch,
 * which yields a half- or whole-step movement as the scale dictates.
 *
 * Octave numbering matches the parser: stepping past B raises the octave,
 * stepping below C lowers it.
 */
function diatonicStepNote(note: ParsedNote, dir: 1 | -1): ParsedNote {
  const i = DIATONIC_LETTERS.indexOf(note.letter.toUpperCase());
  const ni = i + dir;
  let nextLetter: string;
  let nextOctave = note.octave;
  if (ni < 0) {
    nextLetter = DIATONIC_LETTERS[6]!;
    nextOctave -= 1;
  } else if (ni > 6) {
    nextLetter = DIATONIC_LETTERS[0]!;
    nextOctave += 1;
  } else {
    nextLetter = DIATONIC_LETTERS[ni]!;
  }
  // Leave accidental empty so the key signature applies to the new letter,
  // producing a half-step only when the scale requires it.
  return { ...note, accidental: "", letter: nextLetter, octave: nextOctave };
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

/**
 * Convert a MIDI pitch number to a ParsedNote using ABC's octave convention
 * (octave 0 = "C" = MIDI 60). Naturals are preferred; chromatic pitches
 * are spelled with sharps.
 */
function midiToNote(midi: number): ParsedNote {
  const offset = Math.round(midi) - 60;
  const octave = Math.floor(offset / 12);
  const semitone = ((offset % 12) + 12) % 12;
  const table: Array<[string, Accidental]> = [
    ["C", ""], ["C", "^"],
    ["D", ""], ["D", "^"],
    ["E", ""],
    ["F", ""], ["F", "^"],
    ["G", ""], ["G", "^"],
    ["A", ""], ["A", "^"],
    ["B", ""]
  ];
  const [letter, accidental] = table[semitone]!;
  return { accidental, letter, octave, num: 1, den: 1 };
}
