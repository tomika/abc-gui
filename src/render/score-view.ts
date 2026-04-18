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
    this.applySelectionStyle();
    for (const l of [...this.renderListeners]) l();
  }

  /** Highlight the SVG group(s) that represent the selected element. */
  private applySelectionStyle(): void {
    const prev = this.host.querySelectorAll(".abc-gui-selected");
    prev.forEach((n) => n.classList.remove("abc-gui-selected"));
    if (!this.selected) return;

    // Preferred path: use the exact class list abcjs reported for the clicked
    // element — works for every element type (notes, rests, bars, clefs,
    // key & meter signatures, tempo, decorations, metadata, …).
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

    // Fallback: abcjs tags note heads with `abcjs-n<startChar>`, which is all
    // we can rely on when the selection originates from the raw-text caret
    // or from a document mutation.
    const nodes = this.host.querySelectorAll<SVGElement>(
      `.abcjs-n${this.selected.startChar}`
    );
    nodes.forEach((n) => n.classList.add("abc-gui-selected"));
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
