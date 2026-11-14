// Oil and gas politics: the cartel's production cuts, the pipelines that carry oil and gas across borders, and
// pipelines that have been planned but not built.

// No cartel exists when the game begins: producers found one if they choose (see energy.js)
export const CUTS = [0, 5, 10, 20, 30];

// share: how much of each buyer's need for that fuel the pipeline can carry (for buyers), or how much of the
// seller's exports it lets round a strait (for a bypass). via: provinces or nations it crosses on the way.
export const PIPELINES = [
  { id: 'druzhba', name: 'Druzhba', res: 'oil', from: 'rus-vo', to: 'deu-be', via: ['m-belarus', 'pol-ea'], seller: 'rus', buyers: ['pol', 'deu', 'cze'], share: 0.25, note: 'The Soviet "Friendship" pipeline, still feeding Central Europe\'s refineries.' },
  { id: 'pos', name: 'Power of Siberia', res: 'gas', from: 'rus-es', to: 'chn-ne', seller: 'rus', buyers: ['chn'], share: 0.15, note: 'Russian gas to northeast China since 2019.' },
  { id: 'espo', name: 'ESPO spur', res: 'oil', from: 'rus-es', to: 'chn-ne', seller: 'rus', buyers: ['chn'], share: 0.1, note: 'The Eastern Siberia–Pacific Ocean pipeline\'s branch to Daqing.' },
  { id: 'keystone', name: 'Keystone', res: 'oil', from: 'can-ab', to: 'usa-pl', seller: 'can', buyers: ['usa'], share: 0.2, note: 'Oil-sands crude to the American Midwest.' },
  { id: 'turkstream', name: 'TurkStream', res: 'gas', from: 'rus-so', to: 'tur-is', seller: 'rus', buyers: ['tur'], share: 0.35, note: 'Under the Black Sea to Thrace.' },
  { id: 'btc', name: 'Baku–Tbilisi–Ceyhan', res: 'oil', from: 'm-azerbaijan', to: 'tur-me', via: ['m-georgia'], seller: 'm-azerbaijan', buyers: ['tur', 'isr', 'ita'], share: 0.12, note: 'Caspian oil to the Mediterranean, bypassing Russia and the Turkish Straits.' },
  { id: 'cac', name: 'Central Asia–China', res: 'gas', from: 'm-turkmenistan', to: 'chn-xj', via: ['kaz-al'], seller: 'm-turkmenistan', buyers: ['chn'], share: 0.15, note: 'Turkmen gas across Kazakhstan to Xinjiang.' },
  { id: 'langeled', name: 'Langeled & Europipe', res: 'gas', from: 'nor-we', to: 'gbr-nn', seller: 'nor', buyers: ['gbr', 'deu', 'fra', 'bel', 'nld'], share: 0.3, note: 'Norway\'s North Sea gas, now Europe\'s largest supply.' },
  { id: 'transmed', name: 'Trans-Mediterranean', res: 'gas', from: 'm-algeria', to: 'ita-si', via: ['m-tunisia'], seller: 'm-algeria', buyers: ['ita'], share: 0.25, note: 'Algerian gas to Sicily through Tunisia.' },
  { id: 'petroline', name: 'East–West Petroline', res: 'oil', from: 'sau-ep', to: 'sau-hj', seller: 'sau', bypass: 'hormuz', share: 0.6, note: 'Carries Saudi crude across the desert to the Red Sea, out of reach of a Hormuz closure.' },
  { id: 'adcop', name: 'Habshan–Fujairah', res: 'oil', from: 'are-ad', to: 'are-db', seller: 'are', bypass: 'hormuz', share: 0.4, note: 'Lets the Emirates export from the Gulf of Oman, outside Hormuz.' },
  { id: 'kirkuk', name: 'Kirkuk–Ceyhan', res: 'oil', from: 'irq-kk', to: 'tur-me', via: ['tur-se'], seller: 'irq', bypass: 'hormuz', share: 0.2, shut: true, note: 'Iraq\'s northern outlet to the Mediterranean, shut since 2023 by a legal dispute.' },
];

// Real projects that have been planned for years. cost in $ billions, weeks to build.
export const PIPELINE_PROJECTS = [
  { id: 'pos2', name: 'Power of Siberia 2', res: 'gas', from: 'rus-ws', to: 'chn-im', via: ['m-mongolia'], seller: 'rus', buyers: ['chn'], share: 0.15, cost: 25, weeks: 156, note: 'Yamal gas to China through Mongolia, replacing the lost European market.' },
  { id: 'eastmed', name: 'EastMed', res: 'gas', from: 'isr-nh', to: 'm-greece', seller: 'isr', buyers: ['ita', 'deu'], share: 0.06, cost: 8, weeks: 156, note: 'Israeli offshore gas to Europe under the sea.' },
  { id: 'ip', name: 'Iran–Pakistan', res: 'gas', from: 'irn-km', to: 'pak-kr', via: ['pak-ba'], seller: 'irn', buyers: ['pak'], share: 0.3, cost: 7, weeks: 104, note: 'The "peace pipeline", half-built for fifteen years under American sanctions pressure.' },
  { id: 'tapi', name: 'TAPI', res: 'gas', from: 'm-turkmenistan', to: 'ind-dl', via: ['m-afghanistan', 'pak-kp', 'pak-lh'], seller: 'm-turkmenistan', buyers: ['pak', 'ind'], share: 0.1, cost: 10, weeks: 156, note: 'Turkmenistan–Afghanistan–Pakistan–India: decades of plans, little pipe.' },
  { id: 'basra', name: 'Basra–Aqaba', res: 'oil', from: 'irq-bs', to: 'm-jordan', via: ['irq-an'], seller: 'irq', bypass: 'hormuz', share: 0.3, cost: 9, weeks: 130, note: 'Would give Iraq a way to export that avoids Hormuz.' },
];
