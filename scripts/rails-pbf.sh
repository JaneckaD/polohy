#!/usr/bin/env bash
# Železniční tratě oblasti vlaků (Zlínský a Jihomoravský kraj, region.json properties.rail) z dat OpenStreetMap od Geofabriku (v GitHub Actions), když Overpass nejde
# (bývá přetížený). Výsledek: railcache/rails.geojsonseq (koleje a stanice), z něj staví scripts/build-rails.mjs.
# Soubor uchovává actions/cache (obnoví se jednou týdně nebo se změnou oblasti).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p railcache
if [ -s railcache/rails.geojsonseq ]; then
  echo "Koleje z cache."
  exit 0
fi
command -v osmium > /dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq osmium-tool > /dev/null; }
curl -sSfL -o railcache/cz.osm.pbf https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
node -e "
const r = JSON.parse(require('fs').readFileSync('public/region.json', 'utf8'));
require('fs').writeFileSync('railcache/area.geojson', JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: r.properties?.rail ? { type: 'Polygon', coordinates: [r.properties.rail] } : r.geometry }] }));
"
osmium tags-filter railcache/cz.osm.pbf w/railway=rail,narrow_gauge n/railway=station,halt -o railcache/rail.osm.pbf --overwrite
osmium extract -p railcache/area.geojson railcache/rail.osm.pbf -o railcache/area.osm.pbf --overwrite
osmium export railcache/area.osm.pbf -f geojsonseq --geometry-types=point,linestring --add-unique-id=type_id \
  -o railcache/rails.geojsonseq --overwrite
rm -f railcache/cz.osm.pbf railcache/rail.osm.pbf railcache/area.osm.pbf
echo "Koleje z Geofabriku: $(wc -l < railcache/rails.geojsonseq) prvků."
