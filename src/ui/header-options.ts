import abcjs from "abcjs";
import type { AbcDocument } from "../model/document.js";
import type { HostHeaderOptions } from "../render/score-view.js";
import { en, type HeaderOptionsStrings, type Strings } from "../i18n.js";
import { parseOptionsJson, sameOptions } from "../parser/source.js";
import { button, el } from "./dom.js";

interface OptionField {
  key: string;
  group: "playback" | "appearance";
  type: "number" | "boolean" | "instrument";
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** Range control for the useful part of the values the number field accepts. */
  slider?: { min: number; max: number; step: number; defaultValue: number };
}

const FIELDS: OptionField[] = [
  // abcjs accepts any swing value: up to 50 is straight, above 75 is capped.
  // The number field matches the header parser; the slider covers 50-75.
  { key: "swing", group: "playback", type: "number", min: 0, slider: { min: 50, max: 75, step: 1, defaultValue: 50 } },
  { key: "qpm", group: "playback", type: "number", min: 1, step: 1 },
  { key: "program", group: "playback", type: "instrument", min: 0, max: 127, step: 1 },
  { key: "midiTranspose", group: "playback", type: "number", step: 1, placeholder: "0" },
  { key: "chordsOff", group: "playback", type: "boolean" },
  { key: "bassprog", group: "playback", type: "instrument", min: 0, max: 127, step: 1 },
  { key: "chordprog", group: "playback", type: "instrument", min: 0, max: 127, step: 1 },
  { key: "bassvol", group: "playback", type: "number", min: 0, max: 127, step: 1, slider: { min: 0, max: 127, step: 1, defaultValue: 64 } },
  { key: "chordvol", group: "playback", type: "number", min: 0, max: 127, step: 1, slider: { min: 0, max: 127, step: 1, defaultValue: 48 } },
  { key: "scale", group: "appearance", type: "number", min: 0.01, placeholder: "1" },
  { key: "staffwidth", group: "appearance", type: "number", min: 1, step: 1 },
  { key: "jazzchords", group: "appearance", type: "boolean" },
  { key: "germanAlphabet", group: "appearance", type: "boolean" },
  { key: "visualTranspose", group: "appearance", type: "number", step: 1, placeholder: "0" },
  { key: "paddingtop", group: "appearance", type: "number", min: 0, step: 1 },
  { key: "paddingbottom", group: "appearance", type: "number", min: 0, step: 1 }
];

const NO_HOST_OPTIONS: HostHeaderOptions = { defaults: {}, locked: {} };

let nextDialogId = 0;

