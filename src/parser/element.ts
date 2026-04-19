/**
 * Element-internal micro-parser.
 *
 * Rationale (per project direction): abcjs already tokenizes an ABC source
 * into elements with accurate `startChar`/`endChar` offsets, so we don't
 * reimplement a full ABC tokenizer. What abcjs does NOT provide is a
 * structured, editable model of the *inside* of a single element — e.g. the
 * accidental, octave marks, and length fraction of a note, or the parts of
 * an info field. This module fills that gap:
 *
 *   raw element text  ⇄  structured fields usable by the property panel
 *
 * The parsers only need to understand syntax that can legally appear inside
 * the source span of a single ABC element, so they are small and robust.
 */

// ---------------------------------------------------------------------------
// Length: <num>/<den>, "/" shorthand
// ---------------------------------------------------------------------------

/** Read an ABC length suffix starting at index `i` in `src`.
 *  Returns { num, den, end } where `end` is the index after the suffix. */
export function readLength(
  src: string,
  i: number
): { num: number; den: number; end: number } {
  let num = 1;
  let den = 1;
  let numStr = "";
  while (i < src.length && src[i] >= "0" && src[i] <= "9") numStr += src[i++];
  if (numStr) num = parseInt(numStr, 10);
  if (src[i] === "/") {
    i++;
    let denStr = "";
    while (i < src.length && src[i] >= "0" && src[i] <= "9") denStr += src[i++];
    if (denStr) {
      den = parseInt(denStr, 10);
    } else {
      den = 2;
      while (src[i] === "/") {
        den *= 2;
        i++;
      }
    }
  }
  return { num, den, end: i };
}

/** Serialize a length fraction back to ABC syntax (minimal form). */
export function writeLength(num: number, den: number): string {
  if (num === 1 && den === 1) return "";
  if (den === 1) return String(num);
  if (num === 1) return "/" + den;
  return num + "/" + den;
}

// ---------------------------------------------------------------------------
// Octave marks: `,` lowers, `'` raises, letter case also matters.
// We normalize so that "C" = octave 0, "c" = octave 1, "c'" = 2, "C," = -1.
// ---------------------------------------------------------------------------

export function readOctaveMarks(
  src: string,
  i: number,
  letterIsLower: boolean
): { octave: number; end: number } {
  let octave = letterIsLower ? 1 : 0;
  while (i < src.length) {
    if (src[i] === ",") {
      octave -= 1;
      i++;
    } else if (src[i] === "'") {
      octave += 1;
      i++;
    } else {
      break;
    }
  }
  return { octave, end: i };
}

export function writePitch(letter: string, octave: number): string {
  const base = letter.toUpperCase();
  if (octave <= 0) return base + ",".repeat(-octave);
  return base.toLowerCase() + "'".repeat(octave - 1);
}

// ---------------------------------------------------------------------------
// Accidentals
// ---------------------------------------------------------------------------

export type Accidental = "" | "^^" | "^" | "=" | "_" | "__";
export const ACCIDENTALS: Accidental[] = ["__", "_", "=", "", "^", "^^"];
export const ACCIDENTAL_GLYPH: Record<Accidental, string> = {
  "": "♮̸", // "no accidental"
  "^": "♯",
  "^^": "𝄪",
  "=": "♮",
  "_": "♭",
  "__": "𝄫"
};

export function readAccidental(
  src: string,
  i: number
): { acc: Accidental; end: number } {
  if (src[i] === "^") {
    if (src[i + 1] === "^") return { acc: "^^", end: i + 2 };
    return { acc: "^", end: i + 1 };
  }
  if (src[i] === "_") {
    if (src[i + 1] === "_") return { acc: "__", end: i + 2 };
    return { acc: "_", end: i + 1 };
  }
  if (src[i] === "=") return { acc: "=", end: i + 1 };
  return { acc: "", end: i };
}

// ---------------------------------------------------------------------------
// Note (single pitch)
// ---------------------------------------------------------------------------

export interface ParsedNote {
  accidental: Accidental;
  letter: string; // A-G (always uppercase in parsed form)
  octave: number; // 0 = "C", 1 = "c", etc.
  num: number;
  den: number;
}

