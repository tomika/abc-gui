import type { AbcVisualParams, SynthOptions } from "abcjs";

type Validator = (value: unknown) => boolean;
const number: Validator = (value) => typeof value === "number" && Number.isFinite(value);
const positive: Validator = (value) => number(value) && (value as number) > 0;
const nonnegative: Validator = (value) => number(value) && (value as number) >= 0;
const integer: Validator = (value) => number(value) && Number.isInteger(value);
const bool: Validator = (value) => typeof value === "boolean";
const string: Validator = (value) => typeof value === "string";
const midi: Validator = (value) => integer(value) && (value as number) >= 0 && (value as number) <= 127;
const integers: Validator = (value) => Array.isArray(value) && value.every((item) => integer(item) && item >= 0);

const AUDIO: Record<string, Validator> = {
  swing: nonnegative, qpm: positive, defaultQpm: positive,
  program: midi, bassprog: midi, chordprog: midi, bassvol: midi, chordvol: midi,
  midiTranspose: integer, channel: (value) => integer(value) && (value as number) >= 0 && (value as number) <= 16,
  chordsOff: bool, drumOff: bool,
  voicesOff: (value) => bool(value) || integers(value),
  drum: string, gchord: string, drumBars: positive, drumIntro: nonnegative,
  fadeLength: nonnegative, soundFontVolumeMultiplier: nonnegative,
  pan: (value) => Array.isArray(value) && value.every((item) => number(item) && item >= -1 && item <= 1)
};

const VISUAL: Record<string, Validator> = {
  accentAbove: bool, ariaLabel: string, chordGrid: (value) => value === "noMusic" || value === "withMusic",
  expandToWidest: bool, foregroundColor: string, initialClef: bool,
  jazzchords: bool, germanAlphabet: bool, lineBreaks: integers,
  lineThickness: number, minPadding: nonnegative, oneSvgPerLine: bool,
  paddingbottom: nonnegative, paddingleft: nonnegative, paddingright: nonnegative, paddingtop: nonnegative,
  print: bool, scale: positive, staffwidth: positive, stafftopmargin: nonnegative,
  textboxpadding: nonnegative, visualTranspose: integer
};

const FORMAT_KEYS = new Set(("titlefont gchordfont composerfont footerfont headerfont historyfont infofont " +
  "measurefont partsfont repeatfont subtitlefont tempofont textfont voicefont tripletfont vocalfont " +
  "wordsfont annotationfont scale partsbox freegchord fontboxpadding stretchlast tablabelfont " +
  "tabnumberfont tabgracefont stafftopmargin").split(" "));

function pick(options: Readonly<Record<string, unknown>>, validators: Record<string, Validator>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, validate] of Object.entries(validators)) {
    if (Object.prototype.hasOwnProperty.call(options, key) && validate(options[key])) result[key] = options[key];
  }
  return result;
}

/** Document data cannot install callbacks, parser controls or sample URLs. */
export function synthOptions(options: Readonly<Record<string, unknown>>): SynthOptions {
  return pick(options, AUDIO);
}

export function visualOptions(options: Readonly<Record<string, unknown>>): AbcVisualParams {
  const result = pick(options, VISUAL);
  if (options.format && typeof options.format === "object" && !Array.isArray(options.format)) {
    const format: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options.format)) {
      if (FORMAT_KEYS.has(key) && (string(value) || number(value) || bool(value))) format[key] = value;
    }
    result.format = format;
  }
  if (options.wrap && typeof options.wrap === "object" && !Array.isArray(options.wrap)) {
    result.wrap = pick(options.wrap as Record<string, unknown>, {
      preferredMeasuresPerLine: positive, minSpacing: positive, maxSpacing: positive,
      lastLineLimit: positive, minSpacingLimit: positive
    });
  }
  return result;
}
