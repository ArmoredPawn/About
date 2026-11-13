// Provinces of the 50 playable countries. Each country's land is split between its provinces by the map
// build (nearest seed point), so the seed is a real city or field near the province's middle.
//
// Each row: key, name, lat, lon, population M, share of national GDP (any scale), terrain, resources, flags
//   resources: "oil:7.2/8.5 gas:330" means producing 7.2 now, with 8.5 possible after development
//   flags: C capital, T made only of whole territories (see TERRITORIES), not a share of the mainland
//
// Resource units (yearly rates, close to real 2024-25 output):
//   oil  million barrels a day     gas    billion cubic metres     coal  million tonnes
//   iron million tonnes of ore     food   million tonnes of grain and oilseeds
//   rare thousand tonnes of rare-earth oxides                       uran  thousand tonnes of uranium
//   metal million tonnes copper-equivalent (copper, lithium, nickel, cobalt)
//   chip share of world advanced semiconductor output (world = 100)

export const RESOURCES = ['oil', 'gas', 'coal', 'iron', 'food', 'rare', 'uran', 'metal', 'chip'];

export const RESOURCE_INFO = {
  oil: { name: 'Oil', unit: 'mb/d', value: 27, icon: 'oil' },
  gas: { name: 'Natural gas', unit: 'bcm', value: 0.35, icon: 'gas' },
  coal: { name: 'Coal', unit: 'Mt', value: 0.12, icon: 'coal' },
  iron: { name: 'Iron ore', unit: 'Mt', value: 0.1, icon: 'iron' },
  food: { name: 'Grain', unit: 'Mt', value: 0.3, icon: 'food' },
  rare: { name: 'Rare earths', unit: 'kt', value: 0.05, icon: 'rare' },
  uran: { name: 'Uranium', unit: 'kt', value: 0.18, icon: 'uran' },
  metal: { name: 'Critical metals', unit: 'Mt', value: 9, icon: 'metal' },
  chip: { name: 'Semiconductors', unit: '% world', value: 6, icon: 'chip' },
};

export const TERRAIN = {
  plains: { name: 'Plains', defend: 1.0, move: 1, armor: 1.0 },
  hills: { name: 'Hills', defend: 1.25, move: 1.3, armor: 0.85 },
  forest: { name: 'Forest', defend: 1.3, move: 1.4, armor: 0.75 },
  mountain: { name: 'Mountains', defend: 1.8, move: 2, armor: 0.55 },
  desert: { name: 'Desert', defend: 1.0, move: 1.3, armor: 1.0 },
  jungle: { name: 'Jungle', defend: 1.6, move: 2, armor: 0.5 },
  marsh: { name: 'Marsh', defend: 1.35, move: 1.6, armor: 0.6 },
  urban: { name: 'Urban', defend: 1.6, move: 1, armor: 0.6 },
  arctic: { name: 'Arctic', defend: 1.4, move: 2, armor: 0.7 },
};

