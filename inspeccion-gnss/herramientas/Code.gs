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
 *  · Si un archivo se sube dos veces con el mismo nombre, el anterior se envía a la
 *    papelera y se crea el nuevo (no se duplica).
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
    if (j.op !== 'subir') return json({ ok: false, error: 'op' });
    if (!j.nombre || !j.datos) return json({ ok: false, error: 'datos' });

    // Dos niveles: <raíz>/<aaaa_mm_dd>/<TIPO[jornada]_dd_mm_aaaa_CÓDIGO>/
    // Antes de crear cada carpeta se busca por nombre; nunca se duplica.
    var dia = carpetaDe(String(j.dia || hoy().replace(/-/g, '_')), carpetaRaiz(j.raiz));
    var carpetaFicha = carpetaDeFicha(String(j.carpeta || 'sin-codigo'), dia);
    var bytes = Utilities.base64Decode(j.datos);
    var blob = Utilities.newBlob(bytes, j.mime || 'application/octet-stream', j.nombre);

    // Si ya existe un archivo con ese nombre, se manda a la papelera (no se duplica).
    var reemplazado = false;
    var it = carpetaFicha.getFilesByName(j.nombre);
    while (it.hasNext()) { it.next().setTrashed(true); reemplazado = true; }

    var f = carpetaFicha.createFile(blob);
    return json({
      ok: true, id: f.getId(), nombre: f.getName(), bytes: bytes.length,
      reemplazado: reemplazado, dia: dia.getName(), carpeta: carpetaFicha.getName(), url: f.getUrl()
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
