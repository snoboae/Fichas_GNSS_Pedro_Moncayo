/* Banco de pruebas del PDF (solo desarrollo; no lo usa la app).
   Ejecuta js/pdf.js en Node con jsPDF y escribe herramientas/_demo/ficha-<código>.pdf.
   Uso:
     node herramientas/prueba_pdf.mjs              -> ficha completa de RG-50-01
     node herramientas/prueba_pdf.mjs RG-52-04     -> ficha de otro código
     node herramientas/prueba_pdf.mjs --minimo     -> ficha vacía (peor caso)
     ... --sinfotos                                -> sin fotografías
   Antes: python herramientas/prueba_pdf.py demo */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

globalThis.window = globalThis;
globalThis.window.jspdf = require(path.join(raiz, 'lib', 'jspdf', 'jspdf.umd.min.js'));
globalThis.PDF_DEBUG = !!process.env.PDF_DEBUG;

const cargar = (rel) => vm.runInThisContext(fs.readFileSync(path.join(raiz, rel), 'utf8'), { filename: rel });
['js/config.js', 'js/datos.js', 'js/logos.js', 'js/geo.js', 'js/mapimg.js', 'js/pdf.js'].forEach(cargar);

const b64 = (p) => 'data:image/jpeg;base64,' + fs.readFileSync(p).toString('base64');
const demo = path.join(raiz, 'herramientas', '_demo');
const real = path.join(demo, 'croquis-real.jpg');
const croquis = b64(fs.existsSync(real) ? real : path.join(demo, 'croquis.jpg'));
const foto = b64(path.join(demo, 'foto.jpg'));

const arg = process.argv[2] || 'RG-50-01';
const minimo = arg === '--minimo';
const sinFotos = minimo || process.argv.includes('--sinfotos');
const p = minimo ? PUNTOS[0] : (PUNTOS.find((x) => x.c === arg) || PUNTOS[0]);
const { lat, lon } = Geo.puntoLatLon(p);

const ficha = {
  id: p.c, codigo: p.c, nombre: p.nombre, parroquia: p.parroquia, sector: p.sector,
  este: p.e, norte: p.n, orden: p.orden, materializacion: p.mat, lat, lon,
  inicio: '2026-10-31T09:15', fin: '2026-10-31T10:05', fecha: '2026-10-31',
  operador: 'Saúl Chicaiza', receptor: 'Hi-Target V90', alturaAntena: 1.532,
  metodo: 'Estático diferencial', mascara: 10, intervalo: 1, duracionMin: 50,

  croquis, croquisZ: 18
};
const fotos = sinFotos ? [] : [
  { tipo: 'punto', dataUrl: foto, w: 1200, h: 800 },
  { tipo: 'placa', dataUrl: foto, w: 1200, h: 800 }
];

if (minimo) {
  Object.assign(ficha, {
    inicio: '', fin: '', fecha: '', operador: '', receptor: '', alturaAntena: null,
    duracionMin: 0, croquis: null
  });
}

const doc = PDF.fichaDoc(ficha, fotos);
const buf = Buffer.from(doc.output('arraybuffer'));
const nombre = minimo ? 'ficha-minimo' : `ficha-${p.c}`;
const salida = path.join(demo, nombre + '.pdf');
fs.writeFileSync(salida, buf);
console.log('PDF:', salida, (buf.length / 1024).toFixed(1), 'KB', 'páginas:', doc.getNumberOfPages());
