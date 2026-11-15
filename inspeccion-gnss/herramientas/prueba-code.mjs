/**
 * Prueba del Code.gs (sin Google): simula DriveApp, Utilities y SpreadsheetApp
 * y comprueba que los tres levantamientos siguen funcionando.
 *
 *   node herramientas/prueba-code.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const app = path.dirname(aqui);

let ok = 0, fail = 0;
const check = (cond, txt, dato) => {
  if (cond) { ok++; console.log('OK   ' + txt); }
  else { fail++; console.log('FALLA ' + txt + (dato !== undefined ? ' → ' + dato : '')); }
};

/* ---------------- Drive falso ---------------- */
let idSeq = 0;
const nuevoId = () => 'id' + (++idSeq);

function iterador(lista) {
  let i = 0;
  return { hasNext: () => i < lista.length, next: () => lista[i++] };
}

function carpetaFalsa(nombre, padre) {
  const c = {
    nombre, id: nuevoId(), padre,
    carpetas: [], archivos: [],
    getName: () => c.nombre,
    getId: () => c.id,
    getUrl: () => 'https://drive.google.com/folders/' + c.id,
    getFoldersByName: (n) => iterador(c.carpetas.filter((x) => x.nombre === n)),
    getFilesByName: (n) => iterador(c.archivos.filter((x) => x.nombre === n)),
    getFolders: () => iterador(c.carpetas.slice()),
    getFiles: () => iterador(c.archivos.slice()),
    createFolder(n) { const f = carpetaFalsa(n, c); c.carpetas.push(f); return f; },
    createFile(blob) {
      const f = {
        nombre: blob.getName ? blob.getName() : blob.nombre,
        id: nuevoId(),
        bytes: blob.bytes,
        getMimeType: () => blob.mime || 'application/octet-stream',
        getId() { return this.id; },
        getName() { return this.nombre; },
        getSize: () => (f.bytes ? f.bytes.length : 0),
        getLastUpdated: () => new Date('2026-11-15T12:00:00Z'),
        getUrl: () => 'https://drive.google.com/file/' + f.id,
        makeCopy: (n) => ({ getName: () => n })
      };
      c.archivos.push(f);
      return f;
    },
    addFile(arch) { if (c.archivos.indexOf(arch) < 0) c.archivos.push(arch); },
    removeFile(arch) { const i = c.archivos.indexOf(arch); if (i >= 0) c.archivos.splice(i, 1); }
  };
  return c;
}

const raizDrive = carpetaFalsa('Mi unidad', null);

const archivosPorId = new Map();   // id -> archivo (para DriveApp.getFileById)

const DriveApp = {
  getRootFolder: () => raizDrive,
  getFileById: (id) => archivosPorId.get(id) || null,
  getFoldersByName: (n) => iterador(raizDrive.carpetas.filter((x) => x.nombre === n)),
  createFolder: (n) => raizDrive.createFolder(n),
  searchFolders: () => iterador([])
};

/* ---------------- Utilities / Session ---------------- */
const Utilities = {
  newBlob: (bytes, mime, nombre) => ({ bytes, mime, nombre, getName: () => nombre }),
  base64Decode: (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  formatDate: () => '20261115-1200'
};
const Session = { getScriptTimeZone: () => 'America/Guayaquil' };
const Logger = { log: () => {} };

/* ---------------- SpreadsheetApp falso ---------------- */
const hojas = [];
function hojaFalsa(nombre) {
  const h = {
    nombre, filas: [],
    getName: () => h.nombre,
    setName: (n) => { h.nombre = n; },
    appendRow: (f) => h.filas.push(f),
    getLastRow: () => h.filas.length,
    getRange: (r, c, nr, nc) => {
      const rango = {
        setFontWeight: () => rango, setBackground: () => rango, setFontColor: () => rango,
        setWrap: () => rango,
        getValues: () => {
          const salida = [];
          for (let i = 0; i < (nr || 1); i++) {
            const fila = h.filas[(r - 1) + i] || [];
            const trozo = [];
            for (let j = 0; j < (nc || 1); j++) {
              trozo.push(fila[(c - 1) + j] === undefined ? '' : fila[(c - 1) + j]);
            }
            salida.push(trozo);
          }
          return salida;
        }
      };
      return rango;
    },
    setFrozenRows: () => {},
    setColumnWidth: () => {}
  };
  return h;
}
const SpreadsheetApp = {
  create: (nombre) => {
    const primera = hojaFalsa('Hoja 1');
    const ss = {
      nombre, id: nuevoId(), hojas: [primera],
      getId() { return this.id; },
      getUrl: () => 'https://docs.google.com/spreadsheets/d/' + ss.id,
      getSheets: () => ss.hojas,
      getSheetByName: (n) => ss.hojas.find((x) => x.nombre === n) || null
    };
    hojas.push(ss);
    /* el archivo también existe en Drive, para poder moverlo de carpeta */
    const arch = { nombre, id: ss.id, padre: null, getName: () => nombre, getId: () => ss.id,
      getMimeType: () => 'application/vnd.google-apps.spreadsheet' };
    ss.archivo = arch;
    archivosPorId.set(ss.id, arch);
    return ss;
  },
  openById: (id) => hojas.find((x) => x.id === id) || null
};
const MimeType = { GOOGLE_SHEETS: 'application/vnd.google-apps.spreadsheet' };

/* ContentService: json() devuelve el objeto como texto JSON. */
const ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: (texto) => ({
    texto,
    setMimeType() { return this; },
    getContent() { return this.texto; }
  })
};

