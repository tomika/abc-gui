/**
 * Score view: renders the current ABC source via abcjs and exposes a
 * selection event when the user clicks a rendered element. abcjs itself
 * tokenizes the source, so we simply forward its `startChar`/`endChar`
 * to the editor and let our model resolve the element.
 */

import abcjs from "abcjs";
import type { AbcDocument } from "../model/document.js";

export interface SelectionEvent {
  startChar: number;
  endChar: number;
  /** space-separated CSS classes abcjs applied to the clicked SVG group;
   *  lets us re-find the exact element for highlighting regardless of
   *  element type (note, bar, clef, key signature, meter, tempo, etc.). */
  classes: string;
  /** the raw `abcelem` object as abcjs exposes it */
  abcelem: unknown;
  /** semantic click metadata from abcjs for non-note staff symbols */
  analysis?: {
    name?: string;
    clickedName?: string;
    line?: number;
    measure?: number;
  };
}

export class ScoreView {
  private host: HTMLElement;
  private doc: AbcDocument;
  private listeners: ((ev: SelectionEvent) => void)[] = [];
  private renderListeners: (() => void)[] = [];
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private selected: { startChar: number; endChar: number } | null = null;
  private selectedClasses: string | null = null;
  private lastTune: unknown = null;

  constructor(host: HTMLElement, doc: AbcDocument) {
    this.host = host;
    this.doc = doc;
    this.host.classList.add("abc-gui-score");
    this.doc.on(() => this.scheduleRender());
    this.render();
  }

  onSelect(cb: (ev: SelectionEvent) => void): void {
    this.listeners.push(cb);
  }

  /** Fires after each (debounced) abcjs render completes. */
  onRender(cb: () => void): void {
    this.renderListeners.push(cb);
  }

  /** The most recently rendered abcjs tune object, or null if unavailable. */
  getTune(): unknown {
    return this.lastTune;
  }

  setSelected(
    range: { startChar: number; endChar: number } | null,
    classes: string | null = null
  ): void {
    this.selected = range;
    this.selectedClasses = range ? classes : null;
    this.applySelectionStyle();
  }

  destroy(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.host.innerHTML = "";
  }

