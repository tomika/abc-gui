/**
 * Minimal MIDI playback wrapper around `abcjs.synth.CreateSynth`. The player
 * is lazy: the synth is created / re-primed only when the user presses play,
 * and is discarded whenever the score is re-rendered so it never gets out of
 * sync with the current tune.
 */

import abcjs from "abcjs";
import type { NoteMapTrack, SynthOptions } from "abcjs";
import { synthOptions as filterSynthOptions } from "../parser/options.js";

interface MidiBufferLike {
  millisecondsPerMeasure: number;
  meterSize: number;
  flattened: { totalDuration: number };
  init(params: {
    visualObj: unknown;
    audioContext?: AudioContext;
    millisecondsPerMeasure?: number;
    options?: SynthOptions;
  }): Promise<unknown>;
  prime(): Promise<unknown>;
  start(): void;
  stop(): number;
  seek(position: number, units?: "seconds" | "beats" | "percent"): void;
  getIsRunning(): boolean;
}

interface SynthApi {
  synth?: {
    CreateSynth?: { new (): MidiBufferLike };
    supportsAudio?: () => boolean;
  };
}

export interface PlayOptions {
  /** character offset of the note to start from (inclusive). When omitted
   *  or when no matching event is found, playback starts from the top. */
  startChar?: number;
  /** Document-level abcjs audio options (including swing). */
  synthOptions?: SynthOptions;
}

const DEFAULT_SYNTH_OPTIONS: SynthOptions = {};

export class MidiPlayer {
  private buffer: MidiBufferLike | null = null;
  private preparedFor: unknown = null;
  private audioContext: AudioContext | null = null;
  private preparedOptions: SynthOptions | null = null;
  private sourceTiming: SourceTiming[] = [];
  private generation = 0;

  /** Return true when the browser environment supports audio playback. */
  static isSupported(): boolean {
    const api = abcjs as unknown as SynthApi;
    if (!api.synth?.CreateSynth) return false;
    if (typeof api.synth.supportsAudio === "function") {
      return api.synth.supportsAudio();
    }
    return typeof window !== "undefined" && (
      typeof (window as typeof window & { AudioContext?: unknown }).AudioContext !== "undefined" ||
      typeof (window as typeof window & { webkitAudioContext?: unknown }).webkitAudioContext !==
        "undefined"
    );
  }

  isPlaying(): boolean {
    return this.buffer ? this.buffer.getIsRunning() : false;
  }

  /** Called by the owner whenever the score is re-rendered. Any in-flight
   *  playback is aborted and the prepared buffer is invalidated. */
  invalidate(): void {
    this.generation++;
    if (this.buffer) {
      try {
        this.buffer.stop();
      } catch {
        /* ignore */
      }
    }
    this.buffer = null;
    this.preparedFor = null;
    this.preparedOptions = null;
    this.sourceTiming = [];
  }

  async play(tune: unknown, opts: PlayOptions = {}): Promise<void> {
    if (!tune) throw new Error("No tune available to play");
    const api = abcjs as unknown as SynthApi;
    const Synth = api.synth?.CreateSynth;
    if (!Synth) throw new Error("abcjs.synth.CreateSynth not available");
    const generation = ++this.generation;
    const synthOptions = opts.synthOptions ?? DEFAULT_SYNTH_OPTIONS;

    // Stop any existing playback first; seeking before start() is the
    // abcjs-supported way to begin from an offset.
    if (this.buffer && this.buffer.getIsRunning()) {
      this.buffer.stop();
    }

    if (!this.audioContext) {
      const Ctor =
        (window as typeof window & { AudioContext?: typeof AudioContext }).AudioContext ||
        (window as typeof window & {
          webkitAudioContext?: typeof AudioContext;
        }).webkitAudioContext;
      if (!Ctor) throw new Error("Web Audio API not available");
      this.audioContext = new Ctor();
    }
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    if (generation !== this.generation) return;

    if (!this.buffer || this.preparedFor !== tune || this.preparedOptions !== synthOptions) {
      const buffer = new Synth();
      this.buffer = buffer;
      this.preparedFor = null;
      this.sourceTiming = [];
      // abcjs appends repeat timings to source elements. Discard the previous
      // synthesis annotations before rebuilding with different options.
      for (const voice of sourceVoices(tune)) {
        for (const element of voice) {
          delete element.currentTrackWholeNotes;
          delete element.currentTrackMilliseconds;
        }
      }
      let noteMap: NoteMapTrack[] = [];
      const options = filterSynthOptions(synthOptions as Record<string, unknown>);
      await buffer.init({
        visualObj: tune,
        audioContext: this.audioContext,
        millisecondsPerMeasure: missingMeterMeasureTime(tune, options),
        // Let abcjs derive tempo so document options such as qpm also work.
        options: {
          ...options,
          sequenceCallback: (tracks) => {
            // abcjs calls this after applying swing. Use the actual audio
            // events when starting playback from a selected note.
            noteMap = tracks;
            return tracks;
          }
        }
      });
      if (generation !== this.generation) return;
      await buffer.prime();
      if (generation !== this.generation) return;
      this.preparedFor = tune;
      this.preparedOptions = synthOptions;
      this.sourceTiming = collectSourceTiming(tune, buffer, noteMap);
    }

    const seconds = findEventSeconds(this.sourceTiming, opts.startChar);
    if (seconds > 0) {
      this.buffer.seek(seconds, "seconds");
    } else {
      this.buffer.seek(0, "seconds");
    }
    this.buffer.start();
  }