/** Parse a single note starting at `i`. Returns null if not a note. */
export function readNote(src: string, i: number): (ParsedNote & { end: number }) | null {
  const start = i;
  const { acc, end: afterAcc } = readAccidental(src, i);
  i = afterAcc;
  const letter = src[i];
  if (!letter || !/[A-Ga-g]/.test(letter)) return null;
  i++;
  const isLower = letter === letter.toLowerCase();
  const { octave, end: afterOct } = readOctaveMarks(src, i, isLower);
  i = afterOct;
  const { num, den, end: afterLen } = readLength(src, i);
  i = afterLen;
  return {
    accidental: acc,
    letter: letter.toUpperCase(),
    octave,
    num,
    den,
    end: i === start ? start : i
  };
}

export function writeNote(n: ParsedNote): string {
  return n.accidental + writePitch(n.letter, n.octave) + writeLength(n.num, n.den);
}

// ---------------------------------------------------------------------------
// Whole-element parser: given the raw text of an element (as delimited by
// abcjs' startChar/endChar), produce structured data when we recognize it.
// Unknown text is returned as kind "raw" so raw editing still works.
// ---------------------------------------------------------------------------

export interface ParsedRest {
  variant: "z" | "x" | "Z" | "X";
  num: number;
  den: number;
}

export function readRest(src: string, i: number): (ParsedRest & { end: number }) | null {
  const c = src[i];
  if (c !== "z" && c !== "x" && c !== "Z" && c !== "X") return null;
  const { num, den, end } = readLength(src, i + 1);
  return { variant: c, num, den, end };
}

export function writeRest(r: ParsedRest): string {
  return r.variant + writeLength(r.num, r.den);
}

export interface ParsedChord {
  notes: ParsedNote[];
  num: number;
  den: number;
}

/** Parse a bracketed chord like `[C^EG]3/2`. */
export function readChord(src: string, i: number): (ParsedChord & { end: number }) | null {
  if (src[i] !== "[") return null;
  const close = src.indexOf("]", i + 1);
  if (close === -1) return null;
  const notes: ParsedNote[] = [];
  let j = i + 1;
  while (j < close) {
    const n = readNote(src, j);
    if (!n) {
      j++;
      continue;
    }
    notes.push({
      accidental: n.accidental,
      letter: n.letter,
      octave: n.octave,
      num: n.num,
      den: n.den
    });
    j = n.end;
  }
  const { num, den, end } = readLength(src, close + 1);
  return { notes, num, den, end };
}

export function writeChord(c: ParsedChord): string {
  return "[" + c.notes.map(writeNote).join("") + "]" + writeLength(c.num, c.den);
}

// ---------------------------------------------------------------------------
// Info field: "K:Gmaj" etc. Used for header lines and inline [K:..] fields.
// ---------------------------------------------------------------------------

export interface ParsedInfoField {
  name: string;
  value: string;
}

export function readInfoLine(line: string): ParsedInfoField | null {
  const m = /^([A-Za-z]):(.*)$/.exec(line);
  if (!m) return null;
  return { name: m[1]!, value: m[2]!.trim() };
}

export function readInlineField(src: string): ParsedInfoField | null {
  // "[K:Gmaj]"
  const m = /^\[([A-Za-z]):(.*)\]$/.exec(src);
  if (!m) return null;
  return { name: m[1]!, value: m[2]!.trim() };
}

export function writeInfoLine(f: ParsedInfoField): string {
  return f.name + ":" + f.value;
}

export function writeInlineField(f: ParsedInfoField): string {
  return "[" + f.name + ":" + f.value + "]";
}

// ---------------------------------------------------------------------------
// Bar line types (ABC 2.1 §8.1). We recognize the common ones; anything else
// passes through unchanged.
// ---------------------------------------------------------------------------

export const BAR_TYPES: { value: string; label: string; title: string }[] = [
  { value: "|", label: "|", title: "bar line" },
  { value: "||", label: "‖", title: "double bar line" },
  { value: "[|", label: "[|", title: "thin-thick double bar" },
  { value: "|]", label: "|]", title: "thick-thin double bar" },
  { value: "|:", label: "|:", title: "start repeat" },
  { value: ":|", label: ":|", title: "end repeat" },
  { value: "::", label: "∷", title: "end-start repeat" },
  { value: ".|", label: ".|", title: "dotted bar" },
  { value: "|1", label: "|1", title: "first ending" },
  { value: "|2", label: "|2", title: "second ending" },
  { value: "[1", label: "[1", title: "first ending (start)" },
  { value: "[2", label: "[2", title: "second ending (start)" }
];

