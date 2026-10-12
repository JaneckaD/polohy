import json, urllib.request, urllib.parse, time
def get(u, raw=False):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 polohy-probe"})
    t = time.time()
    with urllib.request.urlopen(req, timeout=30) as r:
        b = r.read()
        print("GET", u[:170], r.status, len(b), "B", round(time.time() - t, 2), "s CORS:", r.headers.get("Access-Control-Allow-Origin"))
        return b if raw else json.loads(b)
def show(u, n=3000):
    try:
        d = get(u)
        print(json.dumps(d, ensure_ascii=False)[:n])
        return d
    except Exception as e:
        print("ERR", u, e)
item = show("https://www.arcgis.com/sharing/rest/content/items/e8aa121910df41bb9a28e4ca34a263c7?f=json", 4000)
show("https://www.arcgis.com/sharing/rest/content/items/e8aa121910df41bb9a28e4ca34a263c7/data?f=json", 3000)
show("https://www.arcgis.com/sharing/rest/search?q=Kordis%20polohy&f=json&num=20", 6000)
for base in ["https://gis.brno.cz/ags1/rest/services/Hosted?f=json", "https://gis.brno.cz/ags1/rest/services?f=json"]:
    d = show(base, 200)
    if d:
        for s in d.get("services", []):
            if "ordis" in s.get("name", "") or "polohy" in s.get("name", "").lower():
                print("SERVICE", s)
url = (item or {}).get("url")
if url:
    for u in [url + "?f=json", url + "/0?f=json"]:
        show(u, 4000)
    for q in ["/0/query?where=1%3D1&outFields=*&resultRecordCount=6&f=json", "/0/query?where=1%3D1&returnCountOnly=true&f=json"]:
        show(url + q, 6000)
    if "StreamServer" in url:
        show(url + "?f=json", 4000)
