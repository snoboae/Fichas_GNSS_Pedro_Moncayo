/* Ficha de campo del punto de control geodésico — UNA SOLA HOJA A4 horizontal.
   Es un registro de campo: identifica el punto, dónde está (UTM), con qué se midió y
   cómo quedó (croquis y dos fotografías). No es la monografía definitiva del IGM.

   Se dibuja con jsPDF en milímetros y posiciones absolutas: el documento siempre tiene
   1 página. Las secciones se apilan con un cursor `y` y el alto de las imágenes se
   calcula con el espacio que queda, para que nada se desborde ni se superponga. */
const PDF = (() => {
  const PW = 297, PH = 210, M = 9, CW = PW - 2 * M;   // A4 horizontal
  const NAVY = [18, 58, 107], GREEN = [124, 179, 66], INK = [22, 32, 43];
  const GRAY = [92, 107, 122], LINE = [197, 208, 219], SOFT = [240, 245, 250];
  const BOTTOM = 183.2;                                // las imágenes no pasan de aquí

  const fmtFecha = (d) => {
    if (!d) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
  };
  /* "2026-10-31T09:15" -> "31/10/2026 09:15" */
  const fmtFechaHora = (s) => {
    if (!s) return '—';
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : s;
  };
  const fmtHora = (s) => {
    const m = /T(\d{2}:\d{2})/.exec(String(s || ''));
    return m ? m[1] : '—';
  };
  const miles = (n) => (isFinite(n) ? Number(n).toLocaleString('es-EC', { maximumFractionDigits: 0 }) : '—');
  const dec = (n, d = 3) => (isFinite(n) ? Number(n).toFixed(d) : '—');
  const ORD = { 1: 'Primer orden', 2: 'Segundo orden', 3: 'Tercer orden' };

  function nuevo() {
    const { jsPDF } = window.jspdf;
    return new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape', compress: true });
  }

  /* ---------------- utilidades de dibujo ---------------- */
  function txt(doc, s, x, y, o) {
    o = o || {};
    doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal');
    doc.setFontSize(o.size || 8);
    doc.setTextColor(...(o.color || INK));
    const cuerpo = Array.isArray(s) ? s : String(s == null ? '' : s);
    const opciones = { align: o.align || 'left', lineHeightFactor: o.lh || 1.16 };
    if (o.space) opciones.charSpace = o.space;      // espaciado entre letras (títulos)
    doc.text(cuerpo, x, y, opciones);
  }

  function lineas(doc, s, w, size, estilo) {
    doc.setFont('helvetica', estilo || 'normal');
    doc.setFontSize(size);
    return doc.splitTextToSize(String(s == null ? '' : s), w);
  }

  function recortar(arr, cabe) {
    if (arr.length <= cabe) return arr;
    const out = arr.slice(0, Math.max(1, cabe));
    out[out.length - 1] = String(out[out.length - 1]).replace(/\s*\S{0,3}$/, '…');
    return out;
  }

  /* Celda con etiqueta arriba y valor.
     El valor se dibuja con aire respecto del borde inferior (para que las letras con
     descendentes no pisen la línea) y, si el texto es largo, se reduce el tamaño de
     letra antes de recortarlo con puntos suspensivos. */
  function celda(doc, x, y, w, h, etiqueta, valor, o) {
    o = o || {};
    const estilo = o.bold ? 'bold' : 'normal';
    doc.setDrawColor(...LINE); doc.setLineWidth(0.18);
    doc.rect(x, y, w, h);
    txt(doc, etiqueta, x + 1.8, y + 3.1, { size: 5.4, bold: true, color: GRAY });

    const v = valor === '' || valor == null ? '—' : String(valor);
    const ancho = w - 3.6;
    let fs = o.size || 8.5;
    let ls = lineas(doc, v, ancho, fs, estilo);
    while (ls.length > 1 && fs > 6.6) { fs -= 0.3; ls = lineas(doc, v, ancho, fs, estilo); }
    const yTexto = y + 6.1;                    // deja ~1,1 mm bajo la línea base
    const caben = Math.max(1, Math.floor((h - 4.8) / 2.9) + 1);
    ls = recortar(ls, caben);
    txt(doc, ls, x + 1.8, yTexto, { size: fs, bold: o.bold, color: o.color || INK, lh: 1.05 });
  }

  function seccion(doc, num, titulo, y, x, w) {
    const bx = x == null ? M : x, bw = w == null ? CW : w;
    doc.setFillColor(...NAVY); doc.rect(bx, y, 4.2, 4.2, 'F');
    txt(doc, num, bx + 2.1, y + 3.2, { size: 6.2, bold: true, color: [255, 255, 255], align: 'center' });
    const t = titulo.toUpperCase();
    txt(doc, t, bx + 6, y + 3.35, { size: 7.2, bold: true, color: NAVY });
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
    doc.line(bx + 6 + doc.getTextWidth(t) + 2.2, y + 2.1, bx + bw, y + 2.1);
  }

  function imagen(doc, x, y, w, h, dataUrl, iw, ih, pie, vacio) {
    doc.setFillColor(...SOFT); doc.rect(x, y, w, h, 'F');
    doc.setDrawColor(...LINE); doc.setLineWidth(0.18); doc.rect(x, y, w, h);
    if (dataUrl && iw && ih) {
      const k = Math.min((w - 1.2) / iw, (h - 1.2) / ih);
      const dw = iw * k, dh = ih * k;
      try {
        doc.addImage(dataUrl, 'JPEG', x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      } catch (e) { /* imagen inválida: queda el recuadro */ }
    } else {
      const t = vacio || 'Sin fotografía';
      const ls = lineas(doc, t, w - 8, 6.8);
      txt(doc, ls, x + w / 2, y + h / 2 + 2 - (ls.length - 1) * 1.5, { size: 6.8, color: GRAY, align: 'center' });
    }
    if (pie) txt(doc, pie, x + w / 2, y + h + 3.1, { size: 6, color: GRAY, align: 'center' });
  }

  /* Párrafo con la etiqueta en negrita al inicio de la primera línea. */
  function parrafoEtiqueta(doc, x, y, w, limite, etiqueta, texto) {
    const size = 7.1, lh = 2.8;
    const etq = etiqueta + ': ';
    doc.setFont('helvetica', 'bold'); doc.setFontSize(size);
    const wEtq = doc.getTextWidth(etq);
    const palabras = String(texto).split(/\s+/).filter(Boolean);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
    const filas = [];
    let actual = '', disp = w - wEtq;
    for (const p of palabras) {
      const prueba = actual ? actual + ' ' + p : p;
      if (!actual || doc.getTextWidth(prueba) <= disp) actual = prueba;
      else { filas.push(actual); actual = p; disp = w; }
    }
    if (actual) filas.push(actual);
    const caben = Math.max(1, Math.floor((limite - y) / lh) + 1);
    const usar = recortar(filas, caben);
    txt(doc, etq, x, y, { size, bold: true, color: NAVY });
    txt(doc, usar[0] || '', x + wEtq, y, { size, lh: 1.0 });
    if (usar.length > 1) txt(doc, usar.slice(1), x, y + lh, { size, lh: 1.0 });
    return y + usar.length * lh + 1.4;
  }

  /* ---------------- encabezado institucional ---------------- */
  function encabezado(doc, f) {
    const LG = LOGOS;
    const hPM = 11.2, wPM = hPM * (LG.pedroMoncayo.w / LG.pedroMoncayo.h);
    doc.addImage(LG.pedroMoncayo.data, 'PNG', M, 4.6, wPM, hPM);
    const hGC = 9.8, wGC = hGC * (LG.geocaliza.w / LG.geocaliza.h);
    doc.addImage(LG.geocaliza.data, 'PNG', PW - M - wGC, 5.4, wGC, hGC);

    // El título del proyecto ocupa el centro (es lo primero que se lee)
    const cx = PW / 2;
    txt(doc, 'PROYECTO', cx, 7.4, { size: 5.8, bold: true, color: GRAY, align: 'center', space: 1.1 });
    const nombre = (PROYECTO.nombre || '').toUpperCase();
    let fsTitulo = 10.2;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fsTitulo);
    while (doc.getTextWidth(nombre) > 196 && fsTitulo > 7.6) {
      fsTitulo -= 0.2;
      doc.setFontSize(fsTitulo);
    }
    txt(doc, nombre, cx, 11.9, { size: fsTitulo, bold: true, color: NAVY, align: 'center' });
    txt(doc, `${PROYECTO.contrato} · Proceso ${PROYECTO.proceso}`, cx, 15.6, { size: 6.2, color: GRAY, align: 'center' });

    // banda con el título de la ficha
    const by = 18.6, bh = 9.4;
    doc.setFillColor(...NAVY); doc.rect(M, by, CW, bh, 'F');
    doc.setFillColor(...GREEN); doc.rect(M, by + bh, CW, 0.9, 'F');
    txt(doc, 'FICHA DE CAMPO · PUNTO DE CONTROL GEODÉSICO', M + 4, by + 6.3, { size: 11.2, bold: true, color: [255, 255, 255] });

    /* placa del código: con alto suficiente para que el código no toque el borde */
    const pw = 46, px = PW - M - pw, py = by + 1.2, ph = bh - 2.4;
    doc.setFillColor(255, 255, 255); doc.rect(px, py, pw, ph, 'F');
    txt(doc, 'CÓDIGO / NOMINATIVO', px + 2.6, py + 2.7, { size: 5.1, bold: true, color: GRAY });
    txt(doc, f.codigo || '—', px + 2.6, py + 6.9, { size: 10.2, bold: true, color: NAVY });

    return 29.9;
  }

  /* ---------------- 1. identificación ---------------- */
  function identificacion(doc, f, y) {
    seccion(doc, '1', 'Identificación del punto', y);
    const t = y + 6.6, h = 7.2, cw = CW / 6;
    celda(doc, M, t, cw * 2, h, 'NOMBRE DEL PUNTO', f.nombre, { bold: true });
    celda(doc, M + cw * 2, t, cw, h, 'CÓDIGO / NOMINATIVO', f.codigo, { bold: true });
    celda(doc, M + cw * 3, t, cw, h, 'ORDEN', ORD[f.orden] || '—');
    celda(doc, M + cw * 4, t, cw * 2, h, 'FECHA', fmtFecha(f.fecha));
    const t2 = t + h;
    celda(doc, M, t2, cw, h, 'PROVINCIA', PROYECTO.provincia);
    celda(doc, M + cw, t2, cw, h, 'CANTÓN', PROYECTO.canton);
    celda(doc, M + cw * 2, t2, cw, h, 'PARROQUIA', f.parroquia, { bold: true });
    celda(doc, M + cw * 3, t2, cw * 3, h, 'SECTOR / SITIO', f.sector);
    return t2 + h;
  }

  /* ---------------- 2. coordenadas, materialización y equipo ---------------- */
  function coordenadas(doc, f, y) {
    seccion(doc, '2', 'Ubicación, materialización y observación', y);
    const t = y + 6.6, h = 7.2;
    const wA = 106, wB = CW - 106;
    const xA = M, xB = M + wA;

    doc.setFillColor(...SOFT); doc.setDrawColor(...LINE); doc.setLineWidth(0.18);
    doc.rect(xA, t, wA, 4.4, 'FD'); doc.rect(xB, t, wB, 4.4, 'FD');
    txt(doc, `COORDENADAS UTM ${PROYECTO.zona}${PROYECTO.hemisferio} — WGS84`, xA + 1.8, t + 3.1, { size: 5.6, bold: true, color: NAVY });
    txt(doc, 'MATERIALIZACIÓN Y EQUIPO', xB + 1.8, t + 3.1, { size: 5.6, bold: true, color: NAVY });

    const r0 = t + 4.4;
    const metodo = `${f.metodo || 'Estático diferencial'} · máscara ${f.mascara || 10}° · ${f.intervalo || 1} s`;
    const mismoDia = String(f.inicio || '').slice(0, 10) === String(f.fin || '').slice(0, 10);
    const finTxt = f.fin ? (mismoDia ? fmtHora(f.fin) : fmtFechaHora(f.fin)) : '—';
    const obs = (f.inicio || f.fin)
      ? `${fmtFechaHora(f.inicio)}  a  ${finTxt}${f.duracionMin ? `  (${f.duracionMin} min)` : ''}`
      : '—';
    const filasA = [
      ['ESTE — X (m)', miles(f.este)],
      ['NORTE — Y (m)', miles(f.norte)],
      [`ZONA UTM`, `${PROYECTO.zona} ${PROYECTO.hemisferio}  ·  ${PROYECTO.epsg}`],
      ['MÉTODO / PARÁMETROS DEL TR', metodo]
    ];
    const filasB = [
      ['MATERIALIZACIÓN', f.materializacion],
      ['RECEPTOR GNSS', f.receptor],
      ['ALTURA DE LA ANTENA (m)', f.alturaAntena ? dec(f.alturaAntena, 3) : '—'],
      ['INICIO – FIN DE LA OBSERVACIÓN', obs]
    ];
    filasA.forEach(([lab, val], i) => celda(doc, xA, r0 + i * h, wA, h, lab, val, { bold: i === 0 }));
    filasB.forEach(([lab, val], i) => celda(doc, xB, r0 + i * h, wB, h, lab, val, { bold: i === 0 }));
    return r0 + 4 * h;
  }

  /* ---------------- documento ---------------- */
  function fichaDoc(f, fotos) {
    const doc = nuevo();
    const log = (tag, y) => { if (globalThis.PDF_DEBUG) console.log(tag, y.toFixed(1)); };

    let y = encabezado(doc, f); log('encabezado', y);
    y = identificacion(doc, f, y + 2.4) + 2.4; log('identificacion', y);
    y = coordenadas(doc, f, y) + 2.6; log('coordenadas', y);

    // ---------- 3. croquis (izquierda) + 4. fotografías (derecha) ----------
    const ySec = y, yImg = ySec + 6.2;
    const hImg = BOTTOM - yImg;
    const wCro = Math.min(134, hImg * (Croquis.W / Croquis.H));
    const xR = M + wCro + 5, wR = CW - wCro - 5;

    seccion(doc, '3', 'Croquis de ubicación', ySec, M, wCro);
    imagen(doc, M, yImg, wCro, hImg, f.croquis, Croquis.W, Croquis.H, '',
      'Croquis pendiente.\nSe completa solo cuando haya internet.');

    const conPunto = (fotos || []).find((p) => p.tipo === 'punto');
    const conPlaca = (fotos || []).find((p) => p.tipo === 'placa');
    const nPunto = (fotos || []).filter((p) => p.tipo === 'punto').length;
    const nPlaca = (fotos || []).filter((p) => p.tipo === 'placa').length;

    seccion(doc, '4', 'Registro fotográfico', ySec, xR, wR);
    const gap = 4, wF = (wR - gap) / 2;
    const hF = Math.max(28, Math.min(wF / 1.5, hImg - 6.1 - 3.4 - 5.6 - 22));
    imagen(doc, xR, yImg, wF, hF, conPunto && conPunto.dataUrl, conPunto && conPunto.w, conPunto && conPunto.h, 'Fotografía del punto');
    imagen(doc, xR + wF + gap, yImg, wF, hF, conPlaca && conPlaca.dataUrl, conPlaca && conPlaca.w, conPlaca && conPlaca.h, 'Fotografía de la placa');
    if (nPunto > 1 || nPlaca > 1) {
      txt(doc, `Se enviaron ${nPunto} foto(s) del punto y ${nPlaca} de la placa a la carpeta del punto en Google Drive.`,
        xR, yImg + hF + 7.4, { size: 5.6, color: GRAY });
    }
    log('fotos', yImg + hF);

    // ---------- 5. observaciones (derecha, bajo las fotos) ----------
    const yObs = yImg + hF + (nPunto > 1 || nPlaca > 1 ? 9.6 : 6.2);
    seccion(doc, '5', 'Observaciones y accesibilidad', yObs, xR, wR);
    const bx = xR, by = yObs + 6.2, bw = wR, alto = Math.max(18, BOTTOM - by);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.18); doc.rect(bx, by, bw, alto);

    let ty = by + 4.2;
    const bloques = [];
    if (f.descripcion) bloques.push(['Descripción', f.descripcion]);
    if (f.accesibilidad) bloques.push(['Accesibilidad', f.accesibilidad]);
    if (f.observaciones) bloques.push(['Observaciones', f.observaciones]);
    if (!bloques.length) bloques.push(['Observaciones', 'Sin novedades registradas en campo.']);
    const limite = by + alto - 2.8;
    for (const [lab, val] of bloques) {
      if (ty > limite - 2.6) break;
      ty = parrafoEtiqueta(doc, bx + 2, ty, bw - 4.4, limite, lab, val);
    }
    log('obs', by + alto);

    // ---------- firma y nota ----------
    const yF = 186.6, hFirma = 12.8, wFirma = 92;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.18); doc.rect(M, yF, wFirma, hFirma);
    txt(doc, 'ELABORADO POR — OPERADOR DE CAMPO', M + 2, yF + 3.3, { size: 5.3, bold: true, color: GRAY });
    txt(doc, f.operador || '—', M + 2, yF + 7, { size: 7.3, bold: true });
    doc.setDrawColor(...GRAY); doc.setLineWidth(0.2);
    doc.line(M + 4, yF + hFirma - 3, M + wFirma - 4, yF + hFirma - 3);

    const xN = M + wFirma + 5, wN = PW - M - xN;
    const nota = 'Registro de campo de la observación GNSS. Las coordenadas X/Y corresponden al diseño de la red ' +
      `geodésica cantonal (WGS84, UTM ${PROYECTO.zona} ${PROYECTO.hemisferio}) y no sustituyen la monografía ` +
      'definitiva del punto. Las fotografías adicionales y los datos se archivan en Google Drive.';
    const ln = recortar(lineas(doc, nota, wN - 2, 6.1, 'italic'), 5);
    txt(doc, ln, xN + 1, yF + 4, { size: 6.1, color: GRAY, italic: true, lh: 1.02 });

    // ---------- pie ----------
    doc.setDrawColor(...LINE); doc.setLineWidth(0.25);
    doc.line(M, PH - 8.2, PW - M, PH - 8.2);
    txt(doc, `${PROYECTO.entidad} · ${PROYECTO.area}`, M, PH - 4.4, { size: 5.7, color: GRAY });
    txt(doc, `${PROYECTO.contrato} · Proceso ${PROYECTO.proceso}`, PW / 2, PH - 4.4, { size: 5.7, color: GRAY, align: 'center' });
    txt(doc, `Ficha generada con la app Inspección GNSS v${CONFIG.version} · Página 1 de 1`, PW - M, PH - 4.4, { size: 5.7, color: GRAY, align: 'right' });
    return doc;
  }

  return { fichaDoc, fmtFecha, fmtFechaHora };
})();