  stop(): void {
    this.generation++;
    if (this.buffer) {
      try {
        this.buffer.stop();
      } catch {
        /* ignore */
      }
    }
  }
}

interface SourceElement {
  el_type: string;
  startChar?: number;
  endChar?: number;
  currentTrackWholeNotes?: number | number[];
  currentTrackMilliseconds?: number | number[];
}

interface SourceTiming {
  startChar: number;
  endChar: number;
  seconds: number;
}

function missingMeterMeasureTime(tune: unknown, options: SynthOptions): number | undefined {
  const t = tune as {
    getMeterFraction: () => { den: number };
    metaText?: { tempo?: { bpm?: number; duration?: number[] } };
  };
  const denominator = t.getMeterFraction().den;
  if (Number.isFinite(denominator) && denominator > 0) return undefined;
  // For M:3 abcjs uses meterSize=1, but its default measure duration is NaN.
  // Give that whole-note measure a finite tempo, honoring an explicit Q: unit.
  const tempo = t.metaText?.tempo;
  const bpm = options.qpm ?? tempo?.bpm ?? options.defaultQpm ?? 180;
  const beat = options.qpm ? 1 / 4 : tempo?.duration?.reduce((sum, duration) => sum + duration, 0) ?? 1 / 4;
  return 60000 / bpm / (beat > 0 ? beat : 1 / 4);
}

function sourceVoices(tune: unknown): SourceElement[][] {
  const t = tune as { lines?: Array<{ staff?: Array<{ voices?: SourceElement[][] }> }> };
  const voices = new Map<string, SourceElement[]>();
  for (const line of t.lines ?? []) {
    (line.staff ?? []).forEach((staff, staffIndex) => {
      (staff.voices ?? []).forEach((voice, voiceIndex) => {
        const key = `${staffIndex}:${voiceIndex}`;
        const elements = voices.get(key) ?? [];
        elements.push(...voice);
        voices.set(key, elements);
      });
    });
  }
  return [...voices.values()];
}

/** Use the same whole-note units and multiplier as CreateSynth.prime(). */
function collectSourceTiming(
  tune: unknown,
  buffer: MidiBufferLike,
  tracks: NoteMapTrack[]
): SourceTiming[] {
  const multiplier = buffer.millisecondsPerMeasure / 1000 / buffer.meterSize;
  const sounding = new Map<number, number>();
  for (const track of tracks) {
    for (const note of track) {
      if (typeof note.startChar === "number") {
        sounding.set(note.startChar, Math.min(sounding.get(note.startChar) ?? Infinity, note.start));
      }
    }
  }
  const events: SourceTiming[] = [];
  for (const voice of sourceVoices(tune)) {
    let nextStart = buffer.flattened.totalDuration;
    for (let i = voice.length - 1; i >= 0; i--) {
      const element = voice[i];
      const timing = element.currentTrackWholeNotes;
      const naturalStart = Array.isArray(timing) ? Math.min(...timing) : timing;
      let start: number | undefined;
      if (element.el_type === "note" && typeof naturalStart === "number") {
        nextStart = naturalStart;
        // Rests have no sound-map entry. Their native audio annotations still
        // include the effective tempo, tempo changes, repeats and count-in.
        start = sounding.get(element.startChar!) ?? naturalStart;
      } else if (element.el_type === "bar") {
        start = nextStart;
      }
      if (start !== undefined && typeof element.startChar === "number" && typeof element.endChar === "number") {
        events.push({ startChar: element.startChar, endChar: element.endChar, seconds: Math.max(0, start * multiplier) });
      }
    }
  }
  return events;
}

function findEventSeconds(events: SourceTiming[], startChar: number | undefined): number {
  if (typeof startChar !== "number") return 0;
  let seconds = Infinity;
  for (const ev of events) {
    if (ev.startChar <= startChar && ev.endChar > startChar) seconds = Math.min(seconds, ev.seconds);
  }
  return Number.isFinite(seconds) ? seconds : 0;
}
