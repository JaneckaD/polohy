import json, urllib.request, time
B = "https://gis.brno.cz/ags1/rest/services/Hosted/Kordis_26_polohy"
def get(u, raw=False):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 polohy-probe"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
        print("GET", u[:160], r.status, len(b), "B", round(time.time() - t, 2), "s", dict(r.headers).get("Access-Control-Allow-Origin"))
        return b if raw else json.loads(b)
for u in [B + "/FeatureServer?f=json", B + "/FeatureServer/0?f=json", B + "/StreamServer?f=json"]:
    try:
        d = get(u)
        s = json.dumps(d, ensure_ascii=False)
        print(s[:3500])
    except Exception as e:
        print("ERR", u, e)
try:
    d = get(B + "/FeatureServer/0/query?where=1%3D1&outFields=*&resultRecordCount=8&f=json")
    for f in d.get("features", [])[:8]:
        print(json.dumps(f, ensure_ascii=False))
    c = get(B + "/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json")
    print("COUNT", c)
    # counts by vtype, and freshness
    d = get(B + "/FeatureServer/0/query?where=1%3D1&outFields=*&outStatistics=" + urllib.parse.quote(json.dumps([{"statisticType":"count","onStatisticField":"objectid","outStatisticFieldName":"n"}])) + "&groupByFieldsForStatistics=vtype&f=json")
    print("BY VTYPE", json.dumps(d.get("features"), ensure_ascii=False))
except Exception as e:
    print("ERR query", e)
import urllib.parse
for q in ["where=1%3D1&outFields=*&orderByFields=lastupdate+DESC&resultRecordCount=5&f=json", "where=1%3D1&outFields=*&f=geojson&resultRecordCount=3"]:
    try:
        d = get(B + "/FeatureServer/0/query?" + q, raw=True)
        print(d[:2500].decode("utf8", "replace"))
    except Exception as e:
        print("ERR", q, e)
