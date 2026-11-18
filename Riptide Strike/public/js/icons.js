// Icons, as inline SVG: a side view of each ship, and a symbol for each weapon slot.

const svg = (vb, body, cls = '') => `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" fill="currentColor">${body}</svg>`;

// Side views, bow to the right
export const SHIPS = {
  interceptor: svg('0 0 120 40', '<path d="M6 26h96l14-9H40l-6-6H24l-4 6H10z"/><rect x="30" y="7" width="14" height="5" rx="1.5"/><path d="M70 14h18v3H70z"/><rect x="4" y="22" width="5" height="10" rx="1"/>'),
  corvette: svg('0 0 120 40', '<path d="M4 27h104l10-8H90V15H76l-4-6h-4l-2 6H50l-6 4H30v-3H20v3H6z"/><path d="M66 9l3-7 3 7z"/><rect x="92" y="13" width="9" height="4" rx="1"/><path d="M100 14h12v1.6h-12z"/>'),
  destroyer: svg('0 0 120 40', '<path d="M3 27h106l9-8h-22v-5H80l-3-5h-5l-2 5H46v-3H36l-4-3h-6v6H16v3H4z"/><path d="M71 9l3-8 3 8z"/><rect x="83" y="16" width="12" height="3" rx="1"/><rect x="97" y="13" width="9" height="4" rx="1"/><path d="M105 14h11v1.6h-11z"/>'),
  carrier: svg('0 0 120 40', '<path d="M2 27h108l8-6v-3H2z"/><path d="M4 18h112v-3H4z"/><path d="M28 15V6h12l3 9z"/><path d="M33 6l2-5 2 5z"/><path d="M60 13l6-2 6 2-6 1z"/><path d="M82 13l6-2 6 2-6 1z"/>'),
};

export const SLOT_ICONS = {
  gun: svg('0 0 24 24', '<path d="M2 10h13v4H2zM15 9h3v6h-3zM18 11h4v2h-4zM5 14h3v5H5z"/>'),
  cannon: svg('0 0 24 24', '<path d="M3 13l12-6 1.5 3-12 6zM16 9h6v2h-6zM4 15h9v5H4z"/>'),
  missile: svg('0 0 24 24', '<path d="M3 11h13l5 1-5 1H3zM5 8l3 3H4zM5 16l3-3H4zM1 11.5h2v1H1z"/>'),
  air: svg('0 0 24 24', '<path d="M2 12l8-1 4-8h2l-2 8 7 1-7 1 2 8h-2l-4-8-8-1z"/>'),
};

export const SLOT_NAMES = { gun: 'Gun', cannon: 'Cannon', missile: 'Missile', air: 'Air strike' };
export const SLOT_KEYS = { gun: 'Space', cannon: 'E', missile: 'Q', air: 'F' };
