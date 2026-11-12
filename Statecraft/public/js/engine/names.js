// Display names for every province and minor nation, and terrain for minor nations.

import { PROVINCES } from './data/regions.js';
import { MINORS } from './data/minors.js';
import { EXTRA_MINORS } from './data/geo.js';

export const REGION_NAMES = Object.fromEntries([
  ...PROVINCES.map((p) => [p.id, p.name]),
  ...Object.values({ ...MINORS, ...EXTRA_MINORS }).map((m) => [m.id, m.name]),
]);

// Fighting quality of minor nations' forces (0.5 if not listed)
export const MINOR_QUALITY = {
  'm-ukraine': 0.82, 'm-north-korea': 0.6, 'm-belarus': 0.55, 'm-greece': 0.7, 'm-hungary': 0.65, 'm-azerbaijan': 0.6,
  'm-armenia': 0.55, 'm-georgia': 0.55, 'm-jordan': 0.65, 'm-lithuania': 0.68, 'm-latvia': 0.68, 'm-estonia': 0.7,
  'm-new-zealand': 0.75, 'm-kuwait': 0.6, 'm-qatar': 0.6, 'm-oman': 0.6, 'm-algeria': 0.6, 'm-morocco': 0.6,
  'm-afghanistan': 0.55, 'm-yemen': 0.5, 'm-eritrea': 0.45, 'm-ethiopia': 0.5,
};

// Fortified lines at the start (0-5)
export const START_FORTS = {
  'm-ukraine': 3, 'kor-se': 3, 'kor-gw': 3, 'm-north-korea': 3, 'ind-jk': 3, 'pak-gb': 3, 'pak-is': 2, 'twn-tp': 2, 'twn-tc': 2,
  'twn-ts': 2, 'isr-nh': 2, 'isr-ta': 1, 'fin-ea': 2, 'pol-ea': 1, 'chn-fj': 1, 'rus-bk': 2, 'rus-so': 1, 'rus-kl': 2,
  'irn-hz': 1, 'irn-kh': 1, 'tur-is': 1, 'egy-sz': 1, 'sgp-sg': 2, 'nor-tr': 1, 'swe-gb': 1, 'm-belarus': 1,
};

export const MINOR_TERRAIN = {
  'm-afghanistan': 'mountain', 'm-north-korea': 'mountain', 'm-georgia': 'mountain', 'm-armenia': 'mountain',
  'm-nepal': 'mountain', 'm-bhutan': 'mountain', 'm-kyrgyzstan': 'mountain', 'm-tajikistan': 'mountain',
  'm-bosnia-and-herzegovina': 'mountain', 'm-montenegro': 'mountain', 'm-albania': 'mountain', 'm-north-macedonia': 'mountain',
  'm-lebanon': 'mountain', 'm-yemen': 'mountain', 'm-ethiopia': 'mountain', 'm-eritrea': 'mountain', 'm-bolivia': 'mountain',
  'm-iceland': 'arctic', 'm-dr-congo': 'jungle', 'm-republic-of-the-congo': 'jungle', 'm-gabon': 'jungle',
  'm-cameroon': 'jungle', 'm-myanmar': 'jungle', 'm-laos': 'jungle', 'm-cambodia': 'jungle', 'm-papua-new-guinea': 'jungle',
  'm-guyana': 'jungle', 'm-suriname': 'jungle', 'm-ecuador': 'mountain', 'm-venezuela': 'jungle', 'm-panama': 'jungle',
  'm-libya': 'desert', 'm-algeria': 'desert', 'm-sudan': 'desert', 'm-chad': 'desert', 'm-niger': 'desert', 'm-mali': 'desert',
  'm-mauritania': 'desert', 'm-western-sahara': 'desert', 'm-egypt': 'desert', 'm-oman': 'desert', 'm-kuwait': 'desert',
  'm-qatar': 'desert', 'm-jordan': 'desert', 'm-syria': 'desert', 'm-turkmenistan': 'desert', 'm-uzbekistan': 'desert',
  'm-mongolia': 'desert', 'm-namibia': 'desert', 'm-botswana': 'desert', 'm-somalia': 'desert', 'm-djibouti': 'desert',
  'm-ukraine': 'plains', 'm-belarus': 'forest', 'm-switzerland': 'mountain', 'm-palestine': 'urban',
};
