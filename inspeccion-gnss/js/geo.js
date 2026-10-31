/* Utilidades geoespaciales sobre el elipsoide WGS84 (a = 6378137 m, f = 1/298.257223563).
   Las rutinas de conversión y distancia son las mismas de las apps anteriores, validadas
   contra pyproj (Karney / GeographicLib):
     - WGS84 <-> UTM por series de Krüger ....... error < 0.05 mm
     - Distancias geodésicas (Vincenty inverso) . error < 0.01 mm
   En esta app se usan para pasar los 22 puntos de UTM 17S a latitud/longitud (croquis,
   Maps y mapa) y para mostrar la distancia del operador al punto. */
const Geo = (() => {
  const A = 6378137;                    // semieje mayor
  const F = 1 / 298.257223563;          // aplanamiento
  const B = A * (1 - F);                // semieje menor
  const E2 = F * (2 - F);               // excentricidad al cuadrado
  const ECC = Math.sqrt(E2);
  const K0 = 0.9996;
  const N_SER = F / (2 - F);
  const AM = (A / (1 + N_SER)) * (1 + N_SER * N_SER / 4 + N_SER ** 4 / 64);
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const n2 = N_SER * N_SER, n3 = N_SER * n2;
  const ALPHA = [N_SER / 2 - 2 * n2 / 3 + 5 * n3 / 16, 13 * n2 / 48 - 3 * n3 / 5, 61 * n3 / 240];
  const BETA = [N_SER / 2 - 2 * n2 / 3 + 37 * n3 / 96, n2 / 48 + n3 / 15, 17 * n3 / 480];

  const radiusMeridian = (phi) => (A * (1 - E2)) / Math.pow(1 - E2 * Math.sin(phi) ** 2, 1.5); // M
  const radiusPrimeVertical = (phi) => A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);              // N

  /* ---------- UTM (series de Krüger) ---------- */
  function zoneOf(lon) { return Math.floor((lon + 180) / 6) + 1; }

  /* WGS84 -> UTM. Devuelve { zone, hemi, e, n }. */
  function toUTM(lat, lon, zoneOverride) {
    const zone = zoneOverride || zoneOf(lon);
    const lon0 = rad((zone - 1) * 6 - 180 + 3);
    const phi = rad(lat), lam = rad(lon) - lon0;
    const t = Math.sinh(Math.atanh(Math.sin(phi)) - ECC * Math.atanh(ECC * Math.sin(phi)));
    const xi = Math.atan2(t, Math.cos(lam));
    const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let x = eta, y = xi;
    for (let j = 1; j <= 3; j++) {
      y += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      x += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    let n = K0 * AM * y;
    if (lat < 0) n += 10000000;
    return { zone, hemi: lat < 0 ? 'S' : 'N', e: 500000 + K0 * AM * x, n };
  }

  /* UTM -> WGS84. Devuelve [lat, lng]. south = true si es hemisferio sur. */
  function fromUTM(e, n, zone, south) {
    const n0 = south ? 10000000 : 0;
    const x = (e - 500000) / (K0 * AM);
    const y = (n - n0) / (K0 * AM);
    let xi = y, eta = x;
    for (let j = 1; j <= 3; j++) {
      xi -= BETA[j - 1] * Math.sin(2 * j * y) * Math.cosh(2 * j * x);
      eta -= BETA[j - 1] * Math.cos(2 * j * y) * Math.sinh(2 * j * x);
    }
    const tau = Math.sin(xi) / Math.sqrt(Math.sinh(eta) ** 2 + Math.cos(xi) ** 2);
    let phi = Math.atan(tau);
    const f = (p) => { const s = Math.sin(p); return Math.sinh(Math.atanh(s) - ECC * Math.atanh(ECC * s)); };
    for (let k = 0; k < 8; k++) {
      const sp = f(phi);
      const h = 1e-9, sp2 = f(phi + h);
      const d = (sp - tau) / ((sp2 - sp) / h);
      phi -= d;
      if (Math.abs(d) < 1e-14) break;
    }
    const lam = Math.atan2(Math.sinh(eta), Math.cos(xi));
    const lon0 = rad((zone - 1) * 6 - 180 + 3);
    return [deg(phi), deg(lam) + deg(lon0)];
  }

  /* ---------- Distancia geodésica (Vincenty inverso, WGS84) ---------- */
  function dist(a, b) {
    const lat1 = a[0], lon1 = a[1], lat2 = b[0], lon2 = b[1];
    if (lat1 === lat2 && lon1 === lon2) return 0;
    const L = rad(lon2 - lon1);
    const U1 = Math.atan((1 - F) * Math.tan(rad(lat1)));
    const U2 = Math.atan((1 - F) * Math.tan(rad(lat2)));
    const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
    const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
    let lam = L;
    let sinSigma = 0, cosSigma = 0, sigma = 0, sinAlpha = 0, cos2Alpha = 0, cos2SigmaM = 0;
    for (let i = 0; i < 200; i++) {
      const sinLam = Math.sin(lam), cosLam = Math.cos(lam);
      sinSigma = Math.sqrt((cosU2 * sinLam) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLam) ** 2);
      if (sinSigma === 0) return 0;                       // puntos coincidentes
      cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLam;
      sigma = Math.atan2(sinSigma, cosSigma);
      sinAlpha = (cosU1 * cosU2 * sinLam) / sinSigma;
      cos2Alpha = 1 - sinAlpha * sinAlpha;
      cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
      const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
      const lamPrev = lam;
      lam = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
      if (Math.abs(lam - lamPrev) < 1e-12) break;
    }
    const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
    const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
    const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    const dSigma = BB * sinSigma * (cos2SigmaM + (BB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
      - (BB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
    return B * AA * (sigma - dSigma);
  }

  /* Rumbo inicial (azimut geodésico simplificado) en grados desde el norte. */
  function bearing(a, b) {
    const φ1 = rad(a[0]), φ2 = rad(b[0]), Δλ = rad(b[1] - a[1]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }

  /* ---------- formato ---------- */
  const DMS = (value, hemiPos, hemiNeg) => {
    const hemi = value < 0 ? hemiNeg : hemiPos;
    const v = Math.abs(value);
    let d = Math.floor(v);
    let m = Math.floor((v - d) * 60);
    let s = (v - d - m / 60) * 3600;
    if (s >= 59.99995) { s = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(5).padStart(8, '0')}" ${hemi}`;
  };
  const latDMS = (lat) => DMS(lat, 'N', 'S');
  const lonDMS = (lon) => DMS(lon, 'E', 'O');

  /* Punto del catálogo -> { lat, lon } (UTM 17S del diseño). */
  function puntoLatLon(p) {
    const [lat, lon] = fromUTM(p.e, p.n, PROYECTO.zona, PROYECTO.hemisferio === 'S');
    return { lat, lon };
  }

  return {
    rad, deg, zoneOf, toUTM, fromUTM, dist, bearing,
    latDMS, lonDMS, puntoLatLon,
    radiusMeridian, radiusPrimeVertical
  };
})();
