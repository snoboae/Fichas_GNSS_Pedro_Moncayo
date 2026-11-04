/* Prueba del módulo de Drive sin Google (solo desarrollo).
   - Levanta un servidor local que imita al script de Apps Script.
   - Comprueba el envío de la ficha completa (PDF + fotos + JSON) y el manejo de errores.
   Uso: node herramientas/prueba-drive.mjs */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cargar = (rel) => vm.runInThisContext(fs.readFileSync(path.join(raiz, rel), 'utf8'), { filename: rel });

let ok = 0, fail = 0;
const check = (cond, etiqueta, detalle) => {
  if (cond) { ok++; console.log('OK   ' + etiqueta); }
  else { fail++; console.log('FALLA ' + etiqueta + (detalle ? ' → ' + detalle : '')); }
};

/* --------- 1) servidor local que imita al script --------- */
const recibidos = [];
let modo = 'ok';   // ok | clave | 403 | html
const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    if (modo === '403') { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('<html>Acceso denegado</html>'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, version: '1.0', cuenta: 'prueba@ejemplo.com', raiz: 'Inspección GNSS - Pedro Moncayo', raizUrl: 'https://drive.google.com/x' }));
    return;
  }
  let cuerpo = '';
  req.on('data', (c) => { cuerpo += c; });
  req.on('end', () => {
    if (modo === '403') { res.writeHead(403, { 'Content-Type': 'text/html' }); res.end('<html>Acceso denegado</html>'); return; }
    if (modo === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>no json</html>'); return; }
    let j = null;
    try { j = JSON.parse(cuerpo); } catch (e) { res.writeHead(400); res.end('{}'); return; }
    recibidos.push(j);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (modo === 'clave') { res.end(JSON.stringify({ ok: false, error: 'clave' })); return; }
    if (j.op === 'existe') {
      res.end(JSON.stringify({
        ok: true, existe: true, copias: 2,
        existente: { nombre: j.nombre, tamano: 1000, actualizado: '2026-11-03 14:22' },
        autor: { operador: 'Otro Operador', fecha: '2026-11-03' }
      }));
      return;
    }
    res.end(JSON.stringify({ ok: true, id: 'f' + recibidos.length, nombre: j.nombre, bytes: (j.datos || '').length }));
  });
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const puerto = server.address().port;
const URL_LOCAL = `http://127.0.0.1:${puerto}/exec`;

/* --------- 2) entorno mínimo para drive.js --------- */
globalThis.window = globalThis;
globalThis.CONFIG = { driveScriptUrl: URL_LOCAL, driveClave: 'secreta', carpetaProyecto: 'Inspección GNSS - Pedro Moncayo', fotoMaxDriveMB: 8 };
globalThis.PROYECTO = { nombre: 'Proyecto', contrato: 'C', proceso: 'P', zona: 17, hemisferio: 'S', epsg: 'EPSG:32717' };
globalThis.DB = { kvGet: async () => null, kvSet: async () => {} };
globalThis.FileReader = class {
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = 'data:' + (blob.type || 'application/octet-stream') + ';base64,' + Buffer.from(buf).toString('base64');
      if (this.onload) this.onload();
    });
  }
};
cargar('js/drive.js');

/* --------- 3) envío de una ficha completa --------- */
await Drive.init();
check(Drive.configurado(), 'Drive queda configurado con URL y clave');

const pdf = new Blob([Buffer.from('%PDF-1.4 prueba')], { type: 'application/pdf' });
const fotoGrande = new Blob([Buffer.alloc(1024, 7)], { type: 'image/jpeg' });
const ficha = {
  codigo: 'RG-50-01', fecha: '2026-10-31', nombre: 'Mirador Mojanda', receptor: 'Hi-Target V90',
  alturaAntena: 1.532, inicio: '2026-10-31T09:15', fin: '2026-10-31T10:05', operador: 'Prueba'
};
const fotos = [
  { tipo: 'punto', orden: 1, nombre: 'IMG_1.jpg', orig: fotoGrande, blob: fotoGrande, origTipo: 'image/jpeg' },
  { tipo: 'placa', orden: 2, nombre: 'IMG_2.jpg', orig: fotoGrande, blob: fotoGrande, origTipo: 'image/jpeg' },
  { tipo: 'extra', orden: 1, etiqueta: 'Acceso vehicular', nombre: 'IMG_3.jpg', orig: fotoGrande, blob: fotoGrande, origTipo: 'image/jpeg' }
];
const r = await Drive.subirFicha(ficha, pdf, fotos, () => {});
check(recibidos.length === 5, 'se enviaron 5 archivos (PDF, 3 fotos y JSON)', 'recibidos=' + recibidos.length);
check(recibidos[0].nombre === 'RG-50-01_IDA.pdf' && recibidos[0].mime === 'application/pdf', 'el PDF va con su nombre y tipo');
check(recibidos[1].nombre === 'RG-50-01_IDA_medicion_1.jpg' && recibidos[2].nombre === 'RG-50-01_IDA_placa_2.jpg' && recibidos[3].nombre === 'RG-50-01_IDA_acceso_vehicular_1.jpg', 'las fotos van como <código>_<IDA|VUELTA>_medicion_N',
  recibidos.slice(1, 3).map((x) => x.nombre).join(', '));
