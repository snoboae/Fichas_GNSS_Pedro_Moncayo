/**
 * ============================================================================
 *  Puente de subida a Google Drive para la app
 *  "Fichas GNSS · Red Geodésica Pedro Moncayo"
 * ============================================================================
 *
 *  QUÉ HACE
 *  Recibe un archivo (PDF, foto o JSON) desde la app y lo guarda en el Drive del
 *  dueño de este script, con esta estructura:
 *
 *      <CARPETA_RAIZ>/2026_10_31/BASE3_31_10_2026_RG-50-01/RG-50-01_BASE-3.pdf
 *      <CARPETA_RAIZ>/2026_10_31/IDA_31_10_2026_RG-52-02/RG-52-02_IDA.pdf
 *      <CARPETA_RAIZ>/2026_11_15/VUELTA_15_11_2026_RG-53-01/RG-53-01_VUELTA_medicion_1.jpg
 *      <CARPETA_RAIZ>/2026_10_31/IDA_31_10_2026_RG-52-02/datos_RG-52-02_IDA.json
 *
 *  CÓMO SE INSTALA (una sola vez)
 *  1. Entra a https://script.google.com con la cuenta dueña de la carpeta.
 *  2. "Nuevo proyecto" → borra el contenido y pega TODO este archivo.
 *  3. Cambia CLAVE por una palabra secreta (la misma que pondrás en la app).
 *  4. Implementar → Nueva implementación → tipo "Aplicación web".
 *       · Ejecutar como:  Yo
 *       · Quién tiene acceso:  Cualquier persona
 *  5. Autoriza los permisos y copia la URL que termina en /exec.
 *  6. En la app: pestaña Drive → pega la URL y la CLAVE → "Guardar y probar".
 *
 *  NOTAS
 *  · No hace falta OAuth ni proyecto de Google Cloud.
 *  · Los archivos quedan a nombre del dueño de este script (una cuenta institucional).
 *  · Si la ficha de ese punto ya existe ese día, NUNCA se borra nada: la nueva se guarda
 *    completa en una subcarpeta COPIA (o "COPIA 1", "COPIA 2"…) dentro de la carpeta de
 *    la ficha. Quedan las dos, cada una con su PDF, sus fotos y su JSON.
 *  · Para comprobar que quedó bien, ejecuta la función `probar` desde el editor.
 * ============================================================================
 */

// ------------------------------- CONFIGURACIÓN -------------------------------
var CLAVE = 'CAMBIA_ESTA_CLAVE';                        // ← tu palabra secreta
var CARPETA_RAIZ = 'Inspección GNSS - Pedro Moncayo';   // ← carpeta que se crea en tu Drive
// -----------------------------------------------------------------------------

/** Diagnóstico: se ejecuta desde el editor (menú Ejecutar) para ver si todo está bien. */
function probar() {
  var raiz = carpetaRaiz();
  var msg = 'Carpeta: ' + raiz.getName() + '\nURL: ' + raiz.getUrl() +
    '\nCuenta: ' + cuenta() + '\nClave configurada: ' + (CLAVE === 'CAMBIA_ESTA_CLAVE' ? 'NO (cámbiala)' : 'sí');
  Logger.log(msg);
  return msg;
}

/** GET: la app lo usa para probar la conexión. */
function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.ping) return json({ ok: true, version: '1.0', mensaje: 'Puente de subida activo' });
  if (p.clave !== CLAVE) return json({ ok: false, error: 'clave' });
  try {
    var raiz = carpetaRaiz(p.raiz);       // <-- la carpeta del levantamiento que pregunta
    return json({
      ok: true, version: '1.0', cuenta: cuenta(), proyecto: String(p.raiz || ''),
      raiz: raiz.getName(), raizUrl: raiz.getUrl()
    });
  } catch (err) {
    return json({ ok: false, error: 'script: ' + mensaje(err) });
  }
}

