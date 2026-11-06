import abcjs from "abcjs";
import type { AbcVisualParams } from "abcjs";
import type { AbcDocument } from "../model/document.js";
import { en, type HeaderOptionsStrings, type Strings } from "../i18n.js";
import { parseOptionsJson } from "../parser/source.js";
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

let nextDialogId = 0;

/** A draft form: only Apply changes the source; Cancel and Escape discard it. */
export class HeaderOptionsDialog {
  private dialog: HTMLDialogElement;
  private form!: HTMLFormElement;
  private json!: HTMLTextAreaElement;
  private advanced!: HTMLDetailsElement;
  private error!: HTMLElement;
  private controls = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private sliders = new Map<string, { input: HTMLInputElement; defaultValue: number }>();
  private overrideHints = new Map<string, HTMLElement>();
  private overrides: Record<string, unknown> = {};
  private translations: Array<() => void> = [];
  private errorKind: "json" | "value" | null = null;
  private errorKey = "";
  private built = false;
  private strings: HeaderOptionsStrings;
  private id = `abc-gui-options-${++nextDialogId}`;

  constructor(
    container: HTMLElement,
    private doc: AbcDocument,
    strings: Strings,
    private getOverrides: () => AbcVisualParams = () => ({})
  ) {
    this.strings = strings.headerOptions ?? en.headerOptions!;
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
    this.overrides = this.getOverrides() as Record<string, unknown>;
    this.updateOverrides();
    const source = this.doc.source();
    this.json.value = source.headerText ?? "{}";
    for (const [key, control] of this.controls) {
      control.value = "";
      this.syncSlider(key);
    }
    this.populateFields();
    this.dialog.showModal();
  }

  setStrings(strings: Strings): void {
    this.strings = strings.headerOptions ?? en.headerOptions!;
    // Translate existing nodes in place: focus, partial numeric input, textarea
    // selection, details state and validation errors remain untouched.
    for (const update of this.translations) update();
    if (this.built) this.refreshError();
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
      this.json.value = "{}";
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
      for (const field of FIELDS) {
        const value = options[field.key];
        if (value === undefined) continue;
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
      this.translations.push(() => { inherit.textContent = this.strings.inherit; });
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
        input.placeholder = field.slider ? "—" : field.placeholder ?? this.strings.inherit;
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
      this.sliders.set(field.key, { input: slider, defaultValue: range.defaultValue });
      slider.setAttribute("aria-labelledby", caption.id);
      control.setAttribute("aria-labelledby", caption.id);
      this.translations.push(() => {
        slider!.setAttribute("aria-valuetext", control.value || this.strings.inherit);
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
    if (field.group === "appearance") {
      const hint = el("small", { hidden: true });
      this.overrideHints.set(field.key, hint);
      this.translations.push(() => {
        hint.textContent = `${this.strings.overridden} (${String(this.overrides[field.key])})`;
      });
      label.append(hint);
    }
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
      const value = control.disabled ? this.overrides[field.key] : options[field.key];
      control.value = typeof value === "number" || typeof value === "boolean" ? String(value) : "";
      this.syncSlider(field.key);
    }
  }

  private syncSlider(key: string): void {
    const slider = this.sliders.get(key);
    const control = this.controls.get(key);
    if (!slider || !control || !control.validity.valid) return;
    slider.input.value = control.value || String(slider.defaultValue);
    slider.input.setAttribute("aria-valuetext", control.value || this.strings.inherit);
  }

  private updateOverrides(): void {
    for (const [key, hint] of this.overrideHints) {
      const overridden = this.overrides[key] !== undefined;
      this.controls.get(key)!.disabled = overridden;
      hint.hidden = !overridden;
    }
    for (const update of this.translations) update();
  }

  private showError(kind: "json" | "value", key = ""): void {
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
    this.error.hidden = this.errorKind === null;
    this.error.textContent = this.errorKind === "json" ? this.strings.invalidJson
      : this.errorKind === "value" ? this.strings.invalidValue(this.strings.labels[this.errorKey] ?? this.errorKey) : "";
  }
}
