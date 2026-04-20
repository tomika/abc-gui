/**
 * Localization strings for the abc-gui editor UI.
 *
 * All user-visible labels, button titles, tooltips, and messages are
 * gathered into a single `Strings` object so a host application can swap
 * languages at runtime. Two locales ship in-box: English (`en`) and
 * Hungarian (`hu`). Consumers can also pass a partial `strings` override
 * through `AbcEditorOptions` to tweak or extend them.
 *
 * Note: ABC field single-letter codes (`K:`, `L:`, `M:`, `Q:`, `T:`, `V:`,
 * `X:`, `C:`, `R:`) and musical pitch letters (A..G) are universal across
 * locales — they are part of the ABC 2.1 notation itself — so they are
 * displayed verbatim and do not need translations.
 */

export interface Strings {
  panel: {
    emptyHint: string;
    kind: {
      note: string;
      chord: string;
      rest: string;
      bar: string;
      infoLine: string;
      inlineField: string;
      other: string;
    };
    section: {
      note: string;
      noteLength: string;
      chordLength: string;
      notesInChord: string;
      rest: string;
      restLength: string;
      attached: string;
      rawElement: string;
    };
    labels: {
      accidental: string;
      pitch: string;
      octave: string;
      kind: string;
      barType: string;
      measure: string;
      key: string;
      clef: string;
      unitL: string;
      length: string;
      dot: string;
      group: string;
      decorations: string;
      chordText: string;
      grace: string;
    };
    hints: {
      unitL: string;
      noteDuration: string;
      pitchOf: (letter: string) => string;
      octaveDown: string;
      octaveUp: string;
      lengthPresetTitle: (title: string, rn: number, rd: number) => string;
      dotToggle: string;
      triplet: { add: string; remove: string };
      slurStart: { add: string; remove: string };
      slurEnd: { add: string; remove: string };
      tie: { add: string; remove: string };
      remove: string;
      removeX: (name: string) => string;
      removeGraceNotes: string;
      addAnnotation: string;
      pickChordSymbol: string;
      pickChordNotes: string;
      convertNoteToChord: string;
      convertSingleNoteChordToNote: string;
      expandDecorations: string;
      collapseDecorations: string;
      noAccidental: string;
      editNote: (index: number) => string;
      addNoteToChord: string;
      removeNoteN: (index: number) => string;
      removeNote: string;
      meterPreset: (value: string) => string;
      unitLengthPreset: (value: string) => string;
      restVariant: {
        z: string;
        x: string;
        Z: string;
        X: string;
      };
    };
    keyEditor: {
      clefDefault: string;
      clefTreble: string;
      clefBass: string;
      clefAlto: string;
      clefTenor: string;
      clefPerc: string;
      clefNone: string;
    };
    meterEditor: {
      custom: string;
    };
    grace: { placeholder: string };
    annotation: {
      chordSymbol: string;
      above: string;
      below: string;
      left: string;
      right: string;
      freePlacement: string;
    };
  };
  toolbar: {
    groups: {
      history: string;
      playback: string;
      modes: string;
      insert: string;
      header: string;
    };
    undo: string;
    redo: string;
    delete: string;
    play: string;
    stop: string;
    rawSelectOn: string;
    rawSelectOff: string;
    showRaw: string;
    hideRaw: string;
    shiftHint: string;
    insert: {
      note: string;
      rest: string;
      chord: string;
      bar: string;
      doubleBar: string;
      startRepeat: string;
      endRepeat: string;
      lineBreak: string;
    };
    header: {
      newTune: string;
      title: string;
      composer: string;
      rhythm: string;
      key: string;
      meter: string;
      unitLength: string;
      tempo: string;
      voice: string;
    };
  };
  barTypes: Record<
    | "|"
    | "||"
    | "[|"
    | "|]"
    | "|:"
    | ":|"
    | "::"
    | ".|"
    | "|1"
    | "|2"
    | "[1"
    | "[2",
    string
  >;
  decorations: {
    staccato: string;
    tenuto: string;
    accent: string;
    marcato: string;
    fermata: string;
    trill: string;
    turn: string;
    lowermordent: string;
    uppermordent: string;
    roll: string;
    segno: string;
    coda: string;
    downbow: string;
    upbow: string;
    breath: string;
  };
  lengths: {
    breve: string;
    whole: string;
    half: string;
    quarter: string;
    eighth: string;
    sixteenth: string;
    thirtysecond: string;
  };
  /**
   * Short HTML tutorial describing how to use the editor — suitable for
   * display in a splash screen or help panel. Returned by
   * `AbcEditor.getTutorialHtml()` in the currently active locale.
   */
  tutorial: string;
}