/* ---------------- cargar Code.gs ---------------- */
const fuente = fs.readFileSync(path.join(aqui, 'Code.gs'), 'utf8');
const mod = new Function(
  'DriveApp', 'Utilities', 'Session', 'Logger', 'SpreadsheetApp', 'MimeType', 'ContentService', 'console',
  fuente + '\n; return { doGet, doPost, CLAVE, CARPETA_RAIZ, carpetaRaiz, hojaObservaciones };'
)(DriveApp, Utilities, Session, Logger, SpreadsheetApp, MimeType, ContentService, console);

const CLAVE = mod.CLAVE;
const post = (o) => JSON.parse(mod.doPost({ postData: { contents: JSON.stringify(o) } }).texto);
const get = (p) => JSON.parse(mod.doGet({ parameter: p }).texto);

const PDF = 'JVBERi0xLjQK';   // base64 de "%PDF-1.4"
const PETER = 'Inspección GNSS - Pedro Moncayo';
const RUMI = 'Pruebas GNSS - Rumiñahui';
const VA = 'Inspección GNSS - Pedro Moncayo/VISTA ATRÁS';

/* ---------------- 1) los dos levantamientos de siempre ---------------- */
let r = post({ clave: CLAVE, op: 'subir', raiz: PETER, dia: '2026_11_15', carpeta: 'IDA_15_11_2026_RG-52-02',
  punto: 'RG-52-02', nombre: 'RG-52-02_IDA.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === true, 'Pedro Moncayo: sube un PDF', JSON.stringify(r).slice(0, 90));

r = post({ clave: CLAVE, op: 'subir', raiz: RUMI, dia: '2026_11_15', carpeta: 'UNICA_15_11_2026_PCA01',
  punto: 'PCA01', nombre: 'PCA01_UNICA.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === true, 'Rumiñahui: sube un PDF', JSON.stringify(r).slice(0, 90));

const cPeter = raizDrive.carpetas.find((c) => c.nombre === PETER);
const cRumi = raizDrive.carpetas.find((c) => c.nombre === RUMI);
check(!!cPeter, 'la carpeta de Pedro Moncayo sigue siendo la misma');
check(!!cRumi, 'la carpeta de Rumiñahui sigue siendo la misma');
check(cPeter && cPeter.carpetas.some((c) => c.nombre === '2026_11_15'), 'Pedro: crea la carpeta del día');
check(cRumi && cRumi.carpetas.some((c) => c.nombre === '2026_11_15'), 'Rumiñahui: crea la carpeta del día');
check(raizDrive.carpetas.filter((c) => c.nombre === PETER).length === 1, 'no duplica la raíz de Pedro');

/* ---------------- 2) duplicados (op existe / copia) ---------------- */
r = post({ clave: CLAVE, op: 'subir', raiz: PETER, dia: '2026_11_15', carpeta: 'IDA_15_11_2026_RG-52-02',
  punto: 'RG-52-02', nombre: 'RG-52-02_IDA.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === false && r.error === 'existe', 'Pedro: avisa que la ficha ya existe', JSON.stringify(r).slice(0, 120));
check(r.carpetaCopia === 'COPIA', 'dice en qué carpeta de copia iría', r.carpetaCopia);

r = post({ clave: CLAVE, op: 'subir', raiz: PETER, dia: '2026_11_15', carpeta: 'IDA_15_11_2026_RG-52-02',
  punto: 'RG-52-02', nombre: 'RG-52-02_IDA.pdf', mime: 'application/pdf', datos: PDF,
  siExiste: 'copia', carpetaCopia: 'COPIA' });
check(r.ok === true && r.subcarpeta === 'COPIA', 'Pedro: la copia va a la subcarpeta COPIA', JSON.stringify(r).slice(0, 90));

r = post({ clave: CLAVE, op: 'subir', raiz: PETER, dia: '2026_11_15', carpeta: 'IDA_15_11_2026_RG-52-02',
  punto: 'RG-52-02', nombre: 'RG-52-02_IDA_medicion_1.jpg', mime: 'image/jpeg', datos: PDF,
  siExiste: 'copia', carpetaCopia: 'COPIA' });
check(r.ok === true && r.subcarpeta === 'COPIA', 'Pedro: la foto entra en la misma COPIA');

/* ---------------- 3) VISTA ATRÁS ---------------- */
r = post({ clave: CLAVE, op: 'subir', raiz: VA, dia: '2026_11_16', carpeta: 'VA_16_11_2026_VA-50-01',
  punto: 'VA-50-01', nombre: 'VA-50-01_UNICA.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === true, 'Vista Atrás: sube el PDF', JSON.stringify(r).slice(0, 90));
check(cPeter && cPeter.carpetas.some((c) => c.nombre === 'VISTA ATRÁS'), 'Vista Atrás queda DENTRO de la carpeta de Pedro');
check(!raizDrive.carpetas.some((c) => c.nombre === 'VISTA ATRÁS'), 'Vista Atrás no se crea en la raíz del Drive');

/* ---------------- 3 bis) reintento con 'continuar' ---------------- */
r = post({ clave: CLAVE, op: 'subir', raiz: VA, dia: '2026_11_16', carpeta: 'VA_16_11_2026_VA-50-01',
  punto: 'VA-50-01', nombre: 'VA-50-01_UNICA.pdf', mime: 'application/pdf', datos: PDF, siExiste: 'continuar' });
check(r.ok === true && r.saltado === true, 'si continúa y el archivo ya está, se salta sin tocarlo', JSON.stringify(r).slice(0, 80));

r = post({ clave: CLAVE, op: 'subir', raiz: VA, dia: '2026_11_16', carpeta: 'VA_16_11_2026_VA-50-01',
  punto: 'VA-50-01', nombre: 'VA-50-01_UNICA_placa_2.jpg', mime: 'image/jpeg', datos: PDF, siExiste: 'continuar' });
check(r.ok === true && !r.saltado && r.subcarpeta === '', 'si continúa y falta, se crea en la carpeta de la ficha', JSON.stringify(r).slice(0, 80));

/* ---------------- 4) observaciones ---------------- */
r = post({ clave: CLAVE, raiz: VA, op: 'obs', punto: 'VA-50-01', fecha: '2026-11-16',
  operador: 'Operador VA', texto: 'Sin novedad, placa visible.' });
check(r.ok === true && r.fila === 2, 'la observación se anota (fila 2, con cabecera)', JSON.stringify(r).slice(0, 110));
const libro = hojas[0];
check(libro && libro.hojas[0].filas[0][0] === 'PUNTO', 'la hoja arranca con cabecera PUNTO/FECHA/…');
const fila1 = libro && libro.hojas[0].filas[1];
check(!!fila1 && fila1[2] === 'Sin novedad, placa visible.', 'la fila trae el texto de la observación', JSON.stringify(fila1 || null));

/* la misma observación, otra vez: no se duplica */
const antes = libro.hojas[0].filas.length;
r = post({ clave: CLAVE, raiz: VA, op: 'obs', punto: 'VA-50-01', fecha: '2026-11-16',
  operador: 'Operador VA', texto: 'Sin novedad, placa visible.' });
check(r.ok === true && r.repetida === true, 'la misma observación no se escribe dos veces', JSON.stringify(r).slice(0, 90));
check(libro.hojas[0].filas.length === antes, 'la hoja no ganó filas repetidas', libro.hojas[0].filas.length);

/* una observación distinta del mismo punto sí entra */
r = post({ clave: CLAVE, raiz: VA, op: 'obs', punto: 'VA-50-01', fecha: '2026-11-16',
  operador: 'Operador VA', texto: 'Se volvió a medir con otra antena.' });
check(r.ok === true && !r.repetida && libro.hojas[0].filas.length === antes + 1, 'una observación nueva sí se agrega');

/* ---------------- 5) errores y compatibilidad ---------------- */
r = post({ clave: 'otra', raiz: PETER, nombre: 'x.pdf', datos: PDF });
check(r.ok === false && r.error === 'clave', 'clave incorrecta se rechaza');

r = post({ clave: CLAVE, op: 'subir', raiz: 'Carpeta que no existe', dia: '2026_11_15', carpeta: 'X',
  nombre: 'x.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === true, 'una raíz no listada cae en la carpeta por defecto y no rompe');
check(!raizDrive.carpetas.some((c) => c.nombre === 'Carpeta que no existe'), 'no crea carpetas fuera de la lista');

const ping = get({ ping: '1', clave: CLAVE, raiz: RUMI });
check(ping.ok === true && ping.raiz === RUMI, 'ping de Rumiñahui devuelve su carpeta', ping.raiz);

const pingVA = get({ ping: '1', clave: CLAVE, raiz: VA });
check(pingVA.ok === true && pingVA.raiz === 'VISTA ATRÁS', 'ping de Vista Atrás devuelve su carpeta', pingVA.raiz);

/* ---------------- 6) un subida vieja sin 'op' no se confunde ---------------- */
r = post({ clave: CLAVE, op: 'subir', raiz: PETER, dia: '2026_11_15', carpeta: 'BASE2_15_11_2026_RG-50-01',
  punto: 'RG-50-01', nombre: 'RG-50-01_BASE-2.pdf', mime: 'application/pdf', datos: PDF });
check(r.ok === true, 'una ficha BASE del primer orden sigue subiendo', JSON.stringify(r).slice(0, 80));

console.log(`\nResultado: ${ok} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
