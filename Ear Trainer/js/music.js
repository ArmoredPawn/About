// Notes, the laptop-key layout and the question generators for each drill.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

// The on-screen piano runs two octaves, C4–C6. Each key maps to a physical key (event.code), so the
// layout works the same on any keyboard. As in most music software, the bottom two letter rows play the
// lower octave (Z row white, A row black) and the top two rows the upper one (Q row white, number row black).
export const KEYS = [
  { midi: 60, code: 'KeyZ', label: 'Z' },
  { midi: 61, code: 'KeyS', label: 'S' },
  { midi: 62, code: 'KeyX', label: 'X' },
  { midi: 63, code: 'KeyD', label: 'D' },
  { midi: 64, code: 'KeyC', label: 'C' },
  { midi: 65, code: 'KeyV', label: 'V' },
  { midi: 66, code: 'KeyG', label: 'G' },
  { midi: 67, code: 'KeyB', label: 'B' },
  { midi: 68, code: 'KeyH', label: 'H' },
  { midi: 69, code: 'KeyN', label: 'N' },
  { midi: 70, code: 'KeyJ', label: 'J' },
  { midi: 71, code: 'KeyM', label: 'M' },
  { midi: 72, code: 'KeyQ', label: 'Q' },
  { midi: 73, code: 'Digit2', label: '2' },
  { midi: 74, code: 'KeyW', label: 'W' },
  { midi: 75, code: 'Digit3', label: '3' },
  { midi: 76, code: 'KeyE', label: 'E' },
  { midi: 77, code: 'KeyR', label: 'R' },
  { midi: 78, code: 'Digit5', label: '5' },
  { midi: 79, code: 'KeyT', label: 'T' },
  { midi: 80, code: 'Digit6', label: '6' },
  { midi: 81, code: 'KeyY', label: 'Y' },
  { midi: 82, code: 'Digit7', label: '7' },
  { midi: 83, code: 'KeyU', label: 'U' },
  { midi: 84, code: 'KeyI', label: 'I' },
];

export const LOW = 60;
export const HIGH = 84;

export const isBlack = midi => [1, 3, 6, 8, 10].includes(midi % 12);
export const noteName = midi => NOTE_NAMES[((midi % 12) + 12) % 12];
export const fullName = midi => `${noteName(midi)}${Math.floor(midi / 12) - 1}`;
export const sameNote = (a, b) => ((a - b) % 12 + 12) % 12 === 0;

export const INTERVALS = [
  'Unison', 'Minor 2nd', 'Major 2nd', 'Minor 3rd', 'Major 3rd', 'Perfect 4th', 'Tritone',
  'Perfect 5th', 'Minor 6th', 'Major 6th', 'Minor 7th', 'Major 7th', 'Octave',
];

export const CHORDS = {
  major: { name: 'major', steps: [0, 4, 7] },
  minor: { name: 'minor', steps: [0, 3, 7] },
  diminished: { name: 'diminished', steps: [0, 3, 6] },
  augmented: { name: 'augmented', steps: [0, 4, 8] },
};

// The five drills, in the order Arcade plays them. `base` is the points for a correct answer,
// `time` the seconds allowed once the sound has finished.
export const DRILLS = [
  {
    id: 'notes', name: 'Notes', blurb: 'White keys only. You hear C first, then the mystery note.',
    title: 'Which note is it?', sub: 'You’ll hear C first, then the mystery note. Play the mystery note.',
    base: 100, time: 8,
  },
  {
    id: 'chromatic', name: 'Every note', blurb: 'Black keys join in. C still comes first.',
    title: 'Which note is it?', sub: 'You’ll hear C first, then the mystery note. Black keys count now.',
    base: 150, time: 8,
  },
  {
    id: 'intervals', name: 'Intervals', blurb: 'Two notes, starting anywhere. Find the second.',
    title: 'Find the second note', sub: 'The first note is lit. Play the note that comes after it.',
    base: 200, time: 9,
  },
  {
    id: 'chords', name: 'Chords', blurb: 'Three notes at once. The root is given.',
    title: 'Complete the chord', sub: 'The root is lit. Play the other two notes, in any order.',
    base: 250, time: 12,
  },
  {
    id: 'melodies', name: 'Melodies', blurb: 'A short tune. Play it back in order.',
    title: 'Play it back', sub: 'The first note is lit. Play the rest of the tune in order.',
    base: 300, time: 14,
  },
];

export const drillById = id => DRILLS.find(d => d.id === id);

const pick = list => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const WHITE = KEYS.map(k => k.midi).filter(m => !isBlack(m));

