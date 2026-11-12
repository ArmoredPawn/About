// The 50 playable countries: the largest economies by nominal GDP (IMF, 2025, sovereign states only).
// Figures are rounded real-world values from around 2025: GDP and reserves in billions of US dollars,
// population in millions, forces from IISS/SIPRI-style estimates, nuclear warheads from FAS.
//
// Columns:
//  id, name, iso2 (flag), leader title, colour,
//  gdp $B, population M, trend growth %, population growth %, debt % of GDP, government,
//  tax revenue % of GDP, defence % of GDP, policy rate %, inflation %, approval, world standing (0-100),
//  reserves $B (central bank + sovereign funds), active troops K, reserves K, tanks, combat aircraft,
//  major warships and submarines, aircraft carriers, missiles, nuclear warheads, technology (1-10),
//  energy intensity (1 = world average per $ of GDP), uranium needed for nuclear power (kt/yr),
//  share of resource export windfalls that reaches the state (0-1), general surnames

const ROWS = [
  ['usa', 'United States', 'us', 'President', '#4f7fe0', 30507, 341, 2.0, 0.5, 122, 'democracy', 30, 3.4, 3.75, 2.8, 42, 55, 800, 1330, 800, 4600, 2700, 290, 11, 4000, 5177, 10, 0.85, 18, 0.1, 'Patton Bradley Ridgway Abrams Powell Mattis Nimitz Halsey'],
  ['chn', 'China', 'cn', 'President', '#e0483d', 19232, 1409, 4.5, -0.1, 90, 'autocracy', 26, 1.7, 1.4, 0.2, 70, 40, 3300, 2035, 510, 5000, 2100, 370, 3, 3000, 600, 8, 1.3, 13, 0.3, 'Zhang Liu Wei He Li Zhao Wang Xu'],
  ['deu', 'Germany', 'de', 'Chancellor', '#d6a531', 4745, 84, 0.6, 0.1, 63, 'democracy', 47, 2.1, 2.0, 2.1, 35, 68, 300, 181, 60, 300, 230, 60, 0, 200, 0, 9, 0.8, 0, 0.1, 'Breuer Freuding Zorn Vollmer Schneider Bühler Kühn Weber'],
  ['ind', 'India', 'in', 'Prime Minister', '#f08c2e', 4187, 1450, 6.5, 0.8, 83, 'democracy', 20, 2.3, 5.5, 3.0, 62, 55, 690, 1475, 1155, 4600, 600, 150, 2, 700, 180, 7, 1.3, 1.5, 0.1, 'Rawat Naravane Pande Dwivedi Manekshaw Singh Thimayya Kapoor'],
  ['jpn', 'Japan', 'jp', 'Prime Minister', '#e86a9a', 4186, 124, 0.7, -0.5, 235, 'democracy', 34, 1.6, 0.75, 2.5, 35, 66, 1250, 247, 56, 450, 550, 155, 2, 400, 0, 9, 0.9, 2, 0.05, 'Yamazaki Yoshida Morimoto Kawano Iwasaki Oda Tanaka Sato'],
  ['gbr', 'United Kingdom', 'gb', 'Prime Minister', '#c43a5a', 3839, 69, 1.1, 0.6, 101, 'democracy', 40, 2.3, 3.75, 3.5, 30, 62, 180, 141, 70, 200, 230, 65, 2, 300, 225, 9, 0.7, 1.2, 0.2, 'Montgomery Slim Carver Radakin Walker Sanders Knighton Wavell'],
  ['fra', 'France', 'fr', 'President', '#3f5bbf', 3211, 68, 0.8, 0.2, 116, 'democracy', 51, 2.1, 2.0, 1.2, 25, 62, 250, 200, 41, 220, 250, 80, 1, 500, 290, 9, 0.75, 8, 0.1, 'Leclerc Burkhard Mandon Lecointre Juin Schill Gaulle Foch'],
  ['ita', 'Italy', 'it', 'Prime Minister', '#3ca86b', 2422, 59, 0.6, -0.2, 137, 'democracy', 47, 1.5, 2.0, 1.6, 42, 60, 230, 165, 18, 200, 220, 85, 2, 150, 0, 8, 0.8, 0, 0.1, 'Portolano Graziano Masiello Cavo Rossi Ferrari Romano Colombo'],
  ['can', 'Canada', 'ca', 'Prime Minister', '#cf4f4f', 2225, 41, 1.4, 1.5, 110, 'democracy', 41, 1.4, 2.25, 2.0, 45, 70, 120, 68, 36, 80, 90, 30, 0, 50, 0, 8, 1.2, 1.6, 0.3, 'Carignan Eyre Vance Currie Dextraze Hillier Natynczyk Lawson'],
  ['bra', 'Brazil', 'br', 'President', '#41a85a', 2125, 212, 2.0, 0.5, 92, 'democracy', 33, 1.1, 15.0, 5.0, 45, 55, 340, 366, 1340, 400, 120, 60, 0, 100, 0, 6, 1.0, 0.3, 0.3, 'Paiva Tomás Freire Mourão Caxias Sampaio Rondon Lima'],
  ['rus', 'Russia', 'ru', 'President', '#8b2e3a', 2076, 144, 1.5, -0.3, 21, 'autocracy', 35, 7.1, 16.0, 7.0, 75, 20, 300, 1320, 1500, 2500, 1100, 220, 1, 2500, 5459, 8, 1.9, 5, 0.5, 'Gerasimov Zhukov Surovikin Teplinsky Rokossovsky Konev Lapin Chaiko'],
  ['esp', 'Spain', 'es', 'Prime Minister', '#e3b23c', 1799, 49, 2.5, 0.5, 101, 'democracy', 41, 1.3, 2.0, 2.5, 38, 64, 90, 133, 15, 330, 150, 50, 1, 100, 0, 8, 0.8, 1.2, 0.1, 'Rojo Varela Cortés Yagüe Martínez García López Sánchez'],
  ['kor', 'South Korea', 'kr', 'President', '#5aa7d6', 1790, 52, 1.6, -0.1, 54, 'democracy', 25, 2.6, 2.5, 2.0, 45, 62, 410, 500, 3100, 2200, 400, 150, 0, 1500, 0, 9, 1.1, 5, 0.05, 'Kim Lee Park Choi Jung Kang Yoon Paik'],
  ['aus', 'Australia', 'au', 'Prime Minister', '#2f9d8f', 1771, 27, 1.8, 1.3, 50, 'democracy', 36, 2.0, 3.6, 2.8, 45, 70, 80, 60, 30, 60, 110, 45, 0, 150, 0, 9, 1.1, 0, 0.3, 'Monash Cosgrove Campbell Hurley Blamey Angus Stuart Moore'],
  ['mex', 'Mexico', 'mx', 'President', '#2e8b57', 1692, 131, 1.2, 0.7, 58, 'democracy', 23, 0.8, 7.0, 3.8, 65, 52, 240, 230, 80, 0, 50, 100, 0, 20, 0, 5, 1.0, 0.2, 0.3, 'Trevilla Sandoval Cienfuegos Morelos Zaragoza Obregón Ángeles Villa'],
  ['tur', 'Turkey', 'tr', 'President', '#c2553a', 1437, 87, 3.0, 0.4, 25, 'hybrid', 30, 1.9, 38.0, 33.0, 45, 42, 160, 355, 380, 2200, 300, 120, 1, 300, 0, 7, 1.0, 0, 0.1, 'Gürak Akar Bayraktaroğlu İnönü Çakmak Yaşar Kaya Demir'],
  ['idn', 'Indonesia', 'id', 'President', '#b8433f', 1429, 283, 5.0, 0.8, 40, 'democracy', 15, 0.7, 4.75, 2.5, 70, 55, 150, 395, 400, 400, 100, 150, 0, 50, 0, 5, 1.3, 0, 0.3, 'Sudirman Nasution Yudhoyono Hadi Agus Prabowo Suharto Wiranto'],
  ['nld', 'Netherlands', 'nl', 'Prime Minister', '#ef8a3a', 1272, 18, 1.4, 0.5, 44, 'democracy', 43, 2.0, 2.0, 3.0, 35, 68, 70, 33, 6, 18, 50, 30, 0, 80, 0, 9, 0.9, 0.1, 0.2, 'Eichelsheim Bauer Middendorp Tromp Ruyter Winkelman Smit Visser'],
  ['sau', 'Saudi Arabia', 'sa', 'Crown Prince', '#2f7d4a', 1083, 35, 3.5, 1.5, 30, 'autocracy', 30, 7.1, 4.5, 2.0, 70, 45, 1350, 257, 0, 1000, 400, 40, 0, 300, 0, 6, 3.0, 0, 0.85, 'Al-Ruwaili Al-Bunyan Al-Qahtani Al-Shehri Al-Mutairi Al-Ghamdi Al-Harbi Al-Otaibi'],
  ['che', 'Switzerland', 'ch', 'President of the Confederation', '#d24a4a', 1003, 9, 1.3, 0.7, 38, 'democracy', 34, 0.7, 0.0, 0.2, 60, 78, 900, 20, 120, 134, 30, 0, 0, 20, 0, 9, 0.6, 0.4, 0.1, 'Süssli Rebord Guisan Wille Keckeis Blattmann Müller Meier'],
  ['pol', 'Poland', 'pl', 'Prime Minister', '#d35d7a', 980, 37, 3.2, -0.2, 58, 'democracy', 37, 4.2, 4.5, 3.5, 42, 60, 230, 216, 350, 1100, 90, 25, 0, 100, 0, 7, 1.1, 0, 0.1, 'Kukuła Andrzejczak Piłsudski Anders Sosabowski Maczek Nowak Kowalski'],
  ['twn', 'Taiwan', 'tw', 'President', '#3d8bd1', 805, 23, 3.0, -0.1, 26, 'democracy', 13, 2.5, 2.0, 1.7, 45, 60, 590, 169, 1657, 1000, 285, 90, 0, 800, 0, 9, 1.2, 0.2, 0.05, 'Mei Huang Lee Chen Lin Wu Tsai Hsu'],
  ['bel', 'Belgium', 'be', 'Prime Minister', '#e0c443', 690, 12, 1.0, 0.4, 105, 'democracy', 50, 1.3, 2.0, 3.0, 35, 66, 40, 23, 5, 0, 50, 5, 0, 20, 0, 8, 1.0, 0.6, 0.1, 'Vansina Hofman Compernolle Peeters Janssens Maes Jacobs Mertens'],
  ['arg', 'Argentina', 'ar', 'President', '#7fb6e8', 683, 46, 3.5, 0.9, 85, 'democracy', 35, 0.5, 29.0, 30.0, 47, 50, 30, 72, 0, 230, 30, 40, 0, 20, 0, 5, 1.1, 0.2, 0.2, 'Isaac Paleo San-Martín Belgrano Güemes Pérez González Rodríguez'],
  ['swe', 'Sweden', 'se', 'Prime Minister', '#3c78c8', 620, 10.6, 1.9, 0.5, 34, 'democracy', 48, 2.2, 1.75, 1.0, 38, 72, 60, 25, 32, 120, 95, 30, 0, 50, 0, 9, 0.9, 1.5, 0.2, 'Bydén Claesson Göranson Andersson Johansson Karlsson Nilsson Eriksson'],
  ['irl', 'Ireland', 'ie', 'Taoiseach', '#47b06e', 609, 5.3, 3.0, 1.0, 40, 'democracy', 22, 0.2, 2.0, 2.0, 40, 75, 15, 8, 4, 0, 0, 8, 0, 0, 0, 8, 0.6, 0, 0.1, 'Clancy Mulcahy Collins Murphy Kelly Walsh Byrne Ryan'],
  ['isr', 'Israel', 'il', 'Prime Minister', '#5c86d6', 583, 10, 3.0, 1.6, 68, 'democracy', 33, 8.8, 4.25, 3.0, 38, 35, 230, 170, 465, 1300, 340, 65, 0, 600, 90, 9, 0.9, 0, 0.1, 'Zamir Halevi Kochavi Dayan Rabin Sharon Barak Eisenkot'],
  ['are', 'United Arab Emirates', 'ae', 'President', '#7d8c3a', 569, 10, 4.0, 1.3, 30, 'autocracy', 25, 5.0, 4.15, 2.0, 75, 55, 1100, 63, 0, 400, 150, 70, 0, 150, 0, 7, 2.8, 1, 0.75, 'Al-Rumaithi Al-Nahyan Al-Mazrouei Al-Ketbi Al-Shamsi Al-Dhaheri Al-Suwaidi Al-Mansoori'],
  ['sgp', 'Singapore', 'sg', 'Prime Minister', '#e05a6b', 565, 6, 2.5, 0.8, 175, 'hybrid', 17, 2.8, 2.0, 1.0, 60, 72, 1100, 51, 252, 150, 100, 40, 0, 100, 0, 9, 2.0, 0, 0.2, 'Aw Ng Neo Tan Lim Goh Ong Chan'],
  ['tha', 'Thailand', 'th', 'Prime Minister', '#6a5acd', 546, 72, 2.5, 0.1, 63, 'hybrid', 20, 1.3, 1.5, 0.0, 40, 52, 260, 360, 200, 600, 110, 90, 1, 100, 0, 6, 1.2, 0, 0.2, 'Songwit Chalermpon Apirat Prayut Prawit Narongpan Chaiyaporn Somchai'],
  ['aut', 'Austria', 'at', 'Chancellor', '#c8504a', 534, 9, 1.0, 0.4, 80, 'democracy', 49, 0.9, 2.0, 3.0, 35, 70, 35, 23, 125, 56, 15, 0, 0, 10, 0, 8, 0.8, 0, 0.1, 'Striedinger Brieger Entacher Gruber Huber Bauer Wagner Pichler'],
  ['nor', 'Norway', 'no', 'Prime Minister', '#3e6ea8', 504, 5.6, 1.5, 0.7, 44, 'democracy', 55, 2.2, 4.0, 3.0, 45, 74, 1900, 25, 40, 50, 50, 20, 0, 50, 0, 9, 1.3, 0, 0.75, 'Kristoffersen Bruun-Hanssen Sunde Fleischer Ruge Hansen Johansen Olsen'],
  ['phl', 'Philippines', 'ph', 'President', '#4a66c9', 497, 116, 6.0, 1.5, 60, 'democracy', 17, 1.3, 5.0, 2.0, 50, 55, 105, 145, 100, 20, 30, 80, 0, 20, 0, 5, 1.0, 0, 0.1, 'Brawner Centino Esperon Ramos Aguinaldo Luna Santos Reyes'],
  ['vnm', 'Vietnam', 'vn', 'General Secretary', '#d4583c', 490, 101, 6.5, 0.7, 37, 'autocracy', 18, 2.3, 4.5, 3.5, 75, 55, 85, 450, 5000, 1300, 75, 70, 0, 100, 0, 6, 1.4, 0, 0.3, 'Giáp Nguyễn Trần Lê Phạm Hoàng Phan Vũ'],
  ['bgd', 'Bangladesh', 'bd', 'Chief Adviser', '#2d8f5a', 467, 174, 4.5, 1.0, 40, 'hybrid', 9, 1.0, 10.0, 8.5, 45, 50, 25, 163, 0, 300, 45, 90, 0, 20, 0, 4, 0.9, 0, 0.1, 'Zaman Ahmed Rahman Hossain Islam Khan Chowdhury Uddin'],
  ['mys', 'Malaysia', 'my', 'Prime Minister', '#3355aa', 444, 35, 4.5, 1.1, 64, 'democracy', 17, 1.0, 2.75, 1.5, 50, 58, 120, 113, 52, 50, 40, 50, 0, 30, 0, 6, 1.4, 0, 0.4, 'Hafizuddeain Affendi Zulkifli Raja Hassan Ismail Abdullah Ibrahim'],
  ['dnk', 'Denmark', 'dk', 'Prime Minister', '#c9404a', 432, 6, 2.0, 0.4, 30, 'democracy', 47, 2.4, 1.6, 2.0, 40, 76, 100, 15, 45, 44, 30, 20, 0, 30, 0, 9, 0.7, 0, 0.2, 'Wang Bjerre Bartram Rasmussen Jensen Nielsen Hansen Pedersen'],
  ['col', 'Colombia', 'co', 'President', '#e5c02e', 427, 53, 2.5, 0.6, 60, 'democracy', 27, 3.0, 9.0, 5.0, 35, 50, 62, 250, 35, 0, 20, 50, 0, 10, 0, 5, 1.1, 0, 0.3, 'Cadena Giraldo Ospina Santander Córdoba Mejía Rojas Gómez'],
  ['zaf', 'South Africa', 'za', 'President', '#3aa36b', 410, 64, 1.0, 0.9, 76, 'democracy', 27, 0.7, 7.0, 3.5, 40, 55, 65, 74, 15, 24, 25, 15, 0, 10, 0, 6, 1.8, 0.3, 0.2, 'Maphwanya Shoke Ngwenya Mbeki Dlamini Nkosi Botha Mokoena'],
  ['rou', 'Romania', 'ro', 'President', '#d8b03a', 403, 19, 1.5, -0.5, 55, 'democracy', 32, 2.3, 6.5, 7.0, 40, 58, 75, 71, 55, 300, 30, 20, 0, 20, 0, 7, 0.9, 0.2, 0.1, 'Vlad Ciucă Antonescu Popescu Ionescu Stan Dumitru Constantin'],
  ['pak', 'Pakistan', 'pk', 'Prime Minister', '#2b7a4b', 373, 251, 3.0, 1.9, 70, 'hybrid', 12, 2.7, 11.0, 5.0, 40, 35, 15, 660, 550, 2600, 400, 50, 0, 400, 170, 6, 1.0, 0.5, 0.1, 'Munir Bajwa Raheel Kayani Musharraf Ayub Shah Qureshi'],
  ['cze', 'Czechia', 'cz', 'Prime Minister', '#4a6fb5', 360, 10.9, 2.0, 0.1, 44, 'democracy', 40, 2.1, 3.5, 2.5, 38, 64, 165, 27, 10, 44, 30, 0, 0, 10, 0, 8, 1.1, 0.6, 0.1, 'Řehka Opata Bečvář Pavel Novák Svoboda Dvořák Černý'],
  ['egy', 'Egypt', 'eg', 'President', '#c79a3a', 347, 107, 4.0, 1.6, 90, 'autocracy', 20, 1.2, 22.0, 13.0, 55, 45, 45, 440, 480, 2700, 500, 150, 2, 200, 0, 5, 1.6, 0, 0.2, 'Askar Hegazy Zaki Sadek Tantawi Mohamed Hassan Mahmoud'],
  ['irn', 'Iran', 'ir', 'Supreme Leader', '#3f9a62', 341, 91, 1.5, 0.7, 34, 'autocracy', 12, 2.0, 23.0, 40.0, 40, 15, 30, 610, 350, 1500, 300, 110, 0, 3000, 0, 6, 2.4, 0.2, 0.7, 'Bagheri Soleimani Hajizadeh Salami Mousavi Rashid Hosseini Ahmadi'],
  ['chl', 'Chile', 'cl', 'President', '#c33e4e', 344, 20, 2.5, 0.6, 40, 'democracy', 24, 1.8, 4.75, 4.0, 35, 65, 45, 68, 40, 250, 45, 30, 0, 20, 0, 6, 1.0, 0, 0.4, 'Iturriaga Oyarzún Prat Baquedano O\'Higgins Carrera Muñoz Soto'],
  ['prt', 'Portugal', 'pt', 'Prime Minister', '#4b8f3f', 321, 10.5, 2.0, 0.2, 95, 'democracy', 43, 1.6, 2.0, 2.5, 42, 68, 30, 24, 210, 34, 30, 20, 0, 10, 0, 8, 0.9, 0, 0.1, 'Nunes Gouveia Ramalho Silva Santos Ferreira Pereira Costa'],
  ['fin', 'Finland', 'fi', 'President', '#7aa5d8', 304, 5.6, 1.0, 0.2, 82, 'democracy', 43, 2.4, 2.0, 1.5, 45, 76, 15, 24, 238, 200, 60, 20, 0, 50, 0, 9, 1.2, 0.7, 0.1, 'Hulkko Kivinen Mannerheim Siilasvuo Laaksonen Virtanen Korhonen Mäkinen'],
  ['per', 'Peru', 'pe', 'President', '#c6474a', 303, 34, 3.0, 1.0, 33, 'democracy', 20, 1.1, 4.25, 1.8, 20, 52, 85, 81, 188, 160, 40, 30, 0, 10, 0, 5, 1.0, 0, 0.3, 'Céspedes Grau Bolognesi Cáceres Quispe Flores Torres Vargas'],
  ['kaz', 'Kazakhstan', 'kz', 'President', '#3fb2c9', 300, 20, 5.0, 1.2, 25, 'autocracy', 19, 0.8, 16.5, 12.0, 65, 50, 60, 39, 0, 300, 100, 10, 0, 50, 0, 5, 2.0, 0, 0.5, 'Bektanov Zhaksylykov Ermekbayev Nurlanov Seitov Abenov Kasymov Ospanov'],
  ['irq', 'Iraq', 'iq', 'Prime Minister', '#9a6b3a', 270, 46, 1.5, 2.2, 45, 'hybrid', 30, 3.6, 7.5, 3.0, 40, 35, 100, 193, 0, 400, 60, 20, 0, 50, 0, 4, 1.5, 0, 0.9, 'Yarallah Ghanimi Zaidi Hashimi Jabouri Saadi Obeidi Tamimi'],
];

