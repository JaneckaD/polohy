// Minimalistický bílý styl mapy nad vektorovými dlaždicemi OpenFreeMap (schéma OpenMapTiles).
// Ukazuje jen vodu, světle šedé ulice a názvy obcí. Žádné budovy, POI ani názvy ulic.

const ROAD_COLOR = '#e4e4e4';
const MAJOR_ROAD_COLOR = '#d6d6d6';

export const mapStyle = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    omt: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
      attribution:
        '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
    {
      id: 'water',
      type: 'fill',
      source: 'omt',
      'source-layer': 'water',
      paint: { 'fill-color': '#eef3f6' },
    },
    {
      id: 'roads-minor',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROAD_COLOR,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 12, 0.5, 16, 4, 18, 10],
      },
    },
    {
      id: 'roads-major',
      type: 'line',
      source: 'omt',
      'source-layer': 'transportation',
      filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': MAJOR_ROAD_COLOR,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 8, 0.5, 12, 1.5, 16, 6, 18, 14],
      },
    },
    {
      id: 'places',
      type: 'symbol',
      source: 'omt',
      'source-layer': 'place',
      filter: ['in', ['get', 'class'], ['literal', ['city', 'town', 'village']]],
      layout: {
        'text-field': ['coalesce', ['get', 'name:cs'], ['get', 'name']],
        'text-font': ['Noto Sans Regular'],
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          8, ['match', ['get', 'class'], 'city', 13, 'town', 11, 9],
          14, ['match', ['get', 'class'], 'city', 18, 'town', 15, 13],
        ],
        'text-max-width': 8,
        'symbol-sort-key': ['match', ['get', 'class'], 'city', 0, 'town', 1, 2],
      },
      paint: {
        'text-color': '#8a8a8a',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
      },
    },
  ],
};
