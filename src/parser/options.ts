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

const AUDIO = {
  swing: nonnegative, qpm: positive, defaultQpm: positive,
  program: midi, bassprog: midi, chordprog: midi, bassvol: midi, chordvol: midi,
  midiTranspose: integer, channel: (value) => integer(value) && (value as number) >= 0 && (value as number) <= 16,
  chordsOff: bool, drumOff: bool,
  voicesOff: (value) => bool(value) || integers(value),
  drum: string, gchord: string, drumBars: positive, drumIntro: nonnegative,
  fadeLength: nonnegative, soundFontVolumeMultiplier: nonnegative,
  pan: (value) => Array.isArray(value) && value.every((item) => number(item) && item >= -1 && item <= 1)
} satisfies Record<string, Validator>;

const VISUAL = {
  accentAbove: bool, ariaLabel: string, chordGrid: (value) => value === "noMusic" || value === "withMusic",
  expandToWidest: bool, foregroundColor: string, initialClef: bool,
  jazzchords: bool, germanAlphabet: bool, lineBreaks: integers,
  lineThickness: number, minPadding: nonnegative, oneSvgPerLine: bool,
  paddingbottom: nonnegative, paddingleft: nonnegative, paddingright: nonnegative, paddingtop: nonnegative,
  print: bool, scale: positive, staffwidth: positive, stafftopmargin: nonnegative,
  textboxpadding: nonnegative, visualTranspose: integer
} satisfies Record<string, Validator>;

/** Values an options header may contain, typed as abcjs declares them. */
export type HeaderOptionValues =
  Pick<SynthOptions, keyof typeof AUDIO> & Pick<AbcVisualParams, keyof typeof VISUAL | "format" | "wrap">;
export type HeaderOptionKey = keyof HeaderOptionValues;

export interface HeaderOptionDefault<T> {
  /** Used when the document header does not set the option. */
  value: T;
  /** `false` fixes the value: the header cannot override it and the editor
   *  shows it read-only. Default: `true`. */
  editable?: boolean;
}

/** Host-supplied defaults for the options header, per option. */
export type HeaderOptionDefaults = {
  [K in HeaderOptionKey]?: HeaderOptionDefault<NonNullable<HeaderOptionValues[K]>>;
};

/** Checked defaults: values per key, and the keys the host fixes. */
export interface ResolvedDefaults {
  values: Readonly<Record<string, unknown>>;
  locked: ReadonlySet<string>;
}

const HEADER_KEYS: ReadonlySet<string> = new Set([...Object.keys(AUDIO), ...Object.keys(VISUAL), "format", "wrap"]);

export function isHeaderOptionKey(key: string): key is HeaderOptionKey {
  return HEADER_KEYS.has(key);
}

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

/** Every supported, well-typed option; anything else is dropped. */
function supportedOptions(options: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return { ...synthOptions(options), ...visualOptions(options) };
}

/** Defaults pass the same checks as document values; invalid entries are dropped. */
export function resolveDefaults(defaults: HeaderOptionDefaults = {}): ResolvedDefaults {
  const values: Record<string, unknown> = {};
  const locked = new Set<string>();
  for (const [key, entry] of Object.entries(defaults) as Array<[string, HeaderOptionDefault<unknown> | undefined]>) {
    if (!entry || typeof entry !== "object") continue;
    const checked = supportedOptions({ [key]: entry.value });
    if (!Object.prototype.hasOwnProperty.call(checked, key)) {
      console.warn(`[abc-gui] Ignoring unsupported header option default "${key}".`);
      continue;
    }
    values[key] = checked[key];
    if (entry.editable === false) locked.add(key);
  }
  return { values, locked };
}

/**
 * Effective header options: defaults, then valid document values. Fixed
 * defaults always win. Nested objects (`format`, `wrap`) are replaced whole.
 */
export function applyDefaults(
  document: Readonly<Record<string, unknown>>,
  defaults: ResolvedDefaults
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults.values };
  for (const [key, value] of Object.entries(supportedOptions(document))) {
    if (!defaults.locked.has(key)) result[key] = value;
  }
  return result;
}
