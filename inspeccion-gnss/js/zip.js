/* Generador de archivos ZIP sin compresión (store) y sin dependencias.
   Las fotos ya son JPEG (comprimidas), así que basta guardarlas tal cual; solo se calcula el CRC-32.
   Para no duplicar memoria, el ZIP se arma como un Blob compuesto por: cabeceras (Uint8Array) + los
   blobs originales de IndexedDB (referencias, no copias). El CRC se calcula leyendo un buffer a la vez. */
const Zip = (() => {
  const te = new TextEncoder();
  let crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crcTable[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function u16(n) { return [n & 0xFF, (n >> 8) & 0xFF]; }
  function u32(n) { return [n & 0xFF, (n >> 8) & 0xFF, (n >> 16) & 0xFF, (n >>> 24) & 0xFF]; }

  // Fecha/hora DOS: (año-1980)<<9 | mes<<5 | dia, hora<<11 | min<<5 | seg/2
  function dosDateTime(d) {
    const t = new Date(d);
    return [
      ...u16((t.getHours() << 11) | (t.getMinutes() << 5) | (t.getSeconds() >> 1)),
      ...u16(((t.getFullYear() - 1980) << 9) | ((t.getMonth() + 1) << 5) | t.getDate())
    ];
  }

  function localHeader(name, crc, size, date) {
    const nb = te.encode(name);
    const h = new Uint8Array(30 + nb.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x04034b50, true);   // firma local
    v.setUint16(4, 20, true);           // versión necesaria
    v.setUint16(6, 0x0800, true);       // flags: nombres UTF-8
    v.setUint16(8, 0, true);            // método store
    h.set(dosDateTime(date), 10);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);        // tamaño comprimido
    v.setUint32(22, size, true);        // tamaño sin comprimir
    v.setUint16(26, nb.length, true);
    v.setUint16(28, 0, true);           // extra
    h.set(nb, 30);
    return h;
  }

  function centralEntry(name, crc, size, date, offset) {
    const nb = te.encode(name);
    const h = new Uint8Array(46 + nb.length);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);           // versión creada
    v.setUint16(6, 20, true);           // versión necesaria
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    h.set(dosDateTime(date), 12);
    v.setUint32(16, crc, true);
    v.setUint32(20, size, true);
    v.setUint32(24, size, true);
    v.setUint16(28, nb.length, true);
    v.setUint16(30, 0, true);           // extra
    v.setUint16(32, 0, true);           // comentario
    v.setUint16(34, 0, true);           // número de disco
    v.setUint16(36, 0, true);           // atributos internos
    v.setUint32(38, 0, true);           // atributos externos
    v.setUint32(42, offset, true);      // offset del local header
    h.set(nb, 46);
    return h;
  }

  function eocd(count, cdSize, cdOffset) {
    const h = new Uint8Array(22);
    const v = new DataView(h.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(4, 0, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, count, true);
    v.setUint16(10, count, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, cdOffset, true);
    v.setUint16(20, 0, true);           // comentario
    return h;
  }

  /* entries: [{ name, blob, date? }] -> Promise<Blob> */
  async function build(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
      const date = e.date || Date.now();
      const buf = await e.blob.arrayBuffer();
      const crc = crc32(new Uint8Array(buf));
      const size = buf.byteLength;
      parts.push(localHeader(e.name, crc, size, date));
      parts.push(e.blob);
      central.push(centralEntry(e.name, crc, size, date, offset));
      offset += 30 + te.encode(e.name).length + size;
    }
    let cdSize = 0;
    for (const c of central) { parts.push(c); cdSize += c.byteLength; }
    parts.push(eocd(entries.length, cdSize, offset));
    return new Blob(parts, { type: 'application/zip' });
  }

  return { build };
})();
