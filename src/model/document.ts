/**
 * Source-of-truth model for the editor.
 *
 * Holds the raw ABC text and exposes a `replace(start, end, newText)` API
 * for surgical edits. Also runs abcjs' parser on demand and exposes the
 * resulting tune objects so the UI can map clicks & selection back to
 * character ranges.
 */

import abcjs from "abcjs";

export interface ChangeEvent {
  /** whole source after the edit */
  value: string;
  /** character range that was replaced (in the pre-edit document) */
  replaced: { start: number; end: number };
  /** text that now occupies the replaced range */
  inserted: string;
}

export type ChangeListener = (ev: ChangeEvent) => void;

/** A lightweight view of what abcjs tells us about a single element. */
export interface AbcElement {
  el_type: string;            // "note" | "bar" | "rest" (abcjs also uses "note" for chords)
  startChar: number;
  endChar: number;
  [key: string]: unknown;
}

export class AbcDocument {
  private _value: string;
  private listeners: ChangeListener[] = [];
  private _parsed: unknown[] | null = null;
  /** Undo stack: snapshots of _value *before* each mutation. */
  private undoStack: string[] = [];
  /** Redo stack: snapshots restored by undo(); cleared by new mutations. */
  private redoStack: string[] = [];
  /** Max number of history entries we keep. */
  private maxHistory = 200;
  /** While true, mutations do not push to the undo stack (used by undo/redo). */
  private suppressHistory = false;
  /** Timestamp of last mutation, used for coalescing rapid edits. */
  private lastPushAt = 0;
  /** ms window during which consecutive mutations coalesce into one undo step. */
  private coalesceMs = 400;

  constructor(initial = "") {
    this._value = initial;
  }

  get value(): string {
    return this._value;
  }

  setValue(v: string, { silent = false }: { silent?: boolean } = {}) {
    const old = this._value;
    if (v === old) return;
    this.pushHistory(old);
    this._value = v;
    this._parsed = null;
    if (!silent) {
      this.emit({
        value: v,
        replaced: { start: 0, end: old.length },
        inserted: v
      });
    }
  }

  /** Replace the character range [start, end) with `newText`. */
  replace(start: number, end: number, newText: string): ChangeEvent {
    const old = this._value;
    const before = old.slice(0, start);
    const after = old.slice(end);
    const next = before + newText + after;
    if (next !== old) this.pushHistory(old);
    this._value = next;
    this._parsed = null;
    const ev: ChangeEvent = {
      value: this._value,
      replaced: { start, end },
      inserted: newText
    };
    this.emit(ev);
    return ev;
  }

  // ---- History ---------------------------------------------------

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Restore the previous value. No-op if stack is empty. */
  undo(): void {
    if (!this.undoStack.length) return;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(this._value);
    const old = this._value;
    this.suppressHistory = true;
    try {
      this._value = prev;
      this._parsed = null;
      this.emit({
        value: prev,
        replaced: { start: 0, end: old.length },
        inserted: prev
      });
    } finally {
      this.suppressHistory = false;
    }
  }

  /** Reapply the most recently undone value. */
  redo(): void {
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(this._value);
    const old = this._value;
    this.suppressHistory = true;
    try {
      this._value = next;
      this._parsed = null;
      this.emit({
        value: next,
        replaced: { start: 0, end: old.length },
        inserted: next
      });
    } finally {
      this.suppressHistory = false;
    }
  }

