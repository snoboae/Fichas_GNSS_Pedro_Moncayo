/* Subida a Google Drive mediante un puente de Google Apps Script.
   No se necesita OAuth ni proyecto en Google Cloud: el dueño de la carpeta publica
   una vez el script (herramientas/Code.gs) como "aplicación web" y pega aquí la URL
   y la clave.

   Estructura que crea el script dentro de la carpeta raíz:
     <carpeta raíz>/
       2026-10-31/                (una por día de observación)
         RG-50-01/
           RG-50-01.pdf
           RG-50-01_punto_1.jpg
           RG-50-01_placa_1.jpg
           datos_RG-50-01.json

   Cada archivo se envía en una petición aparte (text/plain, sin preflight) para no
   chocar con los límites de tamaño del script. */
const Drive = (() => {
  const K_URL = 'drive.url';
  const K_CLAVE = 'drive.clave';
  const K_ULTIMO = 'drive.ultimo';

  let url = '';
  let clave = '';

  class ErrorDrive extends Error {
    constructor(msg, code) { super(msg); this.code = code || 'drive'; }
  }

  /* ---------------- configuración ---------------- */
  async function init() {
    url = (await DB.kvGet(K_URL, '')) || CONFIG.driveScriptUrl || '';
    clave = (await DB.kvGet(K_CLAVE, '')) || CONFIG.driveClave || '';
  }
  const configurado = () => !!(url && clave);
  const urlActual = () => url;
  const claveActual = () => clave;

  async function guardarConfig(u, c) {
    url = String(u || '').trim();
    clave = String(c || '').trim();
    await DB.kvSet(K_URL, url);
    await DB.kvSet(K_CLAVE, clave);
  }

  const normalizarUrl = (u) => String(u || '').trim();

  function validarUrl(u) {
    const s = normalizarUrl(u);
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/.test(s)) {
      throw new ErrorDrive('La URL debe empezar con https://script.google.com/macros/s/…/exec (la que da Google al implementar).', 'url');
    }
    return s;
  }

  /* ---------------- envío ---------------- */
  function mensajeError(j) {
    const e = String((j && j.error) || '');
    if (e === 'clave') return 'La clave no coincide con la del script.';
    if (e === 'cuota') return 'El script se quedó sin cuota o el archivo es demasiado grande.';
    if (e === 'datos') return 'El script no recibió los datos del archivo.';
    return 'El script respondió con un error: ' + (e || 'desconocido');
  }

  async function enviar(payload, timeoutMs) {
    if (!configurado()) throw new ErrorDrive('Falta configurar la URL y la clave del script de Drive (pestaña Drive).', 'sin_config');
    const cuerpo = JSON.stringify(payload);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 180000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // sin preflight CORS
        body: cuerpo,
        redirect: 'follow',
        signal: ctrl.signal
      });
      const txt = await r.text();
      let j;
      try { j = JSON.parse(txt); }
      catch (e) {
        throw new ErrorDrive('El script no respondió JSON. Revisa que el despliegue sea "Aplicación web" y el acceso "Cualquier persona".', 'respuesta');
      }
      if (!j.ok) {
        const err = new ErrorDrive(mensajeError(j), j.error || 'script');
        if (j.error === 'existe') err.existe = j;      // la app pregunta qué hacer
        throw err;
      }
      return j;
    } catch (e) {
      if (e instanceof ErrorDrive) throw e;
      if (e.name === 'AbortError') throw new ErrorDrive('El script tardó demasiado. Intenta de nuevo o sube las fichas una por una.', 'timeout');
      // Si el navegador bloquea la lectura de la respuesta (CORS), se reenvía sin leerla.
      try {
        await fetch(url, { method: 'POST', mode: 'no-cors', body: cuerpo });
        return { ok: true, sinConfirmar: true };
      } catch (e2) {
        throw new ErrorDrive('No se pudo conectar con el script de Drive. Revisa internet y la URL.', 'red');
      }
    } finally {
      clearTimeout(t);
    }
  }

  async function probar(u, c, raiz) {
    const destino = validarUrl(u || url);
    const llave = String(c == null ? clave : c);
    if (!llave) throw new ErrorDrive('Falta la clave del script (la misma que pusiste en Code.gs).', 'clave');
    const q = destino + (destino.includes('?') ? '&' : '?') +
      'ping=1&clave=' + encodeURIComponent(llave) +
      (raiz ? '&raiz=' + encodeURIComponent(raiz) : '');
    let r;
    try {
      r = await fetch(q, { cache: 'no-store', redirect: 'follow' });
    } catch (e) {
      throw new ErrorDrive('No se pudo contactar el script. Revisa el internet y que la URL termine en /exec.', 'red');
    }
    if (r.status === 403) {
      throw new ErrorDrive('Google respondió 403 (acceso denegado). La implementación está restringida: ' +
        'en Apps Script abre Implementar → Administrar implementaciones → editar y pon "Quién tiene acceso: Cualquier persona".', 'acceso');
    }
    if (r.status === 401) throw new ErrorDrive('Google respondió 401: vuelve a autorizar el script desde el editor de Apps Script.', 'acceso');
    if (!r.ok) throw new ErrorDrive('El script respondió HTTP ' + r.status + '. Revisa la implementación en Apps Script.', 'http');
    let j = null;
    try { j = await r.json(); } catch (e) { /* respuesta no JSON */ }
    if (!j) {
      throw new ErrorDrive('El script respondió algo que no es JSON. Revisa que la URL termine en /exec ' +
        'y que la implementación sea del tipo "Aplicación web".', 'respuesta');
    }
    if (j.error === 'clave') throw new ErrorDrive('La clave no coincide con la del script.', 'clave');
    if (!j.ok) throw new ErrorDrive(mensajeError(j), j.error || 'script');
    return j;
  }

  /* ---------------- utilidades ---------------- */
  function aBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, ''));
      r.onerror = () => rej(new ErrorDrive('No se pudo leer el archivo para enviarlo.', 'lectura'));
      r.readAsDataURL(blob);
    });
  }

  const hoyISO = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  /* Extensiones equivalentes: iPhone guarda .jpeg lo que en Android es .jpg.
     Se normalizan para que el nombre del archivo no dependa de dónde vino la foto. */
  const EQUIV = { '.jpeg': '.jpg', '.jpe': '.jpg', '.jfif': '.jpg' };
  const extDe = (nombre, tipo) => {
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(nombre || ''));
    if (m) {
      const e = '.' + m[1].toLowerCase();
      return EQUIV[e] || e;
    }
    const t = String(tipo || '');
    if (/png/.test(t)) return '.png';
    if (/heic|heif/.test(t)) return '.heic';
    if (/webp/.test(t)) return '.webp';
    return '.jpg';
  };
  const mimeDe = (ext) => ({
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.heic': 'image/heic', '.heif': 'image/heif', '.webp': 'image/webp'
  }[ext] || 'application/octet-stream');

  /* Etiqueta del archivo según la sesión: IDA, VUELTA, BASE-D3 o UNICA */
  const etiquetaFicha = (ficha) => {
    const tipo = String(ficha.tipo || 'ida').toLowerCase();
    if (tipo === 'base') return 'BASE';
    if (tipo === 'unica') return 'UNICA';
    return tipo === 'vuelta' ? 'VUELTA' : 'IDA';
  };

  /* "Acceso vehicular" -> "acceso_vehicular" (para el nombre del archivo en Drive) */
  const nombreCorto = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

  /* ---------------- consulta previa ---------------- */
  /* Pregunta al script si ya existe la ficha (mismo nombre de PDF) antes de subir nada.
     Devuelve {existe, existente:{nombre,fecha,tamano}, autor:{operador,fecha}, copia:'COPIA1'…} */
  async function revisarExistente(ficha, raiz) {
    const punto = ficha.codigo;
    const etq = etiquetaFicha(ficha);
    const fecha = (ficha.fecha || hoyISO()).slice(0, 10);
    const [aa, mm, dd] = fecha.split('-');
    const dia = `${aa}_${mm}_${dd}`;
    const carpeta = `${etq}_${dd}_${mm}_${aa}_${punto}`;
    const r = await enviar({
      clave, op: 'existe', raiz, dia, carpeta, punto,
      nombre: `${punto}_${etq}.pdf`
    }, 30000);
    return r;
  }

  /* ---------------- subida ---------------- */
  async function subirArchivo(o) {
    const datos = await aBase64(o.blob);
    return enviar({
      clave,
      op: 'subir',
      raiz: o.raiz,
      dia: o.dia,
      carpeta: o.carpeta,
      punto: o.punto,
      nombre: o.nombre,
      mime: o.mime || 'application/octet-stream',
      siExiste: o.siExiste || '',
      carpetaCopia: o.carpetaCopia || '',
      datos
    }, o.timeoutMs);
  }

  /* ficha: registro; pdfBlob: Blob del PDF; fotos: [{tipo, orden, nombre, orig, blob, origTipo}] */
  async function subirFicha(ficha, pdfBlob, fotos, onPaso, raiz, opciones) {
    const opc = opciones || {};
    const siExiste = opc.siExiste || '';                 // '' | 'copia'
    const carpetaCopia = opc.carpetaCopia || '';         // 'COPIA' | 'COPIA 1'… (lo decide el script)
    if (!configurado()) throw new ErrorDrive('Falta configurar la URL y la clave del script de Drive.', 'sin_config');
    const paso = (t) => { if (onPaso) onPaso(t); };
    const punto = ficha.codigo;
    const etq = etiquetaFicha(ficha);                       // IDA / VUELTA / BASE-3 / UNICA
    /* dos niveles:  <raíz>/<aaaa_mm_dd>/<TIPO[+jornada]_dd_mm_aaaa_CÓDIGO>/  */
    const fecha = (ficha.fecha || hoyISO()).slice(0, 10);
    const [aa, mm, dd] = fecha.split('-');
    const dia = `${aa}_${mm}_${dd}`;
    /* las bases llevan el número de jornada: BASE3_03_11_2026_RG-50-01 */
    const prefijo = etq;
    const carpeta = `${prefijo}_${dd}_${mm}_${aa}_${punto}`;
    const base = `${punto}_${etq}`;
    const archivos = [];

    paso('Ficha PDF…');
    const rPdf = await subirArchivo({
      raiz, dia, carpeta, punto, nombre: `${base}.pdf`, mime: 'application/pdf', blob: pdfBlob,
      siExiste, carpetaCopia
    });
    archivos.push(rPdf.nombre || `${base}.pdf`);
    /* si el script guardó en una carpeta de copia, el resto de archivos va a la misma */
    const copia = (rPdf && rPdf.subcarpeta) || '';

    const lista = fotos || [];
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      /* medición y placa van con nombre fijo; las adicionales con su nombre */
      const n = f.tipo === 'placa' ? 'placa'
        : f.tipo === 'extra' ? (nombreCorto(f.etiqueta) || 'extra')
          : 'medicion';
      const original = f.orig || null;
      const usarOriginal = original && original.size <= (CONFIG.fotoMaxDriveMB || 8) * 1024 * 1024;
      const cuerpo = usarOriginal ? original : (f.blob || original);
      if (!cuerpo) continue;
      const ext = usarOriginal ? extDe(f.nombre, f.origTipo) : '.jpg';
      const nombre = `${base}_${n}_${f.orden || (i + 1)}${ext}`;
      paso(`Foto ${i + 1} de ${lista.length}…`);
      const rFoto = await subirArchivo({
        raiz, dia, carpeta, punto, nombre,
        mime: usarOriginal ? (f.origTipo || mimeDe(ext)) : 'image/jpeg',
        blob: cuerpo, siExiste, carpetaCopia: copia || carpetaCopia
      });
      archivos.push(rFoto.nombre || nombre);
    }

    paso('Datos de la ficha…');
    const datos = JSON.stringify({
      proyecto: PROYECTO,
      ficha: Object.assign({}, ficha, { croquis: undefined }),
      subido: new Date().toISOString()
    }, null, 2);
    const rJson = await subirArchivo({
      raiz, dia, carpeta, punto,
      nombre: `datos_${base}.json`,
      mime: 'application/json', siExiste, carpetaCopia: copia || carpetaCopia,
      blob: new Blob([datos], { type: 'application/json' })
    });
    archivos.push(`datos_${base}.json`);

    const sub = copia || '';
    const ruta = `${raiz || CONFIG.carpetaProyecto}/${dia}/${carpeta}` + (sub ? '/' + sub : '');
    return { ruta, archivos, carpeta, dia, fecha, subcarpeta: sub };
  }

  return {
    init, configurado, urlActual, claveActual, guardarConfig, validarUrl,
    probar, revisarExistente, subirFicha, subirArchivo, aBase64, hoyISO, ErrorDrive
  };
})();
