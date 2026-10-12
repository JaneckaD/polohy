#!/usr/bin/env bash
# Vlastní OSRM se silnicemi okolí Zlínského kraje (v GitHub Actions): trasy linek se pak počítají bez
# omezení veřejného serveru (1 dotaz za sekundu), takže se každé nasazení spočítají všechny znovu.
# Data jsou v osrm/ (uchovává je actions/cache), server poslouchá na http://localhost:5000.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE=ghcr.io/project-osrm/osrm-backend:v5.27.1
# Zlínský, Jihomoravský, Olomoucký a Moravskoslezský kraj s okolím.
BBOX=15.4,48.5,18.95,50.5
mkdir -p osrm
if [ ! -f osrm/region.osrm.mldgr ]; then
  rm -f osrm/*
  curl -sSfL -o osrm/cz.osm.pbf https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf
  sudo apt-get install -y -qq osmium-tool > /dev/null
  osmium extract -b "$BBOX" osrm/cz.osm.pbf -o osrm/region.osm.pbf --overwrite
  rm osrm/cz.osm.pbf
  docker run --rm -v "$PWD/osrm:/data" "$IMAGE" osrm-extract -p /opt/car.lua /data/region.osm.pbf
  docker run --rm -v "$PWD/osrm:/data" "$IMAGE" osrm-partition /data/region.osrm
  docker run --rm -v "$PWD/osrm:/data" "$IMAGE" osrm-customize /data/region.osrm
  rm osrm/region.osm.pbf
  # Soubory z kontejneru patří rootovi; actions/cache je jinak neuloží.
  sudo chown -R "$(id -u):$(id -g)" osrm
fi
docker run -d --name osrm -p 5000:5000 -v "$PWD/osrm:/data" "$IMAGE" \
  osrm-routed --algorithm mld --max-matching-size 500 --max-viaroute-size 500 /data/region.osrm
for i in $(seq 1 60); do
  if curl -sf "http://localhost:5000/route/v1/driving/17.6679,49.2265;17.5303,49.2093" > /dev/null; then
    echo "OSRM běží."
    echo "OSRM_URL=http://localhost:5000" >> "$GITHUB_ENV"
    exit 0
  fi
  sleep 2
done
echo "OSRM se nespustil, použije se veřejný server." >&2
docker logs osrm >&2 || true
exit 1