check(recibidos.every((x) => x.carpeta === 'IDA_31_10_2026_RG-50-01' && x.punto === 'RG-50-01'), 'todas las peticiones llevan la carpeta TIPO_dd_mm_aaaa_CÓDIGO');
check(recibidos.every((x) => x.clave === 'secreta'), 'todas las peticiones llevan la clave');
const pdfB64 = Buffer.from(recibidos[0].datos, 'base64');
check(pdfB64.toString() === '%PDF-1.4 prueba', 'el base64 del PDF se decodifica igual');
check(recibidos[4].nombre === 'datos_RG-50-01_IDA.json', 'se envía el JSON de datos');
const datos = JSON.parse(Buffer.from(recibidos[4].datos, 'base64').toString());
check(datos.ficha.codigo === 'RG-50-01' && datos.ficha.inicio === '2026-10-31T09:15', 'el JSON lleva los datos de la ficha');
check(r.ruta === 'Inspección GNSS - Pedro Moncayo/2026_10_31/IDA_31_10_2026_RG-50-01', 'la ruta devuelta es raíz/día/carpeta de la ficha', r.ruta);

/* carpeta con nombre BASE / VUELTA / UNICA */
for (const caso of [['base', 3, 'BASE_31_10_2026_RG-50-01'], ['vuelta', null, 'VUELTA_31_10_2026_RG-50-01'], ['unica', null, 'UNICA_31_10_2026_RG-50-01']]) {
  const n0 = recibidos.length;
  await Drive.subirFicha({ ...ficha, tipo: caso[0], dia: caso[1] }, pdf, [], () => {});
  const c = recibidos[n0].carpeta;
  check(c === caso[2], 'carpeta para ' + caso[0] + ' = ' + caso[2], c);
}

/* --------- 4) errores (con respuestas simuladas de Google) --------- */
const URL_GOOGLE = 'https://script.google.com/macros/s/AKfycbzPRUEBA123/exec';   // forma válida
const respuesta = (o) => ({
  status: o.status || 200,
  ok: (o.status || 200) < 400,
  json: async () => { if (o.sinJson) throw new SyntaxError('no es json'); return o.json; },
  text: async () => (o.sinJson ? '<html>Acceso denegado</html>' : JSON.stringify(o.json))
});
const fetchReal = globalThis.fetch;

globalThis.fetch = async () => respuesta({ json: { ok: false, error: 'clave' } });
try { await Drive.probar(URL_GOOGLE, 'mala'); check(false, 'clave incorrecta debe fallar'); }
catch (e) { check(e.code === 'clave', 'clave incorrecta da error "clave"', e.code + ' ' + e.message); }

globalThis.fetch = async () => respuesta({ status: 403, sinJson: true });
try { await Drive.probar(URL_GOOGLE, 'x'); check(false, '403 debe fallar'); }
catch (e) { check(e.code === 'acceso' && /403/.test(e.message), 'el 403 de Google se explica con el paso a corregir', e.code); }

globalThis.fetch = async () => respuesta({ sinJson: true });
try { await Drive.probar(URL_GOOGLE, 'x'); check(false, 'respuesta sin JSON debe fallar'); }
catch (e) { check(e.code === 'respuesta', 'una respuesta que no es JSON se informa', e.code); }

globalThis.fetch = async () => respuesta({ json: { ok: true, cuenta: 'x@y.com', raiz: 'Carpeta', raizUrl: 'https://drive.google.com/x' } });
const ping = await Drive.probar(URL_GOOGLE, 'secreta');
check(ping.ok && ping.raiz === 'Carpeta', 'una respuesta correcta devuelve la carpeta y la cuenta');

/* la carpeta que se consulta debe ser la del levantamiento (no siempre Pedro Moncayo) */
let urlPedida = '';
globalThis.fetch = async (u) => { urlPedida = String(u); return respuesta({ json: { ok: true, cuenta: 'x@y.com', raiz: 'Pruebas GNSS - Rumiñahui', raizUrl: 'https://drive.google.com/r' } }); };
const pingRumi = await Drive.probar(URL_GOOGLE, 'secreta', 'Pruebas GNSS - Rumiñahui');
check(/raiz=Pruebas%20GNSS%20-%20Rumi/.test(urlPedida), 'la conexión pide la carpeta del levantamiento', urlPedida);
check(pingRumi.raiz === 'Pruebas GNSS - Rumiñahui', 'la respuesta trae la carpeta de Rumiñahui', pingRumi.raiz);

globalThis.fetch = fetchReal;

try { Drive.validarUrl('https://ejemplo.com/x'); check(false, 'URL inválida debe fallar'); }
catch (e) { check(e.code === 'url', 'una URL que no es de Apps Script se rechaza'); }

/* --------- consulta previa: ficha ya existente en Drive --------- */
const info = await Drive.revisarExistente(ficha, 'Inspección GNSS - Pedro Moncayo');
check(info.existe === true, 'la consulta previa dice que la ficha ya existe', JSON.stringify(info).slice(0, 80));
check(info.existe && info.autor && info.autor.operador === 'Otro Operador',
  'la consulta previa dice quién la subió', info.autor && info.autor.operador);
check(info.copias === 2, 'la consulta previa cuenta las copias que hay', String(info.copias));
check(recibidos.some((x) => x.op === 'existe' && x.nombre === 'RG-50-01_IDA.pdf'),
  'la consulta se hace por el nombre del PDF, sin subir nada');

/* --------- si el script responde 'existe' al subir, el error lo conserva --------- */
modo = 'ok';
const fetchPrevio = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true, status: 200,
  text: async () => JSON.stringify({ ok: false, error: 'existe', existente: { nombre: 'x' } }),
  json: async () => ({ ok: false, error: 'existe' })
});
try {
  await Drive.subirFicha(ficha, pdf, [], () => {});
  check(false, 'un conflicto al subir debe fallar');
} catch (e) {
  check(e && e.existe && e.existe.existente, 'el conflicto al subir trae los datos del archivo existente');
}
globalThis.fetch = fetchPrevio;

server.close();
console.log(`\nResultado: ${ok} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