/** POST: sube un archivo. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json({ ok: false, error: 'datos' });
    var j = JSON.parse(e.postData.contents);
    if (j.clave !== CLAVE) return json({ ok: false, error: 'clave' });

    /* 1) consulta: ¿ya hay una ficha con ese nombre? (sin subir nada) */
    if (j.op === 'existe') {
      var cDia0 = carpetaDe(String(j.dia || hoy().replace(/-/g, '_')), carpetaRaiz(j.raiz));
      var c0 = carpetaDeFicha(String(j.carpeta || 'sin-codigo'), cDia0);
      return json(infoExistente(c0, String(j.nombre || '')));
    }

    if (j.op !== 'subir') return json({ ok: false, error: 'op' });
    if (!j.nombre || !j.datos) return json({ ok: false, error: 'datos' });

    // Dos niveles: <raíz>/<aaaa_mm_dd>/<TIPO[jornada]_dd_mm_aaaa_CÓDIGO>/
    // Antes de crear cada carpeta se busca por nombre; nunca se duplica.
    var dia = carpetaDe(String(j.dia || hoy().replace(/-/g, '_')), carpetaRaiz(j.raiz));
    var carpetaFicha = carpetaDeFicha(String(j.carpeta || 'sin-codigo'), dia);
    var bytes = Utilities.base64Decode(j.datos);
    var blob = Utilities.newBlob(bytes, j.mime || 'application/octet-stream', j.nombre);

    /* Decisión por PETICIÓN (no por archivo):
       · siExiste = 'copia' → todo el juego va a la subcarpeta COPIA / COPIA 1 / COPIA 2…
         (aunque ese archivo en concreto no exista: la extensión puede cambiar, p. ej. .jpeg)
       · si no            → si el nombre ya existe se responde 'existe' y la app decide */
    var politica = String(j.siExiste || '');
    var carpetaDestino = carpetaFicha;
    var subcarpeta = '';
    var existentes = listaPorNombre(carpetaFicha, String(j.nombre));

    if (politica === 'copia') {
      var pedida = String(j.carpetaCopia || '');
      var nombreCopia = /^COPIA( [0-9]{1,3})?$/.test(pedida) ? pedida : carpetaCopiaLibre(carpetaFicha);
      carpetaDestino = carpetaDe(nombreCopia, carpetaFicha);
      /* si dentro de esa copia ya estuviera ese archivo, se pasa a la siguiente carpeta */
      if (listaPorNombre(carpetaDestino, String(j.nombre)).length) {
        carpetaDestino = carpetaDe(carpetaCopiaLibre(carpetaFicha), carpetaFicha);
      }
      subcarpeta = carpetaDestino.getName();
    } else if (existentes.length) {
      var info = infoExistente(carpetaFicha, String(j.nombre));
      info.ok = false;
      return json(info);
    }
    /* aviso: si en la carpeta principal hay un archivo con el mismo nombre y otra extensión
       (.jpg / .jpeg), no se toca: la copia va aparte y nada se sobrescribe. */

    var f = carpetaDestino.createFile(blob);
    return json({
      ok: true, id: f.getId(), nombre: f.getName(), bytes: bytes.length,
      copia: !!subcarpeta, subcarpeta: subcarpeta,
      dia: dia.getName(), carpeta: carpetaFicha.getName(), url: f.getUrl()
    });
  } catch (err) {
    return json({ ok: false, error: mensaje(err) });
  }
}

// --------------------------------- ayudantes ---------------------------------
/* Cada levantamiento tiene su carpeta raíz. Solo se aceptan estos nombres. */
var RAIZ_VALIDAS = ['Inspección GNSS - Pedro Moncayo', 'Pruebas GNSS - Rumiñahui'];

function carpetaRaiz(nombre) {
  var n = String(nombre || CARPETA_RAIZ);
  if (RAIZ_VALIDAS.indexOf(n) < 0) n = CARPETA_RAIZ;
  var it = DriveApp.getFoldersByName(n);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(n);
}

function carpeta(nombre, padre) {
  var it = padre ? padre.getFoldersByName(nombre) : DriveApp.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return padre ? padre.createFolder(nombre) : DriveApp.createFolder(nombre);
}

/* Devuelve la carpeta con ese nombre dentro de "padre"; si no existe, la crea.
   Nunca duplica: siempre se busca primero (y devuelve la primera si hubiera varias). */
function carpetaDe(nombre, padre) {
  var it = padre.getFoldersByName(nombre);
  if (it.hasNext()) return it.next();
  return padre.createFolder(nombre);
}

/* Carpeta de la ficha dentro de la carpeta del día. Si por algún motivo ya existe en la
   raíz o se movió a mano, se reutiliza en vez de crear otra. */
