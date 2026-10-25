// Battles, campaigns and milestones. `at` is [lon, lat].
// type: battle | naval | milestone | bombing  (resistance and Holocaust sites live in memory.js)
// theater: west | east | italy | balkans | atlantic | africa
// Casualty figures are rounded estimates from standard references; sources often differ.
window.WW2_EVENTS = [
  {
    id: "poland", title: "Invasion of Poland", type: "battle", theater: "east",
    start: "1939-09-01", end: "1939-10-06", at: [19.6, 52.0], place: "Poland",
    summary: "Germany attacked Poland from the west, north and south on 1 September. On 17 September the Soviet Union invaded from the east under the secret protocol of the Molotov–Ribbentrop Pact. The last Polish units surrendered on 6 October.",
    casualties: "Poland: about 66,000 soldiers killed and 400,000+ captured. Germany: about 16,000 killed. USSR: roughly 1,500–3,000 killed.",
    why: "Britain and France declared war on Germany on 3 September, turning a regional invasion into a European war.",
    wiki: "Invasion of Poland"
  },
  {
    id: "atlantic", title: "Battle of the Atlantic", type: "naval", theater: "atlantic",
    start: "1939-09-03", end: "1945-05-08", at: [-28, 53], place: "North Atlantic",
    summary: "The longest continuous campaign of the war. German U-boats, surface raiders and aircraft tried to cut the convoy routes that carried food, fuel and troops from North America to Britain.",
    casualties: "About 36,000 Allied naval personnel and 36,000 merchant seamen killed; around 3,500 merchant ships sunk. About 28,000 of some 40,000 U-boat crew died.",
    why: "Britain could not keep fighting, and no invasion of France could be mounted, unless the convoys got through.",
    wiki: "Battle of the Atlantic"
  },
  {
    id: "athenia", title: "Sinking of SS Athenia", type: "naval", theater: "atlantic",
    start: "1939-09-03", end: "1939-09-04", at: [-14.1, 56.7], place: "Northwest of Ireland",
    summary: "Hours after Britain declared war, U-30 torpedoed the passenger liner Athenia, mistaking it for an armed merchant cruiser.",
    casualties: "117 passengers and crew killed.",
    why: "Britain concluded that unrestricted submarine warfare had begun and introduced convoys at once.",
    wiki: "SS Athenia (1922)"
  },
  {
    id: "winterwar", title: "Winter War", type: "battle", theater: "east",
    start: "1939-11-30", end: "1940-03-13", at: [29.0, 60.6], place: "Karelian Isthmus, Finland",
    summary: "The Soviet Union invaded Finland after it refused to cede territory. Heavily outnumbered Finnish troops held the Mannerheim Line for weeks before the Moscow Peace Treaty forced Finland to give up Karelia.",
    casualties: "Finland: about 25,900 killed. USSR: about 126,000–168,000 killed.",
    why: "The Red Army's poor showing persuaded Hitler that the USSR could be beaten quickly.",
    wiki: "Winter War"
  },
  {
    id: "norway", title: "Invasion of Denmark and Norway", type: "battle", theater: "west",
    start: "1940-04-09", end: "1940-06-10", at: [17.4, 68.4], place: "Narvik, Norway",
    summary: "Operation Weserübung took Denmark in a day and landed troops along the Norwegian coast. British, French and Polish forces fought around Narvik before withdrawing as France collapsed.",
    casualties: "Germany: about 5,300 killed or missing. Allies: about 6,000 killed, wounded or missing, plus heavy naval losses.",
    why: "Germany secured Swedish iron ore and Atlantic bases, and the failed campaign brought Churchill to power on 10 May.",
    wiki: "Norwegian campaign"
  },
  {
    id: "france", title: "Battle of France", type: "battle", theater: "west",
    start: "1940-05-10", end: "1940-06-25", at: [4.95, 49.7], place: "Sedan, France",
    summary: "German armour pushed through the Ardennes, crossed the Meuse at Sedan and raced to the Channel, trapping the best Allied armies in Belgium. Paris fell on 14 June and France signed an armistice on 22 June.",
    casualties: "France: about 60,000–90,000 killed and 1.8 million captured. Germany: about 27,000 killed.",
    why: "France fell in six weeks, which left Britain fighting alone and gave Germany the Atlantic coast.",
    wiki: "Battle of France"
  },
  {
    id: "rotterdam", title: "Rotterdam Blitz", type: "bombing", theater: "west",
    start: "1940-05-14", end: "1940-05-15", at: [4.48, 51.92], place: "Rotterdam, Netherlands",
    summary: "German bombers destroyed the medieval centre of Rotterdam while surrender talks were under way. The Netherlands capitulated the next day after Germany threatened Utrecht with the same.",
    casualties: "Roughly 850–900 civilians killed and 80,000 left homeless.",
    why: "The next day Britain ended its restraint and began bombing industrial targets in Germany.",
    wiki: "Rotterdam Blitz"
  },
  {
    id: "dunkirk", title: "Dunkirk evacuation", type: "milestone", theater: "west",
    start: "1940-05-26", end: "1940-06-04", at: [2.37, 51.03], place: "Dunkirk, France",
    summary: "Warships and hundreds of civilian 'little ships' lifted troops off the beaches and harbour of Dunkirk under air attack while a rearguard held the perimeter.",
    casualties: "338,226 British and French troops evacuated; more than 200 ships lost.",
    why: "The core of the British Army survived to fight again.",
    wiki: "Dunkirk evacuation"
  },
  {
    id: "britain", title: "Battle of Britain", type: "battle", theater: "west",
    start: "1940-07-10", end: "1940-10-31", at: [0.6, 51.25], place: "Southern England",
    summary: "The Luftwaffe tried to destroy the RAF as the first step toward an invasion. Radar, Fighter Command's control system and German switches of target denied it air superiority.",
    casualties: "RAF: about 1,500 aircrew killed, 1,744 aircraft lost. Luftwaffe: about 2,600 aircrew killed, 1,977 aircraft lost.",
    why: "Germany's first major defeat; the invasion of Britain was postponed indefinitely.",
    wiki: "Battle of Britain"
  },
  {
    id: "blitz", title: "The Blitz", type: "bombing", theater: "west",
    start: "1940-09-07", end: "1941-05-11", at: [-0.12, 51.51], place: "London and British cities",
    summary: "For eight months German bombers attacked London, often on consecutive nights, along with Coventry, Liverpool, Birmingham, Glasgow and other industrial and port cities.",
    casualties: "About 43,000 civilians killed and a million homes damaged or destroyed.",
    why: "It did not break British morale or production, and the Luftwaffe turned east for the invasion of the USSR.",
    wiki: "The Blitz"
  },
  {
    id: "coventry", title: "Bombing of Coventry", type: "bombing", theater: "west",
    start: "1940-11-14", end: "1940-11-15", at: [-1.51, 52.41], place: "Coventry, England",
    summary: "A single night raid by over 500 bombers burned out the city centre and its medieval cathedral.",
    casualties: "About 570 people killed.",
    why: "German propaganda coined the word 'coventrieren' for destroying a city; the ruins became a symbol of the Blitz.",
    wiki: "Coventry Blitz"
  },
  {
    id: "malta", title: "Siege of Malta", type: "bombing", theater: "africa",
    start: "1940-06-11", end: "1942-11-20", at: [14.45, 35.9], place: "Malta",
    summary: "Italian and German aircraft bombed the British island base almost daily while convoys fought through to keep it supplied. In 1942 it was among the most heavily bombed places on earth.",
    casualties: "About 1,300–1,600 civilians killed.",
    why: "Aircraft and submarines from Malta sank the supply ships Rommel depended on in North Africa.",
    wiki: "Siege of Malta (World War II)"
  },
  {
    id: "greece40", title: "Greco-Italian War", type: "battle", theater: "balkans",
    start: "1940-10-28", end: "1941-04-23", at: [20.4, 40.3], place: "Epirus and southern Albania",
    summary: "Mussolini invaded Greece from Albania. The Greek army stopped the attack in the mountains and drove the Italians back deep into Albania.",
    casualties: "Italy: about 13,700 killed. Greece: about 13,400 killed.",
    why: "Italy's failure drew Germany into the Balkans in spring 1941.",
    wiki: "Greco-Italian War"
  },
  {
    id: "taranto", title: "Raid on Taranto", type: "naval", theater: "italy",
    start: "1940-11-11", end: "1940-11-12", at: [17.22, 40.46], place: "Taranto, Italy",
    summary: "Twenty-one Swordfish biplanes from HMS Illustrious attacked the Italian fleet at anchor and put three battleships out of action.",
    casualties: "Italy: about 60 killed. Britain: 2 aircraft lost.",
    why: "The first all-aircraft ship-to-ship strike in history, studied closely by Japanese planners before Pearl Harbor.",
    wiki: "Battle of Taranto"
  },
  {
    id: "compass", title: "Operation Compass", type: "battle", theater: "africa",
    start: "1940-12-09", end: "1941-02-07", at: [20.2, 31.9], place: "Beda Fomm, Libya",
    summary: "A small British and Commonwealth force routed the Italian Tenth Army, advancing 800 km from Egypt to Beda Fomm in two months.",
    casualties: "Italy: about 130,000 captured. Britain and Commonwealth: about 1,900 casualties.",
    why: "Hitler sent Rommel and the Afrika Korps to rescue his ally.",
    wiki: "Operation Compass"
  },
  {
    id: "balkans41", title: "Invasion of Yugoslavia and Greece", type: "battle", theater: "balkans",
    start: "1941-04-06", end: "1941-04-30", at: [20.46, 44.82], place: "Belgrade, Yugoslavia",
    summary: "After a coup in Belgrade rejected the Axis, Germany, Italy and Hungary invaded Yugoslavia and Greece at once. Yugoslavia surrendered in 11 days and British forces evacuated Greece by the end of April.",
    casualties: "German losses were light (about 2,500 killed). Several thousand civilians died in the bombing of Belgrade; over 300,000 Yugoslav soldiers were captured.",
    why: "It began four years of occupation and partisan war that tied down hundreds of thousands of Axis troops.",
    wiki: "Invasion of Yugoslavia"
  },
  {
    id: "crete", title: "Battle of Crete", type: "battle", theater: "balkans",
    start: "1941-05-20", end: "1941-06-01", at: [23.83, 35.53], place: "Maleme, Crete",
    summary: "Germany took Crete in the first mainly airborne invasion in history, after paratroopers seized the Maleme airfield at great cost.",
    casualties: "Germany: about 4,000 killed or missing. Allies: about 4,000 killed and 12,000 captured, plus heavy naval losses.",
    why: "German losses were so heavy that Hitler never again used paratroops in a major airborne assault.",
    wiki: "Battle of Crete"
  },
  {
    id: "bismarck", title: "Sinking of the Bismarck", type: "naval", theater: "atlantic",
    start: "1941-05-24", end: "1941-05-27", at: [-16.2, 48.2], place: "North Atlantic, west of Brest",
    summary: "The battleship Bismarck sank HMS Hood in the Denmark Strait, then was crippled by a torpedo bomber and sunk by the Home Fleet three days later.",
    casualties: "Hood: 1,415 killed, 3 survivors. Bismarck: about 2,100 killed, 114 survivors.",
    why: "Germany's big surface ships were never again a serious threat to the Atlantic convoys.",
    wiki: "Last battle of the battleship Bismarck"
  },
  {
    id: "barbarossa", title: "Operation Barbarossa", type: "battle", theater: "east",
    start: "1941-06-22", end: "1941-12-05", at: [26.5, 53.2], place: "Western USSR",
    summary: "About 3.8 million Axis troops invaded the Soviet Union along a 2,900 km front. Huge encirclements at Minsk, Smolensk and Kiev destroyed entire Soviet armies, but the advance stalled before Moscow.",
    casualties: "USSR: roughly 4.5 million casualties by December, including about 3 million captured. Axis: about 1 million casualties.",
    why: "It opened the Eastern Front, where most German soldiers who died in the war would be killed.",
    wiki: "Operation Barbarossa"
  },
  {
    id: "leningrad", title: "Siege of Leningrad", type: "battle", theater: "east",
    start: "1941-09-08", end: "1944-01-27", at: [30.31, 59.94], place: "Leningrad (St Petersburg)",
    summary: "German and Finnish forces cut Leningrad off by land for 872 days. The only lifeline ran across Lake Ladoga, by boat in summer and over the ice in winter.",
    casualties: "About 800,000 to 1 million civilians died, most of them from starvation.",
    why: "The city never fell, and the siege tied down a whole German army group.",
    wiki: "Siege of Leningrad"
  },
  {
    id: "moscow", title: "Battle of Moscow", type: "battle", theater: "east",
    start: "1941-10-02", end: "1942-01-07", at: [37.62, 55.75], place: "Moscow",
    summary: "Operation Typhoon brought German troops within 30 km of the Kremlin. On 5 December a Soviet counteroffensive by fresh divisions, many from Siberia, drove them back in deep winter.",
    casualties: "USSR: around 1 million casualties. Germany: several hundred thousand; estimates vary widely.",
    why: "The Wehrmacht's first strategic defeat; Germany could no longer win a short war.",
    wiki: "Battle of Moscow"
  },
  {
    id: "usentry", title: "Germany declares war on the US", type: "milestone", theater: "atlantic",
    start: "1941-12-11", end: "1941-12-12", at: [13.4, 52.52], place: "Berlin",
    summary: "Four days after Pearl Harbor, Hitler declared war on the United States. Italy followed the same day.",
    casualties: null,
    why: "It brought American industry and manpower into the European war.",
    wiki: "German declaration of war on the United States"
  },
  {
    id: "pq17", title: "Convoy PQ 17", type: "naval", theater: "atlantic",
    start: "1942-06-27", end: "1942-07-10", at: [35.0, 75.0], place: "Barents Sea",
    summary: "Fearing an attack by the battleship Tirpitz, the Admiralty ordered this Arctic convoy to scatter. U-boats and aircraft then picked off the merchant ships one by one.",
    casualties: "24 of 35 merchant ships sunk; about 150 seamen killed.",
    why: "The worst convoy disaster of the war; Arctic convoys were suspended until the dark months.",
    wiki: "Convoy PQ 17"
  },
  {
    id: "cologne", title: "First 1,000-bomber raid", type: "bombing", theater: "west",
    start: "1942-05-30", end: "1942-05-31", at: [6.96, 50.94], place: "Cologne, Germany",
    summary: "Bomber Command put more than 1,000 aircraft over a single German city for the first time.",
    casualties: "About 470 people killed on the ground; 41 bombers lost.",
    why: "It showed what massed area bombing could do and secured the resources for a strategic bomber offensive.",
    wiki: "Bombing of Cologne in World War II"
  },
  {
    id: "stalingrad", title: "Battle of Stalingrad", type: "battle", theater: "east",
    start: "1942-08-23", end: "1943-02-02", at: [44.51, 48.71], place: "Stalingrad (Volgograd)",
    summary: "The German Sixth Army fought street by street for the city on the Volga. In November Operation Uranus broke through the Romanian armies on its flanks and encircled more than 250,000 Axis troops.",
    casualties: "USSR: about 1.1 million casualties. Axis: about 800,000 killed, wounded or captured; 91,000 surrendered at the end.",
    why: "It destroyed an entire German army and is widely seen as the turning point of the war.",
    wiki: "Battle of Stalingrad"
  },
  {
    id: "alamein", title: "Second Battle of El Alamein", type: "battle", theater: "africa",
    start: "1942-10-23", end: "1942-11-11", at: [28.95, 30.83], place: "El Alamein, Egypt",
    summary: "Montgomery's Eighth Army broke through Axis minefields after twelve days of attrition, forcing Rommel into a retreat that ended in Tunisia.",
    casualties: "Allies: about 13,500 casualties. Axis: about 30,000 killed or wounded and 30,000 captured.",
    why: "It ended the threat to Egypt and the Suez Canal. Churchill: 'Before Alamein we never had a victory. After Alamein we never had a defeat.'",
    wiki: "Second Battle of El Alamein"
  },
  {
    id: "torch", title: "Operation Torch", type: "battle", theater: "africa",
    start: "1942-11-08", end: "1942-11-16", at: [3.06, 36.75], place: "Algiers, Casablanca and Oran",
    summary: "American and British troops landed in Vichy French Morocco and Algeria. French forces resisted briefly, then agreed a ceasefire and joined the Allies.",
    casualties: "Allies: about 480 killed. Vichy French: about 1,350 killed.",
    why: "The first major American ground operation against Germany; in response Germany occupied the rest of France.",
    wiki: "Operation Torch"
  },
  {
    id: "blackmay", title: "Black May", type: "naval", theater: "atlantic",
    start: "1943-05-01", end: "1943-05-31", at: [-35.0, 56.0], place: "Mid-Atlantic air gap",
    summary: "Long-range aircraft, escort carriers, radar and broken Enigma codes turned the hunters into the hunted. Admiral Dönitz withdrew his U-boats from the North Atlantic.",
    casualties: "41 U-boats lost in a single month.",
    why: "The convoy routes were secured, so American troops and supplies could be built up in Britain for D-Day.",
    wiki: "Black May (1943)"
  },
  {
    id: "tunisia", title: "Axis surrender in Tunisia", type: "battle", theater: "africa",
    start: "1943-05-07", end: "1943-05-13", at: [10.18, 36.8], place: "Tunis, Tunisia",
    summary: "Squeezed between the Eighth Army from the east and Allied armies from Algeria, the Axis bridgehead collapsed. Tunis fell on 7 May.",
    casualties: "About 230,000–250,000 Axis troops captured.",
    why: "It ended the war in Africa and opened the way to Sicily and Italy.",
    wiki: "Tunisian campaign"
  },
  {
    id: "kursk", title: "Battle of Kursk", type: "battle", theater: "east",
    start: "1943-07-05", end: "1943-08-23", at: [36.19, 51.73], place: "Kursk salient",
    summary: "Germany attacked the Kursk salient into deep Soviet defences, including the tank battle at Prokhorovka. Soviet counteroffensives then retook Orel, Belgorod and Kharkov.",
    casualties: "USSR: about 860,000 casualties across all phases. Germany: about 170,000–200,000.",
    why: "Germany's last major offensive in the East; from then on the Red Army held the initiative.",
    wiki: "Battle of Kursk"
  },
  {
    id: "sicily", title: "Invasion of Sicily", type: "battle", theater: "italy",
    start: "1943-07-10", end: "1943-08-17", at: [14.24, 37.07], place: "Gela, Sicily",
    summary: "American and British armies landed on the south-east coast and took the island in 38 days, though most German troops escaped across the Strait of Messina.",
    casualties: "Allies: about 25,000 casualties. Axis: about 29,000 killed or wounded and 140,000 captured, mostly Italian.",
    why: "Mussolini was deposed on 25 July and Italy surrendered in September.",
    wiki: "Allied invasion of Sicily"
  },
  {
    id: "hamburg", title: "Firebombing of Hamburg", type: "bombing", theater: "west",
    start: "1943-07-24", end: "1943-08-03", at: [10.0, 53.55], place: "Hamburg, Germany",
    summary: "Operation Gomorrah, a week of British night and American day raids. On 27–28 July hot, dry weather turned the fires into a firestorm.",
    casualties: "About 37,000–40,000 people killed and 900,000 left homeless.",
    why: "It shocked the Nazi leadership, and it showed how destructive area bombing had become.",
    wiki: "Bombing of Hamburg in World War II"
  },
  {
    id: "ploiesti", title: "Operation Tidal Wave", type: "bombing", theater: "balkans",
    start: "1943-08-01", end: "1943-08-02", at: [26.03, 44.94], place: "Ploiești, Romania",
    summary: "177 American B-24s flew from Libya to attack Romania's oil refineries at very low altitude.",
    casualties: "53 bombers lost and about 660 aircrew killed, captured or interned.",
    why: "It exposed how dependent Germany was on Romanian oil; the refineries were soon repaired.",
    wiki: "Operation Tidal Wave"
  },
  {
    id: "salerno", title: "Italian armistice and Salerno", type: "battle", theater: "italy",
    start: "1943-09-08", end: "1943-09-16", at: [14.9, 40.55], place: "Salerno, Italy",
    summary: "Italy's armistice was announced as Allied troops landed at Salerno. Germany disarmed the Italian army, occupied the north and centre, and nearly threw the beachhead back into the sea.",
    casualties: "Allies: about 9,000 casualties. Germany: about 3,500.",
    why: "Instead of a quick collapse, the Allies faced a slow, costly campaign up the length of Italy.",
    wiki: "Allied invasion of Italy"
  },
  {
    id: "dnieper", title: "Battle of the Dnieper", type: "battle", theater: "east",
    start: "1943-08-26", end: "1943-12-23", at: [30.52, 50.45], place: "Kiev and the Dnieper",
    summary: "Soviet armies pursued the Germans to the Dnieper and stormed across it on improvised rafts. Kiev was liberated on 6 November.",
    casualties: "USSR: about 1.3 million casualties. Germany: estimates vary, several hundred thousand.",
    why: "It broke Germany's 'Eastern Wall' and liberated most of Ukraine east of the river.",
    wiki: "Battle of the Dnieper"
  },
  {
    id: "northcape", title: "Battle of the North Cape", type: "naval", theater: "atlantic",
    start: "1943-12-26", end: "1943-12-27", at: [28.0, 72.3], place: "Off the North Cape, Norway",
    summary: "The battleship Scharnhorst sortied against an Arctic convoy and was trapped and sunk by a British force led by HMS Duke of York.",
    casualties: "Scharnhorst: 1,932 killed, 36 survivors.",
    why: "It ended the threat from German heavy ships to the Arctic convoys.",
    wiki: "Battle of the North Cape"
  },
  {
    id: "cassino", title: "Battle of Monte Cassino", type: "battle", theater: "italy",
    start: "1944-01-17", end: "1944-05-18", at: [13.81, 41.49], place: "Cassino, Italy",
    summary: "Four battles against the Gustav Line, which was anchored on the mountain crowned by the ancient abbey. Polish troops finally took the ruins in May.",
    casualties: "Allies: about 55,000 casualties. Germany: about 20,000.",
    why: "Breaking the Gustav Line opened the road to Rome.",
    wiki: "Battle of Monte Cassino"
  },
  {
    id: "anzio", title: "Anzio landings", type: "battle", theater: "italy",
    start: "1944-01-22", end: "1944-06-05", at: [12.62, 41.45], place: "Anzio, Italy",
    summary: "A landing behind the Gustav Line was meant to outflank it. The Germans contained it, and the beachhead held out under shellfire for four months.",
    casualties: "Allies: about 43,000 casualties, including 7,000 killed. Germany: about 40,000.",
    why: "Churchill hoped for 'a wildcat' and got 'a stranded whale'. The breakout came only when Cassino fell.",
    wiki: "Battle of Anzio"
  },
  {
    id: "bigweek", title: "Big Week", type: "bombing", theater: "west",
    start: "1944-02-20", end: "1944-02-25", at: [12.37, 51.34], place: "Leipzig and German aircraft plants",
    summary: "American and British bombers attacked the German aircraft industry around the clock, escorted deep into Germany by long-range fighters.",
    casualties: "About 2,600 Allied aircrew killed, missing or captured; heavy Luftwaffe fighter and pilot losses.",
    why: "It began the destruction of the Luftwaffe that gave the Allies command of the air over Normandy.",
    wiki: "Big Week"
  },
  {
    id: "dday", title: "D-Day: the Normandy landings", type: "battle", theater: "west",
    start: "1944-06-06", end: "1944-08-30", at: [-0.88, 49.37], place: "Normandy, France",
    summary: "The largest seaborne invasion in history put 156,000 troops ashore on five beaches on the first day. The Normandy campaign ended with the Falaise pocket and the liberation of Paris.",
    casualties: "D-Day: about 10,000 Allied casualties, including about 4,400 killed. Campaign: about 226,000 Allied and 400,000+ German casualties.",
    why: "It opened the second front in the West that Stalin had demanded since 1941.",
    wiki: "Normandy landings"
  },
  {
    id: "vweapons", title: "V-1 and V-2 attacks", type: "bombing", theater: "west",
    start: "1944-06-13", end: "1945-03-29", at: [4.4, 51.22], place: "London and Antwerp",
    summary: "Germany launched thousands of V-1 flying bombs and V-2 ballistic missiles, first at London and later mainly at the port of Antwerp.",
    casualties: "About 9,000 killed in Britain and around 3,500 civilians in Belgium. Thousands of forced labourers died building them.",
    why: "They came too late to change the war, but the V-2 became the ancestor of every ballistic missile and space rocket.",
    wiki: "V-1 flying bomb"
  },
  {
    id: "bagration", title: "Operation Bagration", type: "battle", theater: "east",
    start: "1944-06-22", end: "1944-08-19", at: [27.56, 53.9], place: "Belarus",
    summary: "Three years to the day after Barbarossa, the Red Army attacked Army Group Centre in Belarus and advanced 600 km to the Vistula and the borders of East Prussia.",
    casualties: "USSR: about 770,000 casualties, including 180,000 killed. Germany: about 400,000.",
    why: "It was Germany's worst defeat of the war; Army Group Centre was effectively destroyed.",
    wiki: "Operation Bagration"
  },
  {
    id: "paris", title: "Liberation of Paris", type: "milestone", theater: "west",
    start: "1944-08-19", end: "1944-08-25", at: [2.35, 48.86], place: "Paris",
    summary: "The Resistance rose in Paris as Allied armies approached. The garrison commander ignored Hitler's order to destroy the city and surrendered to General Leclerc's French 2nd Armoured Division.",
    casualties: "About 1,500 Resistance fighters and civilians killed.",
    why: "De Gaulle's entry restored a French government and France's place among the Allies.",
    wiki: "Liberation of Paris"
  },
  {
    id: "dragoon", title: "Operation Dragoon", type: "battle", theater: "west",
    start: "1944-08-15", end: "1944-09-14", at: [6.64, 43.27], place: "Provence, France",
    summary: "American and French troops landed on the Riviera and drove up the Rhône valley, linking with Patton's army near Dijon in mid-September.",
    casualties: "Allies: about 17,000 casualties. Germany: about 7,000 killed and 130,000 captured.",
    why: "The ports of Marseille and Toulon became a main supply route for the Allied armies in France.",
    wiki: "Operation Dragoon"
  },
  {
    id: "marketgarden", title: "Operation Market Garden", type: "battle", theater: "west",
    start: "1944-09-17", end: "1944-09-25", at: [5.91, 51.98], place: "Arnhem, Netherlands",
    summary: "Airborne divisions were dropped to seize a chain of bridges to the Rhine. The bridge at Arnhem, 'a bridge too far', was not held, and the British 1st Airborne Division was destroyed.",
    casualties: "Allies: about 15,000–17,000 casualties. Germany: about 3,300–13,000.",
    why: "Its failure ended hopes of finishing the war in 1944 and left much of the Netherlands to the 'Hunger Winter'.",
    wiki: "Operation Market Garden"
  },
  {
    id: "aachen", title: "Battle of Aachen", type: "battle", theater: "west",
    start: "1944-10-02", end: "1944-10-21", at: [6.08, 50.78], place: "Aachen, Germany",
    summary: "American troops fought house to house for the first German city to fall to the Western Allies.",
    casualties: "US: about 5,000 casualties. Germany: about 5,000 casualties and 5,600 captured.",
    why: "It showed that Germans would fight hard for their own soil, a warning of the costly winter ahead.",
    wiki: "Battle of Aachen"
  },
  {
    id: "bulge", title: "Battle of the Bulge", type: "battle", theater: "west",
    start: "1944-12-16", end: "1945-01-25", at: [5.72, 50.0], place: "Ardennes, Belgium",
    summary: "Hitler's surprise winter offensive through the Ardennes aimed at Antwerp. It drove a 'bulge' into American lines, but Bastogne held and clearing skies let Allied air power return.",
    casualties: "US: about 89,000 casualties, including 19,000 killed. Germany: about 67,000–100,000.",
    why: "Hitler's last gamble in the West used up his final reserves of men, tanks and fuel.",
    wiki: "Battle of the Bulge"
  },
  {
    id: "vistulaoder", title: "Vistula–Oder Offensive", type: "battle", theater: "east",
    start: "1945-01-12", end: "1945-02-02", at: [19.0, 52.0], place: "Poland",
    summary: "Soviet fronts broke out of their Vistula bridgeheads and advanced about 500 km in three weeks, liberating Warsaw and Kraków and reaching the Oder 70 km from Berlin.",
    casualties: "USSR: about 194,000 casualties. Germany: very heavy, including about 150,000 captured.",
    why: "It brought the Red Army within striking distance of Berlin.",
    wiki: "Vistula–Oder offensive"
  },
  {
    id: "gustloff", title: "Sinking of the Wilhelm Gustloff", type: "naval", theater: "east",
    start: "1945-01-30", end: "1945-01-31", at: [17.41, 55.07], place: "Baltic Sea, off Pomerania",
    summary: "A Soviet submarine torpedoed the overcrowded liner, which was carrying refugees and military personnel west from Gotenhafen during the evacuation of East Prussia.",
    casualties: "Over 9,000 people killed, the largest loss of life in a single ship sinking.",
    why: "The worst moment of Operation Hannibal, the sea evacuation that carried about 800,000 civilians west.",
    wiki: "MV Wilhelm Gustloff"
  },
  {
    id: "yalta", title: "Yalta Conference", type: "milestone", theater: "east",
    start: "1945-02-04", end: "1945-02-11", at: [34.14, 44.47], place: "Yalta, Crimea",
    summary: "Roosevelt, Churchill and Stalin agreed on Germany's occupation zones, Poland's new borders, the founding of the United Nations, and Soviet entry into the war against Japan.",
    casualties: null,
    why: "It set the shape of postwar Europe and, for many, the start of its division.",
    wiki: "Yalta Conference"
  },
  {
    id: "dresden", title: "Bombing of Dresden", type: "bombing", theater: "west",
    start: "1945-02-13", end: "1945-02-15", at: [13.74, 51.05], place: "Dresden, Germany",
    summary: "British and American raids on the city, a transport hub crowded with refugees, created a firestorm that destroyed the historic centre.",
    casualties: "Up to 25,000 people killed (Dresden Historians' Commission, 2010).",
    why: "It became the enduring focus of the moral debate over area bombing.",
    wiki: "Bombing of Dresden"
  },
  {
    id: "remagen", title: "Bridge at Remagen", type: "battle", theater: "west",
    start: "1945-03-07", end: "1945-03-17", at: [7.25, 50.58], place: "Remagen, Germany",
    summary: "American troops captured the Ludendorff railway bridge intact after German demolition charges failed. It collapsed ten days later.",
    casualties: null,
    why: "It gave the Allies their first bridgehead across the Rhine.",
    wiki: "Battle of Remagen"
  },
  {
    id: "elbe", title: "Elbe Day", type: "milestone", theater: "west",
    start: "1945-04-25", end: "1945-04-26", at: [13.0, 51.56], place: "Torgau, Germany",
    summary: "American and Soviet troops met on the Elbe at Torgau.",
    casualties: null,
    why: "Germany was cut in two.",
    wiki: "Elbe Day"
  },
  {
    id: "berlin", title: "Battle of Berlin", type: "battle", theater: "east",
    start: "1945-04-16", end: "1945-05-02", at: [13.4, 52.52], place: "Berlin",
    summary: "Soviet armies broke through on the Seelow Heights, encircled Berlin and fought to the Reichstag. Hitler killed himself on 30 April; the garrison surrendered on 2 May.",
    casualties: "USSR: about 81,000 killed or missing and 280,000 wounded. Germany: about 92,000–100,000 soldiers and some 22,000 civilians killed.",
    why: "The fall of the capital ended the Third Reich.",
    wiki: "Battle of Berlin"
  },
  {
    id: "vedaye", title: "VE Day", type: "milestone", theater: "west",
    start: "1945-05-08", end: "1945-05-09", at: [13.53, 52.48], place: "Reims and Berlin-Karlshorst",
    summary: "Germany signed an unconditional surrender at Reims on 7 May and again in Berlin late on 8 May, which was already 9 May in Moscow.",
    casualties: "The war in Europe killed roughly 40 million people, more than half of them civilians.",
    why: "The war in Europe was over.",
    wiki: "Victory in Europe Day"
  }
];
