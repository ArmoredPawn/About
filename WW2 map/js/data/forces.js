// Troop strengths for the major campaigns, shown as panels on the map while each campaign runs.
// Figures are rounded totals as commonly cited (e.g. the campaign infoboxes on Wikipedia,
// Glantz for the Eastern Front). They are approximate and sources differ.
// `at` is [lon, lat]; `anchor` says which side of that point the panel opens toward.
window.WW2_FORCES = [
  { id: "poland", title: "Invasion of Poland", start: "1939-09-01", end: "1939-10-06", theater: "east", at: [25.2, 56.6], anchor: "start",
    sides: [{ side: "axis", name: "Germany", n: 1500000 }, { side: "axis", name: "Slovakia", n: 51000 },
            { side: "allied", name: "Poland", n: 950000 }, { side: "soviet", name: "USSR (from 17 Sep)", n: 466000 }] },
  { id: "winterwar", title: "Winter War", start: "1939-11-30", end: "1940-03-13", theater: "east", at: [19.6, 64.6], anchor: "end",
    sides: [{ side: "neutral", name: "Finland", n: 340000 }, { side: "soviet", name: "USSR (at peak)", n: 760000 }] },
  { id: "france", title: "Battle of France", start: "1940-05-10", end: "1940-06-25", theater: "west", at: [-5.2, 49.6], anchor: "end",
    sides: [{ side: "axis", name: "Germany", n: 3350000 }, { side: "allied", name: "France, Britain, Belgium, Netherlands", n: 3300000 }] },
  { id: "barbarossa", title: "Operation Barbarossa", start: "1941-06-22", end: "1941-12-05", theater: "east", at: [43.5, 58.6], anchor: "start",
    sides: [{ side: "axis", name: "Germany and allies", n: 3800000 }, { side: "soviet", name: "Red Army, western USSR", n: 2700000 }] },
  { id: "stalingrad", title: "Battle of Stalingrad", start: "1942-08-23", end: "1943-02-02", theater: "east", at: [47.0, 51.2], anchor: "start",
    sides: [{ side: "axis", name: "Axis (at the start)", n: 1040000 }, { side: "soviet", name: "Red Army (Operation Uranus)", n: 1140000 }] },
  { id: "alamein", title: "El Alamein", start: "1942-10-23", end: "1942-11-11", theater: "africa", at: [32.5, 30.8], anchor: "start",
    sides: [{ side: "axis", name: "Germany and Italy", n: 116000 }, { side: "allied", name: "British Commonwealth", n: 195000 }] },
  { id: "kursk", title: "Battle of Kursk", start: "1943-07-05", end: "1943-08-23", theater: "east", at: [40.5, 53.6], anchor: "start",
    sides: [{ side: "axis", name: "Germany", n: 780000 }, { side: "soviet", name: "Red Army", n: 1910000 }] },
  { id: "sicily", title: "Invasion of Sicily", start: "1943-07-10", end: "1943-08-17", theater: "italy", at: [11.6, 37.6], anchor: "end",
    sides: [{ side: "axis", name: "Italy and Germany", n: 260000 }, { side: "allied", name: "Allies (total landed)", n: 467000 }] },
  { id: "normandy1", title: "D-Day", start: "1944-06-06", end: "1944-06-29", theater: "west", at: [-5.2, 49.6], anchor: "end",
    sides: [{ side: "allied", name: "Allied troops landed on 6 June", n: 156000 }, { side: "axis", name: "German defenders in Normandy", n: 50000 }] },
  { id: "normandy2", title: "Battle of Normandy", start: "1944-06-30", end: "1944-08-30", theater: "west", at: [-5.2, 49.6], anchor: "end",
    sides: [{ side: "allied", name: "Allies ashore by 30 June", n: 850000 }, { side: "allied", name: "Allies ashore by late August", n: 2000000 }, { side: "axis", name: "Germany, in Normandy", n: 640000 }] },
  { id: "bagration", title: "Operation Bagration", start: "1944-06-22", end: "1944-08-19", theater: "east", at: [33.5, 57.4], anchor: "start",
    sides: [{ side: "axis", name: "Army Group Centre", n: 850000 }, { side: "soviet", name: "Red Army", n: 1670000 }] },
  { id: "bulge", title: "Battle of the Bulge", start: "1944-12-16", end: "1945-01-25", theater: "west", at: [3.2, 53.9], anchor: "end",
    sides: [{ side: "axis", name: "Germany", n: 410000 }, { side: "allied", name: "Allies (by the end)", n: 700000 }] },
  { id: "vistula", title: "Vistula–Oder Offensive", start: "1945-01-12", end: "1945-02-02", theater: "east", at: [25.2, 56.6], anchor: "start",
    sides: [{ side: "axis", name: "Germany", n: 450000 }, { side: "soviet", name: "Red Army", n: 2200000 }] },
  { id: "west45", title: "Western Allies", start: "1945-03-07", end: "1945-05-08", theater: "west", at: [-4.5, 58.6], anchor: "end",
    sides: [{ side: "allied", name: "Western Allies under SHAEF", n: 4500000 }] },
  { id: "berlin", title: "Battle of Berlin", start: "1945-04-16", end: "1945-05-08", theater: "east", at: [15.6, 62.3], anchor: "start",
    sides: [{ side: "axis", name: "Germany", n: 770000 }, { side: "soviet", name: "Red Army and Polish forces", n: 2500000 }] }
];

// Allied and neutral merchant shipping lost to all causes, by year, in gross register tons
// (Roskill, The War at Sea). 1939 covers September to December; 1945 runs to May.
window.WW2_SHIPPING_LOSSES = [
  ["1939-09-03", "1939-12-31", 755392],
  ["1940-01-01", "1940-12-31", 3991641],
  ["1941-01-01", "1941-12-31", 4328558],
  ["1942-01-01", "1942-12-31", 7790697],
  ["1943-01-01", "1943-12-31", 3220137],
  ["1944-01-01", "1944-12-31", 1045629],
  ["1945-01-01", "1945-05-08", 438821]
];
