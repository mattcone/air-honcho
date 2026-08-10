/**
 * Sound: off by default, and synthesised rather than sampled.
 *
 * Every cue is generated with a couple of oscillators through WebAudio, so the
 * game ships no audio files, gains no dependency, and still builds in ten years —
 * the same reasoning that keeps the map in SVG and the sim in plain data.
 *
 * The palette is deliberately narrow and dry: a flap click, a soft chime when the
 * quarter closes, a flatter one when it closed badly. This is an airport terminal,
 * not a slot machine. Nothing loops, nothing plays without the player switching it
 * on, and the context is only created after that first switch — browsers refuse to
 * start audio before a gesture anyway.
 */

const ENABLED_KEY = 'air-honcho:sound';

let context: AudioContext | null = null;
let enabled = read();

function read(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'on';
  } catch {
    return false;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked — the setting simply does not persist.
  }
  if (!on && context) {
    void context.close();
    context = null;
  }
}

function ctx(): AudioContext | null {
  if (!enabled) return null;
  if (context) return context;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
    return context;
  } catch {
    return null;
  }
}

/** One short shaped tone. Everything in the palette is built from these. */
function tone(freq: number, seconds: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
  const audio = ctx();
  if (!audio) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  // A quick attack and an exponential tail: a click or a struck chime, never a pad.
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
  osc.connect(amp).connect(audio.destination);
  osc.start(start);
  osc.stop(start + seconds + 0.02);
}

/** A split-flap leaf landing. Deliberately tiny — dozens fire in a row. */
export function playFlap(): void {
  tone(2100, 0.028, 0.035, 'square');
}

/** The quarter closed in profit: a two-note terminal chime. */
export function playGoodQuarter(): void {
  tone(587.33, 0.5, 0.09); // D5
  tone(880, 0.6, 0.07, 'sine', 0.11); // A5
}

/** The quarter closed in the red: the same shape, fallen instead of risen. */
export function playBadQuarter(): void {
  tone(440, 0.5, 0.085); // A4
  tone(329.63, 0.7, 0.07, 'sine', 0.12); // E4
}

/**
 * Something needs the board's attention now: a repeated note, the one shape in
 * the palette that does not resolve. Takes a delay because it follows the
 * quarter's chime rather than talking over it — see showBriefing.
 */
export function playAlert(delay = 0): void {
  tone(392, 0.22, 0.08, 'triangle', delay);
  tone(392, 0.26, 0.07, 'triangle', delay + 0.2);
}
