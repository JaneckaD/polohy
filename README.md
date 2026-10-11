# MHD Zlín live

PWA, která ukazuje živou polohu autobusů a trolejbusů DSZO (Zlín, Otrokovice) na bílé mapě kolem tebe.
Vozidla jsou červená kolečka s číslem linky a malou šipkou ve směru jízdy. Po klepnutí na vozidlo se ukáže
směr (konečná), zastávka a zpoždění.

## Odkud jsou data

- **Polohy vozidel:** veřejná stránka DSZO [www.dszo.cz/online](https://www.dszo.cz/online/). Nemá JSON API,
  vozidla jsou vypsaná přímo v HTML jako JavaScript pro OpenLayers (souřadnice, linka, zpoždění, natočení šipky).
  Parser je v [`src/dszo.js`](src/dszo.js).
- **Směr jízdy (konečná):** tabulka [www.dszo.cz/online/tabs2.php](https://www.dszo.cz/online/tabs2.php) (JSON),
  spojená s polohami podle čísla vozu.
- **Mapa:** vektorové dlaždice [OpenFreeMap](https://openfreemap.org) (data © OpenStreetMap) s vlastním
  minimalistickým stylem v [`src/style.js`](src/style.js): bílý podklad, světlé ulice, jen názvy obcí.

DSZO data obnovuje zhruba každých 15 s, aplikace je stahuje ve stejném intervalu (a jen když je otevřená).

## Proč je potřeba proxy

GitHub Pages hostuje jen statické soubory. Server DSZO neposílá hlavičku `Access-Control-Allow-Origin`,
takže prohlížeč nedovolí stránce na `github.io` jeho data přečíst. Mezi aplikací a DSZO proto stojí malá proxy
[`proxy/worker.js`](proxy/worker.js) pro Cloudflare Workers (zdarma, 100 000 požadavků denně). Pouští jen
dvě veřejné adresy DSZO a na 10 s si odpověď drží v cache, takže server DSZO nezatěžuje.

Zvažované alternativy:
- **GitHub Action, která data stahuje a ukládá do repozitáře:** obejde se bez dalšího účtu, ale cron na GitHubu
  běží nejčastěji jednou za 5 minut a často se zpožďuje, na živou polohu to nestačí.
- **Veřejné CORS proxy (allorigins apod.):** bez nastavení, ale nespolehlivé a s limity.

### Nastavení proxy (jednorázově, asi 5 minut)

1. Založ si účet na [dash.cloudflare.com](https://dash.cloudflare.com) (zdarma).
2. **Workers & Pages → Create → Create Worker**, pojmenuj ho např. `dszo-proxy` a dej **Deploy**.
3. **Edit code**, smaž ukázkový kód, vlož obsah [`proxy/worker.js`](proxy/worker.js) a dej **Deploy**.
4. Zkopíruj adresu workeru, třeba `https://dszo-proxy.tvuj-ucet.workers.dev`.
5. V tomto repozitáři: **Settings → Secrets and variables → Actions → Variables → New repository variable**,
   název `DSZO_PROXY`, hodnota adresa z bodu 4.
6. **Actions → Nasazení na GitHub Pages → Run workflow** (nebo jen pushni změnu).

Kdo má rád příkazovou řádku: `cd proxy && npx wrangler deploy`.

## GitHub Pages

Nasazení dělá workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) při každém pushi do
výchozí větve. Pokud Pages ještě nejsou zapnuté, nastav **Settings → Pages → Source: GitHub Actions**.
Aplikace pak poběží na `https://janeckad.github.io/polohy/`.

## Instalace do mobilu

Otevři adresu aplikace v mobilu a zvol **Přidat na plochu** (Android Chrome nabídne rovnou **Instalovat**).
Při prvním spuštění povol přístup k poloze, mapa se vycentruje na tebe. Tlačítko ◎ tě na mapě kdykoli najde.

## Vývoj

```bash
npm install
npm run dev      # http://localhost:5173, data DSZO jdou přes proxy dev serveru, Cloudflare není potřeba
npm test         # testy parseru dat DSZO a proxy
npm run build    # produkční build do dist/
```

Pro produkční build s proxy: `VITE_DSZO_PROXY=https://dszo-proxy.tvuj-ucet.workers.dev npm run build`.