export const COUNTRY_IDS = ROWS.map((r) => r[0]);

export const COUNTRIES = Object.fromEntries(ROWS.map((r, rank) => {
  const [id, name, iso2, title, color, gdp, pop, growth, popGrowth, debt, gov, tax, defence, rate, inflation,
    approval, standing, reserves, troops, reserveTroops, tanks, aircraft, ships, carriers, missiles, nukes, tech,
    energy, uranium, rents, generals] = r;
  return [id, {
    id, rank: rank + 1, name, iso2, title, color, gdp, pop, growth, popGrowth, debt, gov, tax, defence, rate, inflation,
    approval, standing, reserves, troops, reserveTroops, tanks, aircraft, ships, carriers, missiles, nukes, tech,
    energy, uranium, rents, generals: generals.split(' '),
  }];
}));

// Fields where a country is ahead of or behind its general technology level
export const TECH_OVERRIDES = {
  usa: { air: 10, naval: 10, cyber: 10 },
  chn: { naval: 8, missile: 9, industry: 9, cyber: 8 },
  rus: { missile: 9, air: 7, naval: 6, nuclear: 9, cyber: 8 },
  isr: { cyber: 10, missile: 10, air: 9 },
  twn: { industry: 10 },
  kor: { industry: 10 },
  irn: { missile: 7, nuclear: 6, cyber: 6 },
  ind: { nuclear: 7, missile: 7 },
  pak: { nuclear: 6 },
  fra: { nuclear: 9 },
  gbr: { nuclear: 9, cyber: 9 },
  jpn: { industry: 10 },
  deu: { industry: 10 },
  nld: { industry: 10 },
  sau: { army: 5 },
  are: { air: 8 },
  tur: { army: 7, air: 7 },
};

// Claims on other countries' territory, which make wars to take it easier to justify
export const CLAIMS = {
  chn: ['twn-tp', 'twn-tc', 'twn-ts', 'twn-ea'],
  arg: ['gbr-fk'],
  ind: ['pak-gb'],
  pak: ['ind-jk'],
};

// Countries with a nuclear weapons programme under way at the start (0-1 progress to a first warhead)
export const NUCLEAR_PROGRAMMES = { irn: 0.6 };