const R = {
  usa: [
    ['ne', 'New England & New York', 41.9, -73.6, 36, 15, 'urban', 'food:5'],
    ['ma', 'Mid-Atlantic (Washington, D.C.)', 38.9, -77.3, 32, 11, 'plains', 'food:10', 'C'],
    ['ov', 'Ohio Valley & Appalachia (Pittsburgh)', 39.6, -81.4, 26, 6, 'hills', 'coal:170/220 gas:330/400'],
    ['gl', 'Great Lakes (Chicago, Detroit)', 42.3, -86.6, 47, 13, 'plains', 'food:160 iron:44/60'],
    ['se', 'Southeast (Atlanta, Miami)', 31.5, -83.5, 62, 14, 'plains', 'food:30'],
    ['tx', 'Texas & Gulf Coast (Houston)', 30.8, -97.6, 38, 12, 'plains', 'oil:7.2/8.5 gas:330/380 chip:2 food:15'],
    ['pl', 'Great Plains (Kansas City, Bakken)', 41.8, -98.6, 14, 4, 'plains', 'food:250 oil:1.4/1.8 gas:80'],
    ['mt', 'Rocky Mountains (Denver, Wyoming)', 41.5, -107.5, 12, 3.5, 'mountain', 'coal:320/400 oil:1.2/1.5 gas:140 uran:0.5/3 metal:0.3'],
    ['sw', 'Southwest (Phoenix, Nevada)', 34.0, -112.5, 13, 3.5, 'desert', 'metal:1.0/1.6 rare:45/60 chip:3/6'],
    ['ca', 'California (Los Angeles, Silicon Valley)', 36.5, -119.8, 39, 14.5, 'plains', 'food:30 oil:0.3 chip:2'],
    ['nw', 'Pacific Northwest (Seattle)', 46.5, -120.6, 15, 4.5, 'forest', 'food:25 chip:1'],
    ['ak', 'Alaska (Anchorage)', 63.5, -150, 0.7, 0.3, 'arctic', 'oil:0.4/1.2 gas:10/90 metal:0.2/0.5'],
    ['hi', 'Hawaii (Pearl Harbor)', 20.8, -157, 1.4, 0.4, 'jungle', ''],
    ['pr', 'Puerto Rico', 18.2, -66.5, 3.2, 0.4, 'jungle', '', 'T'],
    ['gu', 'Guam & the Marianas', 13.45, 144.8, 0.2, 0.03, 'jungle', '', 'T'],
  ],
  chn: [
    ['bj', 'North China Plain (Beijing)', 39.9, 116.4, 110, 9, 'plains', 'coal:300 food:60', 'C'],
    ['hb', 'Hebei & Shandong (Tianjin, Qingdao)', 36.8, 118.0, 180, 13, 'plains', 'food:120 oil:1.2 iron:100'],
    ['sx', 'Shanxi (Taiyuan)', 37.6, 112.3, 35, 2.5, 'hills', 'coal:1400 iron:30'],
    ['im', 'Inner Mongolia (Baotou, Ordos)', 42.0, 112.0, 24, 2.3, 'desert', 'coal:1200 rare:230/300 gas:50 iron:40'],
    ['ne', 'Manchuria (Shenyang, Harbin, Daqing)', 44.5, 126.0, 98, 5, 'plains', 'food:140 oil:0.8 coal:100 iron:50'],
    ['sh', 'Yangtze Delta (Shanghai)', 31.3, 120.5, 170, 22, 'urban', 'chip:5/10 food:50'],
    ['gd', 'Guangdong & Hong Kong (Shenzhen)', 23.0, 113.5, 135, 14, 'urban', 'chip:3/6 oil:0.4'],
    ['cn', 'Central China (Wuhan)', 30.0, 113.0, 230, 13, 'plains', 'food:180 rare:20'],
    ['fj', 'Fujian (Xiamen)', 25.8, 118.0, 45, 5, 'hills', ''],
    ['sc', 'Sichuan & Chongqing (Chengdu)', 30.3, 104.5, 115, 8, 'hills', 'gas:70/120 food:60 iron:30'],
    ['yn', 'Yunnan & Guangxi (Kunming)', 24.5, 105.0, 100, 5, 'mountain', 'metal:0.6 rare:20 food:40'],
    ['nw', 'Northwest (Xi\'an, Lanzhou)', 36.0, 106.5, 75, 4, 'hills', 'coal:700 oil:0.7 gas:50 food:30'],
    ['xj', 'Xinjiang (Urumqi)', 42.0, 86.0, 26, 1.5, 'desert', 'oil:0.6 gas:40/80 coal:300 uran:1 metal:0.3 food:20'],
    ['xz', 'Tibet & Qinghai (Lhasa)', 32.5, 92.0, 10, 0.4, 'mountain', 'metal:0.4/1.5 uran:0.7'],
    ['hn', 'Hainan (Yulin naval base)', 19.2, 109.7, 10, 0.8, 'jungle', ''],
  ],
  deu: [
    ['be', 'Berlin & Brandenburg', 52.5, 13.5, 6.5, 6, 'plains', 'food:5', 'C'],
    ['sx', 'Saxony (Dresden, Leipzig)', 51.1, 13.0, 8, 7, 'hills', 'coal:40 chip:2/4 food:4'],
    ['nw', 'North Rhine-Westphalia (Ruhr)', 51.4, 7.2, 18, 21, 'urban', 'coal:55'],
    ['no', 'Northern Germany (Hamburg)', 53.5, 9.8, 16, 14, 'plains', 'gas:4 food:12'],
    ['he', 'Hesse & Rhineland (Frankfurt)', 50.0, 8.3, 14, 15, 'hills', ''],
    ['bw', 'Baden-Württemberg (Stuttgart)', 48.6, 9.2, 11, 15, 'hills', 'food:6'],
    ['by', 'Bavaria (Munich)', 48.7, 11.8, 13.3, 18, 'hills', 'food:15'],
  ],
  jpn: [
    ['kn', 'Kanto (Tokyo)', 35.9, 139.6, 43, 40, 'urban', 'chip:1 food:1.5', 'C'],
    ['ks', 'Kansai (Osaka, Kyoto)', 34.8, 135.6, 22, 17, 'urban', ''],
    ['ch', 'Chubu (Nagoya)', 35.8, 137.4, 21, 18, 'mountain', 'food:1.5'],
    ['th', 'Tohoku (Sendai)', 39.2, 140.8, 8.5, 6, 'mountain', 'food:3'],
    ['hk', 'Hokkaido (Sapporo)', 43.3, 142.7, 5, 3.5, 'forest', 'food:2'],
    ['cg', 'Chugoku & Shikoku (Hiroshima)', 34.2, 132.9, 11, 8, 'mountain', ''],
    ['ky', 'Kyushu & Okinawa (Fukuoka)', 32.7, 130.8, 14, 9, 'mountain', 'chip:3/5 food:1'],
  ],
  ind: [
    ['dl', 'Delhi & Punjab', 29.6, 76.3, 110, 10, 'plains', 'food:60', 'C'],
    ['up', 'Uttar Pradesh (Lucknow)', 26.8, 80.9, 240, 9, 'plains', 'food:70'],
    ['bh', 'Bihar & Bengal (Kolkata)', 24.6, 87.2, 230, 8, 'plains', 'food:50'],
    ['jh', 'Jharkhand & Odisha (Mineral Belt)', 21.6, 85.0, 85, 4, 'hills', 'coal:500/650 iron:200/260 rare:2 uran:0.5 metal:0.1'],
    ['mh', 'Maharashtra (Mumbai)', 19.4, 75.3, 130, 14, 'hills', 'oil:0.25 food:20'],
    ['gj', 'Gujarat & South Rajasthan (Ahmedabad, Jamnagar)', 23.0, 72.4, 142, 12.6, 'plains', 'oil:0.2/0.3 gas:15 food:30 metal:0.1'],
    ['th', 'Thar Desert (Jaisalmer, Jodhpur)', 26.8, 71.3, 8, 0.6, 'desert', 'oil:0.1'],
    ['mp', 'Central India (Bhopal, Chhattisgarh)', 22.6, 79.5, 115, 5, 'forest', 'coal:450/550 iron:40 food:40'],
    ['ka', 'Karnataka & Telangana (Bangalore, Hyderabad)', 15.8, 77.4, 105, 12, 'hills', 'iron:30 chip:0.3/2 food:20 coal:50'],
    ['tn', 'Tamil Nadu & Kerala (Chennai)', 10.8, 78.0, 115, 11, 'plains', 'rare:1 food:15'],
    ['ap', 'Andhra Pradesh (Visakhapatnam)', 16.3, 80.7, 55, 5, 'plains', 'gas:15 food:15'],
    ['as', 'Northeast (Assam)', 26.2, 92.8, 50, 1.5, 'jungle', 'oil:0.05 gas:5 food:15'],
    ['jk', 'Kashmir & the Himalaya', 34.0, 76.5, 25, 1.2, 'mountain', ''],
  ],
  gbr: [
    ['ln', 'London & the South East', 51.4, -0.4, 19, 40, 'urban', '', 'C'],
    ['sw', 'South West (Bristol, Plymouth)', 50.9, -3.5, 6, 7, 'hills', 'food:3'],
    ['md', 'Midlands (Birmingham)', 52.6, -1.5, 11, 13, 'plains', 'food:8 gas:4'],
    ['nn', 'North of England (Manchester, Leeds)', 54.0, -1.9, 15.5, 17, 'hills', 'gas:3 food:4'],
    ['sc', 'Scotland (Edinburgh, North Sea oil)', 56.9, -4.2, 5.5, 7.5, 'mountain', 'oil:0.6/0.8 gas:25 food:4'],
    ['wa', 'Wales (Cardiff)', 52.2, -3.7, 3.1, 2.6, 'mountain', 'coal:1'],
    ['ni', 'Northern Ireland (Belfast)', 54.6, -6.7, 1.9, 1.8, 'hills', 'food:1'],
    ['fk', 'Falklands & South Atlantic', -51.7, -59.0, 0.01, 0.01, 'arctic', 'oil:0/0.2', 'T'],
    ['os', 'Overseas Territories (Bermuda, Diego Garcia)', 32.3, -64.8, 0.3, 0.3, 'jungle', '', 'T'],
  ],
  fra: [
    ['pa', 'Île-de-France (Paris)', 48.8, 2.4, 12.3, 31, 'urban', '', 'C'],
    ['no', 'Northern France (Lille, Normandy)', 49.8, 1.6, 10, 11, 'plains', 'food:22'],
    ['es', 'Grand Est (Strasbourg)', 48.6, 6.0, 5.6, 7, 'hills', 'food:10'],
    ['ar', 'Auvergne-Rhône-Alpes (Lyon, Grenoble)', 45.5, 4.9, 8, 12, 'mountain', 'chip:1/2'],
    ['pr', 'Provence & Riviera (Marseille, Toulon)', 43.7, 6.0, 5.2, 7, 'hills', ''],
    ['oc', 'Occitanie (Toulouse)', 43.8, 1.8, 6, 7, 'hills', 'food:6'],
    ['aq', 'Nouvelle-Aquitaine (Bordeaux)', 45.0, 0.2, 6.1, 7, 'plains', 'food:12'],
    ['bt', 'Brittany & Loire (Nantes, Brest)', 47.8, -2.3, 7.2, 8, 'plains', 'food:12'],
    ['cb', 'Burgundy & Centre (Dijon, Orléans)', 47.3, 3.3, 5, 5, 'plains', 'food:8'],
    ['ov', 'Overseas France (Guiana, New Caledonia)', 4.0, -53.0, 2.8, 2, 'jungle', 'metal:0.2/0.4'],
  ],
  ita: [
    ['rm', 'Lazio (Rome)', 41.9, 12.7, 5.7, 11, 'hills', '', 'C'],
    ['lo', 'Lombardy (Milan)', 45.6, 9.6, 10, 22, 'plains', 'food:4'],
    ['pi', 'Piedmont & Liguria (Turin, Genoa)', 44.9, 7.9, 5.8, 9, 'mountain', 'food:2'],
    ['ve', 'Veneto & Friuli (Venice)', 45.8, 12.3, 6.1, 12, 'plains', 'food:4 gas:1'],
    ['em', 'Emilia-Romagna & Tuscany (Bologna, Florence)', 43.9, 11.4, 8.1, 15, 'hills', 'food:4'],
    ['ca', 'Campania & the South (Naples, Taranto)', 40.9, 15.6, 13, 13, 'hills', 'oil:0.08 food:2'],
    ['si', 'Sicily (Palermo)', 37.6, 14.1, 4.8, 4.5, 'hills', 'gas:1 food:1'],
    ['sa', 'Sardinia', 40.1, 9.0, 1.6, 2, 'hills', ''],
  ],
  can: [
    ['on', 'Ontario (Toronto, Ottawa)', 45.5, -79.5, 16, 38, 'forest', 'metal:0.3 food:10', 'C'],
    ['qc', 'Quebec (Montreal)', 47.5, -71.5, 9, 19, 'forest', 'iron:30 metal:0.1 food:5'],
    ['ab', 'Alberta (Calgary, Oil Sands)', 54.5, -114.5, 4.9, 15, 'plains', 'oil:4.2/5.5 gas:150 coal:15'],
    ['bc', 'British Columbia (Vancouver)', 51.5, -123.5, 5.7, 13, 'mountain', 'gas:30/80 coal:25 metal:0.3'],
    ['pr', 'Prairies (Winnipeg, Saskatchewan)', 51.5, -102.0, 2.7, 7, 'plains', 'food:60 oil:0.5 uran:7/9'],
    ['at', 'Atlantic Canada (Halifax, Labrador)', 48.0, -61.5, 2.5, 5, 'forest', 'iron:30 oil:0.25 metal:0.1'],
    ['no', 'Northern Territories (Yukon, Nunavut)', 66.0, -110.0, 0.13, 0.8, 'arctic', 'metal:0.2/0.6 rare:0/5 gas:0/50 oil:0/0.5'],
  ],
  bra: [
    ['sp', 'São Paulo', -22.5, -48.5, 46, 31, 'urban', 'food:25'],
    ['rj', 'Rio de Janeiro & Espírito Santo (Pre-salt oil)', -22.0, -42.3, 21, 12, 'hills', 'oil:3.0/4.5 gas:20'],
    ['df', 'Brasília & Goiás', -16.0, -48.5, 11, 6, 'plains', 'food:30', 'C'],
    ['mg', 'Minas Gerais (Belo Horizonte)', -18.8, -44.5, 21, 9, 'hills', 'iron:200/250 metal:0.1/0.5 rare:0/10'],
    ['so', 'South (Porto Alegre, Curitiba)', -27.5, -51.5, 30, 17, 'plains', 'food:70'],
    ['mt', 'Mato Grosso (Cerrado farmland)', -13.0, -56.0, 7, 4, 'plains', 'food:140/180'],
    ['ne', 'Northeast (Salvador, Recife)', -9.0, -39.5, 55, 14, 'hills', 'oil:0.1 gas:5 food:15'],
    ['am', 'Amazonas (Manaus)', -4.5, -63.0, 9, 2, 'jungle', 'gas:0/10 metal:0.1'],
    ['pa', 'Pará (Carajás iron)', -5.0, -51.5, 9, 3, 'jungle', 'iron:210/260 metal:0.3 food:10'],
  ],
  rus: [
    ['mo', 'Moscow & Central Russia', 55.6, 37.6, 40, 33, 'plains', 'food:20', 'C'],
    ['sp', 'Northwest (St Petersburg)', 59.6, 31.5, 14, 10, 'forest', 'metal:0.1 rare:2/10'],
    ['kl', 'Kaliningrad', 54.7, 21.0, 1, 0.8, 'plains', ''],
    ['nf', 'Far North (Murmansk, Komi)', 66.5, 45.0, 3.5, 3, 'arctic', 'oil:0.4 metal:0.1 coal:10'],
    ['bk', 'Black Earth (Voronezh, Kursk)', 51.5, 38.5, 7, 3, 'plains', 'iron:60/70 food:25'],
    ['vo', 'Volga (Kazan, Samara)', 54.5, 49.5, 28, 12, 'plains', 'oil:1.8 food:30'],
    ['so', 'South Russia (Rostov, Krasnodar, Volgograd)', 47.3, 41.5, 17, 6, 'plains', 'food:60 gas:10 oil:0.1'],
    ['ca', 'North Caucasus (Grozny, Maykop oil)', 43.4, 45.0, 10, 2, 'mountain', 'oil:0.2/0.4 gas:15'],
    ['ur', 'Urals (Yekaterinburg, Chelyabinsk)', 56.5, 60.0, 12, 7, 'hills', 'iron:30 metal:0.3 coal:10'],
    ['ws', 'West Siberia (Tyumen oil, Yamal gas)', 62.0, 73.0, 15, 15, 'marsh', 'oil:6.0/7 gas:520/580'],
    ['kz', 'Kuzbass (Novosibirsk, Kemerovo)', 54.5, 85.0, 9, 3, 'forest', 'coal:230/260 iron:10 food:10'],
    ['es', 'East Siberia (Krasnoyarsk, Norilsk, Irkutsk)', 60.0, 100.0, 7, 4, 'arctic', 'oil:0.9 gas:20/60 metal:1.4 coal:70'],
    ['fe', 'Far East (Vladivostok, Sakhalin)', 49.0, 135.0, 6, 3.5, 'forest', 'oil:0.3 gas:30/60 coal:80 uran:2.5 rare:0/5'],
    ['yk', 'Yakutia & Chukotka', 65.0, 135.0, 1.1, 1.2, 'arctic', 'metal:0.1 coal:20 gas:10/40'],
  ],
  esp: [
    ['md', 'Madrid & Castile-La Mancha', 40.2, -3.7, 9, 22, 'plains', 'food:7', 'C'],
    ['ct', 'Catalonia (Barcelona)', 41.8, 1.5, 8, 19, 'hills', ''],
    ['an', 'Andalusia (Seville, Rota)', 37.4, -4.8, 8.6, 13, 'hills', 'food:4 metal:0.1'],
    ['va', 'Valencia & Murcia', 39.0, -0.8, 7, 12, 'plains', ''],
    ['nw', 'Galicia & Asturias (A Coruña)', 42.8, -7.0, 4.4, 7, 'hills', ''],
    ['ba', 'Basque Country & Ebro (Bilbao, Zaragoza)', 42.4, -2.0, 5.2, 13, 'mountain', 'food:4'],
    ['cl', 'Castile and León (Valladolid)', 41.7, -5.0, 2.4, 5, 'plains', 'food:5'],
    ['is', 'Canary & Balearic Islands', 28.3, -15.8, 3.4, 5, 'hills', ''],
  ],
  kor: [
    ['se', 'Seoul Capital Area', 37.5, 127.0, 26, 52, 'urban', 'chip:10/14', 'C'],
    ['gw', 'Gangwon (eastern DMZ)', 37.7, 128.4, 1.5, 2.5, 'mountain', ''],
    ['cc', 'Chungcheong (Daejeon)', 36.5, 127.1, 5.5, 12, 'hills', 'chip:3 food:2'],
    ['gs', 'Gyeongsang (Busan, Ulsan, Pohang)', 35.6, 128.8, 13, 25, 'mountain', ''],
    ['jl', 'Jeolla & Jeju (Gwangju)', 35.0, 126.9, 5.5, 9, 'plains', 'food:3'],
  ],
  aus: [
    ['ns', 'New South Wales (Sydney, Canberra)', -33.0, 148.0, 8.4, 31, 'hills', 'coal:200/250 food:12', 'C'],
    ['vc', 'Victoria & Tasmania (Melbourne)', -37.2, 144.5, 7.6, 23, 'plains', 'gas:15 oil:0.05 food:10'],
    ['ql', 'Queensland (Brisbane, Bowen Basin)', -22.0, 145.0, 5.6, 18, 'plains', 'coal:240/280 gas:40 metal:0.4 food:12'],
    ['wa', 'Western Australia (Perth, Pilbara)', -26.5, 117.5, 3, 17, 'desert', 'iron:920/1000 gas:90/120 oil:0.25 metal:1.8/3 rare:13/50 food:15'],
    ['sa', 'South Australia (Adelaide, Olympic Dam)', -31.0, 136.0, 1.9, 6, 'desert', 'metal:0.6/1 uran:4/7 food:10'],
    ['nt', 'Northern Territory (Darwin)', -15.0, 132.5, 0.2, 2, 'jungle', 'gas:10/40 uran:1/2 metal:0.2 rare:0/10'],
    ['ob', 'The Outback (Great Sandy, Gibson & Simpson deserts)', -24.0, 127.5, 0.05, 0.3, 'desert', ''],
  ],
  mex: [
    ['mx', 'Mexico City & the Centre', 19.4, -99.1, 30, 30, 'mountain', 'food:5', 'C'],
    ['bj', 'Bajío (Guadalajara, Querétaro)', 20.8, -102.5, 22, 16, 'hills', 'food:10'],
    ['ne', 'Northeast (Monterrey)', 25.8, -99.8, 12, 14, 'desert', 'gas:15'],
    ['nw', 'Northwest (Sonora, Baja California)', 29.0, -112.0, 11, 11, 'desert', 'metal:0.7/1.2 food:8'],
    ['ch', 'Chihuahua & Durango', 27.5, -105.5, 6, 6, 'desert', 'metal:0.1 food:3'],
    ['gu', 'Gulf Coast (Veracruz, Tabasco)', 19.3, -96.5, 15, 10, 'jungle', 'oil:0.9/1.2 gas:20 food:4'],
    ['so', 'South (Oaxaca, Chiapas)', 16.7, -93.6, 13, 5, 'jungle', 'food:2'],
    ['yu', 'Yucatán (Cancún, Campeche oil)', 20.0, -89.0, 5.5, 5, 'jungle', 'oil:0.6/0.8 gas:5 food:3'],
  ],
  tur: [
    ['is', 'Istanbul & Thrace (the Bosporus)', 41.1, 28.5, 18.5, 32, 'urban', ''],
    ['an', 'Ankara & Central Anatolia', 39.3, 33.0, 13, 15, 'plains', 'food:15 rare:0/5', 'C'],
    ['ag', 'Aegean (Izmir)', 38.4, 28.0, 10.5, 13, 'hills', 'food:5 coal:35'],
    ['me', 'Mediterranean (Antalya, Adana)', 37.0, 32.8, 10, 10, 'mountain', 'food:7 coal:40'],
    ['bs', 'Black Sea (Samsun, Trabzon)', 40.9, 37.0, 8, 5, 'mountain', 'gas:1/10 coal:5'],
    ['se', 'Southeast Anatolia (Diyarbakır, Gaziantep)', 37.6, 39.5, 13, 6, 'hills', 'oil:0.1 food:8'],
    ['ea', 'Eastern Anatolia (Erzurum, Van)', 39.3, 42.2, 6, 2, 'mountain', ''],
  ],
  idn: [
    ['jk', 'Jakarta & West Java', -6.6, 107.0, 60, 30, 'urban', 'food:15', 'C'],
    ['jt', 'Central & East Java (Surabaya)', -7.4, 111.5, 95, 25, 'plains', 'food:30 oil:0.05'],
    ['sm', 'Sumatra (Medan, Palembang)', 0.0, 101.5, 60, 21, 'jungle', 'oil:0.4 gas:15 coal:150 food:25'],
    ['kl', 'Kalimantan (Borneo, Balikpapan)', 0.0, 114.5, 17, 9, 'jungle', 'coal:600/700 oil:0.1 gas:15 food:5'],
    ['sl', 'Sulawesi (Makassar, Morowali nickel)', -2.0, 121.0, 20, 6, 'jungle', 'metal:2.8/4 food:8'],
    ['bn', 'Bali & Nusa Tenggara', -8.6, 118.0, 15, 3, 'hills', 'metal:0.1'],
    ['pp', 'Papua & Maluku (Grasberg)', -4.0, 136.0, 9, 3, 'jungle', 'metal:0.6/0.8 gas:10/25'],
  ],
  nld: [
    ['rd', 'Randstad (Amsterdam, Rotterdam)', 52.2, 4.7, 9, 60, 'urban', '', 'C'],
    ['no', 'North (Groningen gas)', 53.1, 6.5, 1.8, 8, 'marsh', 'gas:15/40 food:1'],
    ['so', 'South (Eindhoven, Brabant)', 51.5, 5.5, 5.5, 24, 'plains', 'chip:0.5 food:1'],
    ['cb', 'Caribbean (Aruba, Curaçao)', 12.2, -69.0, 0.3, 0.4, 'jungle', '', 'T'],
  ],
  sau: [
    ['ry', 'Riyadh & Najd', 24.7, 46.0, 12, 30, 'desert', 'food:2', 'C'],
    ['ep', 'Eastern Province (Dhahran, Ghawar, Abqaiq)', 25.8, 49.6, 5.5, 38, 'desert', 'oil:9.5/12 gas:110'],
    ['hj', 'Hejaz (Jeddah, Mecca)', 22.0, 40.0, 10, 17, 'desert', 'metal:0.1'],
    ['nr', 'Northern Region (Tabuk, NEOM)', 28.5, 38.0, 2.5, 4, 'desert', 'metal:0/0.3 uran:0/0.5'],
    ['so', 'Asir & Jizan (Yemen border)', 18.0, 43.5, 4.5, 4, 'mountain', ''],
    ['eq', 'Rub’ al Khali (the Empty Quarter)', 20.0, 50.5, 0.05, 0.3, 'desert', ''],
  ],
  che: [
    ['zr', 'Zürich & the North', 47.45, 8.7, 3.5, 40, 'urban', ''],
    ['be', 'Bern & Central Switzerland', 46.9, 7.6, 2.5, 25, 'mountain', 'food:1', 'C'],
    ['ge', 'Geneva & Romandy', 46.4, 6.6, 2.1, 25, 'mountain', ''],
    ['ti', 'Ticino & the Alps', 46.4, 9.0, 0.9, 10, 'mountain', ''],
  ],
  pol: [
    ['wa', 'Masovia (Warsaw)', 52.3, 20.8, 5.5, 23, 'plains', 'food:7', 'C'],
    ['si', 'Silesia & Kraków', 50.2, 19.2, 7.8, 20, 'hills', 'coal:90/100'],
    ['wp', 'Greater Poland & Pomerania (Poznań, Gdańsk)', 53.2, 17.0, 8.5, 22, 'plains', 'food:12 gas:3'],
    ['lw', 'Lower Silesia (Wrocław, KGHM copper)', 51.0, 16.0, 5, 14, 'hills', 'metal:0.45 coal:5'],
    ['ea', 'Eastern Poland (Lublin, Suwałki Gap)', 51.8, 23.2, 6, 9, 'forest', 'food:10'],
  ],
  twn: [
    ['tp', 'Taipei & Hsinchu', 24.9, 121.4, 10, 45, 'urban', 'chip:20/25', 'C'],
    ['tc', 'Taichung & Central Taiwan', 24.1, 120.7, 5.6, 20, 'urban', 'chip:12/15 food:1'],
    ['ts', 'Tainan & Kaohsiung', 22.9, 120.3, 6.5, 30, 'urban', 'chip:28/35 food:1'],
    ['ea', 'East Coast (Hualien)', 23.6, 121.4, 0.5, 1, 'mountain', ''],
  ],
  bel: [
    ['br', 'Brussels & Flanders (Antwerp)', 51.0, 4.2, 7.6, 70, 'urban', 'food:2', 'C'],
    ['wl', 'Wallonia (Liège, Ardennes)', 50.3, 5.2, 4.2, 30, 'forest', 'food:1'],
  ],
  arg: [
    ['ba', 'Buenos Aires', -34.8, -59.0, 17, 45, 'urban', 'food:20', 'C'],
    ['pa', 'Pampas (Córdoba, Rosario)', -32.5, -63.0, 10, 22, 'plains', 'food:90/110'],
    ['cu', 'Cuyo (Mendoza, San Juan)', -33.0, -68.5, 3.5, 6, 'mountain', 'oil:0.05 metal:0/0.5'],
    ['nw', 'Northwest (Salta, Lithium Triangle)', -25.0, -65.8, 6, 7, 'mountain', 'metal:0.5/1.5 gas:3 food:10'],
    ['ne', 'Northeast (Chaco, Misiones)', -27.5, -59.0, 4.5, 5, 'plains', 'food:10'],
    ['pt', 'Northern Patagonia (Neuquén, Vaca Muerta)', -39.0, -68.8, 2.4, 13, 'plains', 'oil:0.6/1.4 gas:36/105'],
    ['sp', 'Southern Patagonia (Santa Cruz, Tierra del Fuego)', -49.0, -69.5, 0.6, 2, 'plains', 'oil:0.1 gas:6/10'],
  ],
  swe: [
    ['st', 'Stockholm & Svealand', 59.6, 17.0, 4.6, 45, 'forest', 'food:3', 'C'],
    ['gb', 'Götaland (Gothenburg, Malmö)', 57.2, 13.8, 4.6, 40, 'forest', 'food:3'],
    ['nl', 'Norrland (Kiruna, Luleå)', 65.0, 18.5, 1.4, 15, 'arctic', 'iron:35/40 metal:0.2/0.4 rare:0/10 uran:0/1'],
  ],
  irl: [
    ['du', 'Dublin & Leinster', 53.3, -6.8, 2.9, 70, 'urban', 'chip:0.5', 'C'],
    ['mu', 'Munster & Connacht (Cork, Galway)', 52.6, -8.9, 2.4, 30, 'plains', 'food:2'],
  ],
  isr: [
    ['ta', 'Tel Aviv & the Centre', 32.1, 34.85, 4.3, 55, 'urban', 'chip:0.5'],
    ['je', 'Jerusalem', 31.78, 35.15, 1.3, 10, 'hills', '', 'C'],
    ['nh', 'Haifa & the North (Galilee, Golan)', 32.85, 35.3, 2.3, 20, 'hills', 'gas:25/35'],
    ['ng', 'Negev & the South (Beersheba, Dimona)', 30.8, 34.8, 1.5, 15, 'desert', ''],
  ],
  are: [
    ['ad', 'Abu Dhabi', 23.6, 54.0, 4, 60, 'desert', 'oil:3.2/4.8 gas:50', 'C'],
    ['db', 'Dubai & the Northern Emirates', 25.2, 55.6, 6, 40, 'urban', 'oil:0.1 gas:8'],
  ],
  sgp: [
    ['sg', 'Singapore (Strait of Malacca)', 1.35, 103.82, 6, 100, 'urban', 'chip:1.5', 'C'],
  ],
  tha: [
    ['bk', 'Bangkok & the Central Plains', 13.9, 100.4, 20, 50, 'plains', 'food:12', 'C'],
    ['ea', 'Eastern Seaboard (Rayong, Gulf gas)', 13.0, 101.8, 6, 17, 'plains', 'gas:30 oil:0.2'],
    ['ne', 'Isan (Northeast)', 16.0, 103.5, 22, 10, 'plains', 'food:15'],
    ['nn', 'North (Chiang Mai)', 18.5, 99.5, 11, 8, 'mountain', 'rare:13'],
    ['so', 'South (Phuket, Songkhla)', 8.0, 99.5, 9.5, 12, 'jungle', 'food:4'],
  ],
  aut: [
    ['vi', 'Vienna & Lower Austria', 48.2, 16.0, 3.7, 45, 'urban', 'food:2 gas:0.5', 'C'],
    ['up', 'Upper Austria & Salzburg (Linz)', 47.9, 13.5, 2.1, 25, 'hills', 'food:1'],
    ['al', 'Tyrol & the Alps (Innsbruck)', 47.1, 11.5, 3.3, 30, 'mountain', ''],
  ],
  nor: [
    ['os', 'Oslo & the East', 60.3, 10.6, 2.6, 45, 'forest', 'rare:0/10 food:1', 'C'],
    ['we', 'West Coast (Bergen, Stavanger oil)', 60.6, 6.0, 1.8, 35, 'mountain', 'oil:2.0/2.2 gas:120'],
    ['tr', 'Trøndelag & the North (Narvik, Svalbard)', 66.0, 14.5, 1.2, 20, 'arctic', 'metal:0.05'],
  ],
  phl: [
    ['mn', 'Metro Manila & Central Luzon', 14.8, 120.9, 40, 55, 'urban', 'food:8', 'C'],
    ['nl', 'Northern Luzon (Cagayan)', 17.2, 121.3, 10, 6, 'mountain', 'food:5'],
    ['vi', 'Visayas (Cebu)', 10.8, 123.5, 21, 16, 'jungle', 'food:5'],
    ['mi', 'Mindanao (Davao)', 7.5, 125.0, 27, 17, 'jungle', 'metal:0.6 food:7'],
    ['pw', 'Palawan (West Philippine Sea)', 9.6, 118.5, 1.3, 1, 'jungle', 'gas:3'],
  ],
  vnm: [
    ['hn', 'Hanoi & the Red River Delta', 21.0, 105.8, 23, 30, 'plains', 'food:10 coal:45/50', 'C'],
    ['nb', 'Northern Highlands (Lai Châu rare earths)', 22.2, 103.6, 11, 6, 'mountain', 'rare:0.3/20'],
    ['ct', 'Central Coast (Da Nang, Cam Ranh)', 15.5, 108.0, 20, 12, 'hills', 'food:6'],
    ['hc', 'Ho Chi Minh City & the Southeast', 11.2, 106.8, 22, 38, 'urban', 'oil:0.2 gas:7'],
    ['md', 'Mekong Delta (Cần Thơ)', 9.9, 105.5, 18, 12, 'marsh', 'food:30'],
  ],
  bgd: [
    ['dh', 'Dhaka', 23.8, 90.4, 45, 40, 'urban', 'food:15', 'C'],
    ['ct', 'Chittagong', 22.4, 91.9, 35, 25, 'hills', 'gas:5'],
    ['ra', 'Rajshahi & Rangpur', 24.9, 89.0, 38, 13, 'plains', 'food:25 coal:1'],
    ['kh', 'Khulna & Barisal', 22.6, 89.6, 27, 10, 'marsh', 'food:10'],
    ['sy', 'Sylhet (gas fields)', 24.7, 91.8, 11, 5, 'hills', 'gas:17/22 food:4'],
  ],
  mys: [
    ['kl', 'Kuala Lumpur & Selangor', 3.1, 101.6, 9, 40, 'urban', '', 'C'],
    ['pn', 'Penang & the Northern Peninsula', 5.5, 100.6, 8, 16, 'plains', 'chip:1 food:2'],
    ['jh', 'Johor & the South', 2.0, 103.4, 6, 12, 'jungle', ''],
    ['ec', 'East Coast (Kuantan, Terengganu oil)', 4.5, 102.9, 4.5, 9, 'jungle', 'oil:0.15 gas:15'],
    ['sb', 'Sabah & Sarawak (Borneo)', 3.5, 114.0, 7, 18, 'jungle', 'oil:0.4 gas:60'],
  ],
  dnk: [
    ['cp', 'Copenhagen & Zealand', 55.5, 12.0, 2.4, 50, 'urban', '', 'C'],
    ['jt', 'Jutland & Funen (Aarhus)', 56.0, 9.3, 3.5, 45, 'plains', 'food:9 oil:0.06 gas:2'],
    ['gl', 'Greenland', 72.0, -40.0, 0.06, 0.4, 'arctic', 'rare:0/40 uran:0/2 metal:0/0.3 oil:0/1', 'T'],
  ],
  col: [
    ['bo', 'Bogotá & the Andes', 4.6, -74.1, 16, 32, 'mountain', 'food:2', 'C'],
    ['md', 'Antioquia (Medellín)', 6.8, -75.5, 7, 15, 'mountain', ''],
    ['cr', 'Caribbean Coast (Barranquilla, La Guajira coal)', 10.2, -74.0, 11, 15, 'plains', 'coal:55/70 gas:5'],
    ['pc', 'Pacific & Southwest (Cali)', 3.2, -76.8, 9, 13, 'jungle', 'food:2'],
    ['ll', 'Llanos (Orinoquía oil)', 4.5, -71.0, 2, 9, 'plains', 'oil:0.7/0.9 gas:5 food:1'],
    ['am', 'Amazonía', -0.5, -72.0, 1.5, 1, 'jungle', 'oil:0.05'],
  ],
  zaf: [
    ['gt', 'Gauteng (Johannesburg, Pretoria)', -26.0, 28.1, 16, 34, 'urban', 'metal:0.3', 'C'],
    ['mp', 'Mpumalanga & Limpopo (coal belt)', -24.5, 30.2, 11, 12, 'plains', 'coal:220/250 metal:0.1'],
    ['kn', 'KwaZulu-Natal (Durban)', -28.8, 30.8, 12, 16, 'hills', 'coal:10 food:3'],
    ['wc', 'Western Cape (Cape Town)', -33.4, 19.8, 7.4, 14, 'hills', 'food:3'],
    ['ec', 'Eastern Cape (Gqeberha)', -32.2, 26.5, 7.2, 8, 'hills', 'food:2'],
    ['nc', 'Northern Cape & Free State (Sishen iron)', -29.0, 23.5, 4.5, 10, 'desert', 'iron:60/70 metal:0.2 food:9 uran:0.2 rare:0/5'],
  ],
  rou: [
    ['bu', 'Bucharest & Wallachia (Ploiești oil)', 44.5, 25.8, 6.5, 40, 'plains', 'oil:0.07 food:14', 'C'],
    ['tr', 'Transylvania (Cluj, Brașov)', 46.4, 24.4, 6.5, 30, 'mountain', 'gas:8 food:4'],
    ['mo', 'Moldavia (Iași)', 47.1, 27.0, 4.3, 13, 'hills', 'food:7'],
    ['do', 'Dobruja (Constanța, Black Sea gas)', 44.4, 28.4, 1, 8, 'plains', 'gas:1/8 food:3'],
    ['ba', 'Banat & Oltenia (Timișoara, Craiova)', 45.3, 22.4, 3.5, 12, 'plains', 'coal:15 food:4'],
  ],
  pak: [
    ['is', 'Islamabad & Rawalpindi', 33.5, 73.0, 25, 10, 'hills', '', 'C'],
    ['lh', 'Punjab (Lahore, Faisalabad)', 31.0, 73.0, 105, 45, 'plains', 'food:40'],
    ['kr', 'Karachi & Sindh', 25.5, 68.0, 55, 30, 'desert', 'gas:15 coal:10/40 food:8'],
    ['kp', 'Khyber Pakhtunkhwa (Peshawar)', 34.0, 71.6, 40, 9, 'mountain', 'oil:0.05 gas:3'],
    ['ba', 'Balochistan (Quetta, Gwadar, Reko Diq)', 28.0, 65.0, 15, 4, 'desert', 'gas:12 metal:0.05/0.6'],
    ['gb', 'Gilgit-Baltistan & Azad Kashmir', 35.8, 74.6, 6, 1, 'mountain', ''],
  ],
  cze: [
    ['pr', 'Prague & Central Bohemia', 50.0, 14.6, 2.8, 40, 'urban', 'food:1', 'C'],
    ['wb', 'Western Bohemia (Plzeň, Ústí lignite)', 50.1, 13.0, 2.2, 18, 'hills', 'coal:30 metal:0/0.3'],
    ['mo', 'Moravia (Brno, Ostrava)', 49.4, 17.0, 4.2, 30, 'hills', 'food:4 coal:2'],
    ['sb', 'South Bohemia & Vysočina', 49.2, 14.8, 1.7, 12, 'forest', 'food:2 uran:0.03'],
  ],
  egy: [
    ['ca', 'Cairo & the Nile Delta', 30.4, 31.2, 60, 55, 'urban', 'food:15', 'C'],
    ['al', 'Alexandria & the North Coast', 30.9, 28.8, 7, 10, 'desert', 'oil:0.1'],
    ['sz', 'Suez Canal & Sinai', 30.0, 33.5, 4, 12, 'desert', 'gas:30/40 oil:0.25'],
    ['up', 'Upper Egypt (Luxor, Aswan)', 25.5, 32.6, 25, 12, 'desert', 'food:6'],
    ['wd', 'Western Desert (Siwa)', 26.5, 27.0, 0.5, 3, 'desert', 'oil:0.2 gas:30'],
  ],
  irn: [
    ['th', 'Tehran & Alborz', 35.7, 51.4, 19, 32, 'mountain', '', 'C'],
    ['kh', 'Khuzestan (Ahvaz oil)', 31.3, 48.7, 5, 14, 'plains', 'oil:2.6/3.5 gas:20'],
    ['bu', 'Bushehr & South Pars (Persian Gulf)', 28.3, 52.0, 4, 10, 'desert', 'gas:210/250 oil:0.3'],
    ['hz', 'Hormozgan (Bandar Abbas, Strait of Hormuz)', 27.2, 56.5, 2, 4, 'desert', 'oil:0.1'],
    ['is', 'Isfahan & Yazd (Natanz, Fordow)', 32.7, 51.8, 12, 12, 'desert', 'iron:20 uran:0.02'],
    ['az', 'Azerbaijan & the Northwest (Tabriz)', 37.8, 46.5, 12, 8, 'mountain', 'food:5'],
    ['kr', 'Kermanshah & the Zagros', 34.2, 46.6, 9, 5, 'mountain', 'oil:0.1 food:4'],
    ['km', 'Kerman & Baluchestan (Zahedan, Chabahar)', 29.8, 57.0, 8, 5, 'desert', 'metal:0.3/0.5 iron:50 coal:2'],
    ['ms', 'Mashhad & Khorasan', 36.2, 58.8, 10, 6, 'desert', 'gas:10 food:5 iron:10'],
    ['cs', 'Caspian Coast (Rasht, Mazandaran)', 37.0, 49.8, 7, 4, 'forest', 'food:6'],
    ['ds', 'Dasht-e Kavir & Dasht-e Lut (the eastern deserts)', 33.0, 56.8, 0.4, 0.3, 'desert', ''],
  ],
  chl: [
    ['sa', 'Santiago & Central Chile', -33.8, -70.8, 9, 45, 'mountain', 'metal:1.0 food:2', 'C'],
    ['an', 'Antofagasta & Atacama (copper, lithium)', -23.8, -69.3, 1.5, 18, 'desert', 'metal:4.5/6'],
    ['tp', 'Tarapacá & Arica', -19.8, -69.6, 0.6, 6, 'desert', 'metal:0.6'],
    ['vp', 'Valparaíso & Coquimbo', -30.8, -71.0, 3, 12, 'hills', 'metal:0.4'],
    ['bb', 'Biobío & the South (Concepción)', -38.0, -72.6, 5, 15, 'forest', 'food:1'],
    ['pt', 'Patagonia & Magallanes', -48.0, -73.0, 0.6, 4, 'mountain', 'gas:1'],
  ],
  prt: [
    ['li', 'Lisbon & Alentejo', 38.6, -8.5, 3.6, 45, 'plains', 'metal:0.1 food:1', 'C'],
    ['po', 'Porto & the North', 41.4, -8.1, 4, 35, 'hills', 'metal:0/0.2'],
    ['ce', 'Centre (Coimbra)', 40.1, -7.6, 2.2, 15, 'hills', ''],
    ['is', 'Azores & Madeira', 38.5, -28.0, 0.5, 5, 'hills', ''],
  ],
  fin: [
    ['he', 'Helsinki & Uusimaa', 60.3, 24.8, 1.8, 40, 'urban', '', 'C'],
    ['sw', 'Southwest (Turku, Tampere, Åland)', 61.3, 22.8, 1.6, 25, 'forest', 'food:2'],
    ['ea', 'Eastern Finland (Karelia, Kuopio)', 62.5, 28.8, 1.1, 15, 'forest', 'food:1'],
    ['la', 'Lapland & Oulu', 66.5, 26.0, 1, 20, 'arctic', 'metal:0.1/0.2 uran:0/0.2'],
  ],
  per: [
    ['li', 'Lima & the Coast', -12.1, -76.9, 12, 45, 'desert', 'food:2', 'C'],
    ['no', 'North Coast (Trujillo, Piura)', -7.0, -79.2, 8, 15, 'desert', 'oil:0.03 food:3 metal:0.1'],
    ['so', 'South (Arequipa, Cusco, Camisea gas)', -15.0, -72.0, 6, 18, 'mountain', 'metal:1.6/2 gas:13'],
    ['ce', 'Central Andes (Huancayo, Antamina)', -10.0, -76.5, 5, 10, 'mountain', 'metal:1.1/1.4'],
    ['am', 'Amazonia (Iquitos)', -5.0, -74.5, 3, 5, 'jungle', 'oil:0.01'],
  ],
  kaz: [
    ['as', 'Astana & the North', 51.8, 69.5, 5, 30, 'plains', 'food:15', 'C'],
    ['kr', 'Karaganda & Ekibastuz', 49.0, 75.0, 2, 8, 'plains', 'coal:110 metal:0.3 iron:15'],
    ['al', 'Almaty & the South', 43.6, 77.0, 6, 25, 'mountain', 'food:3'],
    ['at', 'Atyrau & the Caspian (Tengiz, Kashagan)', 47.5, 53.0, 2.5, 25, 'desert', 'oil:1.7/2.0 gas:20'],
    ['sk', 'South Kazakhstan (Shymkent, uranium fields)', 43.8, 68.0, 4.5, 10, 'desert', 'uran:23/26 oil:0.2 food:2'],
    ['ek', 'East Kazakhstan (Öskemen)', 49.6, 82.5, 1.4, 5, 'mountain', 'metal:0.3'],
  ],
  irq: [
    ['bg', 'Baghdad', 33.3, 44.4, 9, 30, 'urban', 'food:2', 'C'],
    ['bs', 'Basra (Rumaila oil, Persian Gulf)', 30.6, 47.4, 4.5, 30, 'desert', 'oil:3.3/4.5 gas:7/25'],
    ['kk', 'Kurdistan (Erbil, Kirkuk oil)', 35.9, 44.3, 7, 15, 'mountain', 'oil:0.6/0.8 gas:3/10'],
    ['ms', 'Mosul & Nineveh', 36.4, 42.6, 4.5, 6, 'desert', 'food:2 oil:0.05'],
    ['an', 'Anbar (Ramadi, the Western Desert)', 33.0, 41.5, 2, 4, 'desert', ''],
    ['su', 'Southern Euphrates (Najaf, Nasiriyah)', 31.8, 45.6, 10, 12, 'plains', 'oil:0.4 food:2'],
  ],
};

