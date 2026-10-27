# Test Your Pitch

An ear-training game. It plays a note, an interval, a chord or a short tune, and you find it on the piano.

- **Laptop keys:** two octaves, C to C to C, laid out as in most music software. `Z X C V B N M` play the lower white keys and
  `S D G H J` its black keys; `Q W E R T Y U` play the upper white keys and `2 3 5 6 7` its black keys; `I` is the top C.
- **Mouse or touch:** click or tap the on-screen keys.
- **MIDI keyboard:** connect one from the menu (Chrome and Edge). Any octave counts.

**Arcade** runs five stages (Notes, Every note, Intervals, Chords, Melodies) of six rounds each, then an endless encore
that gets faster. You have three lives; answering quickly scores more, and streaks of 5, 10 and 20 multiply your points.
A perfect stage gives 500 bonus points and a life back. **Practice** plays one drill with no clock or lives.

Scores are kept in memory while you play; only the personal best and the note-names setting are saved, in your own browser.
The piano sound is synthesised with the Web Audio API, so there are no audio files. Plain HTML, CSS and JavaScript
modules with no build step: serve the folder and open `index.html`.