export const en: Strings = {
  panel: {
    emptyHint:
      "Click a note, rest, bar, or header line to edit its properties.",
    kind: {
      note: "♪ Note",
      chord: "♫ Chord",
      rest: "𝄽 Rest",
      bar: "∣ Bar line",
      infoLine: "≡ Info field",
      inlineField: "[≡] Inline field",
      other: "• Element"
    },
    section: {
      note: "Note",
      noteLength: "Note length",
      chordLength: "Chord length",
      notesInChord: "Notes in chord",
      rest: "Rest",
      restLength: "Rest length",
      attached: "Attached",
      rawElement: "ABC"
    },
    labels: {
      accidental: "Accidental",
      pitch: "Pitch",
      octave: "Octave",
      kind: "Kind",
      barType: "Bar type",
      measure: "Measure",
      key: "Key",
      clef: "Clef",
      unitL: "Unit (L:)",
      length: "Length (1..9)",
      dot: "Dot (.)",
      group: "Group",
      decorations: "Decorations",
      chordText: "Chord / text",
      grace: "Grace"
    },
    hints: {
      unitL:
        "Effective unit note length at this position. L: is stateful — the most recent L: (header, body, or inline) wins.",
      noteDuration: "→ note duration = ",
      pitchOf: (l) => `pitch ${l}`,
      octaveDown: "down octave",
      octaveUp: "up octave",
      lengthPresetTitle: (title, rn, rd) => `${title} (= ${rn}/${rd} × L)`,
      dotToggle: "toggle dotted length (×3/2) (shortcut: .)",
      triplet: {
        add: "start triplet (this note + next two)",
        remove: "remove triplet marker"
      },
      slurStart: {
        add: "start slur (shortcut key: '(')",
        remove: "remove slur start (shortcut key: '(')"
      },
      slurEnd: {
        add: "end slur (shortcut key: ')')",
        remove: "remove slur end (shortcut key: ')')"
      },
      tie: {
        add: "tie to next note (shortcut key: '-')",
        remove: "remove tie to next note (shortcut key: '-')"
      },
      remove: "remove",
      removeX: (name) => `remove ${name}`,
      removeGraceNotes: "remove grace notes",
      addAnnotation: "add chord symbol or annotation (shortcut: +)",
      pickChordSymbol: "Pick chord symbol…",
      pickChordNotes: "Pick chord notes…",
      convertNoteToChord: "Convert note to single-note chord",
      convertSingleNoteChordToNote: "Convert single-note chord to note",
      expandDecorations: "Show more decorations…",
      collapseDecorations: "Hide additional decorations",
      noAccidental: "no accidental",
      editNote: (i) => `Edit note ${i}`,
      addNoteToChord: "Add note to chord",
      removeNoteN: (i) => `Remove note ${i} from chord`,
      removeNote: "✕ Remove note",
      meterPreset: (v) => `meter ${v}`,
      unitLengthPreset: (v) => `unit length ${v}`,
      restVariant: {
        z: "rest (z)",
        x: "invisible rest (x)",
        Z: "whole-measure rest (Z)",
        X: "invisible whole-measure rest (X)"
      }
    },
    keyEditor: {
      clefDefault: "(auto)",
      clefTreble: "treble",
      clefBass: "bass",
      clefAlto: "alto",
      clefTenor: "tenor",
      clefPerc: "percussion",
      clefNone: "none"
    },
    meterEditor: {
      custom: "custom"
    },
    grace: { placeholder: "e.g. cd" },
    annotation: {
      chordSymbol: "chord symbol",
      above: "above",
      below: "below",
      left: "left",
      right: "right",
      freePlacement: "free placement"
    }
  },
  toolbar: {
    groups: {
      history: "History",
      playback: "Playback",
      modes: "Modes",
      insert: "Insert",
      header: "Header"
    },
    undo: "undo (Ctrl+Z)",
    redo: "redo (Ctrl+Shift+Z)",
    delete:
      "delete selected element (Delete: select next, Backspace: select previous)",
    play: "play (from selected note, or from start)",
    stop: "stop playback",
    rawSelectOn:
      "raw-text → element selection: ON (click to disable for free-form raw editing)",
    rawSelectOff:
      "raw-text → element selection: OFF (click to re-enable caret-based selection)",
    showRaw: "show raw ABC text pane",
    hideRaw: "hide raw ABC text pane",
    shiftHint: " (Shift: insert before selection)",
    insert: {
      note: "insert note (N; inserts C)",
      rest: "insert rest (Z)",
      chord: "insert chord (H)",
      bar: "insert bar line (I)",
      doubleBar: "insert double bar",
      startRepeat:
        "insert start-repeat ([); default is before, Shift inserts after",
      endRepeat: "insert end-repeat (])",
      lineBreak:
        "insert line break (Enter; split current line at selection); Shift+Enter removes nearest line break"
    },
    header: {
      newTune: "new tune header (X)",
      title: "insert title field (T)",
      composer: "insert composer field (C)",
      rhythm: "insert rhythm field (R)",
      key: "insert key field (K)",
      meter: "insert meter field (M)",
      unitLength: "insert unit length field (L)",
      tempo: "insert tempo field (Q)",
      voice: "insert voice field (V)"
    }
  },
  barTypes: {
    "|": "bar line",
    "||": "double bar line",
    "[|": "thin-thick double bar",
    "|]": "thick-thin double bar",
    "|:": "start repeat",
    ":|": "end repeat",
    "::": "end-start repeat",
    ".|": "dotted bar",
    "|1": "first ending",
    "|2": "second ending",
    "[1": "first ending (start)",
    "[2": "second ending (start)"
  },
  decorations: {
    staccato: "staccato",
    tenuto: "tenuto",
    accent: "accent",
    marcato: "marcato",
    fermata: "fermata",
    trill: "trill",
    turn: "turn",
    lowermordent: "lower mordent",
    uppermordent: "upper mordent",
    roll: "roll",
    segno: "segno",
    coda: "coda",
    downbow: "down-bow",
    upbow: "up-bow",
    breath: "breath"
  },
  lengths: {
    breve: "breve (double whole)",
    whole: "whole",
    half: "half",
    quarter: "quarter",
    eighth: "eighth",
    sixteenth: "sixteenth",
    thirtysecond: "thirty-second"
  },
  tutorial: [
    "<h3>Selecting elements</h3>",
    "<ul>",
    "<li>Click any note, rest, chord, bar line or header field in the score to select it.</li>",
    "<li>The property panel on the right shows editors for the selected element.</li>",
    "<li>Use <kbd>←</kbd> / <kbd>→</kbd> to move between elements; <kbd>Esc</kbd> returns focus to the editor.</li>",
    "</ul>",
    "<h3>Editing</h3>",
    "<ul>",
    "<li>Change pitch, accidental, octave, length, or decorations from the panel.</li>",
    "<li>Type <kbd>1</kbd>–<kbd>9</kbd> to set length, <kbd>.</kbd> to toggle a dot.</li>",
    "<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> to undo / redo.</li>",
    "</ul>",
    "<h3>Inserting</h3>",
    "<ul>",
    "<li>Use the toolbar to insert notes, rests, chords, bar lines, header fields, or line breaks.</li>",
    "<li>Shortcuts: <kbd>N</kbd> note, <kbd>Z</kbd> rest, <kbd>H</kbd> chord, <kbd>I</kbd> bar line, <kbd>Enter</kbd> line break.</li>",
    "</ul>",
    "<h3>Raw text pane</h3>",
    "<p>The raw ABC pane can be toggled from the toolbar. Selecting in the raw text highlights the corresponding element in the score.</p>",
    "<h3>Playback</h3>",
    "<p>Press the play button to hear the tune from the selected note (or from the start).</p>"
  ].join("")
};