// Extra seed points, so far-flung parts of a province are drawn into it
export const EXTRA_SEEDS = {
  'fra-ov': [[-21.1, 55.5], [16.2, -61.5], [14.6, -61.0], [-12.8, 45.1]],
  'esp-is': [[39.6, 2.9]],
  'jpn-ky': [[26.3, 127.8]],
  'can-no': [[74.0, -90.0], [63.0, -135.0], [80.0, -80.0]],
  'nor-tr': [[69.8, 25.0], [78.5, 16.0]],
  'rus-yk': [[66.5, 170.0]],
  'rus-nf': [[73.0, 55.0]],
  'rus-es': [[76.0, 100.0]],
  'mys-sb': [[5.5, 117.0]],
  'prt-is': [[32.7, -17.0]],
  'idn-pp': [[-3.5, 129.0]],
  'usa-ak': [[52.0, -176.0], [57.0, -135.0]],
  // Keep the cities with their provinces and the empty deserts on their own
  'irn-is': [[31.9, 54.3]],
  'irn-km': [[29.4, 60.8], [26.4, 61.0]],
  'irn-ds': [[33.9, 54.6], [31.0, 58.9]],
  'irn-cs': [[36.9, 54.6]],
  'irn-ms': [[36.2, 56.0]],
  'irn-th': [[35.6, 53.4]],
  'sau-eq': [[21.0, 47.3], [21.5, 53.0]],
  'aus-wa': [[-31.6, 116.3], [-21.3, 118.6], [-30.8, 121.4]],
  'aus-ob': [[-24.3, 134.5], [-28.0, 130.0]],
  'aus-sa': [[-34.0, 138.3]],
  'arg-sp': [[-53.5, -68.5]],
};

