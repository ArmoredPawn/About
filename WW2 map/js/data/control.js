// Political control of each country over time, keyed by Natural Earth country name.
// Each entry: [date, status, label]. Status is one of:
//   axis      Axis powers and aligned client states
//   occupied  Territory under Axis military occupation
//   allied    Western Allies and the territory they hold or liberated
//   soviet    The USSR and territory held by the Red Army
//   neutral   Neutral states
// Modern borders are used as the base; the regions and fronts in fronts.js
// refine them where wartime borders or front lines differ.
window.WW2_CONTROL = {
  "Germany": [["1939-09-01", "axis", "Nazi Germany"]],
  "Austria": [["1939-09-01", "axis", "Annexed by Germany (Anschluss, 1938)"]],
  "Italy": [
    ["1939-09-01", "axis", "Fascist Italy"],
    ["1943-09-08", "axis", "German-occupied north / Italian Social Republic"],
    ["1945-05-02", "allied", "Liberated Italy"]
  ],
  "Vatican": [["1939-09-01", "neutral", "Vatican City"]],
  "San Marino": [["1939-09-01", "neutral", "San Marino"]],
  "Hungary": [
    ["1939-09-01", "neutral", "Kingdom of Hungary (non-belligerent)"],
    ["1940-11-20", "axis", "Hungary, Axis member"],
    ["1944-03-19", "axis", "Hungary under German occupation"],
    ["1945-04-04", "soviet", "Hungary under Soviet occupation"]
  ],
  "Romania": [
    ["1939-09-01", "neutral", "Kingdom of Romania"],
    ["1940-11-23", "axis", "Romania, Axis member"],
    ["1944-08-23", "soviet", "Romania, switched sides; Soviet occupation"]
  ],
  "Bulgaria": [
    ["1939-09-01", "neutral", "Tsardom of Bulgaria"],
    ["1941-03-01", "axis", "Bulgaria, Axis member"],
    ["1944-09-09", "soviet", "Bulgaria under Soviet occupation"]
  ],
  "Slovakia": [
    ["1939-09-01", "axis", "Slovak State (German client)"],
    ["1945-04-04", "soviet", "Liberated by the Red Army"]
  ],
  "Czechia": [
    ["1939-09-01", "occupied", "Protectorate of Bohemia and Moravia"]
  ],
  "Poland": [
    ["1939-09-01", "allied", "Republic of Poland"],
    ["1939-09-28", "occupied", "German-occupied Poland"]
  ],
  "Denmark": [
    ["1939-09-01", "neutral", "Kingdom of Denmark"],
    ["1940-04-09", "occupied", "German-occupied Denmark"],
    ["1945-05-05", "allied", "Liberated Denmark"]
  ],
  "Norway": [
    ["1939-09-01", "neutral", "Kingdom of Norway"],
    ["1940-04-09", "allied", "Norway, fighting the invasion"],
    ["1940-06-10", "occupied", "German-occupied Norway"],
    ["1945-05-08", "allied", "Liberated Norway"]
  ],
  "Netherlands": [
    ["1939-09-01", "neutral", "Kingdom of the Netherlands"],
    ["1940-05-10", "allied", "Netherlands, fighting the invasion"],
    ["1940-05-15", "occupied", "German-occupied Netherlands"],
    ["1945-05-05", "allied", "Liberated Netherlands"]
  ],
  "Belgium": [
    ["1939-09-01", "neutral", "Kingdom of Belgium"],
    ["1940-05-10", "allied", "Belgium, fighting the invasion"],
    ["1940-05-28", "occupied", "German-occupied Belgium"],
    ["1944-09-15", "allied", "Liberated Belgium"]
  ],
  "Luxembourg": [
    ["1939-09-01", "neutral", "Grand Duchy of Luxembourg"],
    ["1940-05-10", "occupied", "Annexed by Germany"],
    ["1944-09-12", "allied", "Liberated Luxembourg"]
  ],
  "France": [
    ["1939-09-01", "allied", "French Third Republic"],
    ["1940-06-25", "axis", "Vichy France (unoccupied zone)"],
    ["1942-11-11", "occupied", "German- and Italian-occupied France"],
    ["1944-09-15", "allied", "Liberated France"]
  ],
  "Monaco": [["1939-09-01", "neutral", "Monaco"]],
  "Andorra": [["1939-09-01", "neutral", "Andorra"]],
  "United Kingdom": [["1939-09-01", "allied", "United Kingdom"]],
  "Isle of Man": [["1939-09-01", "allied", "Isle of Man"]],
  "Jersey": [
    ["1939-09-01", "allied", "Jersey"],
    ["1940-07-01", "occupied", "German-occupied Channel Islands"],
    ["1945-05-09", "allied", "Liberated Channel Islands"]
  ],
  "Guernsey": [
    ["1939-09-01", "allied", "Guernsey"],
    ["1940-06-30", "occupied", "German-occupied Channel Islands"],
    ["1945-05-09", "allied", "Liberated Channel Islands"]
  ],
  "Ireland": [["1939-09-01", "neutral", "Éire (neutral)"]],
  "Iceland": [
    ["1939-09-01", "neutral", "Kingdom of Iceland"],
    ["1940-05-10", "allied", "Occupied by Britain, then the US"]
  ],
  "Faeroe Is.": [
    ["1939-09-01", "neutral", "Faroe Islands (Danish)"],
    ["1940-04-12", "allied", "British-occupied Faroe Islands"]
  ],
  "Greenland": [
    ["1939-09-01", "neutral", "Greenland (Danish)"],
    ["1941-04-09", "allied", "Under US protection"]
  ],
  "Spain": [["1939-09-01", "neutral", "Francoist Spain (neutral)"]],
  "Portugal": [["1939-09-01", "neutral", "Portugal (neutral)"]],
  "Switzerland": [["1939-09-01", "neutral", "Switzerland (neutral)"]],
  "Liechtenstein": [["1939-09-01", "neutral", "Liechtenstein (neutral)"]],
  "Sweden": [["1939-09-01", "neutral", "Sweden (neutral)"]],
  "Finland": [
    ["1939-09-01", "neutral", "Republic of Finland"],
    ["1941-06-25", "axis", "Finland, co-belligerent with Germany"],
    ["1944-09-19", "allied", "Finland after the Moscow Armistice"]
  ],
  "Åland": [
    ["1939-09-01", "neutral", "Åland Islands (Finnish)"],
    ["1941-06-25", "axis", "Finland, co-belligerent with Germany"],
    ["1944-09-19", "allied", "Finland after the Moscow Armistice"]
  ],
  "Estonia": [
    ["1939-09-01", "neutral", "Republic of Estonia"],
    ["1940-06-17", "soviet", "Annexed by the USSR"],
    ["1941-06-22", "occupied", "German-occupied (Reichskommissariat Ostland)"]
  ],
  "Latvia": [
    ["1939-09-01", "neutral", "Republic of Latvia"],
    ["1940-06-17", "soviet", "Annexed by the USSR"],
    ["1941-06-22", "occupied", "German-occupied (Reichskommissariat Ostland)"]
  ],
  "Lithuania": [
    ["1939-09-01", "neutral", "Republic of Lithuania"],
    ["1940-06-15", "soviet", "Annexed by the USSR"],
    ["1941-06-22", "occupied", "German-occupied (Reichskommissariat Ostland)"]
  ],
  "Belarus": [
    ["1939-09-01", "soviet", "Byelorussian SSR"],
    ["1941-06-22", "occupied", "German-occupied Belarus"]
  ],
  "Ukraine": [
    ["1939-09-01", "soviet", "Ukrainian SSR"],
    ["1941-06-22", "occupied", "Reichskommissariat Ukraine"]
  ],
  "Moldova": [
    ["1939-09-01", "neutral", "Bessarabia (Romania)"],
    ["1940-06-28", "soviet", "Annexed by the USSR"],
    ["1941-06-22", "axis", "Bessarabia, retaken by Romania"]
  ],
  "Russia": [
    ["1939-09-01", "soviet", "Soviet Union"],
    ["1941-06-22", "occupied", "German-occupied Soviet territory"]
  ],
  "Georgia": [["1939-09-01", "soviet", "Georgian SSR"]],
  "Armenia": [["1939-09-01", "soviet", "Armenian SSR"]],
  "Azerbaijan": [["1939-09-01", "soviet", "Azerbaijan SSR"]],
  "Kazakhstan": [["1939-09-01", "soviet", "Kazakh SSR"]],
  "Turkmenistan": [["1939-09-01", "soviet", "Turkmen SSR"]],
  "Uzbekistan": [["1939-09-01", "soviet", "Uzbek SSR"]],
  "Kyrgyzstan": [["1939-09-01", "soviet", "Kirghiz SSR"]],
  "Tajikistan": [["1939-09-01", "soviet", "Tajik SSR"]],
  "Slovenia": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-17", "occupied", "Annexed by Germany and Italy"],
    ["1945-05-09", "allied", "Liberated by the Yugoslav Partisans"]
  ],
  "Croatia": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-10", "axis", "Independent State of Croatia (Ustaše)"],
    ["1945-05-08", "allied", "Liberated by the Yugoslav Partisans"]
  ],
  "Bosnia and Herz.": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-10", "axis", "Independent State of Croatia (Ustaše)"],
    ["1945-04-06", "allied", "Liberated by the Yugoslav Partisans"]
  ],
  "Serbia": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-17", "occupied", "German-occupied Serbia"],
    ["1944-10-20", "allied", "Liberated by Partisans and the Red Army"]
  ],
  "Kosovo": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-17", "occupied", "Annexed to Italian-ruled Albania"],
    ["1944-11-20", "allied", "Liberated by the Partisans"]
  ],
  "Montenegro": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-17", "occupied", "Italian-occupied Montenegro"],
    ["1944-12-15", "allied", "Liberated by the Partisans"]
  ],
  "Macedonia": [
    ["1939-09-01", "neutral", "Kingdom of Yugoslavia"],
    ["1941-04-17", "occupied", "Bulgarian-occupied Macedonia"],
    ["1944-11-19", "allied", "Liberated by the Partisans"]
  ],
  "Albania": [
    ["1939-09-01", "occupied", "Italian-occupied Albania"],
    ["1943-09-10", "occupied", "German-occupied Albania"],
    ["1944-11-29", "allied", "Liberated by Albanian partisans"]
  ],
  "Greece": [
    ["1939-09-01", "neutral", "Kingdom of Greece"],
    ["1940-10-28", "allied", "Greece, at war with Italy"],
    ["1941-04-27", "occupied", "Axis-occupied Greece"],
    ["1944-10-18", "allied", "Liberated Greece"]
  ],
  "Turkey": [
    ["1939-09-01", "neutral", "Turkey (neutral)"],
    ["1945-02-23", "neutral", "Turkey (declared war on Germany, Feb 1945)"]
  ],
  "Cyprus": [["1939-09-01", "allied", "British Cyprus"]],
  "N. Cyprus": [["1939-09-01", "allied", "British Cyprus"]],
  "Malta": [["1939-09-01", "allied", "British Malta"]],
  "Syria": [
    ["1939-09-01", "allied", "French Mandate of Syria"],
    ["1940-06-25", "axis", "Vichy-controlled Syria"],
    ["1941-07-14", "allied", "Free French and British control"]
  ],
  "Lebanon": [
    ["1939-09-01", "allied", "French Mandate of Lebanon"],
    ["1940-06-25", "axis", "Vichy-controlled Lebanon"],
    ["1941-07-14", "allied", "Free French and British control"]
  ],
  "Israel": [["1939-09-01", "allied", "British Mandate of Palestine"]],
  "Palestine": [["1939-09-01", "allied", "British Mandate of Palestine"]],
  "Jordan": [["1939-09-01", "allied", "Emirate of Transjordan (British)"]],
  "Iraq": [
    ["1939-09-01", "allied", "Kingdom of Iraq (British-aligned)"],
    ["1941-04-01", "axis", "Rashid Ali's pro-Axis government"],
    ["1941-05-31", "allied", "British-occupied Iraq"]
  ],
  "Iran": [
    ["1939-09-01", "neutral", "Imperial Iran"],
    ["1941-08-25", "allied", "Anglo-Soviet occupation"]
  ],
  "Kuwait": [["1939-09-01", "allied", "British protectorate"]],
  "Saudi Arabia": [["1939-09-01", "neutral", "Saudi Arabia"]],
  "Egypt": [["1939-09-01", "allied", "Kingdom of Egypt (British-held)"]],
  "Libya": [
    ["1939-09-01", "axis", "Italian Libya"],
    ["1943-01-23", "allied", "British and Free French administration"]
  ],
  "Tunisia": [
    ["1939-09-01", "allied", "French Tunisia"],
    ["1940-06-25", "axis", "Vichy Tunisia"],
    ["1942-11-12", "occupied", "Axis bridgehead in Tunisia"],
    ["1943-05-13", "allied", "Liberated Tunisia"]
  ],
  "Algeria": [
    ["1939-09-01", "allied", "French Algeria"],
    ["1940-06-25", "axis", "Vichy Algeria"],
    ["1942-11-10", "allied", "Allied-held Algeria"]
  ],
  "Morocco": [
    ["1939-09-01", "allied", "French Morocco"],
    ["1940-06-25", "axis", "Vichy Morocco"],
    ["1942-11-11", "allied", "Allied-held Morocco"]
  ],
  "W. Sahara": [["1939-09-01", "neutral", "Spanish Sahara"]],
  "Canada": [
    ["1939-09-01", "neutral", "Canada"],
    ["1939-09-10", "allied", "Canada"]
  ],
  "United States of America": [
    ["1939-09-01", "neutral", "United States (neutral)"],
    ["1941-12-11", "allied", "United States"]
  ]
};

