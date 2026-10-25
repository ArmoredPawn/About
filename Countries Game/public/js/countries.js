// Canonical list of sovereign states used for answers and guess matching.
// Shared by the browser game and the server (ES module, no dependencies).
// Each entry: [ISO 3166-1 alpha-2 code, display name, ...aliases]

export const COUNTRIES = [
  ['AF', 'Afghanistan'],
  ['AL', 'Albania'],
  ['DZ', 'Algeria'],
  ['AD', 'Andorra'],
  ['AO', 'Angola'],
  ['AG', 'Antigua and Barbuda', 'antigua'],
  ['AR', 'Argentina'],
  ['AM', 'Armenia'],
  ['AU', 'Australia'],
  ['AT', 'Austria'],
  ['AZ', 'Azerbaijan'],
  ['BS', 'Bahamas', 'the bahamas'],
  ['BH', 'Bahrain'],
  ['BD', 'Bangladesh'],
  ['BB', 'Barbados'],
  ['BY', 'Belarus', 'byelorussia'],
  ['BE', 'Belgium'],
  ['BZ', 'Belize'],
  ['BJ', 'Benin'],
  ['BT', 'Bhutan'],
  ['BO', 'Bolivia'],
  ['BA', 'Bosnia and Herzegovina', 'bosnia', 'bosnia herzegovina', 'bih'],
  ['BW', 'Botswana'],
  ['BR', 'Brazil', 'brasil'],
  ['BN', 'Brunei', 'brunei darussalam'],
  ['BG', 'Bulgaria'],
  ['BF', 'Burkina Faso', 'burkina'],
  ['BI', 'Burundi'],
  ['CV', 'Cabo Verde', 'cape verde'],
  ['KH', 'Cambodia', 'kampuchea'],
  ['CM', 'Cameroon'],
  ['CA', 'Canada'],
  ['CF', 'Central African Republic', 'car', 'central africa'],
  ['TD', 'Chad'],
  ['CL', 'Chile'],
  ['CN', 'China', 'prc', "people's republic of china", 'mainland china'],
  ['CO', 'Colombia'],
  ['KM', 'Comoros'],
  ['CG', 'Republic of the Congo', 'congo brazzaville', 'congo republic', 'roc congo'],
  ['CD', 'DR Congo', 'democratic republic of the congo', 'democratic republic of congo', 'drc', 'dr of congo', 'congo kinshasa', 'zaire'],
  ['CR', 'Costa Rica'],
  ['CI', "Côte d'Ivoire", 'ivory coast', 'cote divoire'],
  ['HR', 'Croatia'],
  ['CU', 'Cuba'],
  ['CY', 'Cyprus'],
  ['CZ', 'Czechia', 'czech republic', 'czech'],
  ['DK', 'Denmark'],
  ['DJ', 'Djibouti'],
  ['DM', 'Dominica'],
  ['DO', 'Dominican Republic', 'dominican rep'],
  ['EC', 'Ecuador'],
  ['EG', 'Egypt'],
  ['SV', 'El Salvador', 'salvador'],
  ['GQ', 'Equatorial Guinea'],
  ['ER', 'Eritrea'],
  ['EE', 'Estonia'],
  ['SZ', 'Eswatini', 'swaziland'],
  ['ET', 'Ethiopia'],
  ['FJ', 'Fiji'],
  ['FI', 'Finland'],
  ['FR', 'France'],
  ['GA', 'Gabon'],
  ['GM', 'Gambia', 'the gambia'],
  ['GE', 'Georgia'],
  ['DE', 'Germany', 'deutschland'],
  ['GH', 'Ghana'],
  ['GR', 'Greece', 'hellas'],
  ['GD', 'Grenada'],
  ['GT', 'Guatemala'],
  ['GN', 'Guinea', 'guinea conakry'],
  ['GW', 'Guinea-Bissau', 'guinea bissau'],
  ['GY', 'Guyana'],
  ['HT', 'Haiti'],
  ['HN', 'Honduras'],
  ['HU', 'Hungary'],
  ['IS', 'Iceland'],
  ['IN', 'India'],
  ['ID', 'Indonesia'],
  ['IR', 'Iran', 'persia', 'islamic republic of iran'],
  ['IQ', 'Iraq'],
  ['IE', 'Ireland', 'republic of ireland', 'eire'],
  ['IL', 'Israel'],
  ['IT', 'Italy', 'italia'],
  ['JM', 'Jamaica'],
  ['JP', 'Japan', 'nippon'],
  ['JO', 'Jordan'],
  ['KZ', 'Kazakhstan', 'kazakstan'],
  ['KE', 'Kenya'],
  ['KI', 'Kiribati'],
  ['XK', 'Kosovo'],
  ['KW', 'Kuwait'],
  ['KG', 'Kyrgyzstan', 'kyrgyz republic', 'kirgizstan', 'kyrgyzia'],
  ['LA', 'Laos', 'lao pdr', 'lao'],
  ['LV', 'Latvia'],
  ['LB', 'Lebanon'],
  ['LS', 'Lesotho'],
  ['LR', 'Liberia'],
  ['LY', 'Libya'],
  ['LI', 'Liechtenstein'],
  ['LT', 'Lithuania'],
  ['LU', 'Luxembourg', 'luxemburg'],
  ['MG', 'Madagascar'],
  ['MW', 'Malawi'],
  ['MY', 'Malaysia'],
  ['MV', 'Maldives', 'the maldives'],
  ['ML', 'Mali'],
  ['MT', 'Malta'],
  ['MH', 'Marshall Islands', 'marshalls'],
  ['MR', 'Mauritania'],
  ['MU', 'Mauritius'],
  ['MX', 'Mexico'],
  ['FM', 'Micronesia', 'federated states of micronesia'],
  ['MD', 'Moldova'],
  ['MC', 'Monaco'],
  ['MN', 'Mongolia'],
  ['ME', 'Montenegro'],
  ['MA', 'Morocco'],
  ['MZ', 'Mozambique'],
  ['MM', 'Myanmar', 'burma'],
  ['NA', 'Namibia'],
  ['NR', 'Nauru'],
  ['NP', 'Nepal'],
  ['NL', 'Netherlands', 'holland', 'the netherlands'],
  ['NZ', 'New Zealand', 'aotearoa'],
  ['NI', 'Nicaragua'],
  ['NE', 'Niger'],
  ['NG', 'Nigeria'],
  ['KP', 'North Korea', 'dprk', "democratic people's republic of korea"],
  ['MK', 'North Macedonia', 'macedonia'],
  ['NO', 'Norway'],
  ['OM', 'Oman'],
  ['PK', 'Pakistan'],
  ['PW', 'Palau'],
  ['PS', 'Palestine', 'state of palestine'],
  ['PA', 'Panama'],
  ['PG', 'Papua New Guinea', 'png'],
  ['PY', 'Paraguay'],
  ['PE', 'Peru'],
  ['PH', 'Philippines', 'the philippines'],
  ['PL', 'Poland'],
  ['PT', 'Portugal'],
  ['QA', 'Qatar'],
  ['RO', 'Romania'],
  ['RU', 'Russia', 'russian federation'],
  ['RW', 'Rwanda'],
  ['KN', 'Saint Kitts and Nevis', 'saint kitts', 'saint christopher and nevis'],
  ['LC', 'Saint Lucia'],
  ['VC', 'Saint Vincent and the Grenadines', 'saint vincent'],
  ['WS', 'Samoa'],
  ['SM', 'San Marino'],
  ['ST', 'São Tomé and Príncipe', 'sao tome'],
  ['SA', 'Saudi Arabia', 'ksa', 'saudi'],
  ['SN', 'Senegal'],
  ['RS', 'Serbia'],
  ['SC', 'Seychelles'],
  ['SL', 'Sierra Leone'],
  ['SG', 'Singapore'],
  ['SK', 'Slovakia', 'slovak republic'],
  ['SI', 'Slovenia'],
  ['SB', 'Solomon Islands', 'solomons'],
  ['SO', 'Somalia'],
  ['ZA', 'South Africa', 'rsa'],
  ['KR', 'South Korea', 'republic of korea', 'rok'],
  ['SS', 'South Sudan'],
  ['ES', 'Spain', 'espana'],
  ['LK', 'Sri Lanka', 'ceylon'],
  ['SD', 'Sudan'],
  ['SR', 'Suriname', 'surinam'],
  ['SE', 'Sweden'],
  ['CH', 'Switzerland'],
  ['SY', 'Syria'],
  ['TW', 'Taiwan', 'chinese taipei'],
  ['TJ', 'Tajikistan'],
  ['TZ', 'Tanzania'],
  ['TH', 'Thailand', 'siam'],
  ['TL', 'Timor-Leste', 'east timor', 'timor leste'],
  ['TG', 'Togo'],
  ['TO', 'Tonga'],
  ['TT', 'Trinidad and Tobago', 'trinidad'],
  ['TN', 'Tunisia'],
  ['TR', 'Turkey', 'turkiye'],
  ['TM', 'Turkmenistan'],
  ['TV', 'Tuvalu'],
  ['UG', 'Uganda'],
  ['UA', 'Ukraine'],
  ['AE', 'United Arab Emirates', 'uae', 'emirates'],
  ['GB', 'United Kingdom', 'uk', 'britain', 'great britain', 'england', 'gb'],
  ['US', 'United States', 'usa', 'us', 'america', 'united states of america'],
  ['UY', 'Uruguay'],
  ['UZ', 'Uzbekistan'],
  ['VU', 'Vanuatu'],
  ['VA', 'Vatican City', 'vatican', 'holy see'],
  ['VE', 'Venezuela'],
  ['VN', 'Vietnam', 'viet nam'],
  ['YE', 'Yemen'],
  ['ZM', 'Zambia'],
  ['ZW', 'Zimbabwe'],
];

