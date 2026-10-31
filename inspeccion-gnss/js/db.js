/* Almacenamiento local (IndexedDB). Todo queda en el teléfono.
   Stores:
     fichas : { id (código), ...datos de la ficha }        una por punto, se sobrescribe al guardar
     photos : { id, fichaId, tipo, blob, orig }             blob = copia liviana; orig = original de cámara
     pmeta  : { id, fichaId, tipo, thumb, w, h, orden }     metadatos + miniatura (ligero, para listar)
     croquis: { codigo, dataUrl, z, fecha }                 croquis pregenerado en oficina (sirve sin internet)
     kv     : { key, value }                                ajustes, carpeta de Drive, cola de subida
   Fotos y metadatos van en stores separados para no cargar los blobs al listar. */
const DB = (() => {
  const NAME = 'fichas-gnss';
  const VER = 2;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('fichas')) d.createObjectStore('fichas', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('photos')) {
          const p = d.createObjectStore('photos', { keyPath: 'id' });
          p.createIndex('fichaId', 'fichaId');
        }
        if (!d.objectStoreNames.contains('pmeta')) {
          const m = d.createObjectStore('pmeta', { keyPath: 'id' });
          m.createIndex('fichaId', 'fichaId');
        }
        if (!d.objectStoreNames.contains('croquis')) d.createObjectStore('croquis', { keyPath: 'codigo' });
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv', { keyPath: 'key' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  async function tx(store, mode, fn) {
    const d = await open();
    const names = Array.isArray(store) ? store : [store];
    return new Promise((res, rej) => {
      const t = d.transaction(names, mode);
      const out = {};
      let hasOut = false;
      const req = fn((name) => t.objectStore(name));
      if (req && typeof req.then === 'function') req.then((v) => { hasOut = true; out.value = v; });
      else if (req) req.onsuccess = () => { hasOut = true; out.value = req.result; };
      t.oncomplete = () => res(hasOut ? out.value : undefined);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  /* Varios stores en una sola transacción: fn recibe { nombre: IDBObjectStore }. */
  async function txm(storeNames, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(storeNames, mode);
      const s = {};
      storeNames.forEach((n) => { s[n] = t.objectStore(n); });
      try { fn(s); } catch (e) { rej(e); }
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  return {
    all: (s) => tx(s, 'readonly', (o) => o(s).getAll()),
    get: (s, id) => tx(s, 'readonly', (o) => o(s).get(id)),
    put: (s, v) => tx(s, 'readwrite', (o) => o(s).put(v)),
    del: (s, id) => tx(s, 'readwrite', (o) => o(s).delete(id)),
    clear: (s) => tx(s, 'readwrite', (o) => o(s).clear()),
    byIndex: (s, idx, val) => tx(s, 'readonly', (o) => o(s).index(idx).getAll(val)),
    txm,
    async kvGet(key, def) {
      const r = await tx('kv', 'readonly', (o) => o('kv').get(key));
      return r ? r.value : def;
    },
    kvSet: (key, value) => tx('kv', 'readwrite', (o) => o('kv').put({ key, value }))
  };
})();
