/**
 * Minimal MIDI playback wrapper around `abcjs.synth.CreateSynth`. The player
 * is lazy: the synth is created / re-primed only when the user presses play,
 * and is discarded whenever the score is re-rendered so it never gets out of
 * sync with the current tune.
 */

import abcjs from "abcjs";

interface MidiBufferLike {
  init(params: {
    visualObj: unknown;
    audioContext?: AudioContext;
    millisecondsPerMeasure?: number;
    options?: unknown;
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
}

export class MidiPlayer {
  private buffer: MidiBufferLike | null = null;
  private preparedFor: unknown = null;
  private audioContext: AudioContext | null = null;

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
    if (this.buffer) {
      try {
        this.buffer.stop();
      } catch {
        /* ignore */
      }
    }
    this.buffer = null;
    this.preparedFor = null;
  }

  async play(tune: unknown, opts: PlayOptions = {}): Promise<void> {
    if (!tune) throw new Error("No tune available to play");
    const api = abcjs as unknown as SynthApi;
    const Synth = api.synth?.CreateSynth;
    if (!Synth) throw new Error("abcjs.synth.CreateSynth not available");

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

    if (!this.buffer || this.preparedFor !== tune) {
      this.buffer = new Synth();
      await this.buffer.init({
        visualObj: tune,
        audioContext: this.audioContext,
        millisecondsPerMeasure: getMsPerMeasure(tune)
      });
      await this.buffer.prime();
      this.preparedFor = tune;
    }

    const seconds = findEventSeconds(tune, opts.startChar);
    if (seconds > 0) {
      this.buffer.seek(seconds, "seconds");
    } else {
      this.buffer.seek(0, "seconds");
    }
    this.buffer.start();
  }

  stop(): void {
    if (this.buffer) {
      try {
        this.buffer.stop();
      } catch {
        /* ignore */
      }
    }
  }
}

interface TuneWithTiming {
  millisecondsPerMeasure?: (bpm?: number) => number;
  setupEvents?: (
    startingDelay: number,
    timeDivider: number,
    startingBpm: number,
    warp?: number
  ) => Array<{
    milliseconds: number;
    startChar?: number;
    endChar?: number;
  }>;
  getBpm?: () => number;
}

function getMsPerMeasure(tune: unknown): number | undefined {
  const t = tune as TuneWithTiming;
  if (typeof t.millisecondsPerMeasure === "function") {
    try {
      return t.millisecondsPerMeasure();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Convert a character offset into the starting time (in seconds) of the
 * first note event whose source range contains it. Returns 0 when no match
 * is found (e.g. the selection is a header field or bar line).
 */
function findEventSeconds(tune: unknown, startChar: number | undefined): number {
  if (typeof startChar !== "number") return 0;
  const t = tune as TuneWithTiming;
  if (typeof t.setupEvents !== "function") return 0;
  let bpm = 120;
  if (typeof t.getBpm === "function") {
    try {
      const v = t.getBpm();
      if (typeof v === "number" && v > 0) bpm = v;
    } catch {
      /* ignore */
    }
  }
  let events: ReturnType<NonNullable<TuneWithTiming["setupEvents"]>>;
  try {
    events = t.setupEvents(0, 1, bpm);
  } catch {
    return 0;
  }
  // Prefer the event whose range strictly contains startChar; otherwise the
  // last event that starts at or before it.
  let best: { milliseconds: number } | null = null;
  for (const ev of events) {
    if (typeof ev.startChar !== "number") continue;
    if (ev.startChar <= startChar) {
      if (typeof ev.endChar === "number" && ev.endChar > startChar) {
        best = ev;
        break;
      }
      best = ev;
    } else {
      break;
    }
  }
  return best ? Math.max(0, best.milliseconds / 1000) : 0;
}