// Countries redrawn on top of front-line overlays while these date ranges hold.
// Neutrals are pinned for the whole war; others until fighting reaches them.
window.WW2_PINNED = {
  "Sweden": ["1939-09-01", "1945-12-31"],
  "Switzerland": ["1939-09-01", "1945-12-31"],
  "Liechtenstein": ["1939-09-01", "1945-12-31"],
  "Spain": ["1939-09-01", "1945-12-31"],
  "Portugal": ["1939-09-01", "1945-12-31"],
  "Andorra": ["1939-09-01", "1945-12-31"],
  "Ireland": ["1939-09-01", "1945-12-31"],
  "Turkey": ["1939-09-01", "1945-12-31"],
  "Iran": ["1939-09-01", "1945-12-31"],
  "Saudi Arabia": ["1939-09-01", "1945-12-31"],
  "United Kingdom": ["1939-09-01", "1945-12-31"],
  "Isle of Man": ["1939-09-01", "1945-12-31"],
  "Finland": ["1939-09-01", "1945-12-31"],
  "Åland": ["1939-09-01", "1945-12-31"],
  "Germany": ["1939-09-01", "1944-09-11"],
  "Austria": ["1939-09-01", "1945-03-29"],
  "Slovakia": ["1939-09-01", "1944-09-20"],
  "Hungary": ["1939-09-01", "1944-09-22"],
  "Romania": ["1939-09-01", "1944-04-05"],
  "Bulgaria": ["1939-09-01", "1944-09-05"],
  "Czechia": ["1939-09-01", "1945-01-15"]
};
