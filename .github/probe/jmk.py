import json, time, collections, websocket, urllib.request, zipfile, io, csv
def get(u):
    try:
        r = urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"}), timeout=60)
        return r.read()
    except Exception as e:
        return ("ERR %s" % e).encode()
meta = get("https://gis.brno.cz/ags4/rest/services/Kordis_stream/StreamServer?f=json")
print("META", meta[:3000].decode("utf8", "replace"))
for q in ["query?where=1%3D1&outFields=*&f=json&resultRecordCount=3", "lastObservations?f=json"]:
    print("TRY", q, get("https://gis.brno.cz/ags4/rest/services/Kordis_stream/StreamServer/" + q)[:800])
U = "wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe"
ws = websocket.create_connection(U, timeout=40, origin="https://janeckad.github.io")
seen = {}
t0 = time.time()
while time.time() - t0 < 35:
    try: m = ws.recv()
    except Exception: break
    j = json.loads(m); a = j.get("attributes")
    if a: seen[a["ID"]] = a
ws.close()
print("seen", len(seen))
z = zipfile.ZipFile(io.BytesIO(get("https://kordis-jmk.cz/gtfs/gtfs.zip")))
print("FILES", z.namelist())
def rows(n):
    return csv.DictReader(io.TextIOWrapper(z.open(n), "utf-8-sig"))
stops = {r["stop_id"]: r for r in rows("stops.txt")}
print("STOP sample", list(stops.values())[:3])
print("stop_id sample", list(stops)[:20])
routes = {r["route_id"]: r for r in rows("routes.txt")}
print("ROUTE sample", list(routes.values())[:3])
print("route types", collections.Counter(r["route_type"] for r in routes.values()))
for t in sorted({r["route_type"] for r in routes.values()}):
    print("type", t, sorted({r["route_short_name"] for r in routes.values() if r["route_type"] == t})[:80])
trips = list(rows("trips.txt"))
print("TRIP sample", trips[:3])
print("trips per type", collections.Counter(routes[t["route_id"]]["route_type"] for t in trips))
# match stream to GTFS
hit = collections.Counter()
for a in list(seen.values()):
    for k in ("LastStopID", "FinalStopID"):
        s = str(a[k])
        cand = [sid for sid in (s, "U%s" % s) if sid in stops]
        pref = [sid for sid in stops if sid.split("Z")[0] in ("U" + s, s)][:1]
        hit[k + (" exact" if cand else " prefix" if pref else " none")] += 1
print("STOP MATCH", hit)
byp = collections.defaultdict(list)
for sid, r in stops.items():
    byp[sid.split("Z")[0].split("N")[0]].append(sid)
for a in list(seen.values())[:12]:
    ls, fs = str(a["LastStopID"]), str(a["FinalStopID"])
    def nm(x):
        for key in (x, "U" + x):
            if key in stops: return stops[key]["stop_name"]
            if key in byp: return [stops[i]["stop_name"] for i in byp[key][:2]]
        return None
    print(a["LineName"], a["LineID"], a["RouteID"], a["Course"], "last", ls, nm(ls), "final", fs, nm(fs))
print("LINEID vs route_id", [(a["LineID"], a["LineName"], routes.get("L%s" % a["LineID"], {}).get("route_short_name")) for a in list(seen.values())[:15]])