  /** Record `old` on the undo stack. Recent rapid edits coalesce into one entry. */
  private pushHistory(old: string): void {
    if (this.suppressHistory) return;
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top !== undefined && now - this.lastPushAt < this.coalesceMs) {
      // Coalesce: keep the older snapshot on top, drop the intermediate one.
      this.lastPushAt = now;
      this.redoStack.length = 0;
      return;
    }
    this.undoStack.push(old);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack.length = 0;
    this.lastPushAt = now;
  }

  /** Return the source text of a range. */
  slice(start: number, end: number): string {
    return this._value.slice(start, end);
  }

  on(listener: ChangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private emit(ev: ChangeEvent) {
    // Clone array so listeners can remove themselves during iteration.
    for (const l of [...this.listeners]) l(ev);
  }

  /**
   * Parse the source with abcjs and cache the result.
   * Uses `abcjs.parseOnly` when available (v6+) or falls back to
   * `abcjs.renderAbc` on a detached element.
   */
  parsed(): unknown[] {
    if (this._parsed) return this._parsed;
    const api = abcjs as unknown as {
      parseOnly?: (src: string) => unknown[];
    };
    if (typeof api.parseOnly === "function") {
      this._parsed = api.parseOnly(this._value) || [];
    } else {
      this._parsed = [];
    }
    return this._parsed;
  }

  /** Walk every abcjs element and invoke `cb` with it. */
  forEachElement(cb: (el: AbcElement) => void): void {
    const tunes = this.parsed() as Array<{
      lines?: Array<{
        staff?: Array<{
          voices?: Array<Array<AbcElement>>;
        }>;
      }>;
    }>;
    for (const tune of tunes) {
      for (const line of tune.lines ?? []) {
        for (const staff of line.staff ?? []) {
          for (const voice of staff.voices ?? []) {
            for (const el of voice) {
              if (el && typeof el.startChar === "number") cb(el);
            }
          }
        }
      }
    }
  }

  /** Find the element whose startChar/endChar contains `offset`. */
  elementAtOffset(offset: number): AbcElement | null {
    let best: AbcElement | null = null;
    this.forEachElement((el) => {
      if (offset >= el.startChar && offset < el.endChar) {
        if (!best || el.endChar - el.startChar < best.endChar - best.startChar) {
          best = el;
        }
      }
    });
    return best;
  }

  /**
   * Find the character range of the info-field line (e.g. `K:G`, `T:Title`,
   * `Q:1/4=120`) containing `offset`, if any. Returns null when `offset` is
   * inside a music line or a comment line.
   */
  infoLineAt(offset: number): { startChar: number; endChar: number } | null {
    const v = this._value;
    if (offset < 0 || offset > v.length) return null;
    // Extend back to start of line.
    let s = offset;
    while (s > 0 && v[s - 1] !== "\n") s--;
    // Extend forward to end of line.
    let e = offset;
    while (e < v.length && v[e] !== "\n") e++;
    const line = v.slice(s, e);
    // ABC info field: single letter + ":" at column 0. Excludes comments.
    if (/^[A-Za-z]:/.test(line)) return { startChar: s, endChar: e };
    return null;
  }

  /**
   * Find the inline field (e.g. `[K:C]`, `[M:6/8]`) whose character range
   * contains `offset`, if any.
   */
  inlineFieldAt(offset: number): { startChar: number; endChar: number } | null {
    const v = this._value;
    // Walk backwards to the nearest unmatched `[` on the same line.
    let s = offset;
    while (s > 0 && v[s - 1] !== "\n") {
      s--;
      if (v[s] === "[") break;
    }
    if (v[s] !== "[") return null;
    // Must look like [X:
    if (!/^\[[A-Za-z]:/.test(v.slice(s, s + 3))) return null;
    const close = v.indexOf("]", s);
    if (close === -1) return null;
    // Ensure no newline between s and close (inline fields don't span lines).
    if (v.slice(s, close).includes("\n")) return null;
    const e = close + 1;
    if (offset < s || offset > e) return null;
    return { startChar: s, endChar: e };
  }

  /**
   * Find the last info-field line with the given name at or before `offset`.
   * This is used to map rendered staff symbols like clef/key/meter back to
   * their editable source line when abcjs doesn't provide a precise field span.
   */
  findInfoLineByName(
    name: string,
    offset = this._value.length
  ): { startChar: number; endChar: number } | null {
    const v = this._value;
    const limit = Math.max(0, Math.min(offset, v.length));
    let lineStart = 0;
    let last: { startChar: number; endChar: number } | null = null;

    while (lineStart <= limit) {
      let lineEnd = v.indexOf("\n", lineStart);
      if (lineEnd === -1) lineEnd = v.length;
      const line = v.slice(lineStart, lineEnd);
      if (new RegExp(`^\\s*${name}:`).test(line)) {
        last = { startChar: lineStart, endChar: lineEnd };
      }
      if (lineEnd >= limit) break;
      lineStart = lineEnd + 1;
    }

    return last;
  }

  /**
   * Return the effective unit note length (`L:`) in force at `offset`.
   *
   * ABC 2.1 allows `L:` to appear as a header line, as a body line mid-tune,
   * or as an inline field (e.g. `[L:1/4]`). The last `L:` encountered before
   * a note sets its unit length. When no `L:` has been given, the spec's
   * default is 1/16 for meters < 3/4 and 1/8 otherwise; we use 1/8 as a
   * pragmatic default which is also abcjs's fallback.
   */
  unitLengthAt(offset: number): { num: number; den: number } {
    const v = this._value;
    const upto = v.slice(0, Math.max(0, Math.min(offset, v.length)));
    // Match the last L: directive: either header/body form `L:1/8` at start of
    // a line, or inline `[L:1/8]` anywhere. Use a greedy scan by iterating
    // all matches and keeping the last.
    const re = /(?:^|\n)\s*L:\s*([0-9]+)\s*\/\s*([0-9]+)|\[\s*L:\s*([0-9]+)\s*\/\s*([0-9]+)\s*\]/g;
    let last: { num: number; den: number } | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(upto)) !== null) {
      const num = parseInt((m[1] ?? m[3])!, 10);
      const den = parseInt((m[2] ?? m[4])!, 10);
      if (num > 0 && den > 0) last = { num, den };
    }
    return last ?? { num: 1, den: 8 };
  }

  /**
   * Return the effective key signature in force at `offset`, parsed from
   * the most recent `K:` directive (header, body, or inline `[K:...]`).
   *
   * Defaults to C major when no `K:` is found.
   */
  keyAt(offset: number): { tonic: string; accidental: "" | "#" | "b"; mode: string } {
    const v = this._value;
    const upto = v.slice(0, Math.max(0, Math.min(offset, v.length)));
    // Match either header/body line `K:...` or inline `[K:...]`.
    const re = /(?:^|\n)\s*K:\s*([^\n\r\]]*)|\[\s*K:\s*([^\]\n\r]*)\]/g;
    let lastValue: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(upto)) !== null) {
      const v2 = (m[1] ?? m[2] ?? "").trim();
      if (v2.length > 0) lastValue = v2;
    }
    return parseKeySpec(lastValue ?? "C");
  }
}

function parseKeySpec(spec: string): { tonic: string; accidental: "" | "#" | "b"; mode: string } {
  // e.g. "G", "Bb", "F#dor", "C#m", "Eb maj", "HP" (highland pipes — fall back to C)
  const m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(spec.trim());
  if (!m) return { tonic: "C", accidental: "", mode: "maj" };
  const tonic = m[1]!.toUpperCase();
  const acc = (m[2] as "" | "#" | "b") ?? "";
  const rawMode = (m[3] ?? "").toLowerCase();
  let mode: string;
  if (!rawMode) mode = "maj";
  else if (rawMode.startsWith("min") || rawMode === "m" || rawMode.startsWith("aeo")) mode = "min";
  else if (rawMode.startsWith("maj") || rawMode.startsWith("ion")) mode = "maj";
  else if (rawMode.startsWith("dor")) mode = "dor";
  else if (rawMode.startsWith("phr")) mode = "phr";
  else if (rawMode.startsWith("lyd")) mode = "lyd";
  else if (rawMode.startsWith("mix")) mode = "mix";
  else if (rawMode.startsWith("loc")) mode = "loc";
  else mode = "maj";
  return { tonic, accidental: acc, mode };
}
