// The built-in question bank: every round tagged with its theme and a stable id
// (used to remember which rounds a player has already seen).

import economy from './economy.js';
import people from './people.js';
import geography from './geography.js';
import regions from './regions.js';
import nature from './nature.js';
import energy from './energy.js';
import food from './food.js';
import society from './society.js';
import sport from './sport.js';

export const THEMES = [
  { id: 'economy', label: 'Economy', rounds: economy },
  { id: 'people', label: 'People', rounds: people },
  { id: 'geography', label: 'Geography', rounds: geography },
  { id: 'regions', label: 'Regions', rounds: regions },
  { id: 'nature', label: 'Nature', rounds: nature },
  { id: 'energy', label: 'Energy', rounds: energy },
  { id: 'food', label: 'Food', rounds: food },
  { id: 'society', label: 'Society', rounds: society },
  { id: 'sport', label: 'Sport', rounds: sport },
];

export const THEME_LABELS = Object.fromEntries(THEMES.map(({ id, label }) => [id, label]));

const slug = (text) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const BANK = THEMES.flatMap(({ id: theme, rounds }) =>
  rounds.map((round) => ({ ...round, theme, id: `${round.direction}-${slug(round.title)}` })),
);
