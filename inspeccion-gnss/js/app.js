/* Lógica de la app: navegación, selección de puntos, ficha de campo, croquis,
   generación del PDF, subida a Drive (Apps Script) y respaldo. */
const App = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const ahoraLocal = () => { const d = new Date(); return `${hoy()}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const safe = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_');

  /* método y parámetros fijos del TR */
  const METODO = 'Estático diferencial';
  const MASCARA = 10;
  const INTERVALO = 1;

  /* ---------------- estado ---------------- */
  const S = {
    fichas: new Map(),
    sel: null,
    editor: null,
    fotosEditor: [],
    mapaDetalle: null,
    miPunto: null,
    watchGps: null,
    urls: [],
    ajustes: { operadores: [], ultimoOperador: '', ultimoReceptor: '', autoSubir: true, borrarOrig: false, carpeta: '' }
  };

  const P = (codigo) => PUNTOS.find((p) => p.c === codigo) || null;
  const guardada = (codigo) => S.fichas.get(codigo) || null;

  /* ---------------- avisos ---------------- */
  let toastT = null;
  function toast(msg, tipo) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (tipo ? ' ' + tipo : '');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.add('hidden'), Math.max(2600, Math.min(7000, msg.length * 55)));
    el.classList.remove('hidden');
  }
  function busy(on, msg) {
    $('busy').classList.toggle('hidden', !on);
    if (msg) $('busyMsg').textContent = msg;
  }

  /* ---------------- descargas ---------------- */
  function bajarBlob(blob, nombre) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function compartirBlob(blob, nombre, mime) {
    if (navigator.canShare && navigator.share) {
      try {
        const f = new File([blob], nombre, { type: mime });
        if (navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nombre }); return true; }
      } catch (e) { if (e && e.name === 'AbortError') return true; }
    }
    bajarBlob(blob, nombre);
    return false;
  }

  /* ---------------- vistas ---------------- */
  function mostrar(v) {
    if (v !== 'detalle' && S.watchGps != null) {
      try { navigator.geolocation.clearWatch(S.watchGps); } catch (e) { /* nada */ }
      S.watchGps = null;
    }
    ['puntos', 'ficha', 'detalle', 'drive', 'respaldo'].forEach((k) => $('v-' + k).classList.toggle('hidden', k !== v));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on',
      b.dataset.tab === (v === 'detalle' || v === 'ficha' ? 'puntos' : v)));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- lista de puntos ---------------- */
  function puntosFiltrados(q) {
    const t = String(q || '').toLowerCase().trim();
    const base = PUNTOS.slice();
    if (!t) return base;
    return base.filter((p) => [p.c, p.nombre, p.parroquia, p.sector].join(' ').toLowerCase().includes(t));
  }

  const ORDEN_PARROQUIA = ['Tabacundo', 'La Esperanza', 'Malchingui', 'Tocachi', 'Tupigachi'];
  const ordenParr = (p) => { const i = ORDEN_PARROQUIA.indexOf(p.parroquia); return i < 0 ? 99 : i; };
  const puntosLista = (q) => puntosFiltrados(q).sort((a, b) => (ordenParr(a) - ordenParr(b)) || a.c.localeCompare(b.c));

  function renderCombo() {
    const lista = puntosFiltrados($('comboQ').value);
    $('comboList').innerHTML = lista.map((p) => {
      const ok = !!guardada(p.c);
      return `<button type="button" class="combo-item${ok ? ' saved' : ''}${S.sel === p.c ? ' sel' : ''}" data-cod="${esc(p.c)}" role="option">
        <span class="ck">✓</span>
        <span><b>${esc(p.c)}</b><span class="s">${esc(p.nombre)} · ${esc(p.parroquia)}</span></span>
        <span class="ord">${p.orden}°</span>
      </button>`;
    }).join('') || '<p class="hint" style="padding:14px">Sin resultados.</p>';
  }

  function renderLista() {
    const lista = puntosLista($('q').value);
    let html = '', parr = '';
    lista.forEach((p) => {
      if (p.parroquia !== parr) { parr = p.parroquia; html += `<div class="lp-grupo">${esc(parr)}</div>`; }
      const f = guardada(p.c);
      const pendCro = f && !f.croquis;
      html += `<button class="lp${f ? ' saved' : ''}" data-cod="${esc(p.c)}">
        <span class="ck">${f ? '✓' : '○'}</span>
        <span><b>${esc(p.c)}</b><small>${esc(p.nombre)} · ${esc(p.mat)}</small></span>
        <span class="tag">${f ? (pendCro ? 'Sin croquis' : 'Guardada') : 'Pendiente'}</span>
      </button>`;
    });
    $('listaPuntos').innerHTML = html || '<p class="hint">Sin puntos que coincidan.</p>';
  }

  function renderAvance() {
    const total = PUNTOS.length;
    const hechas = PUNTOS.filter((p) => guardada(p.c)).length;
    $('avancePill').textContent = `${hechas} / ${total}`;
    $('progressBar').style.width = (hechas / total * 100).toFixed(1) + '%';
  }

  function renderTodo() {
    renderCombo(); renderLista(); renderAvance();
    if (S.sel) { pintarComboVal(); pintarPanelPunto(S.sel); }
  }

  /* ---------------- selección de punto ---------------- */
  function seleccionar(codigo, abrirHoja) {
    S.sel = codigo;
    pintarComboVal();
    $('comboPanel').classList.add('hidden');
    $('comboBtn').setAttribute('aria-expanded', 'false');
    $('btnIr').disabled = false;
    $('btnLevantar').disabled = false;
    $('btnLevantar').querySelector('span:last-child').firstChild.textContent = guardada(codigo) ? 'EDITAR FICHA' : 'LEVANTAR FICHA';
    pintarPanelPunto(codigo);
    renderCombo(); renderLista();
    if (abrirHoja) abrirSheet(codigo);
  }

  function pintarComboVal() {
    if (!S.sel) { $('comboVal').textContent = 'Elegir un punto…'; return; }
    const p = P(S.sel);
    const ok = guardada(S.sel);
    $('comboVal').innerHTML = (ok ? '<span class="ok">✓</span> ' : '') + esc(S.sel) +
      ` <small>${esc(p ? p.nombre : '')}${ok ? ' · guardada' : ''}</small>`;
  }

  function pintarPanelPunto(codigo) {
    const p = P(codigo); if (!p) return;
    const f = guardada(codigo);
    const { lat, lon } = Geo.puntoLatLon(p);
    $('panelPunto').classList.remove('hidden');
    $('pp-nombre').textContent = `${p.c} — ${p.nombre}`;
    $('pp-sub').textContent = `${p.parroquia} · ${p.orden}° orden · ${p.mat}`;
    $('pp-datos').innerHTML = [
      ['ESTE (X)', p.e.toLocaleString('es-EC')],
      ['NORTE (Y)', p.n.toLocaleString('es-EC')],
      ['ZONA / DATUM', `UTM ${PROYECTO.zona}${PROYECTO.hemisferio} · WGS84`],
      ['MATERIALIZACIÓN', p.mat],
      ['DISTANCIA', f ? `Ficha del ${PDF.fmtFecha(f.fecha)}` : 'Ficha pendiente'],
      ['ESTADO', f ? (f.drive && f.drive.estado === 'subida' ? 'Guardada · en Drive' : 'Guardada en el teléfono') : 'Pendiente de levantar']
    ].map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('');
    $('btnVerFicha').classList.toggle('hidden', !f);
    $('puntoSelHint').textContent = f ? 'Ficha guardada: puedes verla, descargarla o subirla a Drive.' : '';
    void lat; void lon;
  }

  function abrirSheet(codigo) {
    const p = P(codigo), f = guardada(codigo);
    $('sheetTitle').textContent = `${p.c} — ${p.nombre}`;
    $('sheetSub').textContent = `${p.parroquia} · ${p.sector} · ${p.mat}`;
    $('shVer').classList.toggle('hidden', !f);
    $('shLevantar').querySelector('span:last-child').firstChild.textContent = f ? 'EDITAR FICHA' : 'LEVANTAR FICHA';
    $('sheet').classList.remove('hidden');
  }
  const cerrarSheet = () => $('sheet').classList.add('hidden');

  /* ---------------- IR AL PUNTO ---------------- */
  function irAlPunto(codigo) {
    const p = P(codigo); if (!p) return;
    const { lat, lon } = Geo.puntoLatLon(p);
    const q = `${lat.toFixed(7)},${lon.toFixed(7)}`;
    const esAndroid = /Android/i.test(navigator.userAgent);
    const url = esAndroid
      ? `geo:${q}?q=${q}(${encodeURIComponent(p.c)})`
      : isIOS ? `maps://?daddr=${q}&q=${encodeURIComponent(p.c)}` : '';
    if (url) { try { window.location.href = url; } catch (e) { /* sin app de mapas */ } }
    if (!esAndroid) {
      setTimeout(() => {
        if (document.visibilityState === 'visible') window.open(
          `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`, '_blank', 'noopener');
      }, 1200);
    }
  }

  /* ---------------- ficha: abrir / leer / guardar ---------------- */
  function nuevaFicha(p) {
    const { lat, lon } = Geo.puntoLatLon(p);
    return {
      id: p.c, codigo: p.c, nombre: p.nombre, parroquia: p.parroquia, sector: p.sector,
      este: p.e, norte: p.n, orden: p.orden, materializacion: p.mat,
      lat, lon,
      inicio: ahoraLocal(), fin: '', fecha: hoy(),
      operador: S.ajustes.ultimoOperador || '', receptor: S.ajustes.ultimoReceptor || '',
      alturaAntena: '',
      metodo: METODO, mascara: MASCARA, intervalo: INTERVALO,
      descripcion: '', accesibilidad: '', observaciones: '',
      croquis: null, croquisZ: null, croquisPendiente: false,
      creado: Date.now(), actualizado: Date.now()
    };
  }

  async function abrirFicha(codigo) {
    cerrarSheet();
    const p = P(codigo); if (!p) return;
    const f = guardada(codigo);
    S.editor = f ? clone(f) : nuevaFicha(p);
    migrarFicha(S.editor, p);
    S.fotosEditor = await Fotos.byFicha(codigo);
    pintarForm();
    pintarFotosEditor();
    mostrar('ficha');
    if (!S.editor.croquis) {
      const guardado = await croquisCache(codigo);
      if (guardado) {
        S.editor.croquis = guardado.dataUrl;
        S.editor.croquisZ = guardado.z;
        pintarCroquis();
        $('croquisMsg').textContent = 'Croquis preparado en oficina (' + new Date(guardado.fecha).toLocaleDateString('es-EC') + ').';
      } else if (navigator.onLine) generarCroquis(true);
    }
  }

  /* Compatibilidad con fichas guardadas por versiones anteriores (fecha + hora separadas). */
  function migrarFicha(f, p) {
    const { lat, lon } = Geo.puntoLatLon(p);
    if (f.lat == null || f.lon == null) { f.lat = lat; f.lon = lon; }
    if (!f.inicio) {
      if (f.fecha && f.horaInicio) f.inicio = `${f.fecha}T${f.horaInicio}`;
      else if (f.fecha) f.inicio = `${f.fecha}T00:00`;
    }
    if (!f.fin && f.horaFin) f.fin = `${(f.fecha || hoy()).slice(0, 10)}T${f.horaFin}`;
    if (!f.fecha) f.fecha = (f.inicio || '').slice(0, 10) || hoy();
    f.metodo = METODO; f.mascara = MASCARA; f.intervalo = INTERVALO;
    delete f.horaInicio; delete f.horaFin; delete f.alturaElipsoidal;
    delete f.sats; delete f.gdop; delete f.datum; delete f.epoca;
    return f;
  }

  function pintarForm() {
    const f = S.editor;
    $('f-titulo').textContent = `Ficha ${f.codigo}`;
    $('f-nombre').value = f.nombre || '';
    $('f-codigo').value = f.codigo || '';
    $('f-parroquia').value = f.parroquia || '';
    $('f-sector').value = f.sector || '';
    $('f-este').value = Number(f.este).toLocaleString('es-EC');
    $('f-norte').value = Number(f.norte).toLocaleString('es-EC');
    $('f-orden').value = `${f.orden}° orden`;
    $('f-zona').value = `UTM ${PROYECTO.zona}${PROYECTO.hemisferio} · WGS84`;
    $('f-mat').innerHTML = MATERIALIZACIONES.map((m) => `<option${m === f.materializacion ? ' selected' : ''}>${esc(m)}</option>`).join('');
    const p = P(f.codigo);
    $('f-trabajos').textContent = p ? p.trabajos : '';
    $('f-receptor').innerHTML = '<option value="">—</option>' + RECEPTORES.map((r) => `<option${r === f.receptor ? ' selected' : ''}>${esc(r)}</option>`).join('');
    $('f-altura').value = f.alturaAntena || '';
    $('f-inicio').value = f.inicio || '';
    $('f-fin').value = f.fin || '';
    $('f-operador').value = f.operador || '';
    $('f-desc').value = f.descripcion || '';
    $('f-acceso').value = f.accesibilidad || '';
    $('f-obs').value = f.observaciones || '';
    pintarCroquis();
    pintarDuracion();
    pintarNotasDiseno();
    pintarOperadores();
    $('btnGuardar').textContent = guardada(f.codigo) ? 'Guardar cambios' : 'Guardar ficha';
  }

  function pintarNotasDiseno() {
    const p = P(S.editor.codigo);
    $('f-notas').innerHTML = (p && p.notas && p.notas.length ? p.notas : ['Sin notas de diseño para este sitio.'])
      .map((n) => `<p>${esc(n)}</p>`).join('');
  }

  function pintarOperadores() {
    $('lstOperadores').innerHTML = (S.ajustes.operadores || []).map((o) => `<option value="${esc(o)}">`).join('');
  }

  function leerForm() {
    const f = S.editor;
    f.nombre = $('f-nombre').value.trim();
    f.sector = $('f-sector').value.trim();
    f.materializacion = $('f-mat').value;
    f.receptor = $('f-receptor').value;
    f.alturaAntena = numero($('f-altura').value);
    f.inicio = $('f-inicio').value;
    f.fin = $('f-fin').value;
    f.fecha = (f.inicio || hoy()).slice(0, 10);
    f.operador = $('f-operador').value.trim();
    f.metodo = METODO; f.mascara = MASCARA; f.intervalo = INTERVALO;
    f.descripcion = $('f-desc').value.trim();
    f.accesibilidad = $('f-acceso').value.trim();
    f.observaciones = $('f-obs').value.trim();
    f.actualizado = Date.now();
    pintarDuracion();
  }

  const numero = (v) => {
    const s = String(v == null ? '' : v).replace(',', '.').trim();
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  };

  /* "2026-10-31T09:15" -> minutos desde el día, para la duración */
  function duracionMin(f) {
    if (!f.inicio || !f.fin) return null;
    const a = new Date(f.inicio), b = new Date(f.fin);
    if (isNaN(a) || isNaN(b)) return null;
    let d = Math.round((b - a) / 60000);
    if (d < 0) d += 24 * 60;
    return d;
  }
  function fmtDur(d) {
    if (d == null) return '';
    return d >= 60 ? `${Math.floor(d / 60)} h ${pad(d % 60)} min` : `${d} min`;
  }
  function pintarDuracion() {
    $('f-dur').value = fmtDur(duracionMin(S.editor));
  }

  function pintarCroquis() {
    const f = S.editor;
    const img = $('croquisImg'), vacio = $('croquisEmpty');
    if (f.croquis) {
      img.src = f.croquis; img.classList.remove('hidden'); vacio.classList.add('hidden');
    } else {
      img.classList.add('hidden'); img.removeAttribute('src'); vacio.classList.remove('hidden');
    }
  }

  async function generarCroquis(silencioso) {
    const f = S.editor; if (!f) return;
    if (!navigator.onLine) { if (!silencioso) toast('Sin conexión: el croquis necesita internet.', 'err'); return; }
    if (!silencioso) busy(true, 'Generando croquis…');
    else $('croquisMsg').textContent = 'Generando croquis…';
    try {
      const r = await Croquis.render({ lat: f.lat, lon: f.lon, codigo: f.codigo, e: f.este, n: f.norte });
      f.croquis = r.dataUrl; f.croquisZ = r.z; f.croquisPendiente = false;
      pintarCroquis();
      if (r.conTeselas) await guardarCroquisCache(f.codigo, r.dataUrl, r.z);
      $('croquisMsg').textContent = r.conTeselas
        ? `Croquis listo (zoom ${r.z}).`
        : 'Croquis generado sin imagen satelital: se completará cuando haya internet.';
      if (silencioso && r.conTeselas) toast('Croquis generado.', 'ok');
    } catch (e) {
      $('croquisMsg').textContent = 'No se pudo generar el croquis: ' + e.message;
      if (!silencioso) toast('No se pudo generar el croquis.', 'err');
    } finally { if (!silencioso) busy(false); }
  }

  /* ---- croquis preparados en oficina ---- */
  async function croquisCache(codigo) {
    try { return await DB.get('croquis', codigo); } catch (e) { return null; }
  }
  async function guardarCroquisCache(codigo, dataUrl, z) {
    try { await DB.put('croquis', { codigo, dataUrl, z: z || null, fecha: Date.now() }); } catch (e) { /* sin espacio */ }
  }

  async function prepararCroquis() {
    if (!navigator.onLine) { toast('Hace falta internet para preparar los croquis.', 'err'); return; }
    let ok = 0, sin = 0, err = 0;
    for (let i = 0; i < PUNTOS.length; i++) {
      const p = PUNTOS[i];
      busy(true, `Croquis ${i + 1} de ${PUNTOS.length} · ${p.c}`);
      try {
        const { lat, lon } = Geo.puntoLatLon(p);
        const r = await Croquis.render({ lat, lon, codigo: p.c, e: p.e, n: p.n });
        if (r.conTeselas) { await guardarCroquisCache(p.c, r.dataUrl, r.z); ok++; }
        else sin++;
      } catch (e) { err++; }
    }
    busy(false);
    const msg = `Croquis listos: ${ok} de ${PUNTOS.length}` +
      (sin ? ` · ${sin} sin imagen satelital` : '') + (err ? ` · ${err} con error` : '') + '.';
    $('croquisPrepMsg').textContent = msg + ' Ya se pueden usar sin internet.';
    toast(msg, err || sin ? 'err' : 'ok');
    renderLista();
  }

  /* Completa los croquis que quedaron pendientes en fichas guardadas (al volver internet). */
  async function completarCroquisPendientes() {
    if (!navigator.onLine) return 0;
    const pend = Array.from(S.fichas.values()).filter((f) => !f.croquis);
    let n = 0;
    for (const f of pend) {
      try {
        const cache = await croquisCache(f.codigo);
        let dataUrl = cache && cache.dataUrl, z = cache && cache.z;
        if (!dataUrl) {
          const p = P(f.codigo);
          const ll = p ? Geo.puntoLatLon(p) : { lat: f.lat, lon: f.lon };
          const r = await Croquis.render({ lat: ll.lat, lon: ll.lon, codigo: f.codigo, e: f.este, n: f.norte });
          dataUrl = r.dataUrl; z = r.z;
        }
        f.croquis = dataUrl; f.croquisZ = z; f.croquisPendiente = false;
        f.drive = Object.assign({}, f.drive || {}, { estado: 'pend' });
        await DB.put('fichas', f);
        S.fichas.set(f.codigo, f);
        n++;
      } catch (e) { /* se reintenta la próxima vez */ }
    }
    if (n) {
      renderTodo(); renderDrive();
      if (!$('v-ficha').classList.contains('hidden') && S.editor && !S.editor.croquis) {
        const c = await croquisCache(S.editor.codigo);
        if (c) { S.editor.croquis = c.dataUrl; S.editor.croquisZ = c.z; pintarCroquis(); }
      }
      toast(`Se completaron ${n} croquis pendientes.`, 'ok');
    }
    return n;
  }

  async function guardarFicha() {
    leerForm();
    const f = S.editor;
    const faltan = [];
    if (!f.receptor) faltan.push('receptor GNSS');
    if (!f.alturaAntena) faltan.push('altura de la antena');
    if (!f.inicio) faltan.push('inicio (fecha y hora)');
    if (!f.fin) faltan.push('fin (fecha y hora)');
    if (f.inicio && f.fin && duracionMin(f) != null && duracionMin(f) <= 0) faltan.push('fin posterior al inicio');
    if (!f.operador) faltan.push('operador');
    if (!f.croquis) faltan.push('croquis (se puede completar después)');
    if (!S.fotosEditor.some((m) => m.tipo === 'punto')) faltan.push('fotografía del punto');
    if (!S.fotosEditor.some((m) => m.tipo === 'placa')) faltan.push('fotografía de la placa');
    if (faltan.length && !confirm('Falta completar:\n· ' + faltan.join('\n· ') + '\n\n¿Guardar la ficha igual?')) return;

    f.duracionMin = duracionMin(f);
    f.croquisPendiente = !f.croquis;
    const prev = guardada(f.codigo);
    f.drive = prev && prev.drive ? prev.drive : { estado: 'pend' };
    if (prev) {
      const campos = ['receptor', 'alturaAntena', 'inicio', 'fin', 'materializacion', 'descripcion', 'accesibilidad', 'observaciones'];
      if (campos.some((k) => String(prev[k] || '') !== String(f[k] || ''))) f.drive.estado = 'pend';
      if (!prev.croquis && f.croquis) f.drive.estado = 'pend';
    }

    await DB.put('fichas', f);
    S.fichas.set(f.codigo, f);
    if (f.operador) {
      S.ajustes.ultimoOperador = f.operador;
      S.ajustes.operadores = S.ajustes.operadores || [];
      if (!S.ajustes.operadores.includes(f.operador)) S.ajustes.operadores.push(f.operador);
    }
    S.ajustes.ultimoReceptor = f.receptor || S.ajustes.ultimoReceptor;
    await guardarAjustes();

    renderTodo();
    toast('Ficha guardada. ✓', 'ok');
    mostrar('puntos');
    if (S.ajustes.autoSubir && Drive.configurado() && !f.croquisPendiente) subirUna(f.codigo, true);
  }

  /* ---------------- fotografías ---------------- */
  async function agregarFotos(tipo, files) {
    if (!files || !files.length) return;
    busy(true, 'Procesando fotografías…');
    try {
      let orden = S.fotosEditor.filter((m) => m.tipo === tipo).length;
      for (const file of files) {
        const pr = await Fotos.procesar(file);
        orden += 1;
        await Fotos.add({
          id: uid(), fichaId: S.editor.codigo, tipo, blob: pr.blob, orig: pr.orig,
          thumb: pr.thumb, w: pr.w, h: pr.h, orden, nombre: file.name || `${tipo}.jpg`
        });
      }
      S.fotosEditor = await Fotos.byFicha(S.editor.codigo);
      pintarFotosEditor();
      toast(files.length === 1 ? 'Fotografía agregada.' : `${files.length} fotografías agregadas.`, 'ok');
    } catch (e) {
      toast('No se pudo procesar la foto: ' + e.message, 'err');
    } finally { busy(false); }
  }

  function pintarFotosEditor() {
    ['punto', 'placa'].forEach((tipo) => {
      const lista = S.fotosEditor.filter((m) => m.tipo === tipo);
      $('fotos-' + tipo).innerHTML = lista.map((m, i) => `<figure class="phcard">
        <button class="phfoto" data-ver="${m.id}" title="Ver"><img src="${m.thumb}" alt=""></button>
        <button class="del" data-borrar="${m.id}" title="Borrar">×</button>
        <span class="tag">${i === 0 ? 'En la ficha' : 'Solo Drive'} · ${m.w}×${m.h}</span>
      </figure>`).join('');
    });
  }

  async function borrarFoto(id) {
    if (!confirm('¿Borrar esta fotografía?')) return;
    await Fotos.remove(id);
    S.fotosEditor = await Fotos.byFicha(S.editor.codigo);
    pintarFotosEditor();
  }

  function verImagen(src) {
    $('visorImg').src = src;
    $('visor').classList.remove('hidden');
  }

  /* ---------------- PDF ---------------- */
  async function fotosParaPDF(codigo) {
    const metas = await Fotos.byFicha(codigo);
    const out = [];
    for (const m of metas) {
      const blob = await Fotos.getBlob(m.id);
      if (!blob) continue;
      const v = await Fotos.paraPDF(blob, 1200);
      out.push({ tipo: m.tipo, orden: m.orden, dataUrl: v.dataUrl, w: v.w, h: v.h });
    }
    return out;
  }

  async function pdfDe(codigo) {
    const f = guardada(codigo);
    if (!f) throw new Error('La ficha todavía no está guardada.');
    const fotos = await fotosParaPDF(codigo);
    const doc = PDF.fichaDoc(f, fotos);
    return { blob: doc.output('blob'), nombre: `${safe(f.codigo)}_${(f.fecha || hoy()).slice(0, 10)}.pdf` };
  }

  async function descargarPDF(codigo, compartir) {
    busy(true, 'Generando el PDF…');
    try {
      const { blob, nombre } = await pdfDe(codigo);
      if (compartir) await compartirBlob(blob, nombre, 'application/pdf');
      else bajarBlob(blob, nombre);
      toast(compartir ? 'PDF listo para compartir.' : 'PDF descargado.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally { busy(false); }
  }

  /* ---------------- detalle ---------------- */
  async function verDetalle(codigo) {
    cerrarSheet();
    const f = guardada(codigo);
    if (!f) { abrirFicha(codigo); return; }
    S.sel = codigo;
    mostrar('detalle');
    $('d-titulo').textContent = `${f.codigo} — ${f.nombre}`;
    $('d-sub').textContent = `${f.parroquia} · ${f.orden}° orden · ${f.materializacion || ''}`;
    const d = duracionMin(f);
    $('d-datos').innerHTML = [
      ['ESTE (X)', Number(f.este).toLocaleString('es-EC')],
      ['NORTE (Y)', Number(f.norte).toLocaleString('es-EC')],
      ['ZONA / DATUM', `UTM ${PROYECTO.zona}${PROYECTO.hemisferio} · WGS84`],
      ['FECHA', PDF.fmtFecha(f.fecha)],
      ['INICIO', PDF.fmtFechaHora(f.inicio)],
      ['FIN', PDF.fmtFechaHora(f.fin)],
      ['DURACIÓN', fmtDur(d) || '—'],
      ['RECEPTOR', f.receptor || '—'],
      ['ALTURA ANTENA', f.alturaAntena ? f.alturaAntena + ' m' : '—'],
      ['OPERADOR', f.operador || '—'],
      ['MATERIALIZACIÓN', f.materializacion || '—'],
      ['ACTUALIZADA', new Date(f.actualizado || f.creado || Date.now()).toLocaleString('es-EC')]
    ].map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('');

    $('d-croquisPanel').classList.toggle('hidden', !f.croquis);
    if (f.croquis) $('d-croquis').src = f.croquis;

    S.urls.forEach((u) => URL.revokeObjectURL(u));
    S.urls = [];
    const metas = await Fotos.byFicha(codigo);
    const fotosHtml = [];
    for (const m of metas) {
      const blob = await Fotos.getBlob(m.id);
      const url = blob ? URL.createObjectURL(blob) : m.thumb;
      if (blob) S.urls.push(url);
      fotosHtml.push(`<figure><img src="${url}" alt=""><figcaption>${m.tipo === 'placa' ? 'Placa' : 'Punto'} ${m.orden || ''}</figcaption></figure>`);
    }
    $('d-fotos').innerHTML = fotosHtml.join('') || '<p class="hint">Sin fotografías.</p>';
    $('d-fotosPanel').classList.toggle('hidden', !metas.length);

    const dr = f.drive || { estado: 'pend' };
    $('d-drive').innerHTML = dr.estado === 'subida'
      ? `Subida el ${new Date(dr.fecha).toLocaleString('es-EC')}.<br>Carpeta: <code>${esc(dr.ruta || '')}</code>`
      : dr.estado === 'error'
        ? `La última subida falló: ${esc(dr.error || '')}`
        : f.croquisPendiente
          ? 'Todavía no se ha subido. El croquis está pendiente: se completará cuando haya internet.'
          : 'Todavía no se ha subido a Drive.';

    S.miPunto = null;
    setTimeout(() => montarMapaDetalle(f), 60);
  }

  function montarMapaDetalle(f) {
    const el = $('d-map');
    if (S.mapaDetalle) { try { S.mapaDetalle.remove(); } catch (e) { /* nada */ } S.mapaDetalle = null; }
    if (!el || el.offsetParent === null) return;
    S.mapaDetalle = Croquis.mapa(el, f.lat, f.lon, f.codigo);
    $('d-gps').textContent = 'Activa "Mi ubicación" para ver la distancia al punto.';
  }

  function miUbicacion() {
    const f = guardada(S.sel);
    if (!f) return;
    if (!navigator.geolocation) { toast('Este navegador no da la ubicación.', 'err'); return; }
    if (S.watchGps != null) { navigator.geolocation.clearWatch(S.watchGps); S.watchGps = null; }
    $('d-gps').textContent = 'Buscando señal GPS…';
    S.watchGps = navigator.geolocation.watchPosition((pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const d = Geo.dist([lat, lon], [f.lat, f.lon]);
      const rumbo = Geo.bearing([lat, lon], [f.lat, f.lon]);
      $('d-gps').innerHTML = `Estás a <b>${d.toFixed(1)} m</b> del punto (rumbo ${rumbo.toFixed(0)}°, precisión ±${Math.round(pos.coords.accuracy)} m).`;
      if (S.mapaDetalle) {
        if (!S.miPunto) {
          S.miPunto = L.circleMarker([lat, lon], { radius: 6, color: '#1f4e9c', fillColor: '#4a90e2', fillOpacity: 1, weight: 2 }).addTo(S.mapaDetalle);
        } else S.miPunto.setLatLng([lat, lon]);
      }
    }, (err) => {
      $('d-gps').textContent = 'No se pudo obtener la ubicación: ' + err.message;
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }

  /* ---------------- Drive ---------------- */
  async function fotosParaDrive(codigo) {
    const metas = await Fotos.byFicha(codigo);
    const out = [];
    for (const m of metas) {
      const rec = await Fotos.getRec(m.id);
      if (!rec) continue;
      out.push({
        tipo: m.tipo, orden: m.orden, nombre: m.nombre,
        orig: rec.orig, blob: rec.blob, origTipo: m.origTipo, tipoArchivo: rec.blob ? rec.blob.type : ''
      });
    }
    return out;
  }

  async function subirUna(codigo, automatico) {
    const f = guardada(codigo);
    if (!f) { toast('Guarda la ficha antes de subirla.', 'err'); return; }
    if (!Drive.configurado()) { toast('Configura la URL y la clave del script en la pestaña Drive.', 'err'); return; }
    if (!f.croquis) { toast('La ficha está sin croquis: se subirá cuando se complete.', 'err'); return; }
    try {
      busy(true, 'Preparando la subida…');
      const { blob } = await pdfDe(codigo);
      const fotos = await fotosParaDrive(codigo);
      const r = await Drive.subirFicha(f, blob, fotos, (t) => busy(true, t));
      f.drive = { estado: 'subida', fecha: Date.now(), ruta: r.ruta, archivos: r.archivos, sinConfirmar: !!r.sinConfirmar };
      await DB.put('fichas', f);
      S.fichas.set(codigo, f);
      if (S.ajustes.borrarOrig) {
        for (const m of await Fotos.byFicha(codigo)) if (m.tieneOrig) await Fotos.soloOriginal(m.id);
        S.fotosEditor = await Fotos.byFicha(codigo);
      }
      renderTodo(); renderDrive();
      if (S.sel === codigo && !$('v-detalle').classList.contains('hidden')) verDetalle(codigo);
      toast(r.sinConfirmar ? 'Enviado a Drive (no se pudo confirmar la respuesta).' : 'Ficha subida a Drive.', 'ok');
    } catch (e) {
      f.drive = { estado: 'error', fecha: Date.now(), error: e.message };
      await DB.put('fichas', f);
      S.fichas.set(codigo, f);
      renderDrive();
      toast('No se pudo subir: ' + e.message, 'err');
      void automatico;
    } finally { busy(false); }
  }

  async function subirPendientes(soloErrores) {
    const lista = PUNTOS.map((p) => guardada(p.c)).filter(Boolean)
      .filter((f) => (soloErrores ? f.drive && f.drive.estado === 'error' : !f.drive || f.drive.estado !== 'subida'));
    if (!lista.length) { toast('No hay fichas pendientes de subir.', 'ok'); return; }
    if (!Drive.configurado()) { toast('Configura la URL y la clave del script primero.', 'err'); return; }
    const sinCroquis = lista.filter((f) => !f.croquis).length;
    let ok = 0, err = 0, saltadas = 0;
    for (const f of lista) {
      if (!f.croquis) { saltadas++; continue; }
      busy(true, `Subiendo ${f.codigo} (${ok + err + 1} de ${lista.length})…`);
      try {
        const { blob } = await pdfDe(f.codigo);
        const fotos = await fotosParaDrive(f.codigo);
        const r = await Drive.subirFicha(f, blob, fotos);
        f.drive = { estado: 'subida', fecha: Date.now(), ruta: r.ruta, archivos: r.archivos, sinConfirmar: !!r.sinConfirmar };
        ok++;
      } catch (e) {
        f.drive = { estado: 'error', fecha: Date.now(), error: e.message };
        err++;
      }
      await DB.put('fichas', f);
      S.fichas.set(f.codigo, f);
      renderDrive(); renderTodo();
    }
    busy(false);
    let msg = `Subida terminada: ${ok} correcta(s)`;
    if (err) msg += `, ${err} con error`;
    if (saltadas || sinCroquis) msg += `, ${saltadas} sin croquis (se subirán después)`;
    toast(msg + '.', err ? 'err' : 'ok');
  }

  function renderDrive() {
    const hayUrl = !!Drive.urlActual();
    const cfg = Drive.configurado();
    $('driveDot').classList.toggle('on', cfg);
    $('driveCuenta').textContent = cfg ? 'Script de Drive configurado'
      : hayUrl ? 'Falta la clave del script' : 'Sin configurar';
    $('driveDetalle').textContent = cfg
      ? 'Las fichas se guardan en el Drive del dueño del script.'
      : hayUrl
        ? 'La dirección del script ya está puesta. Escribe la CLAVE que pusiste en Code.gs y pulsa "Guardar y probar".'
        : 'Falta la URL y la clave del script de Drive.';
    $('driveUrl').value = Drive.urlActual() || '';
    $('driveClave').value = Drive.claveActual() || '';
    $('carpetaNombre').textContent = S.ajustes.carpeta || CONFIG.carpetaProyecto;

    const total = PUNTOS.filter((p) => guardada(p.c)).length;
    const subidas = PUNTOS.filter((p) => { const f = guardada(p.c); return f && f.drive && f.drive.estado === 'subida'; }).length;
    const errores = PUNTOS.filter((p) => { const f = guardada(p.c); return f && f.drive && f.drive.estado === 'error'; }).length;
    $('driveResumen').innerHTML = `Fichas guardadas: <b>${total}</b> · en Drive: <b>${subidas}</b> · pendientes: <b>${total - subidas - errores}</b>` +
      (errores ? ` · con error: <b class="err">${errores}</b>` : '');
    $('autoSubir').checked = !!S.ajustes.autoSubir;
    $('borrarOrig').checked = !!S.ajustes.borrarOrig;

    $('driveCola').innerHTML = PUNTOS.map((p) => {
      const f = guardada(p.c);
      if (!f) return '';
      const e = (f.drive && f.drive.estado) || 'pend';
      const cls = e === 'subida' ? 'sub' : e === 'error' ? 'err' : 'pend';
      const txt = e === 'subida' ? 'En Drive' : e === 'error' ? 'Error' : (!f.croquis ? 'Sin croquis' : 'Pendiente');
      const det = e === 'error' ? esc((f.drive || {}).error || '') : PDF.fmtFecha(f.fecha);
      return `<div class="fila"><div><b>${esc(p.c)}</b><small>${det}</small></div><span class="est ${cls}">${txt}</span></div>`;
    }).join('') || '<p class="hint">Todavía no hay fichas guardadas.</p>';
  }

  /* ---------------- exportaciones ---------------- */
  const csvQ = (v) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  function exportarCsv() {
    const cols = ['codigo', 'nombre', 'parroquia', 'sector', 'orden', 'este', 'norte', 'materializacion',
      'receptor', 'altura_antena', 'inicio', 'fin', 'duracion_min', 'metodo', 'mascara', 'intervalo',
      'operador', 'fotos_punto', 'fotos_placa', 'croquis', 'drive'];
    const filas = PUNTOS.map((p) => {
      const f = guardada(p.c) || {};
      return [p.c, f.nombre || p.nombre, p.parroquia, f.sector || p.sector, p.orden, p.e, p.n,
        f.materializacion || p.mat, f.receptor || '', f.alturaAntena || '', f.inicio || '', f.fin || '',
        f.duracionMin || '', f.metodo || METODO, f.mascara || MASCARA, f.intervalo || INTERVALO,
        f.operador || '', '', '', f.este ? (f.croquis ? 'sí' : 'pendiente') : 'no',
        (f.drive && f.drive.estado) || 'pendiente'];
    });
    // cuenta de fotos por ficha
    DB.all('pmeta').then((metas) => {
      const por = {};
      metas.forEach((m) => {
        por[m.fichaId] = por[m.fichaId] || { punto: 0, placa: 0 };
        por[m.fichaId][m.tipo] = (por[m.fichaId][m.tipo] || 0) + 1;
      });
      filas.forEach((r) => {
        const c = por[r[0]] || { punto: 0, placa: 0 };
        r[17] = c.punto; r[18] = c.placa;
      });
      const csv = '\ufeff' + [cols.join(';')].concat(filas.map((r) => r.map(csvQ).join(';'))).join('\r\n');
      bajarBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `avance_red_geodesica_${hoy()}.csv`);
    });
  }

  function geojsonPuntos() {
    const feats = PUNTOS.map((p) => {
      const f = guardada(p.c) || {};
      const { lat, lon } = Geo.puntoLatLon(p);
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          codigo: p.c, nombre: f.nombre || p.nombre, parroquia: p.parroquia, sector: f.sector || p.sector,
          orden: p.orden, este: p.e, norte: p.n, mat: f.materializacion || p.mat,
          receptor: f.receptor || '', altura: f.alturaAntena || '', inicio: f.inicio || '',
          fin: f.fin || '', dur: f.duracionMin || '', operador: f.operador || '',
          ficha: f.este ? 'si' : 'no', croquis: f.croquis ? 'si' : 'pendiente',
          drive: (f.drive && f.drive.estado) || ''
        }
      };
    });
    return JSON.stringify({ type: 'FeatureCollection', name: 'red_geodesica_pedro_moncayo', features: feats }, null, 2);
  }

  function exportarGeo(codigo) {
    const txt = geojsonPuntos();
    const nombre = codigo ? `punto_${safe(codigo)}.geojson` : `red_geodesica_${hoy()}.geojson`;
    if (codigo) {
      const j = JSON.parse(txt);
      j.features = j.features.filter((f) => f.properties.codigo === codigo);
      bajarBlob(new Blob([JSON.stringify(j, null, 2)], { type: 'application/geo+json' }), nombre);
    } else bajarBlob(new Blob([txt], { type: 'application/geo+json' }), nombre);
  }

  async function exportarZip(codigo) {
    busy(true, 'Empaquetando fotografías…');
    try {
      const fichas = codigo ? [guardada(codigo)] : Array.from(S.fichas.values());
      const entradas = [];
      const indice = [['codigo', 'tipo', 'orden', 'archivo', 'ancho', 'alto', 'fecha']];
      for (const f of fichas) {
        if (!f) continue;
        for (const m of await Fotos.byFicha(f.codigo)) {
          const blob = await Fotos.getBlob(m.id);
          if (!blob) continue;
          const nombre = `${f.codigo}/${f.codigo}_${m.tipo}_${m.orden}.jpg`;
          entradas.push({ name: nombre, blob });
          indice.push([f.codigo, m.tipo, m.orden, nombre, m.w, m.h, new Date(m.tomada || Date.now()).toISOString()]);
        }
      }
      if (!entradas.length) { toast('No hay fotografías para exportar.', 'err'); return; }
      const csv = '\ufeff' + indice.map((r) => r.map(csvQ).join(';')).join('\r\n');
      entradas.push({ name: 'indice_fotos.csv', blob: new Blob([csv], { type: 'text/csv' }) });
      const zip = await Zip.build(entradas);
      bajarBlob(zip, codigo ? `fotos_${safe(codigo)}.zip` : `fotos_red_geodesica_${hoy()}.zip`);
      toast('ZIP generado.', 'ok');
    } catch (e) {
      toast('No se pudo generar el ZIP: ' + e.message, 'err');
    } finally { busy(false); }
  }

  async function exportarRespaldo() {
    const lista = Array.from(S.fichas.values()).map((f) => {
      const c = Object.assign({}, f);
      delete c.croquis;               // el croquis se puede regenerar y pesa mucho
      return c;
    });
    const datos = {
      app: 'inspeccion-gnss', version: CONFIG.version, fecha: new Date().toISOString(),
      proyecto: PROYECTO, ajustes: S.ajustes, fichas: lista
    };
    bajarBlob(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }), `respaldo_red_geodesica_${hoy()}.json`);
    $('backupInfo').textContent = `Respaldo generado con ${lista.length} ficha(s). Incluye los datos; no incluye fotografías ni croquis (usa el ZIP o Drive).`;
  }

  async function importarRespaldo(file) {
    try {
      const j = JSON.parse(await file.text());
      const lista = Array.isArray(j.fichas) ? j.fichas : (Array.isArray(j) ? j : []);
      if (!lista.length) throw new Error('El archivo no contiene fichas.');
      let n = 0;
      for (const f of lista) {
        if (!f || !f.codigo) continue;
        const p = P(f.codigo);
        if (p) migrarFicha(f, p);
        const actual = guardada(f.codigo);
        if (actual && (actual.actualizado || 0) > (f.actualizado || 0)) continue;
        await DB.put('fichas', f);
        S.fichas.set(f.codigo, f);
        n++;
      }
      if (j.ajustes) { S.ajustes = Object.assign(S.ajustes, j.ajustes); await guardarAjustes(); }
      renderTodo(); renderDrive(); pintarAjustes();
      toast(`Respaldo importado: ${n} ficha(s).`, 'ok');
      $('backupInfo').textContent = `Se importaron ${n} ficha(s).`;
    } catch (e) {
      toast('No se pudo importar: ' + e.message, 'err');
    }
  }

  /* ---------------- ajustes ---------------- */
  async function cargarAjustes() {
    const a = await DB.kvGet('ajustes', null);
    if (a) S.ajustes = Object.assign(S.ajustes, a);
    if (!Array.isArray(S.ajustes.operadores)) S.ajustes.operadores = [];
    if (!S.ajustes.carpeta) S.ajustes.carpeta = CONFIG.carpetaProyecto;
    delete S.ajustes.datum; delete S.ajustes.epoca;
  }
  async function guardarAjustes() { await DB.kvSet('ajustes', S.ajustes); }

  function pintarAjustes() {
    $('a-carpeta').value = S.ajustes.carpeta || CONFIG.carpetaProyecto;
    $('a-operadores').value = (S.ajustes.operadores || []).join('\n');
  }

  async function guardarAjustesForm() {
    S.ajustes.carpeta = $('a-carpeta').value.trim() || CONFIG.carpetaProyecto;
    S.ajustes.operadores = $('a-operadores').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    await guardarAjustes();
    renderDrive();
    toast('Datos del proyecto guardados.', 'ok');
  }

  /* ---------------- arranque ---------------- */
  async function init() {
    await cargarAjustes();
    if ('serviceWorker' in navigator) {
      try {
        const tenia = !!navigator.serviceWorker.controller;
        const reg = await navigator.serviceWorker.register('sw.js');
        navigator.serviceWorker.addEventListener('message', (e) => {
          if (tenia && e.data && e.data.tipo === 'nueva-version') $('updateBar').classList.remove('hidden');
        });
        reg.addEventListener('updatefound', () => {
          const nuevo = reg.installing;
          if (!nuevo) return;
          nuevo.addEventListener('statechange', () => {
            if (nuevo.state === 'installed' && navigator.serviceWorker.controller) $('updateBar').classList.remove('hidden');
          });
        });
      } catch (e) { /* sin service worker */ }
    }
    $('btnReload').addEventListener('click', () => location.reload());

    const fichas = await DB.all('fichas');
    for (const f of fichas) {
      const p = P(f.id);
      if (p) {
        const antes = JSON.stringify(f);
        migrarFicha(f, p);
        if (JSON.stringify(f) !== antes) await DB.put('fichas', f);   // deja migrada la ficha vieja
      }
      S.fichas.set(f.id, f);
    }

    const validos = new Set(fichas.map((f) => f.id));
    for (const m of await DB.all('pmeta')) if (!validos.has(m.fichaId)) await Fotos.remove(m.id);

    await Drive.init().catch(() => {});
    renderTodo(); renderDrive(); pintarAjustes();
    netState();
    estadoApp();
    cablear();
    document.body.dataset.listo = '1';
    console.log('Inspección GNSS lista · ' + PUNTOS.length + ' puntos · ' + fichas.length + ' fichas guardadas');
    // croquis que quedaron pendientes por falta de internet
    setTimeout(() => { completarCroquisPendientes(); }, 2000);
  }

  function netState() {
    const n = $('net');
    n.textContent = navigator.onLine ? 'en línea' : 'sin conexión';
    n.classList.toggle('off', !navigator.onLine);
  }

  async function estadoApp() {
    $('versionInfo').textContent = `Versión ${CONFIG.version} · ${PROYECTO.nombre}`;
    let txt = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        txt = `Datos de la app en este teléfono: ${(e.usage / 1048576).toFixed(1)} MB.`;
      }
    } catch (e) { /* sin datos */ }
    const p = await Fotos.peso();
    $('storageInfo').textContent = (txt ? txt + ' ' : '') + `Fotografías: ${p.n} (${(p.bytes / 1048576).toFixed(1)} MB).`;
    let nCro = 0;
    try { nCro = (await DB.all('croquis')).length; } catch (e) { /* store nuevo */ }
    $('croquisPrepMsg').textContent = nCro
      ? `Croquis preparados: ${nCro} de ${PUNTOS.length}. Los que faltan se generan al abrir la ficha (con internet).`
      : 'Genera de una vez los croquis de todos los puntos: hazlo en oficina, con wifi, y en campo no hará falta internet para la ficha.';
    $('offlineState').textContent = navigator.onLine
      ? 'La app está guardada en este teléfono: abre y funciona sin conexión.'
      : 'Sin conexión: puedes seguir levantando fichas; el croquis y Drive se completan cuando vuelva el internet.';
  }

  /* ---------------- eventos ---------------- */
  function cablear() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.tab;
      if (t === 'drive') renderDrive();
      if (t === 'respaldo') { estadoApp(); pintarAjustes(); }
      mostrar(t);
    }));

    $('comboBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const p = $('comboPanel');
      const abrir = p.classList.contains('hidden');
      p.classList.toggle('hidden', !abrir);
      $('comboBtn').setAttribute('aria-expanded', String(abrir));
      if (abrir) { $('comboQ').value = ''; renderCombo(); setTimeout(() => $('comboQ').focus(), 30); }
    });
    $('comboQ').addEventListener('input', renderCombo);
    $('comboList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cod]');
      if (b) seleccionar(b.dataset.cod, true);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#combo')) $('comboPanel').classList.add('hidden');
    });

    $('btnIr').addEventListener('click', () => S.sel && irAlPunto(S.sel));
    $('btnLevantar').addEventListener('click', () => S.sel && abrirFicha(S.sel));
    $('btnVerFicha').addEventListener('click', () => S.sel && verDetalle(S.sel));
    $('btnMapaPunto').addEventListener('click', () => S.sel && verDetalle(S.sel));

    document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', cerrarSheet));
    $('shIr').addEventListener('click', () => { const c = S.sel; cerrarSheet(); if (c) irAlPunto(c); });
    $('shLevantar').addEventListener('click', () => { const c = S.sel; cerrarSheet(); if (c) abrirFicha(c); });
    $('shVer').addEventListener('click', () => { const c = S.sel; cerrarSheet(); if (c) verDetalle(c); });

    $('listaPuntos').addEventListener('click', (e) => {
      const b = e.target.closest('[data-cod]');
      if (b) seleccionar(b.dataset.cod, true);
    });
    $('q').addEventListener('input', renderLista);

    $('btnFichaBack').addEventListener('click', async () => {
      await limpiarBorrador();
      mostrar('puntos'); renderTodo();
    });
    $('btnGuardar').addEventListener('click', () => guardarFicha());
    $('f-inicio').addEventListener('change', () => { leerForm(); pintarDuracion(); });
    $('f-fin').addEventListener('change', () => { leerForm(); pintarDuracion(); });
    $('btnCroquis').addEventListener('click', () => generarCroquis(false));
    $('btnVerCroquis').addEventListener('click', () => S.editor && S.editor.croquis && verImagen(S.editor.croquis));

    document.querySelectorAll('[data-foto]').forEach((b) => b.addEventListener('click', () => {
      const tipo = b.dataset.foto, src = b.dataset.src;
      const input = $(src === 'cam' ? 'cam' + (tipo === 'punto' ? 'Punto' : 'Placa') : 'gal' + (tipo === 'punto' ? 'Punto' : 'Placa'));
      input.value = '';
      input.click();
    }));
    [['camPunto', 'punto'], ['galPunto', 'punto'], ['camPlaca', 'placa'], ['galPlaca', 'placa']].forEach(([id, tipo]) => {
      $(id).addEventListener('change', (e) => agregarFotos(tipo, Array.from(e.target.files || [])));
    });
    document.addEventListener('click', async (e) => {
      const ver = e.target.closest('[data-ver]');
      if (ver) {
        const blob = await Fotos.getBlob(ver.dataset.ver);
        if (blob) verImagen(URL.createObjectURL(blob));
      }
      const borrar = e.target.closest('[data-borrar]');
      if (borrar) borrarFoto(borrar.dataset.borrar);
    });
    $('visorClose').addEventListener('click', () => { $('visor').classList.add('hidden'); $('visorImg').src = ''; });

    $('btnDetBack').addEventListener('click', () => { mostrar('puntos'); renderTodo(); });
    $('btnDetPdf').addEventListener('click', () => S.sel && descargarPDF(S.sel, false));
    $('d-pdf').addEventListener('click', () => S.sel && descargarPDF(S.sel, false));
    $('d-share').addEventListener('click', () => S.sel && descargarPDF(S.sel, true));
    $('d-geo').addEventListener('click', () => S.sel && exportarGeo(S.sel));
    $('d-zip').addEventListener('click', () => S.sel && exportarZip(S.sel));
    $('d-edit').addEventListener('click', () => S.sel && abrirFicha(S.sel));
    $('d-del').addEventListener('click', () => S.sel && borrarFicha(S.sel));
    $('d-subir').addEventListener('click', () => S.sel && subirUna(S.sel, false));
    $('d-miUbicacion').addEventListener('click', miUbicacion);
    $('d-ir').addEventListener('click', () => S.sel && irAlPunto(S.sel));

    // Drive (Apps Script)
    $('btnProbar').addEventListener('click', async () => {
      const u = $('driveUrl').value.trim(), c = $('driveClave').value.trim();
      busy(true, 'Probando el script…');
      try {
        Drive.validarUrl(u);
        const r = await Drive.probar(u, c);
        await Drive.guardarConfig(u, c);
        renderDrive();
        const quien = r.cuenta ? ` (${r.cuenta})` : '';
        toast('Conectado con Drive' + quien + '. Carpeta: ' + (r.raiz || CONFIG.carpetaProyecto), 'ok');
        $('driveCarpetaMsg').innerHTML = 'Listo. La carpeta es <b>' + esc(r.raiz || CONFIG.carpetaProyecto) + '</b>' +
          (r.raizUrl ? ` — <a href="${esc(r.raizUrl)}" target="_blank" rel="noopener">abrir en Drive</a>` : '');
        if (r.raizUrl) await DB.kvSet('drive.raizUrl', r.raizUrl);
      } catch (e) {
        toast(e.message, 'err');
        $('driveCarpetaMsg').textContent = e.message;
      } finally { busy(false); }
    });
    $('btnAbrirPing').addEventListener('click', () => {
      const u = $('driveUrl').value.trim() || Drive.urlActual();
      const c = $('driveClave').value.trim();
      if (!u) { toast('Falta la URL del script.', 'err'); return; }
      if (!c) { toast('Escribe la clave para hacer la prueba.', 'err'); return; }
      const q = u + (u.includes('?') ? '&' : '?') + 'ping=1&clave=' + encodeURIComponent(c);
      window.open(q, '_blank', 'noopener');
      toast('Si ves un texto con "ok": true, el script está público. Si ves "Acceso denegado", falta cambiar el acceso de la implementación.');
    });
    $('btnAbrirCarpeta').addEventListener('click', async () => {
      const u = await DB.kvGet('drive.raizUrl', '');
      if (!u) { toast('Primero pulsa "Guardar y probar".', 'err'); return; }
      window.open(u, '_blank', 'noopener');
    });
    $('btnSubirTodo').addEventListener('click', () => subirPendientes(false));
    $('btnReintentar').addEventListener('click', () => subirPendientes(true));
    $('autoSubir').addEventListener('change', async (e) => { S.ajustes.autoSubir = e.target.checked; await guardarAjustes(); });
    $('borrarOrig').addEventListener('change', async (e) => { S.ajustes.borrarOrig = e.target.checked; await guardarAjustes(); });

    $('btnBackup').addEventListener('click', exportarRespaldo);
    $('fileRestore').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importarRespaldo(f); e.target.value = ''; });
    $('btnZipAll').addEventListener('click', () => exportarZip(null));
    $('btnCsv').addEventListener('click', exportarCsv);
    $('btnGeo').addEventListener('click', () => exportarGeo(null));
    $('btnPrepCroquis').addEventListener('click', prepararCroquis);
    $('btnGuardarAjustes').addEventListener('click', guardarAjustesForm);
    $('btnBorrarTodo').addEventListener('click', async () => {
      if (!confirm('Se borrarán TODAS las fichas, fotografías y croquis de este teléfono. ¿Continuar?')) return;
      await DB.clear('fichas'); await DB.clear('photos'); await DB.clear('pmeta'); await DB.clear('croquis');
      S.fichas.clear(); renderTodo(); renderDrive(); estadoApp();
      toast('Datos borrados.', 'ok');
    });

    const alVolver = () => {
      netState();
      completarCroquisPendientes();
    };
    window.addEventListener('online', alVolver);
    window.addEventListener('offline', netState);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') alVolver(); });
  }

  async function limpiarBorrador() {
    const f = S.editor;
    if (!f) return;
    if (guardada(f.codigo)) return;   // ya existía: las fotos pertenecen a la ficha guardada
    for (const m of await Fotos.byFicha(f.codigo)) await Fotos.remove(m.id);
    S.fotosEditor = [];
  }

  async function borrarFicha(codigo) {
    if (!confirm(`¿Eliminar la ficha de ${codigo} y sus fotografías?`)) return;
    await Fotos.removeDeFicha(codigo);
    await DB.del('fichas', codigo);
    S.fichas.delete(codigo);
    mostrar('puntos'); renderTodo(); renderDrive();
    toast('Ficha eliminada.');
  }

  return { init, renderTodo, verDetalle, abrirFicha, completarCroquisPendientes };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((e) => {
    console.error(e);
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Error al iniciar: ' + e.message; t.classList.remove('hidden'); }
  });
});
