/* Lógica de la app: selección de puntos, ficha de campo (ida y vuelta), PDF,
   subida a Drive (Apps Script) y respaldo. */
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

  /* ---------------- ida y vuelta ---------------- */
  const TIPOS = { ida: 'IDA', vuelta: 'VUELTA', base: 'BASE', unica: 'ÚNICA' };
  /* id de la ficha: RG-52-02-IDA · RG-52-02-VUELTA · RG-50-01-BASE-D3 · RG-SF-51-01-UNICA */
  const idFicha = (codigo, tipo, jornada) => `${codigo}-${String(tipo).toUpperCase()}` +
    (String(tipo).toLowerCase() === 'base' ? `-${jornada || 1}` : '');
  const nRuta = (codigo, tipo) => {
    const lista = (typeof RUTA !== 'undefined' && RUTA[tipo]) || [];
    const i = lista.indexOf(codigo);
    return i < 0 ? null : i + 1;
  };

  /* todas las fichas posibles: primero las planificadas (en orden de recorrido) y
     después las de los puntos que no están en la ruta, para no dejar ninguno fuera */
  function sesiones() {
    const out = [];
    const plan = (typeof RUTA !== 'undefined') ? RUTA : { ida: [], vuelta: [] };
    ['ida', 'vuelta'].forEach((tipo) => {
      (plan[tipo] || []).forEach((codigo, i) => out.push({ id: idFicha(codigo, tipo), codigo, tipo, n: i + 1, plan: true }));
    });
    /* Bases de primer orden: una ficha por jornada de ocupación. Las jornadas son
       tentativas: se muestran las previstas y una más, para poder agregar la siguiente
       cuando el trabajo se alargue. */
    const diasBase = plan.diasBase || 6;
    (plan.base || []).forEach((codigo) => {
      const hechas = Array.from(S.fichas.keys())
        .map((id) => { const m = new RegExp('^' + codigo + '-BASE-(\\d+)$').exec(id); return m ? Number(m[1]) : 0; })
        .filter((n) => n > 0);
      const ultima = hechas.length ? Math.max.apply(null, hechas) : 0;
      const total = Math.max(diasBase, ultima + 1);
      for (let j = 1; j <= total; j++) {
        out.push({ id: idFicha(codigo, 'base', j), codigo, tipo: 'base', dia: j, n: null, plan: true, rol: 'base' });
      }
    });
    /* punto adicional: una sola medición */
    (plan.unica || []).forEach((codigo) => {
      out.push({ id: idFicha(codigo, 'unica'), codigo, tipo: 'unica', n: null, plan: true, rol: 'unica' });
    });
    const enRuta = new Set([].concat(plan.ida || [], plan.vuelta || [], plan.base || [], plan.unica || []));
    PUNTOS.forEach((p) => {
      if (enRuta.has(p.c)) return;
      ['ida', 'vuelta'].forEach((tipo) => out.push({ id: idFicha(p.c, tipo), codigo: p.c, tipo, n: null, plan: false }));
    });
    return out;
  }
  const planificadas = () => (typeof RUTA === 'undefined' ? 0
    : (RUTA.ida || []).length + (RUTA.vuelta || []).length
      + (RUTA.base || []).length * (RUTA.diasBase || 6) + (RUTA.unica || []).length);

  /* ---------------- estado ---------------- */
  const S = {
    fichas: new Map(),
    sel: null,          // { id, codigo, tipo, n }
    navCod: null,
    editor: null,
    fotosEditor: [],
    mapaDetalle: null,
    miPunto: null,
    watchGps: null,
    urls: [],
    ajustes: { operadores: [], ultimoOperador: '', ultimoReceptor: '', autoSubir: true, borrarOrig: false }
  };

  const P = (codigo) => PUNTOS.find((p) => p.c === codigo) || null;
  const miFicha = (id) => S.fichas.get(id) || null;

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
  let actualizacionPendiente = false;

  function mostrar(v) {
    if (v !== 'detalle' && S.watchGps != null) {
      try { navigator.geolocation.clearWatch(S.watchGps); } catch (e) { /* nada */ }
      S.watchGps = null;
    }
    ['puntos', 'ficha', 'detalle', 'drive', 'respaldo'].forEach((k) => $('v-' + k).classList.toggle('hidden', k !== v));
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on',
      b.dataset.tab === (v === 'detalle' || v === 'ficha' ? 'puntos' : v)));
    if (v !== 'ficha' && actualizacionPendiente) $('updateBar').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ---------------- puntos ---------------- */
  const badge = (tipo, dia) => `<span class="tipo ${tipo}">${TIPOS[tipo] || tipo}` +
  (String(tipo).toLowerCase() === 'base' ? ` ${dia || 1}` : '') + '</span>';

  function renderCombo() {
    const q = String($('comboQ').value || '').toLowerCase().trim();
    const lista = sesiones().filter((s) => {
      if (!q) return true;
      const p = P(s.codigo) || {};
      return [s.codigo, TIPOS[s.tipo], p.parroquia, p.sector].join(' ').toLowerCase().includes(q);
    });
    let html = '';
    let separador = false;
    for (const s of lista) {
      if (!s.plan && !separador) { separador = true; html += '<div class="combo-sep">Sin ruta asignada</div>'; }
      const p = P(s.codigo) || {};
      const ok = !!miFicha(s.id);
      html += `<button type="button" class="combo-item${ok ? ' saved' : ''}${S.sel && S.sel.id === s.id ? ' sel' : ''}" data-id="${esc(s.id)}" role="option">
        <span class="ck">✓</span>
        <span class="num">${s.n ? s.n : '–'}</span>
        <span class="txt"><b>${esc(s.codigo)}</b> ${badge(s.tipo, s.dia)}<span class="s">${esc(p.parroquia || '')} · ${esc(p.mat || '')}</span></span>
      </button>`;
    }
    $('comboList').innerHTML = html || '<p class="hint" style="padding:14px">Sin resultados.</p>';
  }

  function renderAvance() {
    const total = planificadas() || sesiones().length;
    const hechas = sesiones().filter((s) => s.plan && miFicha(s.id)).length;
    const extras = sesiones().filter((s) => !s.plan && miFicha(s.id)).length;
    $('avancePill').textContent = `${hechas} / ${total}` + (extras ? ` (+${extras})` : '');
    $('progressBar').style.width = (hechas / Math.max(1, total) * 100).toFixed(1) + '%';
  }

  function renderTodo() {
    renderCombo(); renderAvance();
    if (S.sel) { pintarComboVal(); pintarPanelPunto(); }
  }

  function seleccionar(id) {
    const s = sesiones().find((x) => x.id === id);
    if (!s) return;
    S.sel = s;
    pintarComboVal();
    $('comboPanel').classList.add('hidden');
    $('comboBtn').setAttribute('aria-expanded', 'false');
    $('btnIr').disabled = false;
    $('btnLevantar').disabled = false;
    $('btnLevantar').querySelector('span:last-child').firstChild.textContent = miFicha(id) ? 'EDITAR FICHA' : 'LEVANTAR FICHA';
    pintarPanelPunto();
    renderCombo();
  }

  function pintarComboVal() {
    if (!S.sel) { $('comboVal').textContent = 'Elegir un punto…'; return; }
    const p = P(S.sel.codigo);
    const ok = miFicha(S.sel.id);
    const num = S.sel.n ? `${S.sel.n}. ` : '';
    $('comboVal').innerHTML = (ok ? '<span class="ok">✓</span> ' : '') + num + esc(S.sel.codigo) + ' ' + badge(S.sel.tipo, S.sel.dia) +
      ` <small>${esc(p ? p.parroquia : '')}${ok ? ' · guardada' : ''}</small>`;
  }

  function pintarPanelPunto() {
    const s = S.sel; if (!s) return;
    const p = P(s.codigo); if (!p) return;
    const f = miFicha(s.id);
    const otraTipo = s.tipo === 'ida' ? 'vuelta' : 'ida';
    const otra = miFicha(idFicha(s.codigo, otraTipo));
    const totalTipo = ((typeof RUTA !== 'undefined' && RUTA[s.tipo]) || []).length;
    $('panelPunto').classList.remove('hidden');
    $('pp-nombre').innerHTML = esc(p.c) + ' ' + badge(s.tipo, s.dia);
    const detalleRuta = s.rol === 'base' ? ` · jornada ${s.dia || 1} · base de referencia (8 h)`
      : s.rol === 'unica' ? ' · medición única'
        : s.n ? ` · ${TIPOS[s.tipo]} ${s.n} de ${totalTipo}` : ' · sin ruta asignada';
    $('pp-sub').textContent = `${p.parroquia} · ${p.orden}° orden · ${p.mat}` + detalleRuta;
    $('pp-datos').innerHTML = [
      ['ESTE (X)', p.e.toLocaleString('es-EC')],
      ['NORTE (Y)', p.n.toLocaleString('es-EC')],
      ['ZONA / DATUM', `UTM ${PROYECTO.zona}${PROYECTO.hemisferio} · WGS84`],
      ['SECTOR / SITIO', p.sector],
      [TIPOS[s.tipo], f ? (f.drive && f.drive.estado === 'subida' ? 'Guardada · en Drive' : 'Guardada en el teléfono') : 'Pendiente de levantar'],
      [TIPOS[otraTipo], otra ? 'Ya levantada' : 'Pendiente'],
      ['FICHA', f ? `Del ${PDF.fmtFecha(f.fecha)}` : '—']
    ].map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('');
    $('btnVerFicha').classList.toggle('hidden', !f);
    $('btnBorrarFicha').classList.toggle('hidden', !f);
    $('puntoSelHint').textContent = f
      ? `Ficha ${TIPOS[s.tipo]} guardada: puedes verla, descargarla o borrarla.`
      : `Puedes ir al punto o levantar la ficha ${TIPOS[s.tipo]}.`;
  }

  /* ---------------- IR AL PUNTO (elige la app de mapas) ---------------- */
  function abrirNav(codigo) {
    const p = P(codigo); if (!p) return;
    S.navCod = codigo;
    $('btnNavApple').classList.toggle('hidden', /Android/i.test(navigator.userAgent));
    $('navSub').textContent = `${p.c} · ${p.sector}`;
    $('navSheet').classList.remove('hidden');
  }

  const cerrarNav = () => $('navSheet').classList.add('hidden');

  function navegar(app, codigo) {
    const p = P(codigo); if (!p) return;
    const { lat, lon } = Geo.puntoLatLon(p);
    const ll = `${lat.toFixed(7)},${lon.toFixed(7)}`;
    const etiqueta = encodeURIComponent(p.c);
    let url;
    if (app === 'waze') {
      url = `https://waze.com/ul?ll=${ll}&navigate=yes&zoom=17`;
    } else if (app === 'apple') {
      url = isIOS ? `maps://?daddr=${ll}&q=${etiqueta}` : `https://maps.apple.com/?daddr=${ll}&q=${etiqueta}`;
    } else {
      url = `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
    }
    DB.kvSet('nav.ultimo', app).catch(() => {});
    cerrarNav();
    if (app === 'apple' && isIOS) {
      try { window.location.href = url; } catch (e) { /* nada */ }
      setTimeout(() => {
        if (document.visibilityState === 'visible') {
          window.open(`https://maps.apple.com/?daddr=${ll}&q=${etiqueta}`, '_blank', 'noopener');
        }
      }, 1200);
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  /* ---------------- ficha: abrir / leer / guardar ---------------- */
  function nuevaFicha(p, ses) {
    const { lat, lon } = Geo.puntoLatLon(p);
    const tipo = ses.tipo, dia = ses.dia || null;
    return {
      id: ses.id, codigo: p.c, tipo, dia, sesion: ses.n || null,
      grupo: (typeof GRUPOS !== 'undefined' && GRUPOS[ses.rol || 'movil']) || '',
      nombre: p.nombre, parroquia: p.parroquia, sector: p.sector,
      este: p.e, norte: p.n, orden: p.orden, materializacion: p.mat,
      lat, lon,
      inicio: ahoraLocal(), fin: '', fecha: hoy(),
      operador: S.ajustes.ultimoOperador || '', receptor: S.ajustes.ultimoReceptor || '',
      alturaAntena: '',
      metodo: METODO, mascara: MASCARA, intervalo: INTERVALO,
      creado: Date.now(), actualizado: Date.now()
    };
  }

  async function abrirFicha(id) {
    const s = sesiones().find((x) => x.id === id);
    if (!s) return;
    const p = P(s.codigo); if (!p) return;
    const f = miFicha(id);
    S.editor = f ? clone(f) : nuevaFicha(p, s);
    migrarFicha(S.editor, p);
    S.fotosEditor = await Fotos.byFicha(id);
    pintarForm();
    pintarFotosEditor();
    mostrar('ficha');
    if (!$('f-extra-nombre').value) $('f-extra-nombre').value = '';
  }

  /* Compatibilidad con fichas guardadas por versiones anteriores. */
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
    f.nombre = p.nombre; f.parroquia = p.parroquia; f.sector = p.sector; f.materializacion = p.mat;
    if (!f.tipo) f.tipo = 'ida';
    if (f.sesion === undefined) f.sesion = nRuta(p.c, f.tipo);
    if (!f.grupo) f.grupo = (typeof GRUPOS !== 'undefined' && GRUPOS[f.tipo] ) || GRUPOS.movil;
    delete f.horaInicio; delete f.horaFin; delete f.alturaElipsoidal;
    delete f.sats; delete f.gdop; delete f.datum; delete f.epoca;
    delete f.croquis; delete f.croquisZ; delete f.croquisPendiente;   // ahora el croquis viene con la app
    return f;
  }

  function pintarForm() {
    const f = S.editor;
    $('f-titulo').innerHTML = `Ficha ${esc(f.codigo)} ${badge(f.tipo)}`;
    $('f-codigo').value = f.codigo || '';
    $('f-parroquia').value = f.parroquia || '';
    $('f-sector').value = f.sector || '';
    $('f-mat').value = f.materializacion || '';
    $('f-este').value = Number(f.este).toLocaleString('es-EC');
    $('f-norte').value = Number(f.norte).toLocaleString('es-EC');
    $('f-orden').value = `${f.orden}° orden`;
    $('f-zona').value = `UTM ${PROYECTO.zona}${PROYECTO.hemisferio} · WGS84`;
    const p = P(f.codigo);
    $('f-trabajos').textContent = p ? p.trabajos : '';
    $('f-receptor').innerHTML = '<option value="">—</option>' + RECEPTORES.map((r) => `<option${r === f.receptor ? ' selected' : ''}>${esc(r)}</option>`).join('');
    $('f-altura').value = f.alturaAntena || '';
    $('f-inicio').value = f.inicio || '';
    $('f-fin').value = f.fin || '';
    $('f-operador').value = f.operador || '';
    pintarCroquis();
    pintarDuracion();
    pintarNotasDiseno();
    pintarOperadores();
    $('btnGuardar').textContent = miFicha(f.id) ? 'Guardar cambios' : 'Guardar ficha';
  }

  function pintarNotasDiseno() {
    const p = P(S.editor.codigo);
    $('f-notas').innerHTML = (p && p.notas && p.notas.length ? p.notas : ['Sin notas de diseño para este sitio.'])
      .map((n) => `<p>${esc(n)}</p>`).join('');
  }

  function pintarOperadores() {
    const lista = (S.ajustes.operadores || []).slice();
    S.fichas.forEach((f) => { if (f.operador && !lista.includes(f.operador)) lista.push(f.operador); });
    $('lstOperadores').innerHTML = lista.map((o) => `<option value="${esc(o)}">`).join('');
  }

  function leerForm() {
    const f = S.editor;
    f.receptor = $('f-receptor').value;
    f.alturaAntena = numero($('f-altura').value);
    f.inicio = $('f-inicio').value;
    f.fin = $('f-fin').value;
    f.fecha = (f.inicio || hoy()).slice(0, 10);
    f.operador = $('f-operador').value.trim();
    f.metodo = METODO; f.mascara = MASCARA; f.intervalo = INTERVALO;
    f.actualizado = Date.now();
    pintarDuracion();
  }

  const numero = (v) => {
    const s = String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.').trim();
    if (s === '') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  };

  /* "2026-10-31T09:15" -> minutos, para la duración */
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

  /* Botón "Ahora": registra la fecha y hora de este momento. */
  function ponerAhora(cual) {
    const valor = ahoraLocal();
    $(cual === 'fin' ? 'f-fin' : 'f-inicio').value = valor;
    leerForm();
    toast(cual === 'fin' ? 'Hora de fin registrada.' : 'Hora de inicio registrada.', 'ok');
  }

  function pintarCroquis() {
    const f = S.editor;
    const img = $('croquisImg');
    if (!f) return;
    img.classList.remove('hidden');
    img.onerror = () => img.classList.add('hidden');
    img.src = urlCroquis(f.codigo);
  }

  async function guardarFicha() {
    leerForm();
    const f = S.editor;
    const faltan = [];
    if (!f.receptor) faltan.push('receptor GNSS');
    if (!f.alturaAntena) faltan.push('altura de la antena');
    else if (f.alturaAntena <= 0 || f.alturaAntena > 10) faltan.push('altura de la antena entre 0 y 10 m');
    if (!f.inicio) faltan.push('inicio (fecha y hora)');
    if (!f.fin) faltan.push('fin (fecha y hora)');
    if (f.inicio && f.fin && duracionMin(f) != null && duracionMin(f) <= 0) faltan.push('fin posterior al inicio');
    else if (duracionMin(f) > 14 * 60) faltan.push('duración coherente (más de 14 h entre inicio y fin)');
    if (!f.operador) faltan.push('operador');
    if (!S.fotosEditor.some((m) => m.tipo === 'punto')) faltan.push('fotografía de la medición');
    if (!S.fotosEditor.some((m) => m.tipo === 'placa')) faltan.push('fotografía de la placa');
    if (faltan.length && !confirm('Falta completar:\n· ' + faltan.join('\n· ') + '\n\n¿Guardar la ficha igual?')) return;

    f.duracionMin = duracionMin(f);
    const prev = miFicha(f.id);
    f.drive = prev && prev.drive ? prev.drive : { estado: 'pend' };
    if (prev) {
      const campos = ['receptor', 'alturaAntena', 'inicio', 'fin'];
      if (campos.some((k) => String(prev[k] || '') !== String(f[k] || ''))) f.drive.estado = 'pend';
    }

    await DB.put('fichas', f);
    S.fichas.set(f.id, f);
    if (f.operador) {
      S.ajustes.ultimoOperador = f.operador;
      S.ajustes.operadores = S.ajustes.operadores || [];
      if (!S.ajustes.operadores.includes(f.operador)) S.ajustes.operadores.push(f.operador);
    }
    S.ajustes.ultimoReceptor = f.receptor || S.ajustes.ultimoReceptor;
    await guardarAjustes();

    renderTodo();
    toast(`Ficha ${TIPOS[f.tipo]} guardada. ✓`, 'ok');
    mostrar('puntos');
    if (S.ajustes.autoSubir && Drive.configurado()) subirUna(f.id, true);
  }

  /* ---------------- fotografías ---------------- */
  const NOMBRE_TIPO = { punto: 'medicion', placa: 'placa', extra: 'extra' };

  async function agregarFotos(tipo, files) {
    if (!files || !files.length) return;
    const etiqueta = tipo === 'extra' ? $('f-extra-nombre').value.trim() : '';
    busy(true, 'Procesando fotografías…');
    try {
      let orden = S.fotosEditor.filter((m) => m.tipo === tipo).length;
      for (const file of files) {
        const pr = await Fotos.procesar(file);
        orden += 1;
        await Fotos.add({
          id: uid(), fichaId: S.editor.id, tipo, blob: pr.blob, orig: pr.orig,
          thumb: pr.thumb, w: pr.w, h: pr.h, orden, etiqueta,
          nombre: file.name || `${tipo}.jpg`
        });
      }
      S.fotosEditor = await Fotos.byFicha(S.editor.id);
      pintarFotosEditor();
      toast(files.length === 1 ? 'Fotografía agregada.' : `${files.length} fotografías agregadas.`, 'ok');
    } catch (e) {
      toast('No se pudo procesar la foto: ' + e.message, 'err');
    } finally { busy(false); }
  }

  function pintarFotosEditor() {
    ['punto', 'placa', 'extra'].forEach((tipo) => {
      const cont = $('fotos-' + tipo);
      if (!cont) return;
      const lista = S.fotosEditor.filter((m) => m.tipo === tipo);
      cont.innerHTML = lista.map((m, i) => {
        const pie = tipo === 'extra'
          ? (m.etiqueta ? esc(m.etiqueta) : 'Sin nombre')
          : (i === 0 ? 'En la ficha' : 'Solo Drive');
        return `<figure class="phcard">
          <button class="phfoto" data-ver="${m.id}" title="Ver"><img src="${m.thumb}" alt=""></button>
          <button class="del" data-borrar="${m.id}" title="Borrar">×</button>
          <span class="tag">${pie}</span>
        </figure>`;
      }).join('');
    });
  }

  async function borrarFoto(id) {
    if (!confirm('¿Borrar esta fotografía?')) return;
    await Fotos.remove(id);
    S.fotosEditor = await Fotos.byFicha(S.editor.id);
    pintarFotosEditor();
  }

  function verImagen(src) {
    $('visorImg').src = src;
    $('visor').classList.remove('hidden');
  }

  /* ---------------- croquis incluido ---------------- */
  /* Los 22 croquis vienen generados en img/croquis/<código>.jpg. */
  const croquisMemo = new Map();
  const urlCroquis = (codigo) => `img/croquis/${codigo}.jpg`;

  async function croquisDe(codigo) {
    if (croquisMemo.has(codigo)) return croquisMemo.get(codigo);
    let r = null;
    try {
      const res = await fetch(urlCroquis(codigo), { cache: 'force-cache' });
      if (res.ok) {
        const blob = await res.blob();
        if (blob && blob.size) r = { dataUrl: await Fotos.blobToDataURL(blob) };
      }
    } catch (e) { r = null; }
    croquisMemo.set(codigo, r);
    return r;
  }

  /* ---------------- PDF ---------------- */
  async function fotosParaPDF(id) {
    const metas = await Fotos.byFicha(id);
    const out = [];
    for (const m of metas) {
      const blob = await Fotos.getBlob(m.id);
      if (!blob) continue;
      const v = await Fotos.paraPDF(blob, 1200);
      out.push({ tipo: m.tipo, orden: m.orden, etiqueta: m.etiqueta, dataUrl: v.dataUrl, w: v.w, h: v.h });
    }
    return out;
  }

  async function pdfDe(id) {
    const f = miFicha(id);
    if (!f) throw new Error('La ficha todavía no está guardada.');
    const fotos = await fotosParaPDF(id);
    const croquis = await croquisDe(f.codigo);
    const doc = PDF.fichaDoc(f, fotos, croquis);
    return { blob: doc.output('blob'), nombre: `${safe(id)}_${(f.fecha || hoy()).slice(0, 10)}.pdf` };
  }

  async function descargarPDF(id, compartir) {
    busy(true, 'Generando el PDF…');
    try {
      const { blob, nombre } = await pdfDe(id);
      if (compartir) await compartirBlob(blob, nombre, 'application/pdf');
      else bajarBlob(blob, nombre);
      toast(compartir ? 'PDF listo para compartir.' : 'PDF descargado.', 'ok');
    } catch (e) {
      toast(e.message, 'err');
    } finally { busy(false); }
  }

  /* ---------------- detalle ---------------- */
  async function verDetalle(id) {
    const f = miFicha(id);
    if (!f) { abrirFicha(id); return; }
    const s = sesiones().find((x) => x.id === id) || { id, codigo: f.codigo, tipo: f.tipo || 'ida', n: f.sesion || null };
    S.sel = s;
    mostrar('detalle');
    $('d-titulo').innerHTML = esc(f.codigo) + ' ' + badge(f.tipo || 'ida', f.dia);
    $('d-sub').textContent = `${f.parroquia} · ${f.orden}° orden · ${f.materializacion || ''}`;
    const d = duracionMin(f);
    const totalTipo = ((typeof RUTA !== 'undefined' && RUTA[f.tipo]) || []).length;
    $('d-datos').innerHTML = [
      ['TIPO', `${TIPOS[f.tipo || 'ida']}${f.sesion ? ` (${f.sesion} de ${totalTipo})` : ''}`],
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
      ['SECTOR / SITIO', f.sector || '—'],
      ['ACTUALIZADA', new Date(f.actualizado || f.creado || Date.now()).toLocaleString('es-EC')]
    ].map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('');

    $('d-croquis').src = urlCroquis(f.codigo);

    S.urls.forEach((u) => URL.revokeObjectURL(u));
    S.urls = [];
    const metas = await Fotos.byFicha(id);
    const fotosHtml = [];
    for (const m of metas) {
      const blob = await Fotos.getBlob(m.id);
      const url = blob ? URL.createObjectURL(blob) : m.thumb;
      if (blob) S.urls.push(url);
      const nom = m.tipo === 'extra' ? (m.etiqueta || 'Adicional')
        : m.tipo === 'placa' ? 'Placa' : 'Medición';
      fotosHtml.push(`<figure><img src="${url}" alt=""><figcaption>${esc(nom)} ${m.orden || ''}</figcaption></figure>`);
    }
    $('d-fotos').innerHTML = fotosHtml.join('') || '<p class="hint">Sin fotografías.</p>';
    $('d-fotosPanel').classList.toggle('hidden', !metas.length);

    const dr = f.drive || { estado: 'pend' };
    $('d-drive').innerHTML = dr.estado === 'subida'
      ? `Subida el ${new Date(dr.fecha).toLocaleString('es-EC')}.<br>Carpeta: <code>${esc(dr.ruta || '')}</code>`
      : dr.estado === 'error'
        ? `La última subida falló: ${esc(dr.error || '')}`
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
    const f = S.sel && miFicha(S.sel.id);
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
  async function fotosParaDrive(id) {
    const metas = await Fotos.byFicha(id);
    const out = [];
    for (const m of metas) {
      const rec = await Fotos.getRec(m.id);
      if (!rec) continue;
      out.push({
        tipo: m.tipo, orden: m.orden, nombre: m.nombre, etiqueta: m.etiqueta,
        orig: rec.orig, blob: rec.blob, origTipo: m.origTipo, tipoArchivo: rec.blob ? rec.blob.type : ''
      });
    }
    return out;
  }

  async function subirUna(id, automatico) {
    const f = miFicha(id);
    if (!f) { toast('Guarda la ficha antes de subirla.', 'err'); return; }
    if (!Drive.configurado()) { toast('Configura la URL y la clave del script en la pestaña Drive.', 'err'); return; }
    try {
      busy(true, 'Preparando la subida…');
      const { blob } = await pdfDe(id);
      const fotos = await fotosParaDrive(id);
      const r = await Drive.subirFicha(f, blob, fotos, (t) => busy(true, t));
      f.drive = { estado: 'subida', fecha: Date.now(), ruta: r.ruta, archivos: r.archivos, sinConfirmar: !!r.sinConfirmar };
      await DB.put('fichas', f);
      S.fichas.set(id, f);
      if (S.ajustes.borrarOrig) {
        for (const m of await Fotos.byFicha(id)) if (m.tieneOrig) await Fotos.soloOriginal(m.id);
        S.fotosEditor = await Fotos.byFicha(id);
      }
      renderTodo(); renderDrive();
      if (S.sel && S.sel.id === id && !$('v-detalle').classList.contains('hidden')) verDetalle(id);
      toast(r.sinConfirmar ? 'Enviado a Drive (no se pudo confirmar la respuesta).' : 'Ficha subida a Drive.', 'ok');
    } catch (e) {
      f.drive = { estado: 'error', fecha: Date.now(), error: e.message };
      await DB.put('fichas', f);
      S.fichas.set(id, f);
      renderDrive();
      toast('No se pudo subir: ' + e.message, 'err');
      void automatico;
    } finally { busy(false); }
  }

  async function subirPendientes(soloErrores) {
    const lista = sesiones().map((s) => miFicha(s.id)).filter(Boolean)
      .filter((f) => (soloErrores ? f.drive && f.drive.estado === 'error' : !f.drive || f.drive.estado !== 'subida'));
    if (!lista.length) { toast('No hay fichas pendientes de subir.', 'ok'); return; }
    if (!Drive.configurado()) { toast('Configura la URL y la clave del script primero.', 'err'); return; }
    let ok = 0, err = 0;
    for (const f of lista) {
      busy(true, `Subiendo ${f.id} (${ok + err + 1} de ${lista.length})…`);
      try {
        const { blob } = await pdfDe(f.id);
        const fotos = await fotosParaDrive(f.id);
        const r = await Drive.subirFicha(f, blob, fotos);
        f.drive = { estado: 'subida', fecha: Date.now(), ruta: r.ruta, archivos: r.archivos, sinConfirmar: !!r.sinConfirmar };
        ok++;
      } catch (e) {
        f.drive = { estado: 'error', fecha: Date.now(), error: e.message };
        err++;
      }
      await DB.put('fichas', f);
      S.fichas.set(f.id, f);
      renderDrive(); renderTodo();
    }
    busy(false);
    toast(`Subida terminada: ${ok} correcta(s)` + (err ? `, ${err} con error` : '') + '.', err ? 'err' : 'ok');
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

    const todas = sesiones().map((s) => miFicha(s.id)).filter(Boolean);
    const total = todas.length;
    const subidas = todas.filter((f) => f.drive && f.drive.estado === 'subida').length;
    const errores = todas.filter((f) => f.drive && f.drive.estado === 'error').length;
    $('driveResumen').innerHTML = `Fichas guardadas: <b>${total}</b> · en Drive: <b>${subidas}</b> · pendientes: <b>${total - subidas - errores}</b>` +
      (errores ? ` · con error: <b class="err">${errores}</b>` : '');
    $('autoSubir').checked = !!S.ajustes.autoSubir;
    $('borrarOrig').checked = !!S.ajustes.borrarOrig;

    $('driveCola').innerHTML = sesiones().map((s) => {
      const f = miFicha(s.id);
      if (!f) return '';
      const e = (f.drive && f.drive.estado) || 'pend';
      const cls = e === 'subida' ? 'sub' : e === 'error' ? 'err' : 'pend';
      const txt = e === 'subida' ? 'En Drive' : e === 'error' ? 'Error' : 'Pendiente';
      const det = e === 'error' ? esc((f.drive || {}).error || '') : PDF.fmtFecha(f.fecha);
      return `<div class="fila"><div><b>${esc(f.codigo)}</b> ${badge(f.tipo, f.dia)}<small>${det}</small></div><span class="est ${cls}">${txt}</span></div>`;
    }).join('') || '<p class="hint">Todavía no hay fichas guardadas.</p>';
  }

  /* ---------------- exportaciones ---------------- */
  const csvQ = (v) => { const s = v == null ? '' : String(v); return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  async function exportarCsv() {
    const metas = await DB.all('pmeta');
    const por = {};
    metas.forEach((m) => {
      por[m.fichaId] = por[m.fichaId] || { punto: 0, placa: 0, extra: 0 };
      por[m.fichaId][m.tipo] = (por[m.fichaId][m.tipo] || 0) + 1;
    });
    const cols = ['id', 'codigo', 'tipo', 'jornada', 'grupo', 'sesion', 'parroquia', 'sector', 'orden', 'este', 'norte', 'materializacion',
      'receptor', 'altura_antena', 'inicio', 'fin', 'duracion_min', 'metodo', 'mascara', 'intervalo',
      'operador', 'fotos_medicion', 'fotos_placa', 'fotos_extra', 'croquis', 'drive'];
    const filas = sesiones().map((s) => {
      const p = P(s.codigo) || {};
      const f = miFicha(s.id);
      const c = por[s.id] || { punto: 0, placa: 0, extra: 0 };
      const d = f || {};
      return [s.id, s.codigo, s.tipo, s.dia || '', (d.grupo || ''), s.n || '', p.parroquia, d.sector || p.sector, p.orden, p.e, p.n,
        d.materializacion || p.mat, d.receptor || '', d.alturaAntena || '', d.inicio || '', d.fin || '',
        d.duracionMin || '', d.metodo || METODO, d.mascara || MASCARA, d.intervalo || INTERVALO,
        d.operador || '', c.punto, c.placa, c.extra,
        f ? 'incluido' : '—',
        (d.drive && d.drive.estado) || (f ? 'pendiente' : 'sin ficha')];
    });
    const csv = '\ufeff' + [cols.join(';')].concat(filas.map((r) => r.map(csvQ).join(';'))).join('\r\n');
    bajarBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `avance_red_geodesica_${hoy()}.csv`);
  }

  function geojsonPuntos() {
    const feats = PUNTOS.map((p) => {
      const ida = miFicha(idFicha(p.c, 'ida'));
      const vuelta = miFicha(idFicha(p.c, 'vuelta'));
      const { lat, lon } = Geo.puntoLatLon(p);
      const si = (f) => (f ? 'si' : 'no');
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [lon, lat] },
        properties: {
          codigo: p.c, parroquia: p.parroquia, sector: (ida || vuelta || {}).sector || p.sector,
          orden: p.orden, este: p.e, norte: p.n, mat: (ida || vuelta || {}).materializacion || p.mat,
          n_ida: nRuta(p.c, 'ida') || '', n_vuelta: nRuta(p.c, 'vuelta') || '',
          ficha_ida: si(ida), ficha_vuelta: si(vuelta),
          operador_ida: ida ? ida.operador || '' : '', operador_vuelta: vuelta ? vuelta.operador || '' : '',
          receptor_ida: ida ? ida.receptor || '' : '', receptor_vuelta: vuelta ? vuelta.receptor || '' : '',
          dur_ida: ida ? ida.duracionMin || '' : '', dur_vuelta: vuelta ? vuelta.duracionMin || '' : '',
          croquis: 'incluido',
          drive_ida: (ida && ida.drive && ida.drive.estado) || '', drive_vuelta: (vuelta && vuelta.drive && vuelta.drive.estado) || ''
        }
      };
    });
    return JSON.stringify({ type: 'FeatureCollection', name: 'red_geodesica_pedro_moncayo', features: feats }, null, 2);
  }

  function exportarGeo(codigo) {
    const nombre = codigo ? `punto_${safe(codigo)}.geojson` : `red_geodesica_${hoy()}.geojson`;
    if (codigo) {
      const j = JSON.parse(geojsonPuntos());
      j.features = j.features.filter((f) => f.properties.codigo === codigo);
      bajarBlob(new Blob([JSON.stringify(j, null, 2)], { type: 'application/geo+json' }), nombre);
    } else bajarBlob(new Blob([geojsonPuntos()], { type: 'application/geo+json' }), nombre);
  }

  async function exportarZip(id) {
    busy(true, 'Empaquetando fotografías…');
    try {
      const fichas = id ? [miFicha(id)] : Array.from(S.fichas.values());
      const entradas = [];
      const indice = [['id', 'codigo', 'tipo', 'foto', 'etiqueta', 'orden', 'archivo', 'ancho', 'alto', 'fecha']];
      for (const f of fichas) {
        if (!f) continue;
        const etq = TIPOS[f.tipo || 'ida'];
        for (const m of await Fotos.byFicha(f.id)) {
          const blob = await Fotos.getBlob(m.id);
          if (!blob) continue;
          const nombre = `${f.codigo}/${f.codigo}_${etq}_${NOMBRE_TIPO[m.tipo] || m.tipo}_${m.orden}.jpg`;
          entradas.push({ name: nombre, blob });
          indice.push([f.id, f.codigo, f.tipo, m.tipo, m.etiqueta || '', m.orden, nombre, m.w, m.h, new Date(m.tomada || Date.now()).toISOString()]);
        }
      }
      if (!entradas.length) { toast('No hay fotografías para exportar.', 'err'); return; }
      const csv = '\ufeff' + indice.map((r) => r.map(csvQ).join(';')).join('\r\n');
      entradas.push({ name: 'indice_fotos.csv', blob: new Blob([csv], { type: 'text/csv' }) });
      const zip = await Zip.build(entradas);
      bajarBlob(zip, id ? `fotos_${safe(id)}.zip` : `fotos_red_geodesica_${hoy()}.zip`);
      toast('ZIP generado.', 'ok');
    } catch (e) {
      toast('No se pudo generar el ZIP: ' + e.message, 'err');
    } finally { busy(false); }
  }

  async function exportarRespaldo() {
    const lista = Array.from(S.fichas.values()).map((f) => {
      const c = Object.assign({}, f);
      delete c.croquis;
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
        if (!f.id) f.id = idFicha(f.codigo, f.tipo || 'ida');
        const actual = miFicha(f.id);
        if (actual && (actual.actualizado || 0) > (f.actualizado || 0)) continue;
        await DB.put('fichas', f);
        S.fichas.set(f.id, f);
        n++;
      }
      renderTodo(); renderDrive();
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
    delete S.ajustes.carpeta; delete S.ajustes.datum; delete S.ajustes.epoca;
  }
  async function guardarAjustes() { await DB.kvSet('ajustes', S.ajustes); }

  /* ---------------- actualizaciones de la app ---------------- */
  let swReg = null;
  let teniaControl = false;
  let buildSW = '';

  function mostrarBarra(version) {
    const barra = $('updateBar');
    if (!barra || !teniaControl) return;
    actualizacionPendiente = true;
    const txt = barra.querySelector('span');
    if (txt) txt.textContent = version ? `Hay una versión nueva (${version}).` : 'Hay una versión nueva de la app.';
    if (!$('v-ficha').classList.contains('hidden')) return;
    barra.classList.remove('hidden');
  }

  async function aplicarActualizacion() {
    const w = swReg && swReg.waiting;
    if (w) {
      try { w.postMessage({ tipo: 'activar' }); } catch (e) { /* nada */ }
      setTimeout(() => location.reload(), 900);
    } else {
      location.reload();
    }
  }

  function pintarVersion() {
    const el = $('versionInfo');
    if (el) el.textContent = `Versión ${CONFIG.version}${buildSW ? ' · build ' + buildSW : ''} · ${PROYECTO.nombre}`;
  }

  async function buscarActualizacion() {
    if (!swReg) { toast('Este navegador no permite actualizar desde la app. Cierra y vuelve a abrirla.', 'err'); return; }
    busy(true, 'Buscando actualizaciones…');
    try {
      await swReg.update();
      await new Promise((r) => setTimeout(r, 900));
      if (swReg.installing || swReg.waiting || actualizacionPendiente) {
        mostrarBarra();
        toast('Hay una versión nueva: pulsa "Actualizar".', 'ok');
      } else {
        toast('Ya tienes la última versión' + (buildSW ? ' (' + buildSW + ').' : '.'), 'ok');
      }
    } catch (e) {
      toast('No se pudo buscar la actualización: ' + e.message, 'err');
    } finally { busy(false); }
  }

  async function iniciarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    teniaControl = !!navigator.serviceWorker.controller;
    try {
      swReg = await navigator.serviceWorker.register('sw.js');
    } catch (e) {
      console.warn('La app funciona, pero sin modo sin conexión:', e.message);
      return;
    }

    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.tipo === 'nueva-version') mostrarBarra(d.version);
      if (d.tipo === 'version') { buildSW = d.version || ''; pintarVersion(); }
    });

    swReg.addEventListener('updatefound', () => {
      const nuevo = swReg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) mostrarBarra();
      });
    });

    if (navigator.serviceWorker.controller) {
      try { navigator.serviceWorker.controller.postMessage({ tipo: 'version' }); } catch (e) { /* nada */ }
    }

    let ultima = 0;
    const revisar = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - ultima < 60000) return;
      ultima = Date.now();
      swReg.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') revisar();
    });
    window.addEventListener('online', revisar);
    setInterval(revisar, 15 * 60 * 1000);
    setTimeout(revisar, 4000);
  }

  /* ---------------- arranque ---------------- */
  /* Las fichas de versiones anteriores (una por punto) pasan a ser las de IDA. */
  async function migrarSesiones() {
    const viejas = (await DB.all('fichas')).filter((f) => !f.tipo);
    for (const f of viejas) {
      const codigo = f.codigo || String(f.id);
      const tipo = 'ida';
      const nuevoId = idFicha(codigo, tipo);
      const nuevo = Object.assign({}, f, { id: nuevoId, codigo, tipo, sesion: nRuta(codigo, tipo) });
      await DB.put('fichas', nuevo);
      if (f.id !== nuevoId) {
        await DB.del('fichas', f.id);
        for (const m of await DB.all('pmeta')) if (m.fichaId === f.id) await DB.put('pmeta', Object.assign({}, m, { fichaId: nuevoId }));
        for (const p of await DB.all('photos')) if (p.fichaId === f.id) await DB.put('photos', Object.assign({}, p, { fichaId: nuevoId }));
      }
      console.log('Ficha migrada a IDA:', codigo);
    }
  }

  async function init() {
    await cargarAjustes();
    iniciarServiceWorker();
    $('btnReload').addEventListener('click', aplicarActualizacion);
    $('btnUpdateX').addEventListener('click', () => $('updateBar').classList.add('hidden'));

    await migrarSesiones();

    const fichas = await DB.all('fichas');
    for (const f of fichas) {
      const p = P(f.codigo || f.id);
      if (p) {
        const antes = JSON.stringify(f);
        migrarFicha(f, p);
        if (JSON.stringify(f) !== antes) await DB.put('fichas', f);
      }
      S.fichas.set(f.id, f);
    }

    const validos = new Set(fichas.map((f) => f.id));
    for (const m of await DB.all('pmeta')) if (!validos.has(m.fichaId)) await Fotos.remove(m.id);

    await Drive.init().catch(() => {});
    renderTodo(); renderDrive();
    netState();
    estadoApp();
    cablear();
    document.body.dataset.listo = '1';
    console.log(`Inspección GNSS lista · ${PUNTOS.length} puntos · ${planificadas()} fichas planificadas · ${fichas.length} guardadas`);
  }

  function netState() {
    const n = $('net');
    n.textContent = navigator.onLine ? 'en línea' : 'sin conexión';
    n.classList.toggle('off', !navigator.onLine);
  }

  async function estadoApp() {
    pintarVersion();
    let txt = '';
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        txt = `Datos de la app en este teléfono: ${(e.usage / 1048576).toFixed(1)} MB.`;
      }
    } catch (e) { /* sin datos */ }
    const p = await Fotos.peso();
    $('storageInfo').textContent = (txt ? txt + ' ' : '') + `Fotografías: ${p.n} (${(p.bytes / 1048576).toFixed(1)} MB).`;
    $('offlineState').textContent = navigator.onLine
      ? 'La app está guardada en este teléfono: abre y funciona sin conexión.'
      : 'Sin conexión: puedes seguir levantando fichas; la subida a Drive se completa cuando vuelva el internet.';
  }

  /* ---------------- eventos ---------------- */
  function cablear() {
    document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
      const t = b.dataset.tab;
      if (t === 'drive') renderDrive();
      if (t === 'respaldo') estadoApp();
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
      const b = e.target.closest('[data-id]');
      if (b) seleccionar(b.dataset.id);
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#combo')) $('comboPanel').classList.add('hidden');
    });

    $('btnIr').addEventListener('click', () => S.sel && abrirNav(S.sel.codigo));
    document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => navegar(b.dataset.nav, S.navCod)));
    document.querySelectorAll('[data-nav-close]').forEach((b) => b.addEventListener('click', cerrarNav));
    $('btnLevantar').addEventListener('click', () => S.sel && abrirFicha(S.sel.id));
    $('btnVerFicha').addEventListener('click', () => S.sel && verDetalle(S.sel.id));
    $('btnBorrarFicha').addEventListener('click', () => S.sel && borrarFicha(S.sel.id));

    $('btnFichaBack').addEventListener('click', async () => {
      await limpiarBorrador();
      mostrar('puntos'); renderTodo();
    });
    $('btnGuardar').addEventListener('click', () => guardarFicha());
    $('f-inicio').addEventListener('change', () => { leerForm(); });
    $('f-fin').addEventListener('change', () => { leerForm(); });
    document.querySelectorAll('[data-ahora]').forEach((b) => b.addEventListener('click', () => ponerAhora(b.dataset.ahora)));
    $('btnVerCroquis').addEventListener('click', () => S.editor && verImagen(urlCroquis(S.editor.codigo)));

    document.querySelectorAll('[data-foto]').forEach((b) => b.addEventListener('click', () => {
      const tipo = b.dataset.foto, src = b.dataset.src;
      const suf = tipo === 'punto' ? 'Punto' : tipo === 'placa' ? 'Placa' : 'Extra';
      const input = $(src === 'cam' ? 'cam' + suf : 'gal' + suf);
      input.value = '';
      input.click();
    }));
    [['camPunto', 'punto'], ['galPunto', 'punto'], ['camPlaca', 'placa'], ['galPlaca', 'placa'],
     ['camExtra', 'extra'], ['galExtra', 'extra']].forEach(([id, tipo]) => {
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
    $('btnDetPdf').addEventListener('click', () => S.sel && descargarPDF(S.sel.id, false));
    $('d-pdf').addEventListener('click', () => S.sel && descargarPDF(S.sel.id, false));
    $('d-share').addEventListener('click', () => S.sel && descargarPDF(S.sel.id, true));
    $('d-geo').addEventListener('click', () => S.sel && exportarGeo(S.sel.codigo));
    $('d-zip').addEventListener('click', () => S.sel && exportarZip(S.sel.id));
    $('d-edit').addEventListener('click', () => S.sel && abrirFicha(S.sel.id));
    $('d-del').addEventListener('click', () => S.sel && borrarFicha(S.sel.id));
    $('d-subir').addEventListener('click', () => S.sel && subirUna(S.sel.id, false));
    $('d-miUbicacion').addEventListener('click', miUbicacion);
    $('d-ir').addEventListener('click', () => S.sel && abrirNav(S.sel.codigo));

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

    /* Abrir la carpeta: usa el enlace guardado; si no hay, consulta el script y la abre. */
    $('btnAbrirCarpeta').addEventListener('click', async () => {
      let url = await DB.kvGet('drive.raizUrl', '');
      if (!url && Drive.configurado()) {
        busy(true, 'Consultando la carpeta en Drive…');
        try {
          const r = await Drive.probar();
          url = r.raizUrl || '';
          if (url) await DB.kvSet('drive.raizUrl', url);
        } catch (e) { toast(e.message, 'err'); }
        finally { busy(false); }
      }
      if (!url) { toast('Primero pulsa "Guardar y probar" para conectar con el script.', 'err'); return; }
      window.open(url, '_blank', 'noopener');
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
    $('btnBuscar').addEventListener('click', buscarActualizacion);
    $('btnBorrarTodo').addEventListener('click', async () => {
      if (!confirm('Se borrarán TODAS las fichas y fotografías de este teléfono. ¿Continuar?')) return;
      await DB.clear('fichas'); await DB.clear('photos'); await DB.clear('pmeta'); await DB.clear('croquis');
      S.fichas.clear(); S.sel = null;
      $('panelPunto').classList.add('hidden');
      $('btnIr').disabled = true; $('btnLevantar').disabled = true;
      $('btnLevantar').querySelector('span:last-child').firstChild.textContent = 'LEVANTAR FICHA';
      $('comboVal').textContent = 'Elegir un punto…';
      renderTodo(); renderDrive(); estadoApp();
      toast('Datos borrados.', 'ok');
    });

    const alVolver = () => { netState(); };
    window.addEventListener('online', alVolver);
    window.addEventListener('offline', netState);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') alVolver(); });
  }

  async function limpiarBorrador() {
    const f = S.editor;
    if (!f) return;
    if (miFicha(f.id)) return;   // ya existía: las fotos pertenecen a la ficha guardada
    for (const m of await Fotos.byFicha(f.id)) await Fotos.remove(m.id);
    S.fotosEditor = [];
  }

  async function borrarFicha(id) {
    const f = miFicha(id);
    const nombre = f ? `${f.codigo} (${TIPOS[f.tipo || 'ida']})` : id;
    if (!confirm(`¿Borrar la ficha ${nombre} y sus fotografías?`)) return;
    await Fotos.removeDeFicha(id);
    await DB.del('fichas', id);
    S.fichas.delete(id);
    if (S.editor && S.editor.id === id) S.editor = null;
    mostrar('puntos');
    renderTodo(); renderDrive();
    toast('Ficha borrada.', 'ok');
  }

  return { init, renderTodo, verDetalle, abrirFicha };
})();

document.addEventListener('DOMContentLoaded', () => {
  App.init().catch((e) => {
    console.error(e);
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'Error al iniciar: ' + e.message; t.classList.remove('hidden'); }
  });
});
