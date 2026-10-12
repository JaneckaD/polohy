# Dočasná sonda: zdroje dat pro všechny autobusy v oblasti.
import zipfile, io, csv, collections, json, re, sys, urllib.request, os
def get(url, headers={}, timeout=300):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (mhd-zlin-live probe)', **headers})
    return urllib.request.urlopen(req, timeout=timeout).read()
def rows(z, name, limit=None):
    with z.open(name) as f:
        r = csv.DictReader(io.TextIOWrapper(f, 'utf-8-sig'))
        for i, row in enumerate(r):
            if limit and i >= limit: break
            yield row
def section(t): print('\n========', t, flush=True)

section('GGU JDF merged GTFS')
try:
    b = get('https://data.jr.ggu.cz/results/latest/JDF_merged_GTFS.zip', timeout=600)
    print('size MB', len(b) / 1e6)
    z = zipfile.ZipFile(io.BytesIO(b))
    for i in z.infolist(): print(' ', i.filename, i.file_size)
    for n in ['agency.txt', 'routes.txt', 'stops.txt', 'trips.txt', 'feed_info.txt', 'calendar.txt']:
        if n in z.namelist():
            print(n, list(rows(z, n, 3)))
    rt = collections.Counter(); pref = collections.Counter(); desc = collections.Counter()
    routes = list(rows(z, 'routes.txt'))
    for r in routes:
        rt[r.get('route_type')] += 1; pref[r['route_id'][:3]] += 1; desc[(r.get('route_desc') or '')[:30]] += 1
    print('routes', len(routes), 'types', rt.most_common(10)); print('desc', desc.most_common(15))
    st = list(rows(z, 'stops.txt'))
    withc = [s for s in st if s.get('stop_lat') and float(s['stop_lat'] or 0) != 0]
    print('stops', len(st), 'with coords', len(withc))
    jmk = [s for s in withc if 48.5 < float(s['stop_lat']) < 49.65 and 15.5 < float(s['stop_lon']) < 18.9]
    print('stops in box', len(jmk), jmk[:3])
    cal = list(rows(z, 'calendar.txt', 5)) if 'calendar.txt' in z.namelist() else []
    print('calendar sample', cal)
except Exception as e: print('ERR', e)

section('KORDIS IDS JMK GTFS')
try:
    b = get('https://kordis-jmk.cz/gtfs/gtfs.zip')
    z = zipfile.ZipFile(io.BytesIO(b)); print('size MB', len(b) / 1e6, z.namelist())
    routes = list(rows(z, 'routes.txt'))
    print('routes', len(routes), routes[:3])
    rt = collections.Counter(r['route_type'] for r in routes); print('types', rt)
    for t in rt:
        print('type', t, sorted({r['route_short_name'] for r in routes if r['route_type'] == t}, key=lambda x: (len(x), x))[:400])
    print('agency', list(rows(z, 'agency.txt')))
except Exception as e: print('ERR', e)

section('IDS JMK live vehicles')
try:
    html = get('https://mapa.idsjmk.cz/').decode()
    tok = re.search(r"initializeApplication\('([^']+)'", html).group(1)
    v = json.loads(get('https://mapa.idsjmk.cz/api/vehicles', {'X-Access-Token': tok, 'Referer': 'https://mapa.idsjmk.cz/'}))
    lst = v if isinstance(v, list) else v.get('Vehicles') or v.get('vehicles') or v
    print('type', type(v).__name__, 'keys', list(v.keys())[:10] if isinstance(v, dict) else '')
    print('count', len(lst)); print('sample', lst[:2])
    vt = collections.Counter(x.get('VType') for x in lst); print('VType', vt)
    for t in vt:
        sample = [x for x in lst if x.get('VType') == t]
        print('VType', t, 'lines', sorted({str(x.get('LineName')) for x in sample}, key=lambda s: (len(s), s))[:300])
        print('  sample', sample[0])
    other = [k for k in ('/api/lines', '/api/serviceinfo') ]
    for p in other:
        try:
            d = get('https://mapa.idsjmk.cz' + p, {'X-Access-Token': tok, 'Referer': 'https://mapa.idsjmk.cz/'})
            print(p, d[:1500])
        except Exception as e: print(p, 'ERR', e)
except Exception as e: print('ERR', e)

section('FlixBus GTFS')
for url in ['http://gtfs.gis.flix.tech/gtfs_generic_eu.zip', 'https://gtfs.gis.flix.tech/gtfs_generic_eu.zip']:
    try:
        b = get(url); z = zipfile.ZipFile(io.BytesIO(b)); print(url, 'MB', len(b) / 1e6, z.namelist())
        st = [s for s in rows(z, 'stops.txt') if 48.5 < float(s['stop_lat'] or 0) < 49.65 and 15.5 < float(s['stop_lon'] or 0) < 18.9]
        print('stops in box', len(st))
        for s in st: print('  ', s.get('stop_id'), s.get('stop_name'), s.get('stop_lat'), s.get('stop_lon'))
        break
    except Exception as e: print(url, 'ERR', e)

section('mpvnet IDZK carriers')
try:
    d = get('https://dszo-proxy.djanecka6.workers.dev/mhd')
    j = json.loads(d); print('vehicles', len(j.get('vehicles', [])))
    print(collections.Counter((x.get('cr'), x.get('cat')) for x in j.get('vehicles', [])).most_common(40))
except Exception as e: print('ERR', e)
