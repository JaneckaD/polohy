// Převod souřadnic S-JTSK (EPSG:5514, Křovák) na WGS84. Polohy vlaků od Správy železnic jsou v S-JTSK.
// Bessel → kartézské → Helmertova transformace → WGS84 (přesnost kolem 1 m).

const RAD = Math.PI / 180;

/** [x, y] v EPSG:5514 (záporná čísla) → [lon, lat] WGS84. */
export function krovakToWgs(x5514, y5514) {
  const X = -y5514;
  const Y = -x5514;
  const e = 0.081696831215303;
  const n = 0.97992470462083;
  const roQ = 12310230.12797036;
  const sinUQ = 0.863499969506341;
  const cosUQ = 0.504348889819882;
  const sinVQ = 0.420215144586493;
  const cosVQ = 0.907424504992097;
  const alfa = 1.000597498371542;
  const k = 1.003419163966575;

  const ro = Math.hypot(X, Y);
  const eps = 2 * Math.atan(Y / (ro + X));
  const D = eps / n;
  const S = 2 * Math.atan(Math.exp((1 / n) * Math.log(roQ / ro))) - Math.PI / 2;
  const sinS = Math.sin(S);
  const cosS = Math.cos(S);
  const sinU = sinUQ * sinS - cosUQ * cosS * Math.cos(D);
  const cosU = Math.sqrt(1 - sinU * sinU);
  const sinDV = (Math.sin(D) * cosS) / cosU;
  const cosDV = Math.sqrt(1 - sinDV * sinDV);
  const sinV = sinVQ * cosDV - cosVQ * sinDV;
  const cosV = cosVQ * cosDV + sinVQ * sinDV;
  const L = (2 * Math.atan(sinV / (1 + cosV))) / alfa;
  const t = Math.exp((2 / alfa) * Math.log((1 + sinU) / cosU / k));
  let pom = (t - 1) / (t + 1);
  let sinB;
  for (let i = 0; i < 20; i++) {
    sinB = pom;
    pom = t * Math.exp(e * Math.log((1 + e * sinB) / (1 - e * sinB)));
    pom = (pom - 1) / (pom + 1);
    if (Math.abs(pom - sinB) < 1e-15) break;
  }
  const B = Math.atan(pom / Math.sqrt(1 - pom * pom));

  // Bessel → kartézské souřadnice (výška 245 m stačí)
  const H = 245;
  const aB = 6377397.15508;
  const e2B = 1 - (1 - 1 / 299.152812853) ** 2;
  const N = aB / Math.sqrt(1 - e2B * Math.sin(B) ** 2);
  const x = (N + H) * Math.cos(B) * Math.cos(L);
  const y = (N + H) * Math.cos(B) * Math.sin(L);
  const z = ((1 - e2B) * N + H) * Math.sin(B);

  // Helmertova transformace S-JTSK → WGS84
  const wz = (-5.2611 / 3600) * RAD;
  const wy = (-1.58676 / 3600) * RAD;
  const wx = (-4.99821 / 3600) * RAD;
  const m = 3.543e-6;
  const xn = 570.69 + (1 + m) * (x + wz * y - wy * z);
  const yn = 85.69 + (1 + m) * (-wz * x + y + wx * z);
  const zn = 462.84 + (1 + m) * (wy * x - wx * y + z);

  // Kartézské → WGS84
  const a = 6378137;
  const f1 = 298.257223563;
  const ab = f1 / (f1 - 1);
  const p = Math.hypot(xn, yn);
  const e2 = 1 - (1 - 1 / f1) ** 2;
  const th = Math.atan((zn * ab) / p);
  const lat = Math.atan((zn + e2 * ab * a * Math.sin(th) ** 3) / (p - e2 * a * Math.cos(th) ** 3));
  const lon = 2 * Math.atan(yn / (p + xn));
  return [lon / RAD, lat / RAD];
}