// Whole map features (overseas territories) that belong to a province
export const TERRITORIES = {
  'Puerto Rico': 'usa-pr', 'U.S. Virgin Is.': 'usa-pr', 'Guam': 'usa-gu', 'N. Mariana Is.': 'usa-gu', 'American Samoa': 'usa-hi',
  'Falkland Is.': 'gbr-fk', 'S. Geo. and the Is.': 'gbr-fk', 'Saint Helena': 'gbr-os', 'Bermuda': 'gbr-os',
  'Cayman Is.': 'gbr-os', 'British Virgin Is.': 'gbr-os', 'Turks and Caicos Is.': 'gbr-os', 'Anguilla': 'gbr-os',
  'Montserrat': 'gbr-os', 'Pitcairn Is.': 'gbr-os', 'Br. Indian Ocean Ter.': 'gbr-os',
  'Jersey': 'gbr-sw', 'Guernsey': 'gbr-sw', 'Isle of Man': 'gbr-nn',
  'New Caledonia': 'fra-ov', 'Fr. Polynesia': 'fra-ov', 'Wallis and Futuna Is.': 'fra-ov', 'St. Pierre and Miquelon': 'fra-ov',
  'St-Martin': 'fra-ov', 'St-Barthélemy': 'fra-ov', 'Fr. S. Antarctic Lands': 'fra-ov',
  'Aruba': 'nld-cb', 'Curaçao': 'nld-cb', 'Sint Maarten': 'nld-cb',
  'Greenland': 'dnk-gl', 'Faeroe Is.': 'dnk-jt', 'Åland': 'fin-sw',
  'Hong Kong': 'chn-gd', 'Macao': 'chn-gd', 'Siachen Glacier': 'ind-jk',
  'Indian Ocean Ter.': 'aus-wa', 'Ashmore and Cartier Is.': 'aus-wa', 'Heard I. and McDonald Is.': 'aus-wa', 'Norfolk Island': 'aus-ns',
};

