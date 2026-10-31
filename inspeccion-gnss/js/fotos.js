/* Fotografías: se guardan dos versiones.
     - liviana: JPEG de 1600 px (se usa en la ficha y en el PDF)
     - orig   : el archivo tal como salió de la cámara (alta resolución) para subirlo a Drive
   La miniatura (240 px) vive en 'pmeta' para poder listar sin cargar blobs. */
const Fotos = (() => {
  const MAX_LIVIANA = 1600;
  const MAX_THUMB = 240;

  function loadBitmap(file) {
    if ('createImageBitmap' in window) {
      return createImageBitmap(file, { imageOrientation: 'from-image' })
        .then((bm) => {
          const c = document.createElement('canvas');
          c.width = bm.width; c.height = bm.height;
          c.getContext('2d').drawImage(bm, 0, 0);
          bm.close();
          return c;
        })
        .catch(() => loadFromImg(file));
    }
    return loadFromImg(file);
  }

  function loadFromImg(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth; c.height = im.naturalHeight;
        c.getContext('2d').drawImage(im, 0, 0);
        URL.revokeObjectURL(url);
        res(c);
      };
      im.onerror = (e) => { URL.revokeObjectURL(url); rej(e); };
      im.src = url;
    });
  }

  function scale(src, maxDim) {
    const w = src.width, h = src.height;
    const k = Math.min(1, maxDim / Math.max(w, h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  const toBlob = (c, q) => new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo procesar la imagen.'))), 'image/jpeg', q));

  /* file -> { blob (liviana), thumb, w, h, orig (file) } */
  async function procesar(file) {
    const src = await loadBitmap(file);
    const liv = scale(src, MAX_LIVIANA);
    const blob = await toBlob(liv, 0.8);
    const thumb = scale(src, MAX_THUMB).toDataURL('image/jpeg', 0.62);
    return { blob, thumb, w: liv.width, h: liv.height, orig: file };
  }

  /* Guarda foto + metadatos en una transacción. */
  async function add(rec) {
    const { id, fichaId, tipo, blob, orig, thumb, w, h, orden, nombre } = rec;
    await DB.txm(['photos', 'pmeta'], 'readwrite', (s) => {
      s.photos.put({ id, fichaId, tipo, blob, orig: orig || null });
      s.pmeta.put({
        id, fichaId, tipo, thumb, w, h, orden: orden || 0,
        nombre: nombre || 'foto.jpg',
        origBytes: orig ? orig.size : 0,
        origTipo: orig ? (orig.type || 'image/jpeg') : '',
        tieneOrig: !!orig,
        tomada: Date.now()
      });
    });
  }

  const byFicha = (id) => DB.byIndex('pmeta', 'fichaId', id)
    .then((rows) => rows.sort((a, b) => (a.tipo === b.tipo ? (a.orden || 0) - (b.orden || 0) : (a.tipo === 'punto' ? -1 : 1))));

  const getBlob = async (id) => { const r = await DB.get('photos', id); return r ? r.blob : null; };
  const getOrig = async (id) => { const r = await DB.get('photos', id); return r ? r.orig : null; };
  const getRec = (id) => DB.get('photos', id);

  async function soloOriginal(id) {
    const r = await DB.get('photos', id);
    if (!r) return;
    r.orig = null;
    await DB.put('photos', r);
    const m = await DB.get('pmeta', id);
    if (m) { m.tieneOrig = false; m.origBytes = 0; await DB.put('pmeta', m); }
  }

  async function remove(id) {
    await DB.txm(['photos', 'pmeta'], 'readwrite', (s) => {
      s.photos.delete(id);
      s.pmeta.delete(id);
    });
  }

  async function removeDeFicha(fichaId) {
    const metas = await DB.byIndex('pmeta', 'fichaId', fichaId);
    for (const m of metas) await remove(m.id);
  }

  function blobToDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }

  /* Copia reducida en dataURL para incrustar en el PDF (no se guarda). */
  async function paraPDF(blob, maxPx = 1200) {
    const src = await loadBitmap(blob);
    const c = scale(src, maxPx);
    return { dataUrl: c.toDataURL('image/jpeg', 0.78), w: c.width, h: c.height };
  }

  /* Copia en alta resolución (pero razonable) para subir a Drive cuando el original
     es demasiado pesado. Devuelve un Blob JPEG. */
  async function paraDrive(blob, maxPx = 3000) {
    const src = await loadBitmap(blob);
    const c = scale(src, maxPx);
    return toBlob(c, 0.9);
  }

  /* Espacio aproximado ocupado por las fotos (en MB). */
  async function peso() {
    const metas = await DB.all('pmeta');
    let b = 0;
    for (const m of metas) {
      const r = await DB.get('photos', m.id);
      if (r) { b += (r.blob ? r.blob.size : 0) + (r.orig ? r.orig.size : 0); }
    }
    return { bytes: b, n: metas.length };
  }

  return { procesar, paraPDF, paraDrive, add, byFicha, getBlob, getOrig, getRec, soloOriginal, remove, removeDeFicha, blobToDataURL, peso };
})();
