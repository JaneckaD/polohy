import json, urllib.request, urllib.parse
def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 polohy-probe"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())
for host in ["https://gis.brno.cz/ags4/rest/services", "https://gis.brno.cz/ags1/rest/services", "https://gis.brno.cz/ags2/rest/services", "https://gis.brno.cz/ags3/rest/services"]:
    try:
        root = get(host + "?f=json")
    except Exception as e:
        print("ERR", host, e); continue
    print(host, "folders", root.get("folders"))
    todo = [""] + [f + "/" for f in root.get("folders", [])]
    for f in todo:
        try:
            d = get(host + "/" + f + "?f=json") if f else root
        except Exception as e:
            print(" ERR", f, e); continue
        for s in d.get("services", []):
            n = s["name"].lower()
            if any(k in n for k in ["kordis", "polo", "stream", "vehic", "vozid", "ids", "mhd", "dpmb"]):
                print(" SERVICE", s)
for q in ["KORDIS", "polohy vozidel", "IDS JMK poloha", "stream_kordis"]:
    try:
        d = get("https://www.arcgis.com/sharing/rest/search?" + urllib.parse.urlencode({"q": q + " owner:OpenDataBrno", "f": "json", "num": 30}))
        for r in d.get("results", []):
            print("ITEM", q, "|", r["id"], r["type"], r["title"], r.get("url"), r.get("modified"))
    except Exception as e:
        print("ERR search", e)
