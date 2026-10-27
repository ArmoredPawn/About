# By Ear

An ear-training game. It plays a note, an interval, a chord or a short tune, and you find it on the piano.

- **Laptop keys:** the home row (`A S D F G H J K L ;`) plays the white keys from C to E, and the row above (`W E T Y U O P`) plays the black keys.
- **Mouse or touch:** click or tap the on-screen keys.
- **MIDI keyboard:** connect one from the menu (Chrome and Edge). Any octave counts.

**Arcade** runs five stages (Notes, Every note, Intervals, Chords, Melodies) of six rounds each, then an endless encore
that gets faster. You have three lives; answering quickly scores more, and streaks of 5, 10 and 20 multiply your points.
A perfect stage gives 500 bonus points and a life back. **Practice** plays one drill with no clock or lives.

Scores are kept in memory while you play; only the personal best and the note-names setting are saved, in your own browser.
The piano sound is synthesised with the Web Audio API, so there are no audio files. Plain HTML, CSS and JavaScript
modules with no build step: serve the folder and open `index.html`.
