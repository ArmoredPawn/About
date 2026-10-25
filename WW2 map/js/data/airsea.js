// The Battle of Britain and the U-boat war, drawn as their own animated layer. [lon, lat].
(function () {
  const BASE = {
    calais: [1.85, 50.95], stomer: [2.25, 50.75], lille: [3.07, 50.63], amiens: [2.3, 49.9], rouen: [1.1, 49.4],
    caen: [-0.37, 49.18], cherbourg: [-1.62, 49.63], brussels: [4.35, 50.85], stavanger: [5.63, 58.88]
  };
  const T = {
    dover: [1.32, 51.12], portland: [-2.45, 50.56], convoyKent: [1.6, 51.25], convoyBeachy: [0.25, 50.65],
    manston: [1.35, 51.34], kenley: [-0.09, 51.3], biggin: [0.03, 51.33], tangmere: [-0.71, 50.85], ventnor: [-1.2, 50.6],
    hornchurch: [0.2, 51.54], northweald: [0.15, 51.72], newcastle: [-1.6, 54.97],
    london: [-0.1, 51.5], southampton: [-1.4, 50.9], bristol: [-2.6, 51.45]
  };

  window.WW2_BOB = {
    start: "1940-07-10", end: "1940-10-31",
    phases: [
      { start: "1940-07-10", end: "1940-08-12", name: "Phase 1: attacks on Channel convoys and ports",
        raids: [[BASE.cherbourg, T.portland], [BASE.rouen, T.convoyBeachy], [BASE.calais, T.dover], [BASE.lille, T.convoyKent]] },
      { start: "1940-08-13", end: "1940-09-06", name: "Phase 2: attacks on RAF airfields and radar",
        raids: [[BASE.amiens, T.kenley], [BASE.calais, T.manston], [BASE.stomer, T.biggin], [BASE.caen, T.tangmere],
                [BASE.cherbourg, T.ventnor], [BASE.brussels, T.hornchurch], [BASE.lille, T.northweald], [BASE.stavanger, T.newcastle]] },
      { start: "1940-09-07", end: "1940-10-31", name: "Phase 3: mass raids on London and other cities",
        raids: [[BASE.calais, T.london], [BASE.amiens, T.london], [BASE.brussels, T.london], [BASE.lille, T.london],
                [BASE.rouen, T.london], [BASE.cherbourg, T.southampton], [BASE.caen, T.bristol]] }
    ],
    // Chain Home radar stations along the south and east coasts.
    radar: [[-1.2, 50.6], [-0.5, 50.83], [0.33, 50.82], [0.75, 50.95], [1.0, 51.29], [1.33, 51.13], [0.73, 51.62],
            [1.03, 51.87], [1.42, 52.0], [1.6, 52.35], [-0.13, 53.3], [-1.55, 54.6], [-2.1, 55.6]],
    radarKm: 150,
    labels: [
      { at: [2.6, 49.55], title: "Luftwaffe", text: "About 2,500 aircraft in France and the Low Countries" },
      { at: [-1.9, 52.4], title: "RAF Fighter Command", text: "About 650 fighters, guided by radar" }
    ],
    phaseLabelAt: [-6.2, 49.4]
  };

  // Approximate number of operational U-boats across all theatres (rounded).
  window.WW2_UBOATS = {
    start: "1939-09-03", end: "1945-05-08",
    strength: [["1939-09-03", 46], ["1940-06-01", 35], ["1941-02-01", 22], ["1941-07-01", 65], ["1942-01-01", 90],
               ["1942-07-01", 140], ["1943-01-01", 210], ["1943-05-01", 240], ["1943-09-01", 180], ["1944-01-01", 170],
               ["1944-06-01", 185], ["1945-01-01", 145], ["1945-05-08", 140]],
    perIcon: 10,
    // Where the U-boats concentrated, era by era. Boxes are [[lon0, lat0], [lon1, lat1], weight].
    eras: [
      { start: "1939-09-03", name: "U-boats hunt in the Western Approaches", boxes: [[[-14, 46.5], [-7, 51.5], 3], [[-3, 57.5], [3.5, 61], 1]] },
      { start: "1940-07-01", name: "The first 'Happy Time': wolfpacks from French bases off Ireland", boxes: [[[-22, 54.5], [-10, 59.5], 4], [[-14, 47], [-8, 51], 1]] },
      { start: "1941-04-01", name: "Convoys get escorts, so the wolfpacks move west", boxes: [[[-42, 50], [-22, 60.5], 3], [[-24, 40], [-15, 48], 1]] },
      { start: "1942-01-13", name: "Operation Drumbeat: the second 'Happy Time' off America", boxes: [[[-77, 33], [-67, 41.5], 3], [[-40, 46], [-26, 57], 1]] },
      { start: "1942-08-01", name: "The mid-Atlantic air gap: wolfpacks against the convoys", boxes: [[[-42, 48], [-23, 60.5], 4], [[-25, 38.5], [-15, 46], 1]] },
      { start: "1943-05-24", name: "After Black May: U-boats driven from the convoy routes", boxes: [[[-30, 40], [-15, 51], 1], [[-10, 44.5], [-4, 47.5], 1]] },
      { start: "1944-06-01", name: "Snorkel U-boats lurk in British coastal waters", boxes: [[[-10, 49.2], [-5.5, 51.2], 1], [[1.2, 51.7], [3.6, 53.2], 1], [[2.2, 57.5], [4.3, 61], 1]] }
    ],
    statsAt: [-24.5, 46.2],
    routes: [
      { name: "North Atlantic convoys", start: "1939-09-16", path: [[-63.6, 44.6], [-52, 47.5], [-40, 54], [-25, 57], [-14, 56.8], [-7, 55.7], [-3.3, 53.6]] },
      { name: "Gibraltar convoys", start: "1939-10-02", path: [[-3.3, 53.6], [-7, 51.8], [-14, 48], [-16, 42], [-10, 37.2], [-5.4, 36.0]] },
      { name: "Arctic convoys", start: "1941-08-21", path: [[-5.6, 57.9], [-14, 63], [-22, 64.2], [-12, 69.5], [5, 72.8], [20, 73.6], [33.1, 69.2]] }
    ]
  };
})();