function carpetaDeFicha(nombre, dia) {
  var enDia = dia.getFoldersByName(nombre);
  if (enDia.hasNext()) return enDia.next();
  var raiz = carpetaRaiz();
  var enRaiz = raiz.getFoldersByName(nombre);
  if (enRaiz.hasNext()) return enRaiz.next();
  var buscar = DriveApp.searchFolders('title = "' + String(nombre).replace(/"/g, '') + '" and trashed = false');
  if (buscar.hasNext()) return buscar.next();
  return dia.createFolder(nombre);
}

/* Archivos con ese nombre exacto en la carpeta (la búsqueda de Drive no distingue
   mayúsculas, así que se compara el nombre tal cual). */
function listaPorNombre(carpeta, nombre) {
  var out = [], it = carpeta.getFilesByName(nombre);
  while (it.hasNext()) {
    var f = it.next();
    if (f.getName() === nombre) out.push(f);
  }
  return out;
}

/* Primera carpeta de copia libre: COPIA, COPIA 1, COPIA 2… */
function carpetaCopiaLibre(carpeta) {
  if (!carpeta.getFoldersByName('COPIA').hasNext()) return 'COPIA';
  var n = 1;
  while (carpeta.getFoldersByName('COPIA ' + n).hasNext() && n < 1000) n++;
  return 'COPIA ' + n;
}

/* Nombre libre dentro de una carpeta: si ya existe, agrega _2, _3… */
function nombreLibre(carpeta, nombre) {
  if (!listaPorNombre(carpeta, nombre).length) return nombre;
  var base = quitarExtension(nombre), ext = extension(nombre), n = 2;
  while (listaPorNombre(carpeta, base + '_' + n + ext).length && n < 1000) n++;
  return base + '_' + n + ext;
}

function quitarExtension(nombre) {
  return String(nombre).replace(/\.[a-z0-9]{1,6}$/i, '');
}

function extension(nombre) {
  var m = /\.[a-z0-9]{1,6}$/i.exec(String(nombre));
  return m ? m[0] : '';
}

/* Datos del archivo que ya existe: cuándo se subió y quién lo hizo (si está el datos.json). */
function autorDe(carpeta) {
  var out = { operador: '', fecha: '' };
  var it = carpeta.getFiles();
  var candidatos = [];
  while (it.hasNext()) {
    var f = it.next();
    if (/^datos_.*\.json$/i.test(f.getName())) candidatos.push(f);
  }
  candidatos.sort(function (a, b) { return b.getLastUpdated().getTime() - a.getLastUpdated().getTime(); });
  if (!candidatos.length) return out;
  try {
    var txt = candidatos[0].getBlob().getDataAsString();
    var j = JSON.parse(txt);
    var ficha = (j && j.ficha) || j || {};
    out.operador = String((ficha && ficha.operador) || '');
    out.fecha = String((ficha && (ficha.fecha || ficha.inicio)) || '');
  } catch (err) { /* json ilegible: se devuelve vacío */ }
  return out;
}

/* Respuesta estándar cuando hay (o no) un archivo con ese nombre. */
function infoExistente(carpeta, nombre) {
  var encontrados = listaPorNombre(carpeta, nombre);
  var autor = autorDe(carpeta);
  var primero = encontrados.length ? encontrados[0] : null;
  /* cuántas carpetas de copia hay ya y cuál tocaría */
  var copias = 0, itf = carpeta.getFolders();
  while (itf.hasNext()) {
    if (/^COPIA( [0-9]{1,3})?$/.test(itf.next().getName())) copias++;
  }
  /* cuántos archivos hay en la carpeta de la ficha (aunque el nombre no coincida por la extensión) */
  var total = 0, ita = carpeta.getFiles();
  while (ita.hasNext()) { ita.next(); total++; }
  return {
    ok: true,
    existe: encontrados.length > 0,
    archivosTotales: total,
    copias: copias,
    carpetaCopia: carpetaCopiaLibre(carpeta),
    nombre: nombre,
    archivos: encontrados.map(function (f) { return f.getName(); }),
    existente: primero ? {
      nombre: primero.getName(),
      tamano: primero.getSize(),
      actualizado: Utilities.formatDate(primero.getLastUpdated(), Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyy-MM-dd HH:mm')
    } : null,
    autor: autor,
    carpeta: carpeta.getName(),
    url: carpeta.getUrl()
  };
}

function cuenta() {
  try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || ''; }
  catch (err) { return ''; }
}

function hoy() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Guayaquil', 'yyyy-MM-dd');
}

function mensaje(err) { return String((err && err.message) || err || 'desconocido'); }

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