// The map feature(s) each playable country's mainland is drawn from
export const ATLAS_NAMES = {
  usa: ['United States of America'], gbr: ['United Kingdom'], are: ['United Arab Emirates'], kor: ['South Korea'],
  zaf: ['South Africa'], cze: ['Czechia'],
};

// Straits and short crossings that armies can march over without an amphibious landing
export const CROSSINGS = [
  ['jpn-hk', 'jpn-th'], ['jpn-ky', 'jpn-cg'], ['ita-si', 'ita-ca'], ['chn-hn', 'chn-gd'], ['idn-jk', 'idn-sm'],
  ['idn-jt', 'idn-bn'], ['phl-mn', 'phl-vi'], ['phl-vi', 'phl-mi'], ['dnk-cp', 'dnk-jt'], ['dnk-cp', 'swe-gb'],
  ['sgp-sg', 'mys-jh'], ['m-bahrain', 'sau-ep'], ['gbr-ni', 'gbr-nn'], ['aus-vc', 'aus-ns'],
];

export const PROVINCES = [];
for (const [country, rows] of Object.entries(R)) {
  for (const [key, name, lat, lon, pop, gdpShare, terrain, res = '', flags = ''] of rows) {
    const resources = {};
    for (const part of res.split(/\s+/).filter(Boolean)) {
      const [r, amounts] = part.split(':');
      const [cur, pot] = amounts.split('/').map(Number);
      resources[r] = [cur, pot ?? cur];
    }
    PROVINCES.push({
      id: `${country}-${key}`, country, name, lat, lon, pop, gdpShare, terrain, resources,
      capital: flags.includes('C'), territoryOnly: flags.includes('T'),
    });
  }
}