export const hu: Strings = {
  panel: {
    emptyHint:
      "Kattints egy hangra, szünetre, ütemvonalra vagy fejlécsorra a tulajdonságok szerkesztéséhez.",
    kind: {
      note: "♪ Hang",
      chord: "♫ Akkord",
      rest: "𝄽 Szünet",
      bar: "∣ Ütemvonal",
      infoLine: "≡ Fejlécmező",
      inlineField: "[≡] Beágyazott mező",
      other: "• Elem"
    },
    section: {
      note: "Hang",
      noteLength: "Hang hossza",
      chordLength: "Akkord hossza",
      notesInChord: "Akkord hangjai",
      rest: "Szünet",
      restLength: "Szünet hossza",
      attached: "Csatolt",
      rawElement: "ABC"
    },
    labels: {
      accidental: "Módosítójel",
      pitch: "Hangmagasság",
      octave: "Oktáv",
      kind: "Típus",
      barType: "Ütemvonal típusa",
      measure: "Ütem",
      key: "Hangnem",
      clef: "Kulcs",
      unitL: "Egység (L:)",
      length: "Hossz (1..9)",
      dot: "Pont (.)",
      group: "Csoport",
      decorations: "Díszítések",
      chordText: "Akkord / szöveg",
      grace: "Előke"
    },
    hints: {
      unitL:
        "Az itt érvényes egység-hangjegyérték. Az L: állapotfüggő — a legutóbbi L: (fejléc, test vagy beágyazott) érvényesül.",
      noteDuration: "→ hang hossza = ",
      pitchOf: (l) => `${l} hang`,
      octaveDown: "oktávval lejjebb",
      octaveUp: "oktávval feljebb",
      lengthPresetTitle: (title, rn, rd) => `${title} (= ${rn}/${rd} × L)`,
      dotToggle: "pontozott hossz be/ki (×3/2) (gyorsbillentyű: .)",
      triplet: {
        add: "triola indítása (ez és a következő két hang)",
        remove: "triola jelölés eltávolítása"
      },
      slurStart: {
        add: "kötőív kezdete (gyorsbillentyű: '(')",
        remove: "kötőív kezdetének eltávolítása (gyorsbillentyű: '(')"
      },
      slurEnd: {
        add: "kötőív vége (gyorsbillentyű: ')')",
        remove: "kötőív végének eltávolítása (gyorsbillentyű: ')')"
      },
      tie: {
        add: "hangkötés a következő hanghoz (gyorsbillentyű: '-')",
        remove:
          "hangkötés eltávolítása a következő hangról (gyorsbillentyű: '-')"
      },
      remove: "eltávolítás",
      removeX: (name) => `${name} eltávolítása`,
      removeGraceNotes: "előkék eltávolítása",
      addAnnotation:
        "akkordszimbólum vagy felirat hozzáadása (gyorsbillentyű: +)",
      pickChordSymbol: "Akkordszimbólum választása…",
      pickChordNotes: "Akkordhangok választása…",
      convertNoteToChord: "Hang átalakítása egyhangú akkorddá",
      convertSingleNoteChordToNote: "Egyhangú akkord átalakítása hanggá",
      expandDecorations: "További díszítések mutatása…",
      collapseDecorations: "További díszítések elrejtése",
      noAccidental: "nincs módosítójel",
      editNote: (i) => `${i}. hang szerkesztése`,
      addNoteToChord: "Hang hozzáadása az akkordhoz",
      removeNoteN: (i) => `${i}. hang eltávolítása az akkordból`,
      removeNote: "✕ Hang eltávolítása",
      meterPreset: (v) => `${v} ütem`,
      unitLengthPreset: (v) => `${v} egység`,
      restVariant: {
        z: "szünet (z)",
        x: "láthatatlan szünet (x)",
        Z: "egész ütem szünet (Z)",
        X: "láthatatlan egész ütem szünet (X)"
      }
    },
    keyEditor: {
      clefDefault: "(auto)",
      clefTreble: "violin",
      clefBass: "basszus",
      clefAlto: "alt",
      clefTenor: "tenor",
      clefPerc: "ütő",
      clefNone: "nincs"
    },
    meterEditor: {
      custom: "egyedi"
    },
    grace: { placeholder: "pl. cd" },
    annotation: {
      chordSymbol: "akkordszimbólum",
      above: "fölé",
      below: "alá",
      left: "balra",
      right: "jobbra",
      freePlacement: "szabad elhelyezés"
    }
  },
  toolbar: {
    groups: {
      history: "Előzmények",
      playback: "Lejátszás",
      modes: "Módok",
      insert: "Beszúrás",
      header: "Fejléc"
    },
    undo: "visszavonás (Ctrl+Z)",
    redo: "ismét (Ctrl+Shift+Z)",
    delete:
      "kijelölt elem törlése (Delete: következőt kijelöli, Backspace: előzőt)",
    play: "lejátszás (kijelölt hangtól vagy az elejéről)",
    stop: "lejátszás leállítása",
    rawSelectOn:
      "nyers szöveg → elem-kijelölés: BE (kattints a szabad szerkesztéshez)",
    rawSelectOff:
      "nyers szöveg → elem-kijelölés: KI (kattints a kurzor-alapú kijelölés visszakapcsolásához)",
    showRaw: "nyers ABC szöveg panel megjelenítése",
    hideRaw: "nyers ABC szöveg panel elrejtése",
    shiftHint: " (Shift: kijelölés elé szúr)",
    insert: {
      note: "hang beszúrása (N; C-t szúr be)",
      rest: "szünet beszúrása (Z)",
      chord: "akkord beszúrása (H)",
      bar: "ütemvonal beszúrása (I)",
      doubleBar: "kettős ütemvonal beszúrása",
      startRepeat:
        "ismétlés eleje beszúrása ([); alapértelmezetten elé, Shift utána",
      endRepeat: "ismétlés vége beszúrása (])",
      lineBreak:
        "sortörés beszúrása (Enter; a sor kettéosztása a kijelölésnél); Shift+Enter a legközelebbi sortörést eltávolítja"
    },
    header: {
      newTune: "új dal fejléc (X)",
      title: "cím mező beszúrása (T)",
      composer: "szerző mező beszúrása (C)",
      rhythm: "ritmus mező beszúrása (R)",
      key: "hangnem mező beszúrása (K)",
      meter: "ütemmutató mező beszúrása (M)",
      unitLength: "egység-hosszúság mező beszúrása (L)",
      tempo: "tempó mező beszúrása (Q)",
      voice: "szólam mező beszúrása (V)"
    }
  },
  barTypes: {
    "|": "ütemvonal",
    "||": "kettős ütemvonal",
    "[|": "vékony-vastag kettős ütemvonal",
    "|]": "vastag-vékony kettős ütemvonal",
    "|:": "ismétlés eleje",
    ":|": "ismétlés vége",
    "::": "vége-eleje ismétlés",
    ".|": "pontozott ütemvonal",
    "|1": "első végzés",
    "|2": "második végzés",
    "[1": "első végzés (kezdet)",
    "[2": "második végzés (kezdet)"
  },
  decorations: {
    staccato: "staccato",
    tenuto: "tenuto",
    accent: "akcentus",
    marcato: "marcato",
    fermata: "korona",
    trill: "trilla",
    turn: "csoport",
    lowermordent: "alsó mordent",
    uppermordent: "felső mordent",
    roll: "roll",
    segno: "segno",
    coda: "kóda",
    downbow: "lefelé vonás",
    upbow: "felfelé vonás",
    breath: "levegő"
  },
  lengths: {
    breve: "brevis (dupla egész)",
    whole: "egész",
    half: "fél",
    quarter: "negyed",
    eighth: "nyolcad",
    sixteenth: "tizenhatod",
    thirtysecond: "harminckettes"
  },
  tutorial: [
    "<h3>Kiválasztás</h3>",
    "<ul>",
    "<li>Kattints bármely hangra, szünetre, akkordra, ütemvonalra vagy fejlécmezőre.</li>",
    "<li>A jobb oldali tulajdonságpanel megjeleníti a kiválasztott elem szerkesztőit.</li>",
    "<li>A <kbd>←</kbd> / <kbd>→</kbd> bill. mozgat az elemek között; az <kbd>Esc</kbd> visszaadja a fókuszt a szerkesztőnek.</li>",
    "</ul>",
    "<h3>Szerkesztés</h3>",
    "<ul>",
    "<li>A panelben módosíthatod a hangmagasságot, módosítójelet, oktávot, hosszt és díszítéseket.</li>",
    "<li>Az <kbd>1</kbd>–<kbd>9</kbd> állítja a hosszt, a <kbd>.</kbd> kapcsolja a pontozást.</li>",
    "<li><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> visszavonás / újra.</li>",
    "</ul>",
    "<h3>Beszúrás</h3>",
    "<ul>",
    "<li>Az eszköztár gombjaival szúrhatsz be hangot, szünetet, akkordot, ütemvonalat, fejlécmezőt vagy sortörést.</li>",
    "<li>Gyorsbillentyűk: <kbd>N</kbd> hang, <kbd>Z</kbd> szünet, <kbd>H</kbd> akkord, <kbd>I</kbd> ütemvonal, <kbd>Enter</kbd> sortörés.</li>",
    "</ul>",
    "<h3>Nyers szöveg panel</h3>",
    "<p>A nyers ABC panel az eszköztárból kapcsolható. A nyers szövegben való kiválasztás kiemeli a megfelelő elemet a kottán.</p>",
    "<h3>Lejátszás</h3>",
    "<p>Nyomd meg a lejátszás gombot, hogy meghallgasd a dallamot a kiválasztott hangtól (vagy az elejétől) kezdve.</p>"
  ].join("")
};

export type LocaleId = "en" | "hu";

export const LOCALES: Record<LocaleId, Strings> = { en, hu };

export function resolveStrings(
  locale: LocaleId | Strings | undefined
): Strings {
  if (!locale) return en;
  if (typeof locale === "string") return LOCALES[locale] ?? en;
  return locale;
}
