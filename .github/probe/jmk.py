import json, urllib.request, time, collections, subprocess, sys
import websocket
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 polohy-probe"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read(); print("GET", u, r.status, len(b), "CORS:", r.headers.get("Access-Control-Allow-Origin")); return json.loads(b)
it = get("https://www.arcgis.com/sharing/rest/content/items/e8aa121910df41bb9a28e4ca34a263c7?f=json")
print("ITEM url", it.get("url"), "licence", (it.get("licenseInfo") or "")[:300])
S = "https://gis.brno.cz/ags4/rest/services/stream_kordis_26/StreamServer"
try:
    d = get(S + "?f=json"); print(json.dumps(d, ensure_ascii=False)[:3000])
except Exception as e:
    print("ERR", e); d = {}
urls = []
for su in d.get("streamUrls", []):
    for u in su.get("urls", []):
        urls.append(u + ("?token=" + su["token"] if su.get("token") else ""))
urls.append("wss://gis.brno.cz/ags4/rest/services/stream_kordis_26/StreamServer/subscribe")
seen = {}
types = collections.Counter()
n = 0
for u in urls[:2]:
    print("WS", u)
    try:
        ws = websocket.create_connection(u, timeout=10, header=["User-Agent: Mozilla/5.0"], origin="https://data.brno.cz")
        t0 = time.time(); first = None
        while time.time() - t0 < 25:
            try: m = ws.recv()
            except Exception as e: print("recv", e); break
            n += 1
            if n <= 4: print("MSG", m[:900])
            try:
                j = json.loads(m)
                a = j.get("attributes", j)
                if first is None: first = time.time() - t0
                seen[a.get("id")] = a
            except Exception: pass
        ws.close()
        print("messages", n, "first after", first, "s, distinct vehicles", len(seen))
        break
    except Exception as e:
        print("ERR ws", e)
for a in seen.values(): types[(a.get("vtype"), a.get("ltype"))] += 1
print("BY (vtype,ltype)", types.most_common())
lines = collections.Counter(a.get("linename") for a in seen.values())
print("LINES", lines.most_common(80))
print("KEYS", sorted({k for a in seen.values() for k in a}))
for a in list(seen.values())[:5]: print(json.dumps(a, ensure_ascii=False))