// ---------------------------------------------------------------------------
// Decorations (subset of ABC 2.1 §4.14 & §4.16 shorthand chars)
// ---------------------------------------------------------------------------

export interface Decoration {
  name: string;      // "staccato", "trill", ...
  symbol: string;    // Unicode glyph for the UI button
  title: string;     // tooltip
  shorthand?: string; // single-char form if one exists
}

export const DECORATIONS: Decoration[] = [
  { name: "staccato",  symbol: "·",  title: "staccato",  shorthand: "." },
  { name: "tenuto",    symbol: "―",  title: "tenuto" },
  { name: "accent",    symbol: ">",  title: "accent" },
  { name: "marcato",   symbol: "^",  title: "marcato" },
  { name: "fermata",   symbol: "𝄐",  title: "fermata" },
  { name: "trill",     symbol: "𝆖",  title: "trill",     shorthand: "T" },
  { name: "turn",      symbol: "𝆗",  title: "turn" },
  { name: "lowermordent", symbol: "𝆘", title: "lower mordent", shorthand: "M" },
  { name: "uppermordent", symbol: "𝆙", title: "upper mordent", shorthand: "P" },
  { name: "roll",      symbol: "~",  title: "roll",      shorthand: "~" },
  { name: "segno",     symbol: "𝄋",  title: "segno",     shorthand: "S" },
  { name: "coda",      symbol: "𝄌",  title: "coda",      shorthand: "O" },
  { name: "downbow",   symbol: "⊓",  title: "down-bow",  shorthand: "u" },
  { name: "upbow",     symbol: "V",  title: "up-bow",    shorthand: "v" },
  { name: "breath",    symbol: "’",  title: "breath" }
];

// ---------------------------------------------------------------------------
// Length presets (unit-length fractions).
// ---------------------------------------------------------------------------

export const LENGTH_PRESETS: { num: number; den: number; glyph: string; title: string }[] = [
  { num: 8, den: 1, glyph: "𝅜", title: "double whole / breve (×8)" },
  { num: 4, den: 1, glyph: "𝅝", title: "whole / 4× unit" },
  { num: 2, den: 1, glyph: "𝅗𝅥", title: "half / 2× unit" },
  { num: 1, den: 1, glyph: "♩", title: "unit length" },
  { num: 1, den: 2, glyph: "♪", title: "half of unit" },
  { num: 1, den: 4, glyph: "𝅘𝅥𝅯", title: "quarter of unit" },
  { num: 1, den: 8, glyph: "𝅘𝅥𝅰", title: "eighth of unit" }
];

// ---------------------------------------------------------------------------
// Prefix parsing: chord symbols / annotations ("..."), decorations (!name!
// or short-char forms), and grace-note groups ({...}) that attach to a note
// or rest. These are returned by abcjs as part of the note element's
// startChar/endChar range, so the property panel has to peel them off before
// parsing the core note.
// ---------------------------------------------------------------------------
//
// Per ABC 2.1: a quoted string `"..."` attached to a note is either
//   - a chord symbol (no leading ^/_/</>/@), or
//   - an annotation, with a placement prefix: ^ above, _ below, <, >, @ free.
//
// Decorations use either `!name!` long form or a single "legal decoration
// character" (.~HLMOPSTuv) per the ABC standard.
//
// Grace notes are `{...}` (or `{/...}` for acciaccatura).

export interface ParsedAnnotation {
  /** Original full text including outer quotes, e.g. `"^text"` or `"Gm"`. */
  raw: string;
  /** Placement prefix if any: "^" | "_" | "<" | ">" | "@" | "" (chord symbol). */
  placement: "" | "^" | "_" | "<" | ">" | "@";
  /** Text portion without the quotes and placement prefix. */
  text: string;
}

