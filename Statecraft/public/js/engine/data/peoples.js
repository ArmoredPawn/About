// Peoples with a movement for independence (or to join another country), by the province they live in.
// strength (0 to 1) is how much of the population wants to leave in 2027: it sets how loyal the province starts
// and how hard it is to keep. joins: the country the movement wants to join instead of going it alone.
// autonomy: provinces that already govern themselves (Iraqi Kurdistan, Bangsamoro, Scotland's parliament...).

export const MOVEMENTS = {
  'esp-ct': { people: 'Catalans', state: 'Catalonia', strength: 0.45, autonomy: true },
  'esp-ba': { people: 'Basques', state: 'the Basque Country', strength: 0.25, autonomy: true },
  'gbr-sc': { people: 'Scots', state: 'Scotland', strength: 0.45, autonomy: true },
  'gbr-wa': { people: 'Welsh', state: 'Wales', strength: 0.15, autonomy: true },
  'gbr-ni': { people: 'Irish nationalists', state: 'Northern Ireland', strength: 0.35, autonomy: true, joins: 'irl' },
  'can-qc': { people: 'Québécois', state: 'Quebec', strength: 0.35, autonomy: true },
  'bel-br': { people: 'Flemish', state: 'Flanders', strength: 0.25, autonomy: true },
  'fra-ov': { people: 'Kanaks', state: 'New Caledonia', strength: 0.3 },
  'chn-xz': { people: 'Tibetans', state: 'Tibet', strength: 0.5 },
  'chn-xj': { people: 'Uyghurs', state: 'East Turkestan', strength: 0.5 },
  'ind-jk': { people: 'Kashmiris', state: 'Kashmir', strength: 0.55 },
  'ind-as': { people: 'Nagas and Assamese', state: 'the Northeast', strength: 0.25 },
  'rus-ca': { people: 'Chechens and Caucasians', state: 'Ichkeria', strength: 0.45 },
  'tur-se': { people: 'Kurds', state: 'Kurdistan', strength: 0.5 },
  'irq-kk': { people: 'Kurds', state: 'Kurdistan', strength: 0.65, autonomy: true },
  'irn-km': { people: 'Baloch', state: 'Balochistan', strength: 0.35 },
  'pak-ba': { people: 'Baloch', state: 'Balochistan', strength: 0.5 },
  'idn-pp': { people: 'Papuans', state: 'West Papua', strength: 0.5 },
  'phl-mi': { people: 'Moros', state: 'Bangsamoro', strength: 0.35, autonomy: true },
  'usa-pr': { people: 'Puerto Ricans', state: 'Puerto Rico', strength: 0.1 },
};
