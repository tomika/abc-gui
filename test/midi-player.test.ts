import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import abcjs, { type NoteMapTrack, type SynthOptions } from "abcjs";
import { AbcDocument } from "../src/model/document.js";
import { MidiPlayer } from "../src/render/midi-player.js";

const RealSynth = abcjs.synth.CreateSynth;
const buffers: Array<InstanceType<typeof RealSynth>> = [];
const capturedTracks = new Map<InstanceType<typeof RealSynth>, NoteMapTrack[]>();

// Keep abcjs parsing, sequencing, tempo calculation and swing processing real.
// Replace only Web Audio output and sample downloads so tests run offline.
class AudioContextStub {
  state = "running";
  currentTime = 0;
  sampleRate = 1000;
  resume = vi.fn(async () => {});
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate };
  }
}

beforeEach(() => {
  buffers.length = 0;
  capturedTracks.clear();
  vi.stubGlobal("window", {
    Promise,
    AudioContext: AudioContextStub,
    OfflineAudioContext: class {}
  });
  vi.spyOn(abcjs.synth, "CreateSynth").mockImplementation(function () {
    const synth = new RealSynth();
    (synth as any)._deviceCapable = () => true;
    (synth as any)._loadBatch = async () => ({ loaded: [], error: [] });
    const init = synth.init;
    vi.spyOn(synth, "init").mockImplementation((params) => {
      const callback = params.options!.sequenceCallback!;
      params.options!.sequenceCallback = (tracks, context) => {
        capturedTracks.set(synth, tracks);
        return callback(tracks, context);
      };
      return init(params);
    });
    vi.spyOn(synth, "prime");
    vi.spyOn(synth, "start").mockImplementation(() => {});
    vi.spyOn(synth, "stop").mockReturnValue(0);
    vi.spyOn(synth, "seek").mockImplementation(() => {});
    buffers.push(synth);
    return synth;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const music = 'Q:1/4=120\nK:F\nM:4/4\n"F"z2AA BABd|"C"cGEc "Bb"BFDB|"F/A"AFCA "Gm"GABA|';

async function playSource(value: string, startChar?: number) {
  const doc = new AbcDocument(value);
  const player = new MidiPlayer();
  const options: SynthOptions = doc.source().options;
  const tune = doc.parsed()[0];
  await player.play(tune, { synthOptions: options, startChar });
  const buffer = buffers[buffers.length - 1];
  return { doc, player, tune, options, tracks: capturedTracks.get(buffer)!, buffer };
}

describe("header options in real abcjs synthesis", () => {
  it.each([
    { music: "C D E z|F4|", marker: "z", seconds: 3 },
    { music: "C D E|F4|", marker: "|", seconds: 3 },
    { music: "C D E F|\nG4|A4|", marker: "|", seconds: 4 }
  ])("uses the synthesized qpm for rests and bar lines: $music", async ({ music: body, marker, seconds }) => {
    const value = '{"qpm":60}\n---\nQ:1/4=120\nM:4/4\nL:1/4\nK:C\n' + body;
    const { buffer } = await playSource(value, value.indexOf(marker));
    expect(buffer.seek).toHaveBeenCalledWith(seconds, "seconds");
  });

  it("keeps rest and bar timings consistent with native swing and tempo", async () => {
    const value = '{"qpm":60,"swing":65}\n---\nQ:1/4=120\nM:4/4\nL:1/8\nK:C\nCDzEFGAB|';
    const { buffer, player, tune, options } = await playSource(value, value.indexOf("zE"));
    expect(buffer.seek).toHaveBeenLastCalledWith(1, "seconds");
    await player.play(tune, { synthOptions: options, startChar: value.indexOf("|") });
    expect(buffer.seek).toHaveBeenLastCalledWith(4, "seconds");
  });

  it.each([{ header: '{"qpm":60}\n---\n', seconds: 0.5 }, { header: "", seconds: 0.25 }])("uses the native meter size without a denominator: $header", async ({ header, seconds }) => {
    const value = header + 'Q:1/4=120\nM:3\nL:1/8\nK:C\nCDEFGABc|';
    const { buffer } = await playSource(value, value.indexOf("DEFG"));
    expect((buffer as any).meterSize).toBe(1);
    expect(buffer.seek).toHaveBeenCalledWith(seconds, "seconds");
  });

  it("uses native tempo-change timings for a rest after an inline tempo", async () => {
    const value = '{"qpm":60}\n---\nQ:1/4=120\nM:4/4\nL:1/4\nK:C\nCDEF|[Q:1/4=120]GABz|';
    const { buffer } = await playSource(value, value.indexOf("z|"));
    expect(buffer.seek).toHaveBeenCalledWith(5.5, "seconds");
  });

  it("does not retain stale rest timings after changing count-in options", async () => {
    const value = '{"qpm":60}\n---\nQ:1/4=120\nM:4/4\nL:1/4\nK:C\nCDEz|';
    const { player, tune } = await playSource(value, value.indexOf("z|"));
    await player.play(tune, { synthOptions: { qpm: 60, drumIntro: 1 }, startChar: value.indexOf("z|") });
    expect(buffers[1].seek).toHaveBeenCalledWith(7, "seconds");
  });

  it("never forwards document callbacks or sample-server URLs to the synthesizer", async () => {
    const value = '{"sequenceCallback":1,"onEnded":true,"soundFontUrl":"https://example.invalid/","swing":65}\n---\n' + music;
    const { buffer } = await playSource(value);
    const params = vi.mocked(buffer.init).mock.calls[0][0].options!;
    expect(typeof params.sequenceCallback).toBe("function");
    expect(params.onEnded).toBeUndefined();
    expect(params.soundFontUrl).toBeUndefined();
    expect(buffer.start).toHaveBeenCalledOnce();
  });

  it.each([50, 65, 75])("applies swing=%i to the reported example", async (swing) => {
    const value = JSON.stringify({ swing }) + "\n---\n" + music;
    const { tracks, buffer } = await playSource(value);
    const startChar = value.indexOf("AA");
    const first = tracks[0].find((note) => note.startChar === startChar)!;
    const second = tracks[0].find((note) => note.startChar === startChar + 1)!;
    // z2 occupies the first quarter. The first A begins on the next beat.
    expect(first.start).toBeCloseTo(0.25);
    expect(second.start - first.start).toBeCloseTo(0.25 * swing / 100);
    expect(vi.mocked(buffer.init).mock.calls[0][0].options!.swing).toBe(swing);
    expect(buffer.start).toHaveBeenCalledOnce();
  });

  it("starts a selected offbeat note at its swung audio time", async () => {
    const value = '{"swing":65}\n---\n' + music;
    const startChar = value.indexOf("AA") + 1;
    const { buffer } = await playSource(value, startChar);
    // Q:1/4=120: one quarter is 0.5s, then 65% of another quarter.
    expect(buffer.seek).toHaveBeenCalledWith(0.825, "seconds");
  });

  it("forwards other synth options, including qpm, and uses their tempo for seeking", async () => {
    const value = '{"swing":65,"qpm":60,"chordsOff":true,"program":10}\n---\n' + music;
    const { buffer, tracks } = await playSource(value, value.indexOf("AA") + 1);
    expect(vi.mocked(buffer.init).mock.calls[0][0].options).toMatchObject({
      swing: 65, qpm: 60, chordsOff: true, program: 10
    });
    expect(tracks).toHaveLength(1);
    expect(buffer.seek).toHaveBeenCalledWith(1.65, "seconds");
  });

  it("reuses prepared audio and rebuilds it when the options change or disappear", async () => {
    const { player, tune, options, buffer } = await playSource('{"swing":65}\n---\n' + music);
    await player.play(tune, { synthOptions: options });
    expect(buffer.prime).toHaveBeenCalledOnce();
    await player.play(tune, { synthOptions: { swing: 60 } });
    expect(buffers).toHaveLength(2);
    expect(vi.mocked(buffers[1].init).mock.calls[0][0].options!.swing).toBe(60);
    player.invalidate();
    await player.play(tune);
    expect(buffers).toHaveLength(3);
    expect(vi.mocked(buffers[2].init).mock.calls[0][0].options!.swing).toBeUndefined();
  });

  it.each(["invalidate", "stop"] as const)("does not start stale audio after %s during loading", async (action) => {
    const player = new MidiPlayer();
    const doc = new AbcDocument('{"swing":65}\n---\n' + music);
    const loading = player.play(doc.parsed()[0], { synthOptions: doc.source().options });
    const buffer = buffers[0];
    player[action]();
    await loading;
    expect(buffer.start).not.toHaveBeenCalled();
  });
});