function has(options: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

/**
 * Dialog texts with English fallbacks, so translations written before a key
 * existed (such as `lockedValue`) keep working.
 */
export function dialogStrings(strings: Strings): Required<HeaderOptionsStrings> {
  const english = en.headerOptions as Required<HeaderOptionsStrings>;
  const custom = strings.headerOptions;
  return { ...english, ...custom, lockedValue: custom?.lockedValue ?? english.lockedValue };
}

/**
 * A draft form: only Apply changes the source; Cancel and Escape discard it.
 * Values the host fixes are shown read-only and Apply never changes them.
 */
export class HeaderOptionsDialog {
  private dialog: HTMLDialogElement;
  private form!: HTMLFormElement;
  private json!: HTMLTextAreaElement;
  private advanced!: HTMLDetailsElement;
  private error!: HTMLElement;
  private controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private sliders = new Map<string, { input: HTMLInputElement; field: OptionField }>();
  private lockHints = new Map<string, HTMLElement>();
  private host: HostHeaderOptions = NO_HOST_OPTIONS;
  /** Document options when the dialog was opened. */
  private original: Readonly<Record<string, unknown>> = {};
  private translations: Array<() => void> = [];
  private errorKind: "json" | "value" | "locked" | null = null;
  private errorKey = "";
  private built = false;
  private strings: Required<HeaderOptionsStrings>;
  private id = `abc-gui-options-${++nextDialogId}`;

  constructor(
    container: HTMLElement,
    private doc: AbcDocument,
    strings: Strings,
    private getHostOptions: () => HostHeaderOptions = () => NO_HOST_OPTIONS
  ) {
    this.strings = dialogStrings(strings);
    this.dialog = el("dialog", { class: "abc-gui-header-options" });
    this.dialog.setAttribute("aria-labelledby", `${this.id}-title`);
    this.dialog.setAttribute("aria-describedby", `${this.id}-description`);
    // Keep editor shortcuts from modifying notes underneath the modal.
    this.dialog.addEventListener("keydown", (event) => event.stopPropagation());
    container.append(this.dialog);
  }

  open(): void {
    if (this.dialog.open) return;
    if (!this.built) this.build();
    this.host = this.getHostOptions();
    this.updateLocks();
    const source = this.doc.source();
    this.original = source.options;
    this.json.value = source.headerText ?? "{}";
    for (const [key, control] of this.controls) {
      control.value = "";
      this.syncSlider(key);
    }
    this.populateFields();
    this.dialog.showModal();
  }

  setStrings(strings: Strings): void {
    this.strings = dialogStrings(strings);
    // Translate existing nodes in place: focus, partial numeric input, textarea
    // selection, details state and validation errors remain untouched.
    for (const update of this.translations) update();
    if (this.built) this.refreshError();
  }

  /**
   * Follow host changes while the dialog is open: lock states, fixed values
   * and defaults. The JSON draft and fields whose lock did not change keep
   * what the user typed.
   */
  refreshHostOptions(): void {
    if (!this.dialog.open) return;
    const previous = this.host;
    this.host = this.getHostOptions();
    this.updateLocks();
    let draft: Record<string, unknown> = {};
    try {
      draft = parseOptionsJson(this.json.value);
    } catch {
      // The JSON error is already shown; newly unlocked fields start empty.
    }
    for (const field of FIELDS) {
      const wasLocked = has(previous.locked, field.key);
      const isLocked = has(this.host.locked, field.key);
      if (wasLocked !== isLocked || !sameOptions(previous.locked[field.key], this.host.locked[field.key])) {
        this.setControlValue(field, isLocked ? this.host.locked[field.key] : draft[field.key]);
      }
      this.syncSlider(field.key);
    }
    // An error about an option whose lock just changed no longer applies.
    if (this.errorKind !== "json" && has(previous.locked, this.errorKey) !== has(this.host.locked, this.errorKey)) {
      this.clearError();
    }
  }

  destroy(): void {
    if (this.dialog.open) this.dialog.close();
    this.dialog.remove();
  }

  private build(): void {
    const title = el("h2", { id: `${this.id}-title` });
    const description = el("p", { id: `${this.id}-description` });
    this.translations.push(() => {
      title.textContent = this.strings.title;
      description.textContent = this.strings.description;
    });
    this.form = el("form");
    const body = el("div", { class: "abc-gui-options-body" }, [title, description]);
    for (const group of ["playback", "appearance"] as const) {
      const fields = el("div", { class: "abc-gui-options-fields" });
      for (const field of FIELDS.filter((item) => item.group === group)) {
        fields.append(this.createField(field));
      }
      const legend = el("legend");
      this.translations.push(() => { legend.textContent = this.strings[group]; });
      body.append(el("fieldset", {}, [legend, fields]));
    }
    this.json = el("textarea", { rows: 8, spellcheck: false, value: "{}" });
    this.translations.push(() => this.json.setAttribute("aria-label", this.strings.advanced));
    this.json.addEventListener("input", () => this.populateFields());
    const summary = el("summary");
    this.translations.push(() => { summary.textContent = this.strings.advanced; });
    this.advanced = el("details", {}, [summary, this.json]);
    this.error = el("p", { class: "abc-gui-options-error", hidden: true });
    this.error.setAttribute("role", "alert");
    body.append(this.advanced, this.error);

    const reset = button("", "", () => {
      this.json.value = this.lockedDraft();
      this.populateFields();
    });
    const cancel = button("", "", () => this.dialog.close());
    const apply = el("button", { type: "submit", class: "abc-gui-btn abc-gui-options-apply" });
    this.translations.push(() => {
      reset.textContent = reset.title = this.strings.reset;
      cancel.textContent = cancel.title = this.strings.cancel;
      apply.textContent = this.strings.apply;
    });
    this.form.append(body, el("div", { class: "abc-gui-options-actions" }, [reset, cancel, apply]));
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const options = this.readOptions();
      if (!options) return;
      // The document keeps whatever it had for fixed options; the host value
      // applies regardless, so the draft must not change them.
      const changed = Object.keys(this.host.locked).find((key) => !sameOptions(options[key], this.original[key]));
      if (changed !== undefined) {
        this.showError("locked", changed);
        return;
      }
      for (const field of FIELDS) {
        const value = options[field.key];
        if (value === undefined || has(this.host.locked, field.key)) continue;
        const valid = field.type === "boolean" ? typeof value === "boolean"
          : typeof value === "number" && Number.isFinite(value)
            && (field.min === undefined || value >= field.min)
            && (field.max === undefined || value <= field.max)
            && (field.step !== 1 || Number.isInteger(value));
        if (!valid) {
          this.showError("value", field.key);
          return;
        }
      }
      this.doc.setSourceOptions(options);
      this.dialog.close();
    });
    this.dialog.append(this.form);
    this.built = true;
    for (const update of this.translations) update();
  }

  private createField(field: OptionField): HTMLElement {
    let control: HTMLInputElement | HTMLSelectElement;
    if (field.type === "boolean" || field.type === "instrument") {
      const select = el("select");
      const inherit = el("option", { value: "" });
      this.translations.push(() => { inherit.textContent = this.inheritText(field); });
      select.append(inherit);
      if (field.type === "boolean") {
        const yes = el("option", { value: "true" });
        const no = el("option", { value: "false" });
        this.translations.push(() => {
          yes.textContent = this.strings.yes;
          no.textContent = this.strings.no;
        });
        select.append(yes, no);
      } else {
        for (const [index, name] of (abcjs.synth.instrumentIndexToName ?? []).entries()) {
          if (index > 127) break;
          select.append(el("option", { value: String(index) }, [`${index}: ${name.replace(/_/g, " ")}`]));
        }
      }
      control = select;
    } else {
      control = el("input", {
        type: "number", min: field.min?.toString(), max: field.max?.toString(),
        step: field.step?.toString() ?? "any"
      });
      const input = control;
      this.translations.push(() => {
        input.placeholder = has(this.host.defaults, field.key) ? this.formatValue(field, this.host.defaults[field.key])
          : field.slider ? "—" : field.placeholder ?? this.strings.inherit;
      });
    }
    control.name = field.key;
    this.controls.set(field.key, control);
    const caption = el("span", { id: `${this.id}-${field.key}-label` });
    this.translations.push(() => { caption.textContent = this.strings.labels[field.key] ?? field.key; });
    let slider: HTMLInputElement | undefined;
    let label: HTMLElement;
    if (field.slider) {
      const range = field.slider;
      slider = el("input", {
        type: "range", name: `${field.key}-slider`, min: String(range.min), max: String(range.max),
        step: String(range.step), value: String(range.defaultValue)
      });
      this.sliders.set(field.key, { input: slider, field });
      slider.setAttribute("aria-labelledby", caption.id);
      control.setAttribute("aria-labelledby", caption.id);
      this.translations.push(() => {
        slider!.setAttribute("aria-valuetext", control.value || this.inheritText(field));
      });
      label = el("div", { class: "abc-gui-options-field" }, [
        caption, el("div", { class: "abc-gui-options-range" }, [slider, control])
      ]);
    } else {
      label = el("label", { class: "abc-gui-options-field" }, [caption, control]);
    }
    if (field.key === "swing") {
      const hint = el("small", { id: `${this.id}-swing-hint` });
      this.translations.push(() => { hint.textContent = this.strings.swingHint; });
      control.setAttribute("aria-describedby", hint.id);
      slider?.setAttribute("aria-describedby", hint.id);
      label.append(hint);
    }
    const lockHint = el("small", { hidden: true });
    this.lockHints.set(field.key, lockHint);
    this.translations.push(() => {
      lockHint.textContent = `${this.strings.overridden} (${this.formatValue(field, this.host.locked[field.key])})`;
    });
    label.append(lockHint);
    const updateDraft = () => {
      this.syncSlider(field.key);
      const options = this.readOptions();
      if (!options || !control.checkValidity()) return;
      if (control.value === "") delete options[field.key];
      else options[field.key] = field.type === "boolean" ? control.value === "true" : Number(control.value);
      this.json.value = JSON.stringify(options, null, 2);
      this.clearError();
    };
    control.addEventListener("input", updateDraft);
    control.addEventListener("change", updateDraft);
    const updateFromSlider = () => {
      control.value = slider!.value;
      updateDraft();
    };
    slider?.addEventListener("input", updateFromSlider);
    slider?.addEventListener("change", updateFromSlider);
    return label;
  }

  /** "Default", or "Default (value)" when the host supplies the default. */
  private inheritText(field: OptionField): string {
    return has(this.host.defaults, field.key)
      ? `${this.strings.inherit} (${this.formatValue(field, this.host.defaults[field.key])})`
      : this.strings.inherit;
  }

  private formatValue(field: OptionField, value: unknown): string {
    if (field.type === "boolean" && typeof value === "boolean") return value ? this.strings.yes : this.strings.no;
    if (field.type === "instrument" && typeof value === "number") {
      const name = abcjs.synth.instrumentIndexToName?.[value];
      if (name) return `${value}: ${name.replace(/_/g, " ")}`;
    }
    return String(value);
  }

  /** Reset keeps the document's own values for options the host fixes. */
  private lockedDraft(): string {
    const kept: Record<string, unknown> = {};
    for (const key of Object.keys(this.host.locked)) {
      if (has(this.original, key)) kept[key] = this.original[key];
    }
    return Object.keys(kept).length ? JSON.stringify(kept, null, 2) : "{}";
  }

  private readOptions(): Record<string, unknown> | null {
    try {
      return parseOptionsJson(this.json.value);
    } catch {
      this.showError("json");
      return null;
    }
  }

  private populateFields(): void {
    const options = this.readOptions();
    if (!options) return;
    this.clearError();
    for (const field of FIELDS) {
      const control = this.controls.get(field.key)!;
      this.setControlValue(field, control.disabled ? this.host.locked[field.key] : options[field.key]);
      this.syncSlider(field.key);
    }
  }

  private setControlValue(field: OptionField, value: unknown): void {
    this.controls.get(field.key)!.value = typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }

  private syncSlider(key: string): void {
    const slider = this.sliders.get(key);
    const control = this.controls.get(key);
    if (!slider || !control || !control.validity.valid) return;
    const fallback = this.host.defaults[key];
    slider.input.value = control.value
      || String(typeof fallback === "number" ? fallback : slider.field.slider!.defaultValue);
    slider.input.setAttribute("aria-valuetext", control.value || this.inheritText(slider.field));
  }

  private updateLocks(): void {
    for (const [key, hint] of this.lockHints) {
      const locked = has(this.host.locked, key);
      this.controls.get(key)!.disabled = locked;
      const slider = this.sliders.get(key);
      if (slider) slider.input.disabled = locked;
      hint.hidden = !locked;
    }
    for (const update of this.translations) update();
  }

  private showError(kind: "json" | "value" | "locked", key = ""): void {
    this.errorKind = kind;
    this.errorKey = key;
    this.refreshError();
    this.advanced.open = true;
  }

  private clearError(): void {
    this.errorKind = null;
    this.refreshError();
  }

  private refreshError(): void {
    const label = this.strings.labels[this.errorKey] ?? this.errorKey;
    this.error.hidden = this.errorKind === null;
    this.error.textContent = this.errorKind === "json" ? this.strings.invalidJson
      : this.errorKind === "value" ? this.strings.invalidValue(label)
        : this.errorKind === "locked" ? this.strings.lockedValue(label) : "";
  }
}
