// Generates fresh rounds with the Gemini API. Runs only on the server: the key
// and the provider never reach the browser.

import { COUNTRIES } from '../public/js/countries.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const FALLBACK_MODEL = 'gemini-3.6-flash';
const TIMEOUT_MS = 30_000;

// `both` themes work as top or bottom 10; `top` themes only make sense as top 10
// (their bottom 10 would be a pile of zeros or missing data).
export const THEMES = [
  ['GDP (nominal)', 'both'],
  ['GDP per capita', 'both'],
  ['GDP growth rate', 'both'],
  ['Population', 'both'],
  ['Population density', 'both'],
  ['Total area', 'both'],
  ['International tourist arrivals', 'top'],
  ['International tourism revenue', 'top'],
  ['Life expectancy', 'both'],
  ['Median age', 'both'],
  ['Fertility rate', 'both'],
  ['Urban population share', 'both'],
  ['Highest natural elevation', 'both'],
  ['Coastline length', 'top'],
  ['Forest cover share', 'both'],
  ['Crude oil production', 'top'],
  ['Proven oil reserves', 'top'],
  ['Natural gas production', 'top'],
  ['Coffee production', 'top'],
  ['Wheat production', 'top'],
  ['Rice production', 'top'],
  ['Wine production', 'top'],
  ['Cocoa production', 'top'],
  ['Banana production', 'top'],
  ['CO2 emissions', 'top'],
  ['CO2 emissions per capita', 'both'],
  ['Share of electricity from renewables', 'both'],
  ['Military spending', 'top'],
  ['Active military personnel', 'top'],
  ['Summer Olympic medals (all-time)', 'top'],
  ['UNESCO World Heritage Sites', 'top'],
  ['Billionaires', 'top'],
  ['Internet users', 'top'],
  ['Internet penetration rate', 'both'],
  ['Goods exports', 'top'],
  ['Gold reserves', 'top'],
  ['Foreign exchange reserves', 'top'],
  ['Railway network length', 'top'],
  ['Car production', 'top'],
  ['Human Development Index', 'both'],
  ['Unemployment rate', 'both'],
  ['Public debt as a share of GDP', 'both'],
  ['Average annual precipitation', 'both'],
  ['Electricity consumption per capita', 'both'],
  ['Number of land borders', 'top'],
  ['Coffee consumption per capita', 'top'],
  ['Beer consumption per capita', 'top'],
  ['Nobel laureates', 'top'],
  ['Doctors per capita', 'both'],
  ['Literacy rate', 'bottom'],
  ['Infant mortality rate', 'both'],
  ['Refugees hosted', 'top'],
  ['Number of airports', 'top'],
  ['Nuclear power generation', 'top'],
];

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short category name, e.g. "GDP per capita". Max 40 characters.' },
    description: { type: 'string', description: 'One short sentence saying exactly what is measured.' },
    source: { type: 'string', description: 'Data source and year, e.g. "IMF, 2024".' },
    answers: {
      type: 'array',
      minItems: 10,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          country: { type: 'string', description: 'Country name copied exactly from the allowed list.' },
          value: { type: 'string', description: 'Human-readable value with units, e.g. "$135,600" or "1.43 billion".' },
        },
        required: ['country', 'value'],
      },
    },
  },
  required: ['title', 'description', 'source', 'answers'],
};

const ALLOWED_NAMES = COUNTRIES.map(([, name]) => name).join('; ');

export function isConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function buildPrompt({ direction, theme, avoid }) {
  const which = direction === 'top' ? 'TOP 10 (highest values)' : 'BOTTOM 10 (lowest values)';
  const avoidLine = avoid.length
    ? `The player has recently seen these categories, so do not repeat them: ${avoid.join('; ')}.`
    : '';
  return [
    'You write rounds for a geography quiz where players must name the countries in a ranked list.',
    `Create one round: the ${which} countries for a category related to the theme "${theme}".`,
    'You may use the theme directly or a closely related, well-known measure.',
    avoidLine,
    '',
    'Rules:',
    '- Only use categories with reliable, widely published country rankings (World Bank, IMF, UN agencies, CIA World Factbook, SIPRI, EIA, FAO, UNESCO, etc.). Accuracy matters more than novelty.',
    '- Rank only sovereign states. Never include territories, dependencies or regions (no Hong Kong, Macau, Greenland, Puerto Rico, etc.).',
    `- Every country name must be copied exactly from this list: ${ALLOWED_NAMES}.`,
    '- Exactly 10 distinct countries, ordered rank 1 to 10, where rank 1 is the most extreme value in the requested direction.',
    '- For a bottom 10, pick a measure where the lowest values are meaningful and reported for most countries (not many zeros or missing values).',
    '- Values: short and human-readable with units. Use "~" when approximate.',
    '- The description is one sentence for players. Do not mention the ranking direction in the title.',
    '',
    'Respond with JSON only.',
  ].join('\n');
}

function extractText(body) {
  if (typeof body?.output_text === 'string') return body.output_text;
  const parts = [];
  for (const step of body?.steps ?? body?.outputs ?? []) {
    if (typeof step?.text === 'string') parts.push(step.text);
    for (const item of step?.content ?? []) {
      if (typeof item?.text === 'string') parts.push(item.text);
    }
  }
  for (const candidate of body?.candidates ?? []) {
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part?.text === 'string' && !part.thought) parts.push(part.text);
    }
  }
  return parts.join('');
}
export { extractText as _extractText };

export function parseJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('No JSON object in model output');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function post(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = json?.error?.message ?? res.statusText;
      const err = new Error(`HTTP ${res.status}: ${message}`);
      err.status = res.status;
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

// The Interactions API is current; generateContent is kept as a fallback for
// models or keys that only support the older endpoint.
const STRATEGIES = {
  interactions: (model, prompt) =>
    post(`${API_BASE}/interactions`, {
      model,
      input: prompt,
      response_format: { type: 'text', mime_type: 'application/json', schema: SCHEMA },
      generation_config: { thinking_level: 'low' },
    }),
  generateContent: (model, prompt) =>
    post(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
};

let preferred = null; // [strategy, model] that last succeeded

function attempts() {
  const models = [...new Set([process.env.GEMINI_MODEL || DEFAULT_MODEL, FALLBACK_MODEL])];
  const all = [];
  for (const model of models) {
    for (const strategy of Object.keys(STRATEGIES)) all.push([strategy, model]);
  }
  if (preferred) {
    const i = all.findIndex(([s, m]) => s === preferred[0] && m === preferred[1]);
    if (i > 0) all.unshift(...all.splice(i, 1));
  }
  return all;
}

/** Ask the model for a round. Returns the raw parsed JSON (validated elsewhere). */
export async function requestRound(options) {
  const prompt = buildPrompt(options);
  let lastError;
  for (const [strategy, model] of attempts()) {
    try {
      const body = await STRATEGIES[strategy](model, prompt);
      const text = extractText(body);
      if (!text) throw new Error('Empty model output');
      preferred = [strategy, model];
      return parseJson(text);
    } catch (err) {
      lastError = err;
      // Only fall through to another endpoint/model when this one looks
      // unsupported; auth, quota and timeout errors won't be fixed by retrying.
      if (![400, 404].includes(err.status)) break;
    }
  }
  throw lastError;
}
