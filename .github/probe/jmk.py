import json, urllib.request, time, collections
import websocket
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 polohy-probe"})
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read(); print("GET", u, r.status, len(b), "CORS:", r.headers.get("Access-Control-Allow-Origin")); return json.loads(b)
S = "https://gis.brno.cz/ags4/rest/services/Kordis_stream/StreamServer"
d = {}
try:
    d = get(S + "?f=json"); print(json.dumps(d, ensure_ascii=False)[:2500])
except Exception as e: print("ERR", e)
urls = []
for su in d.get("streamUrls", []):
    for u in su.get("urls", []):
        urls.append(u + "/subscribe" + ("?token=" + su["token"] if su.get("token") else ""))
urls.append("wss://gis.brno.cz/ags4/rest/services/Kordis_stream/StreamServer/subscribe")
seen = {}; n = 0
for u in urls[:1] + ["wss://gis.brno.cz/geoevent/ws/services/Kordis_stream/StreamServer/subscribe?outSR=4326"]:
    print("WS", u)
    try:
        ws = websocket.create_connection(u, timeout=40, header=["User-Agent: Mozilla/5.0"], origin="https://data.brno.cz")
        t0 = time.time(); first = None; sizes = 0
        while time.time() - t0 < 45:
            try: m = ws.recv()
            except Exception as e: print("recv", e); break
            n += 1; sizes += len(m)
            if n <= 3: print("MSG", m[:900])
            try:
                j = json.loads(m); a = j.get("attributes", j)
                if first is None: first = round(time.time() - t0, 2)
                g = j.get("geometry") or {}
                a["_x"] = g.get("x"); a["_y"] = g.get("y")
                seen[a.get("id")] = a
            except Exception: pass
        ws.close()
        print("messages", n, "bytes", sizes, "first after", first, "s, distinct vehicles", len(seen))
        if seen: break
    except Exception as e:
        print("ERR ws", e)
types = collections.Counter((a.get("vtype"), a.get("ltype")) for a in seen.values())
print("BY (vtype,ltype)", types.most_common())
print("LINES", collections.Counter(str(a.get("linename")) for a in seen.values()).most_common(120))
print("KEYS", sorted({k for a in seen.values() for k in a}))
for a in list(seen.values())[:6]: print(json.dumps(a, ensure_ascii=False))