// Inputs that could reasonably mean more than one country. Candidates are in
// preference order; the game picks whichever one is actually in the answers.
const AMBIGUOUS = {
  congo: ['CD', 'CG'],
  korea: ['KR', 'KP'],
};

export const BY_CODE = new Map(COUNTRIES.map(([code, name]) => [code, name]));

export function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’‘`´.]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bst\b/g, 'saint')
    .trim()
    .replace(/^the /, '')
    .replace(/\s+/g, ' ');
}

const LOOKUP = new Map();
for (const [code, name, ...aliases] of COUNTRIES) {
  for (const key of [name, ...aliases]) LOOKUP.set(normalize(key), [code]);
}
for (const [key, codes] of Object.entries(AMBIGUOUS)) LOOKUP.set(key, codes);

// Optimal string alignment distance (Levenshtein + adjacent transpositions).
function distance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d = Array.from({ length: rows }, (_, i) => {
    const row = new Array(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function typoAllowance(length) {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

/**
 * Resolve free text to candidate country codes.
 * Returns an array of ISO codes (most likely first), or [] if nothing matches.
 * Typos are tolerated only when they point at a single country.
 */
export function resolveCountry(text) {
  const key = normalize(text);
  if (!key) return [];
  const exact = LOOKUP.get(key);
  if (exact) return exact;

  const allowance = typoAllowance(key.length);
  if (allowance === 0) return [];
  let best = Infinity;
  let codes = new Set();
  for (const [candidate, candidateCodes] of LOOKUP) {
    if (Math.abs(candidate.length - key.length) > allowance) continue;
    const dist = distance(key, candidate);
    if (dist > allowance || dist > best) continue;
    if (dist < best) {
      best = dist;
      codes = new Set();
    }
    candidateCodes.forEach((c) => codes.add(c));
  }
  return codes.size === 1 ? [...codes] : [];
}