export interface ElementPrefix {
  /** Annotations / chord symbols in order they appear. */
  annotations: ParsedAnnotation[];
  /** Decoration names in order (long form without the bang delimiters). */
  decorations: string[];
  /** Grace-note group raw text (without the braces), or null if absent. */
  grace: string | null;
  /** Literal prefix source as it originally appeared, for round-tripping. */
  raw: string;
  /** Index in the source where the prefix ends (= start of the core element). */
  end: number;
}

// Short-char decoration forms recognized by ABC 2.1 §4.14.
const SHORTCHAR_DECO: Record<string, string> = {
  ".": "staccato",
  "~": "roll",
  H: "fermata",
  L: "accent",
  M: "lowermordent",
  O: "coda",
  P: "uppermordent",
  S: "segno",
  T: "trill",
  u: "upbow",
  v: "downbow"
};

/** Parse any leading prefix (annotations, decorations, grace notes) off `src`
 *  starting at index `i`. Always returns an ElementPrefix — `end === i` when
 *  no prefix was present. */
export function readPrefix(src: string, i: number): ElementPrefix {
  const start = i;
  const out: ElementPrefix = {
    annotations: [],
    decorations: [],
    grace: null,
    raw: "",
    end: i
  };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const c = src[i];
    if (c === undefined) break;
    // Skip spaces between prefix items.
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (c === '"') {
      const close = src.indexOf('"', i + 1);
      if (close === -1) break;
      const inner = src.slice(i + 1, close);
      let placement: ParsedAnnotation["placement"] = "";
      let text = inner;
      if (/^[\^_<>@]/.test(inner)) {
        placement = inner[0] as ParsedAnnotation["placement"];
        text = inner.slice(1);
      }
      out.annotations.push({ raw: src.slice(i, close + 1), placement, text });
      i = close + 1;
      continue;
    }
    if (c === "!") {
      const close = src.indexOf("!", i + 1);
      if (close === -1 || src.slice(i + 1, close).includes("\n")) break;
      out.decorations.push(src.slice(i + 1, close));
      i = close + 1;
      continue;
    }
    if (c === "{") {
      const close = src.indexOf("}", i + 1);
      if (close === -1) break;
      out.grace = src.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(SHORTCHAR_DECO, c)) {
      // Only treat as a decoration if followed by a note/rest/accidental/chord
      // (otherwise e.g. "T" could be the start of "T:title").
      const nxt = src[i + 1];
      if (nxt && /[A-Ga-gzxZX\^_=\[\(\{!"\.\~HLMOPSTuv]/.test(nxt)) {
        out.decorations.push(SHORTCHAR_DECO[c]!);
        i++;
        continue;
      }
    }
    break;
  }
  out.end = i;
  out.raw = src.slice(start, i);
  return out;
}

/**
 * Returns true when `text` will be interpreted as a MIDI-playable chord
 * symbol by abcjs's ChordTrack.  The rules are derived directly from
 * abcjs's `interpretChord` implementation:
 *
 *  - The "break" synonyms ('break', '(break)', 'no chord', 'n.c.',
 *    'tacet') are silences — they are valid in the sense that abcjs
 *    handles them without falling back to "ignore this chord".
 *  - Otherwise the first character of the name (after an optional
 *    leading '(') must be one of A–G (uppercase, as stored in abcjs's
 *    `basses` table).  Any modifier that follows is accepted; unrecognised
 *    modifiers fall back to a major triad.
 *  - An empty string is considered invalid.
 */
export function isAbcjsMidiChord(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (
    lower === "break" ||
    lower === "(break)" ||
    lower === "no chord" ||
    lower === "n.c." ||
    lower === "tacet"
  ) return true;
  let name = text;
  if (name[0] === "(") {
    name = name.slice(1, name.length - 1);
    if (!name) return false;
  }
  const root = name[0];
  if (!root) return false;
  return "ABCDEFG".includes(root);
}

/** Serialize an ElementPrefix back to ABC text (preserving original order
 *  as best as possible: annotations, then decorations, then grace notes). */
export function writePrefix(p: ElementPrefix): string {
  let out = "";
  for (const a of p.annotations) {
    out += '"' + a.placement + a.text + '"';
  }
  for (const d of p.decorations) {
    out += "!" + d + "!";
  }
  if (p.grace !== null) {
    out += "{" + p.grace + "}";
  }
  return out;
}