// Each generator returns a question:
//   given    keys shown to the player up front
//   targets  the notes to play (in order when `ordered`)
//   parts    what the speaker plays: [{ notes, at, dur, show }], `show` lights the key as it sounds
//   answer   how the answer is written in the reveal; `weak` groups misses for the end screen
// `level` is 1 (easy), 2 (harder) or 3 (encore).
const GENERATORS = {
  // From level 2 the mystery note may sit in the upper octave; any octave still counts as right
  notes(level, last) {
    let t;
    do t = pick([62, 64, 65, 67, 69, 71]) + (level > 1 && Math.random() < 0.5 ? 12 : 0); while (t === last);
    return fromC(t);
  },

  chromatic(level, last) {
    let t;
    do t = between(61, 71) + (level > 1 && Math.random() < 0.5 ? 12 : 0); while (t === last);
    return fromC(t);
  },

  intervals(level, last) {
    const pool = level === 1 ? [3, 4, 5, 7, 12] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    let iv, root;
    do {
      iv = pick(pool);
      root = between(LOW, HIGH - iv);
    } while (root + iv === last);
    const top = root + iv;
    return {
      given: [root],
      targets: [top],
      parts: [
        { notes: [root], at: 0, dur: 0.85, show: true },
        { notes: [top], at: 1.0, dur: 1.4 },
      ],
      answer: `${INTERVALS[iv]} (${noteName(root)} → ${noteName(top)})`,
      weak: { key: `iv:${iv}`, label: INTERVALS[iv] },
      root,
    };
  },

  chords(level) {
    const kinds = level === 1 ? ['major', 'minor'] : level === 2 ? ['major', 'minor', 'diminished'] : Object.keys(CHORDS);
    const chord = CHORDS[pick(kinds)];
    const root = between(LOW, HIGH - 8);
    const notes = chord.steps.map(s => root + s);
    return {
      given: [root],
      targets: notes.slice(1),
      ordered: false,
      // Block chord first, then the notes one by one so each can be picked out
      parts: [
        { notes, at: 0, dur: 1.5 },
        { notes: [notes[0]], at: 1.75, dur: 0.5, show: true },
        { notes: [notes[1]], at: 2.2, dur: 0.5 },
        { notes: [notes[2]], at: 2.65, dur: 0.9 },
      ],
      answer: `${noteName(root)} ${chord.name} (${notes.map(noteName).join(' · ')})`,
      weak: { key: `ch:${chord.name}`, label: `${chord.name[0].toUpperCase()}${chord.name.slice(1)} chords` },
      root,
    };
  },

  melodies(level) {
    const length = level === 1 ? 3 : level === 2 ? 4 : 5;
    const maxStep = level === 3 ? 3 : 2;
    let i = between(0, WHITE.length - 1);
    const idx = [i];
    while (idx.length < length) {
      const step = pick([-maxStep, -1, 1, maxStep, ...(maxStep === 3 ? [-2, 2] : [])].filter(Boolean));
      const next = i + step;
      if (next < 0 || next >= WHITE.length) continue;
      i = next;
      idx.push(i);
    }
    const notes = idx.map(n => WHITE[n]);
    const gap = level === 3 ? 0.48 : 0.58;
    return {
      given: [notes[0]],
      targets: notes.slice(1),
      ordered: true,
      parts: notes.map((n, k) => ({ notes: [n], at: k * gap, dur: k === notes.length - 1 ? 0.9 : gap * 0.92, show: k === 0 })),
      answer: notes.map(noteName).join(' → '),
      weak: { key: `mel:${length}`, label: `${length}-note melodies` },
      root: notes[0],
    };
  },
};

function fromC(t) {
  return {
    given: [LOW],
    targets: [t],
    parts: [
      { notes: [LOW], at: 0, dur: 0.8, show: true },
      { notes: [t], at: 1.0, dur: 1.4 },
    ],
    answer: noteName(t),
    weak: { key: `note:${t % 12}`, label: noteName(t) },
    root: LOW,
  };
}

export function makeQuestion(drillId, level, last) {
  const q = GENERATORS[drillId](level, last);
  q.drill = drillId;
  q.ordered = q.ordered ?? true;
  q.length = Math.max(...q.parts.map(p => p.at + p.dur));
  return q;
}

// Describes a wrong note relative to the question, for the "Practise next" list
export function describeMiss(q, pressed) {
  const wrong = noteName(pressed);
  if (q.drill === 'notes' || q.drill === 'chromatic') return `heard ${q.answer}, played ${wrong}`;
  if (q.drill === 'intervals') {
    const iv = ((pressed - q.root) % 12 + 12) % 12;
    return `played a ${INTERVALS[iv === 0 ? 12 : iv].toLowerCase()} instead`;
  }
  return null;
}