  private scheduleRender(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer);
    this.renderTimer = setTimeout(() => this.render(), 30);
  }

  private render(): void {
    const api = abcjs as unknown as {
      renderAbc: (
        host: HTMLElement | string,
        src: string,
        params?: Record<string, unknown>
      ) => unknown;
    };
    if (!api.renderAbc) {
      this.host.textContent = "(abcjs not available)";
      return;
    }
    const result = api.renderAbc(this.host, this.doc.value, {
      add_classes: true,
      responsive: "resize",
      // Make every drawn element selectable — by default abcjs only allows
      // clicks on note/tabNumber, which means clefs, key & meter signatures,
      // bar lines, tempo, metadata, decorations, etc. are silently ignored.
      selectTypes: true,
      // Align abcjs's own click-highlight color with the CSS highlight we
      // apply via `.abc-gui-selected`. Without this, abcjs paints clef /
      // key-sig / bar hits in its default red (via direct `fill=`
      // attributes on child paths) while notes still look blue because
      // our CSS class lands on the whole group.
      selectionColor: "#1659c7",
      clickListener: (
        abcelem: {
          startChar?: number;
          endChar?: number;
          [k: string]: unknown;
        },
        _tuneNumber: number,
        classes: string,
        analysis?: {
          name?: string;
          clickedName?: string;
          line?: number;
          measure?: number;
        }
      ) => {
        const ev: SelectionEvent = {
          startChar: typeof abcelem.startChar === "number" ? abcelem.startChar : -1,
          endChar: typeof abcelem.endChar === "number" ? abcelem.endChar : -1,
          classes: typeof classes === "string" ? classes : "",
          abcelem,
          analysis
        };
        for (const l of this.listeners) l(ev);
      }
    });
    // `renderAbc` returns an array of TuneObjects (one per `X:`). Keep the
    // first so the editor can reuse it for MIDI synthesis / timing queries.
    this.lastTune = Array.isArray(result) ? result[0] ?? null : null;
    // abcjs overwrites inline styles on the render target to implement its
    // `responsive: "resize"` aspect-ratio trick — notably a huge
    // `padding-bottom` and `height: 100%` that together make the host div
    // grow to match the rendered SVG's aspect ratio, blowing past our fixed
    // pane size. Restore the scroll-critical styles so the host stays a
    // stable, scrollable box.
    const hostStyle = this.host.style;
    hostStyle.paddingBottom = "";
    hostStyle.height = "";
    hostStyle.overflow = "";
    hostStyle.overflowX = "auto";
    hostStyle.overflowY = "auto";
    this.applySelectionStyle();
    for (const l of [...this.renderListeners]) l();
  }

  /** Highlight the SVG group(s) that represent the selected element. */
  private applySelectionStyle(): void {
    const prev = this.host.querySelectorAll(".abc-gui-selected");
    prev.forEach((n) => n.classList.remove("abc-gui-selected"));
    if (!this.selected) return;

    // Preferred path: walk the engraved tune and find the absolute element(s)
    // whose source range overlaps the selection, then highlight their SVG
    // nodes directly. This works for every element type and — because it
    // re-resolves against the freshly engraved structure on each call — keeps
    // the visible selection in sync after any re-render triggered by a
    // property-panel edit, even when positional class names have shifted.
    if (this.highlightFromEngraver()) return;

    // Fallback 1: use the exact class list abcjs reported for the clicked
    // element when we still have a tune-less render (e.g. abcjs not loaded).
    if (this.selectedClasses) {
      const selector = classListToSelector(this.selectedClasses);
      if (selector) {
        const nodes = this.host.querySelectorAll<SVGElement>(selector);
        if (nodes.length > 0) {
          nodes.forEach((n) => n.classList.add("abc-gui-selected"));
          return;
        }
      }
    }

    // Fallback 2: abcjs tags note heads with `abcjs-n<noteIndexInMeasure>`,
    // which is not actually a character offset; this only matches when the
    // note's index inside its measure happens to equal the selection's start.
    // Kept for backwards-compatibility with the previous behaviour.
    const nodes = this.host.querySelectorAll<SVGElement>(
      `.abcjs-n${this.selected.startChar}`
    );
    nodes.forEach((n) => n.classList.add("abc-gui-selected"));
  }

  /**
   * Use the abcjs engraver's `staffgroups` (populated during `engraveABC`)
   * to map the current source-character selection onto live SVG nodes.
   * Returns true when at least one node was highlighted.
   */
  private highlightFromEngraver(): boolean {
    const sel = this.selected;
    if (!sel) return false;
    const tune = this.lastTune as
      | {
          engraver?: {
            staffgroups?: Array<{
              voices?: Array<{
                children?: Array<{
                  abcelem?: { startChar?: number; endChar?: number };
                  elemset?: ArrayLike<Element> | null;
                  svgEl?: Element | null;
                }>;
              }>;
            }>;
          };
        }
      | null;
    const staffgroups = tune?.engraver?.staffgroups;
    if (!Array.isArray(staffgroups)) return false;

    const { startChar, endChar } = sel;
    let found = false;
    for (const group of staffgroups) {
      for (const voice of group.voices ?? []) {
        for (const child of voice.children ?? []) {
          const ab = child.abcelem;
          const s = ab?.startChar;
          const e = ab?.endChar;
          if (typeof s !== "number" || typeof e !== "number") continue;
          // Same overlap test abcjs's own `rangeHighlight` uses, so notes,
          // bars, rests, key signatures, time signatures, tempos etc. are
          // all picked up.
          const overlaps =
            (endChar > s && startChar < e) ||
            (endChar === startChar && endChar === e);
          if (!overlaps) continue;
          const set = child.elemset;
          const setLen =
            set && typeof set.length === "number" ? set.length : 0;
          for (let i = 0; i < setLen; i++) {
            const node = set![i];
            if (node && node.classList) {
              node.classList.add("abc-gui-selected");
              found = true;
            }
          }
          if (setLen === 0) {
            const svgEl = child.svgEl;
            if (svgEl && svgEl.classList) {
              svgEl.classList.add("abc-gui-selected");
              found = true;
            }
          }
        }
      }
    }
    return found;
  }
}

function classListToSelector(classes: string): string {
  const parts = classes
    .split(/\s+/)
    .filter((c) => c.length > 0)
    // Drop generic classes that appear on many elements and would broaden the
    // selector beyond the clicked group.
    .filter(
      (c) =>
        c !== "abcjs-note" &&
        c !== "abcjs-rest" &&
        c !== "abcjs-bar" &&
        c !== "abcjs-clef" &&
        c !== "abcjs-key-signature" &&
        c !== "abcjs-time-signature" &&
        c !== "abcjs-tempo" &&
        c !== "abcjs-ending" &&
        c !== "abcjs-triplet" &&
        c !== "abcjs-decoration" &&
        c !== "abcjs-chord" &&
        c !== "abcjs-annotation"
    )
    // Drop the dynamic `_selected` flag classes abcjs adds to the SVG group
    // when the user clicks an element. After a re-render those classes are
    // gone, so leaving them in our selector would prevent the selection
    // from being re-applied to the new SVG.
    .filter((c) => !c.endsWith("_selected"))
    // Drop intrinsic-property classes (`abcjs-d<duration>`, `abcjs-p<pitch>`)
    // that change when the user edits the element via the property panel
    // (e.g. flipping pitch, length, adding a triplet that re-scales the
    // duration). The remaining positional classes (`abcjs-l<line>`,
    // `abcjs-m<measure>`, `abcjs-mm<measureTotal>`, `abcjs-v<voice>`,
    // `abcjs-n<noteIndexInMeasure>`) survive in-place edits.
    .filter((c) => !/^abcjs-[dp][0-9]/.test(c));
  if (parts.length === 0) return "";
  const esc =
    typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape
      : (s: string): string => s.replace(/([^\w-])/g, "\\$1");
  return parts.map((c) => "." + esc(c)).join("");
}
