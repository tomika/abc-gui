/** Optional JSON abcjs options followed by a line containing `---`. */
export interface AbcSource {
  /** ABC input padded to keep character offsets relative to the full source. */
  abc: string;
  options: Record<string, unknown>;
  /** First position after the options separator, when a header is present. */
  bodyStart?: number;
  /** Original JSON text, including malformed drafts, without the separator. */
  headerText?: string;
  headerError?: string;
}

/** Shared by source detection and the settings dialog. Never evaluates code. */
export function parseOptionsJson(text: string): Record<string, unknown> {
  const options: unknown = JSON.parse(text);
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("Expected a JSON object.");
  }
  return options as Record<string, unknown>;
}

/** JSON object order is irrelevant; array order and scalar values are not. */
export function sameOptions(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(b, key) && sameOptions(a[key], b[key]));
}

export function parseSource(value: string): AbcSource {
  // abcjs removes CR characters before parsing, which otherwise shifts every
  // later source position in CRLF documents. A trailing space is equivalent
  // for ABC parsing and preserves the original UTF-16 character positions.
  const normalized = value.replace(/\r(?=\n)/g, " ");
  const separator = /^[\t ]*---[\t ]*\r?$/m.exec(value);
  if (!separator) return { abc: normalized, options: {} };

  const candidate = value.slice(0, separator.index).trimStart();
  // Chords, inline fields and grace notes are ordinary ABC, even when a
  // separator follows them. Only an object-like JSON prefix opts into a header.
  if (!/^\{\s*(?:["}]|$)/.test(candidate)) {
    return { abc: normalized, options: {} };
  }
  const headerText = candidate.trim();

  const end = separator.index + separator[0].length;
  const bodyStart = value[end] === "\n" ? end + 1 : end;
  // abcjs counts leading whitespace in source offsets. Masking instead of
  // deleting the header keeps clicks, raw selection and edits in sync, also
  // for fragments without X: and for Windows line endings.
  const abc = normalized.slice(0, end).replace(/[^\n]/g, " ") + normalized.slice(end);
  try {
    return { abc, options: parseOptionsJson(headerText), bodyStart, headerText };
  } catch (error) {
    return {
      abc,
      options: {},
      bodyStart,
      headerText,
      headerError: error instanceof Error ? error.message : String(error)
    };
  }
}
