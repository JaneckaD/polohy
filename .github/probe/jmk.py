import json, time, collections, websocket
U = "wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe"
def run(label, secs, send=None, origin="https://janeckad.github.io"):
    seen = {}; times = collections.defaultdict(list); n = 0; size = 0
    ws = websocket.create_connection(U, timeout=secs, origin=origin, header=["User-Agent: Mozilla/5.0"])
    if send: ws.send(json.dumps(send))
    t0 = time.time(); first = None
    while time.time() - t0 < secs:
        try: m = ws.recv()
        except Exception as e: print(label, "recv", e); break
        n += 1; size += len(m)
        try:
            j = json.loads(m); a = j.get("attributes")
            if not a: print(label, "NONFEATURE", m[:300]); continue
            if first is None: first = round(time.time() - t0, 1)
            seen[a["ID"]] = a; times[a["ID"]].append(round(time.time() - t0, 1))
        except Exception as e: print(label, "bad", m[:200])
    ws.close()
    gaps = [b - a for ts in times.values() for a, b in zip(ts, ts[1:])]
    gaps.sort()
    print(label, "msgs", n, "bytes", size, "first", first, "distinct", len(seen), "median gap", gaps[len(gaps)//2] if gaps else None)
    return seen
seen = run("ALL", 75)
print("VTYPE", collections.Counter(a["VType"] for a in seen.values()).most_common())
print("LTYPE", collections.Counter(a["LType"] for a in seen.values()).most_common())
print("INACTIVE", collections.Counter(a["IsInactive"] for a in seen.values()).most_common())
for vt in sorted({a["VType"] for a in seen.values()}):
    print("LINES vtype", vt, collections.Counter(a["LineName"] for a in seen.values() if a["VType"] == vt).most_common(60))
now = time.time() * 1000
ages = sorted((now - a["TimeUpdated"]) / 1000 for a in seen.values())
print("AGE s p10/p50/p90", [round(ages[int(len(ages) * q)]) for q in (0.1, 0.5, 0.9)] if ages else None)
print("IDB/IDC", collections.Counter((a["IDB"], a["IDC"]) for a in seen.values()).most_common(10))
for a in list(seen.values())[:10]: print(json.dumps(a, ensure_ascii=False))
# filter test: Brno centre only, few fields
run("FILTER", 40, send={"filter": {"geometry": {"xmin": 16.58, "ymin": 49.18, "xmax": 16.63, "ymax": 49.21, "spatialReference": {"wkid": 4326}}, "outFields": "ID,LineName,Lat,Lng"}})
