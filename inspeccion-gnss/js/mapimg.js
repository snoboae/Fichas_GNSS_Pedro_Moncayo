/* Croquis de ubicación del punto.
   Se arma un canvas con la imagen satelital Esri (World_Imagery), el punto marcado,
   norte, escala, datum y atribución. Devuelve un JPEG en dataURL que se guarda con la
   ficha y se incrusta en el PDF. Si no hay internet, dibuja la retícula de referencia
   y el punto igual: el croquis sirve, solo que sin la foto satelital. */
const Croquis = (() => {
  const LAYER = {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Imágenes © Esri, Maxar, Earthstar Geographics y la comunidad SIG',
    /* En el cantón Pedro Moncayo Esri tiene imagen hasta z18; en z19 responde con la
       tesela "Map data not yet available". Se detecta y se baja un nivel solo. */
    maxZoom: 18
  };
  const W = 1100, H = 696;           // 1,58 : 1 (igual que el recuadro del PDF)
  const K = W / 1200;                // escala de todos los elementos gráficos

  const tileUrl = (z, x, y) => LAYER.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);

  const worldPx = (lat, lng, z) => {
    const s = 256 * Math.pow(2, z);
    const sin = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  };

  function loadImg(src, timeout = 9000) {
    return new Promise((res) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      const t = setTimeout(() => { im.src = ''; res(null); }, timeout);
      im.onload = () => { clearTimeout(t); res(im); };
      im.onerror = () => { clearTimeout(t); res(null); };
      im.src = src;
    });
  }

  /* ¿La tesela es el aviso gris de "Map data not yet available"?
     Se muestrea a 24x24: una imagen satelital real nunca es tan uniforme. */
  function esVacia(im) {
    try {
      const c = document.createElement('canvas');
      c.width = 24; c.height = 24;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0, 24, 24);
      const d = g.getImageData(0, 0, 24, 24).data;
      let n = 0, s = 0, s2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
        s += v; s2 += v * v; n++;
      }
      const media = s / n;
      const desv = Math.sqrt(Math.max(0, s2 / n - media * media));
      return media > 195 && desv < 9;
    } catch (e) { return false; }
  }

  async function cargarTesela(url) {
    const im = await loadImg(url);
    if (!im) return { im: null, vacia: true };
    return { im, vacia: esVacia(im) };
  }

  async function tiles(z, cx, cy) {
    const ox = cx - W / 2, oy = cy - H / 2;
    const x0 = Math.floor(ox / 256), x1 = Math.floor((ox + W) / 256);
    const y0 = Math.floor(oy / 256), y1 = Math.floor((oy + H) / 256);
    const max = Math.pow(2, z);
    const jobs = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (y < 0 || y >= max) continue;
      const xw = ((x % max) + max) % max;
      jobs.push(cargarTesela(tileUrl(z, xw, y)).then((r) => ({ im: r.vacia ? null : r.im, x, y })));
    }
    const list = await Promise.all(jobs);
    return { list, ok: list.filter((t) => t.im).length, total: jobs.length, ox, oy };
  }

  function roundRect(g, x, y, w, h, r) {
    if (g.roundRect) { g.beginPath(); g.roundRect(x, y, w, h, r); return; }
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  const miles = (n, dec = 0) => n.toLocaleString('es-EC', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  function drawBase(g, list, ox, oy, hayTeselas) {
    g.fillStyle = '#dfe6ec'; g.fillRect(0, 0, W, H);
    if (hayTeselas) {
      list.forEach(({ im, x, y }) => { if (im) g.drawImage(im, x * 256 - ox, y * 256 - oy); });
    } else {
      g.strokeStyle = '#c2ccd6'; g.lineWidth = 1.2;
      for (let x = 0; x < W; x += 90 * K) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
      for (let y = 0; y < H; y += 90 * K) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      g.fillStyle = '#7a8894'; g.font = `${Math.round(19 * K)}px Arial`; g.textAlign = 'center';
      g.fillText('Sin imagen satelital (generado sin conexión)', W / 2, H / 2 - 40 * K);
      g.font = `${Math.round(15 * K)}px Arial`;
      g.fillText('Vuelve a generar el croquis con internet para obtener el fondo Esri.', W / 2, H / 2 - 14 * K);
    }
  }

  function drawPunto(g, px, py) {
    const r1 = 9 * K, r2 = 17 * K, tick = 30 * K;
    g.save();
    // sombra para que se lea sobre cualquier fondo
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 5 * K;
    // cruz
    g.strokeStyle = '#ffffff'; g.lineWidth = 5 * K; g.lineCap = 'round';
    [[-tick, 0, -r1, 0], [r1, 0, tick, 0], [0, -tick, 0, -r1], [0, r1, 0, tick]].forEach(([x1, y1, x2, y2]) => {
      g.beginPath(); g.moveTo(px + x1, py + y1); g.lineTo(px + x2, py + y2); g.stroke();
    });
    g.strokeStyle = '#c62828'; g.lineWidth = 2.6 * K;
    [[-tick, 0, -r1, 0], [r1, 0, tick, 0], [0, -tick, 0, -r1], [0, r1, 0, tick]].forEach(([x1, y1, x2, y2]) => {
      g.beginPath(); g.moveTo(px + x1, py + y1); g.lineTo(px + x2, py + y2); g.stroke();
    });
    g.restore();
    // anillo blanco + centro rojo
    g.beginPath(); g.arc(px, py, r2, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.fill();
    g.beginPath(); g.arc(px, py, r1, 0, Math.PI * 2);
    g.fillStyle = '#c62828'; g.fill();
    g.lineWidth = 2 * K; g.strokeStyle = 'rgba(0,0,0,.35)'; g.stroke();
  }

  function drawEtiqueta(g, codigo, e, n) {
    const x = 22 * K, y = 22 * K;
    const l1 = codigo || 'PUNTO';
    const l2 = `UTM 17S · X ${miles(e)} · Y ${miles(n)}`;
    g.font = `bold ${Math.round(30 * K)}px Arial`;
    const w1 = g.measureText(l1).width;
    g.font = `${Math.round(18 * K)}px Arial`;
    const w2 = g.measureText(l2).width;
    const pad = 14 * K, h1 = 36 * K, h2 = 24 * K;
    const bw = Math.max(w1, w2) + pad * 2, bh = h1 + h2 + pad * 1.4;
    g.fillStyle = 'rgba(255,255,255,.95)';
    g.strokeStyle = 'rgba(18,58,107,.5)'; g.lineWidth = 1.4 * K;
    roundRect(g, x, y, bw, bh, 9 * K); g.fill(); g.stroke();
    // barra azul de marca
    g.fillStyle = '#123a6b';
    roundRect(g, x, y, 5.5 * K, bh, 2.5 * K); g.fill();
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#123a6b'; g.font = `bold ${Math.round(30 * K)}px Arial`;
    g.fillText(l1, x + pad, y + h1 - 4 * K);
    g.fillStyle = '#3d4c5a'; g.font = `${Math.round(18 * K)}px Arial`;
    g.fillText(l2, x + pad, y + h1 + h2 - 5 * K);
  }

  function drawNorte(g) {
    const cx = W - 58 * K, cy = 62 * K, r = 30 * K;
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(18,58,107,.35)'; g.lineWidth = 1.2 * K; g.stroke();
    g.fillStyle = '#123a6b';
    g.beginPath();
    g.moveTo(cx, cy - 20 * K); g.lineTo(cx + 9 * K, cy + 10 * K); g.lineTo(cx, cy + 4 * K); g.lineTo(cx - 9 * K, cy + 10 * K);
    g.closePath(); g.fill();
    g.fillStyle = '#16202b'; g.font = `bold ${Math.round(15 * K)}px Arial`; g.textAlign = 'center';
    g.fillText('N', cx, cy + 27 * K);
  }

  function niceLen(m) {
    const p = Math.pow(10, Math.floor(Math.log10(m)));
    const f = m / p;
    return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * p;
  }

  function drawEscala(g, lat, z) {
    const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
    const len = niceLen(mpp * W * 0.2);
    const px = len / mpp;
    const bx = 30 * K, by = H - 34 * K;
    g.fillStyle = 'rgba(255,255,255,.92)';
    roundRect(g, bx - 14 * K, by - 30 * K, px + 28 * K, 52 * K, 7 * K); g.fill();
    g.fillStyle = '#16202b'; g.fillRect(bx, by - 3 * K, px, 6 * K);
    g.fillStyle = '#ffffff'; g.fillRect(bx, by - 3 * K, px / 2, 6 * K);
    g.strokeStyle = '#16202b'; g.lineWidth = 1.2 * K; g.strokeRect(bx, by - 3 * K, px, 6 * K);
    g.fillStyle = '#16202b'; g.font = `bold ${Math.round(17 * K)}px Arial`; g.textAlign = 'left';
    g.fillText(len >= 1000 ? (len / 1000) + ' km' : len + ' m', bx, by - 12 * K);
  }

  function drawAtribucion(g, conTeselas) {
    const txt = conTeselas ? LAYER.attr : 'Sin imagen base · solo referencia';
    g.font = `${Math.round(15 * K)}px Arial`; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    const tw = g.measureText(txt).width;
    g.fillStyle = 'rgba(255,255,255,.88)';
    g.fillRect(W - tw - 20 * K, H - 28 * K, tw + 20 * K, 28 * K);
    g.fillStyle = '#243441';
    g.fillText(txt, W - 10 * K, H - 8 * K);
  }

  function drawMarco(g) {
    g.strokeStyle = 'rgba(18,58,107,.45)'; g.lineWidth = 3 * K;
    g.strokeRect(1.5 * K, 1.5 * K, W - 3 * K, H - 3 * K);
  }

  /* Dibuja y devuelve { dataUrl, z, conTeselas }. */
  async function render(p) {
    const { lat, lon, codigo, e, n } = p;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');

    let z = p.zoom || LAYER.maxZoom;
    let r = null;
    // Si la zona no tiene imagen a la resolución pedida, se baja un nivel.
    for (; z >= 14; z--) {
      const [cx, cy] = worldPx(lat, lon, z);
      const t = await tiles(z, cx, cy);
      r = t;
      if (t.ok >= t.total * 0.5) break;
    }
    const conTeselas = !!(r && r.ok);

    try {
      drawBase(g, r ? r.list : [], r ? r.ox : 0, r ? r.oy : 0, conTeselas);
    } catch (e1) {
      drawBase(g, [], 0, 0, false);
    }

    // posición del punto en el canvas
    let px = W / 2, py = H / 2;
    if (r) {
      const [cx, cy] = worldPx(lat, lon, z);
      px = cx - r.ox; py = cy - r.oy;
    }
    drawPunto(g, px, py);
    drawEtiqueta(g, codigo, e, n);
    drawNorte(g);
    drawEscala(g, lat, z);
    drawAtribucion(g, conTeselas);
    drawMarco(g);

    let dataUrl;
    try {
      dataUrl = cv.toDataURL('image/jpeg', 0.9);
    } catch (err) {
      // canvas contaminado (teselas sin CORS): se repinta sin fondo satelital
      const g2 = cv.getContext('2d');
      g2.clearRect(0, 0, W, H);
      drawBase(g2, [], 0, 0, false);
      drawPunto(g2, px, py);
      drawEtiqueta(g2, codigo, e, n);
      drawNorte(g2);
      drawEscala(g2, lat, z);
      drawAtribucion(g2, false);
      drawMarco(g2);
      dataUrl = cv.toDataURL('image/jpeg', 0.9);
      return { dataUrl, z, conTeselas: false };
    }
    return { dataUrl, z, conTeselas };
  }

  /* Mapa interactivo (Leaflet) para la vista de detalle. */
  function mapa(el, lat, lon, codigo) {
    const mapa = L.map(el, { zoomControl: true, attributionControl: true }).setView([lat, lon], 18);
    L.tileLayer(LAYER.url, { maxZoom: 19, maxNativeZoom: LAYER.maxZoom, attribution: 'Imágenes © Esri' }).addTo(mapa);
    const icono = L.divIcon({
      className: 'pin-gnss',
      html: `<div class="pin-halo"></div><div class="pin-core">${codigo ? '' : ''}</div>`,
      iconSize: [26, 26], iconAnchor: [13, 13]
    });
    L.marker([lat, lon], { icon: icono, title: codigo }).addTo(mapa);
    return mapa;
  }

  return { render, mapa, LAYER, W, H };
})();
