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
    const pr = PR();
    const lista = (pr && pr.ruta[tipo]) || [];
    const i = lista.indexOf(codigo);
    return i < 0 ? null : i + 1;
  };

  /* todas las fichas posibles: primero las planificadas (en orden de recorrido) y
     después las de los puntos que no están en la ruta, para no dejar ninguno fuera */
  function sesiones() {
    const out = [];
    const plan = (PR() && PR().ruta) || { ida: [], vuelta: [] };
    if (!PR()) return out;
    /* Primer orden: una sola entrada por base. La ficha se crea para el día que se levanta. */
    (plan.base || []).forEach((codigo) => {
      out.push({ id: idBase(codigo), codigo, tipo: 'base', rol: 'base', n: null, plan: true });
    });
    ['ida', 'vuelta'].forEach((tipo) => {
      (plan[tipo] || []).forEach((codigo, i) => out.push({ id: idFicha(codigo, tipo), codigo, tipo, n: i + 1, plan: true }));
    });
    /* punto adicional: una sola medición */
    (plan.unica || []).forEach((codigo) => {
      out.push({ id: idFicha(codigo, 'unica'), codigo, tipo: 'unica', n: null, plan: true, rol: 'unica' });
    });
    const enRuta = new Set([].concat(plan.ida || [], plan.vuelta || [], plan.base || [], plan.unica || []));
    PR().puntos.forEach((p) => {
      if (enRuta.has(p.c)) return;
      ['ida', 'vuelta'].forEach((tipo) => out.push({ id: idFicha(p.c, tipo), codigo: p.c, tipo, n: null, plan: false }));
    });
    return out;
  }
  /* Las bases se listan una sola vez; la ficha se crea para el día en que se levanta y su
     id lleva la fecha, igual que la carpeta en Drive: RG-50-01-BASE-2026-11-01. */
  const idBase = (codigo, fecha) => `${codigo}-BASE-${fecha || hoy()}`;
  const fichasBase = (codigo) => fichasProyecto()
    .filter((f) => f.tipo === 'base' && f.codigo === codigo)
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const baseDeHoy = (codigo) => {
    const f = fichasBase(codigo).find((x) => x.fecha === hoy());
    return f || null;
  };

  const planificadas = () => {
    const pr = PR();
    if (!pr) return 0;
    return (pr.ruta.ida || []).length + (pr.ruta.vuelta || []).length + (pr.ruta.unica || []).length;
  };

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
    proyecto: null,    // 'pedro' | 'rumi' (se elige al abrir la app)
    ajustes: { operadores: [], ultimoOperador: '', ultimoReceptor: '', autoSubir: true, borrarOrig: false }
  };

  /* proyecto activo (null hasta que se elige en la pantalla de inicio) */
  const PR = () => (S.proyecto && typeof PROYECTOS !== 'undefined' ? PROYECTOS[S.proyecto] : null);
  const P = (codigo) => {
    const pr = PR();
    return pr ? (pr.puntos.find((p) => p.c === codigo) || null) : null;
  };
  /* solo las fichas del levantamiento abierto */
  const fichasProyecto = () => Array.from(S.fichas.values()).filter((f) => (f.proyecto || 'pedro') === S.proyecto);
  const miFicha = (id) => {
    const f = S.fichas.get(id);
    return f && (f.proyecto || 'pedro') === S.proyecto ? f : null;
  };

  /* el enlace a la carpeta de Drive es distinto para cada levantamiento */
  const claveRaizUrl = () => 'drive.raizUrl.' + (S.proyecto || 'pedro');

  /* ---------------- levantamiento activo ---------------- */
  function elegirProyecto(id) {
    if (typeof PROYECTOS === 'undefined' || !PROYECTOS[id]) return;
    S.proyecto = id;
    PROYECTO_ACTIVO = PROYECTOS[id].datos;
    S.sel = null;
    const velo = $('v-proyecto');
    if (velo) velo.classList.add('hidden');
    document.body.classList.remove('sin-proyecto');
    document.querySelectorAll('[data-proy-nombre]').forEach((el) => {
      el.textContent = PROYECTOS[id].corto;
    });
    if ($('topSub')) $('topSub').textContent = PROYECTOS[id].corto;
    DB.kvSet('proyecto', id).catch(() => {});
    renderTodo();
    renderDrive();
    mostrar('puntos');
    toast(PROYECTOS[id].nombre, 'ok');
  }

  function pedirProyecto(ultimo) {
    const velo = $('v-proyecto');
    if (!velo) return;
    const lista = $('proyectoLista');
    if (lista) {
      lista.innerHTML = Object.values(PROYECTOS).map((p) => `
        <button type="button" class="proy" data-proy="${p.id}">
          <b>${esc(p.nombre)}${p.id === ultimo ? ' <i class="ultima">última vez</i>' : ''}</b>
          <span>${esc(p.detalle)}</span>
        </button>`).join('');
    }
    velo.classList.remove('hidden');
    document.body.classList.add('sin-proyecto');
  }

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
  /* ---------------- avisos y confirmaciones ---------------- */
  let avisoResolver = null;

  /* avisar({titulo, texto|html, botones:[{txt, clase, valor}]}) -> Promise<valor> */
  function avisar(o) {
    const velo = $('v-aviso');
    if (!velo) return Promise.resolve('');
    $('avisoTitulo').textContent = o.titulo || 'Aviso';
    $('avisoTexto').innerHTML = o.html || '<p>' + esc(o.texto || '') + '</p>';
    const caja = $('avisoBotones');
    caja.innerHTML = '';
    const botones = o.botones || [{ txt: 'Entendido', clase: 'primary', valor: 'ok' }];
    return new Promise((resolver) => {
      avisoResolver = resolver;
      botones.forEach((b) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'btn ' + (b.clase || '');
        el.textContent = b.txt;
        el.addEventListener('click', () => cerrarAviso(b.valor));
        caja.appendChild(el);
      });
      velo.classList.remove('hidden');
      const prim = caja.querySelector('.btn.primary') || caja.lastElementChild;
      if (prim && prim.focus) prim.focus();
    });
  }

  function cerrarAviso(valor) {
    const velo = $('v-aviso');
    if (velo) velo.classList.add('hidden');
    const r = avisoResolver;
    avisoResolver = null;
    if (r) r(valor == null ? '' : valor);
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
  const badge = (tipo) => `<span class="tipo ${tipo}">${TIPOS[tipo] || tipo}</span>`;

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
      const ok = s.rol === 'base' ? !!baseDeHoy(s.codigo) : !!miFicha(s.id);
      const fch = miFicha(s.id);
      const falta = fch ? FALTANTES.get(s.id) : null;
      const estado = !fch ? ''
        : fch.drive && fch.drive.estado === 'conflicto' ? '<span class="chip-conf">conflicto</span>'
          : fch.drive && fch.drive.estado === 'subida' ? ''
            : (falta && falta.length ? '<span class="chip-inc">incompleta</span>' : '');
      html += `<button type="button" class="combo-item${ok ? ' saved' : ''}${S.sel && S.sel.id === s.id ? ' sel' : ''}" data-id="${esc(s.id)}" role="option">
        <span class="ck">✓</span>
        <span class="num">${s.n ? s.n : '–'}</span>
        <span class="txt"><b>${esc(s.codigo)}</b> ${badge(s.tipo, s.dia)}${estado}<span class="s">${esc(p.parroquia || '')} · ${s.rol === 'base' ? 'base de primer orden' : esc(p.mat || '')}</span></span>
      </button>`;
    }
    $('comboList').innerHTML = html || '<p class="hint" style="padding:14px">Sin resultados.</p>';
  }

  function renderTodo() {
    renderCombo();
    if (S.sel) { pintarComboVal(); pintarPanelPunto(); }
    /* recalcula en segundo plano solo lo que falta por calcular, y repinta los chips */
    const pendientes = fichasProyecto().filter((f) => !FALTANTES.has(f.id)).map((f) => f.id);
    if (pendientes.length) {
      Promise.all(pendientes.map((id) => faltantesFicha(miFicha(id)).then((falta) => FALTANTES.set(id, falta))))
        .then(() => renderCombo()).catch(() => {});
    }
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
    const tiene = s.rol === 'base' ? !!baseDeHoy(s.codigo) : !!miFicha(id);
    $('btnLevantar').querySelector('span:last-child').firstChild.textContent = tiene ? 'EDITAR FICHA' : 'LEVANTAR FICHA';
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
    const esBase = s.rol === 'base';
    const f = esBase ? baseDeHoy(s.codigo) : miFicha(s.id);
    const jornadas = esBase ? fichasBase(s.codigo).length : 0;
    const otraTipo = s.tipo === 'ida' ? 'vuelta' : 'ida';
    const otra = miFicha(idFicha(s.codigo, otraTipo));
    const totalTipo = ((PR() && PR().ruta[s.tipo]) || []).length;
    $('panelPunto').classList.remove('hidden');
    $('pp-nombre').innerHTML = esc(p.c) + ' ' + badge(s.tipo, s.dia);
    const detalleRuta = esBase
      ? ` · base de primer orden · ${jornadas} jornada(s) registrada(s)`
      : s.rol === 'unica' ? ' · medición única'
        : s.n ? ` · ${TIPOS[s.tipo]} ${s.n} de ${totalTipo}` : ' · sin ruta asignada';
    const ordenTxt = typeof p.orden === 'number' ? `${p.orden}° orden` : (p.orden || '');
  $('pp-sub').textContent = `${p.parroquia} · ${ordenTxt} · ${p.mat}` + detalleRuta;
    $('pp-datos').innerHTML = [
      ['ESTE (X)', p.e.toLocaleString('es-EC')],
      ['NORTE (Y)', p.n.toLocaleString('es-EC')],
      ['ZONA / DATUM', `UTM ${PROY().zona}${PROY().hemisferio} · WGS84`],
      ['SECTOR / SITIO', p.sector],
      [esBase ? 'HOY' : TIPOS[s.tipo], f ? (f.drive && f.drive.estado === 'subida' ? 'Guardada · en Drive' : 'Guardada en el teléfono') : 'Pendiente de levantar'],
      esBase ? ['ÚLTIMA', jornadas ? `Del ${PDF.fmtFecha(fichasBase(s.codigo)[0].fecha)}` : '—']
        : [TIPOS[otraTipo], otra ? 'Ya levantada' : 'Pendiente'],
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
      id: ses.id, codigo: p.c, tipo, dia, sesion: ses.n || null, proyecto: S.proyecto,
      observaciones: '',
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
    let s = sesiones().find((x) => x.id === id);
    if (!s) {
      /* ficha de base creada para un día concreto: RG-50-01-BASE-2026-11-01 */
      const m = /^(.+)-BASE-(\d{4}-\d{2}-\d{2})$/.exec(String(id));
      if (m && P(m[1])) s = { id, codigo: m[1], tipo: 'base', rol: 'base', n: null };
    }
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

  /* Al levantar una base se pregunta si es para hoy; si ya existe la de hoy, se edita. */
  async function levantarBase(codigo) {
    const ya = baseDeHoy(codigo);
    if (ya) { abrirFicha(ya.id); return; }
    const hoyTxt = hoy().split('-').reverse().join('/');
    if (!confirm(`¿Crear una ficha de base para hoy (${hoyTxt})?\n\nBase ${codigo} · primer orden · 8 h`)) return;
    await abrirFicha(idBase(codigo, hoy()));
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
    $('f-zona').value = `UTM ${PROY().zona}${PROY().hemisferio} · WGS84`;
    const p = P(f.codigo);
    $('f-trabajos').textContent = p ? p.trabajos : '';
    $('f-receptor').innerHTML = '<option value="">—</option>' + RECEPTORES.map((r) => `<option${r === f.receptor ? ' selected' : ''}>${esc(r)}</option>`).join('');
    $('f-altura').value = f.alturaAntena || '';
    $('f-inicio').value = f.inicio || '';
    $('f-fin').value = f.fin || '';
    $('f-operador').value = f.operador || '';
    if ($('f-obs')) $('f-obs').value = f.observaciones || '';
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
    if ($('f-obs')) f.observaciones = $('f-obs').value.trim();
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
    /* la ficha se puede guardar a medias: solo se avisa qué falta para poder subirla */
    const falta = await faltantesFicha(f);
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

    S.sucio = false;
    if (falta.length) FALTANTES.set(f.id, falta); else FALTANTES.delete(f.id);
    renderTodo();
    toast(`Ficha ${TIPOS[f.tipo]} guardada. ✓`, 'ok');
    mostrar('puntos');
    if (!falta.length && S.ajustes.autoSubir && Drive.configurado()) subirUna(f.id, true);

    if (falta.length) {
      await avisar({
        titulo: 'Faltan datos obligatorios',
        html: '<p>La ficha se guardó, pero todavía no se subirá a Drive. Falta:</p>' + textoFaltantes(falta) +
          '<p>Se subirá a Drive cuando complete esos datos.</p>',
        botones: [{ txt: 'Entendido', clase: 'primary', valor: 'ok' }]
      });
    }
  }

  /* ---------------- fotografías ---------------- */
  const NOMBRE_TIPO = { punto: 'medicion', placa: 'placa', extra: 'extra' };

  async function agregarFotos(tipo, files) {
    if (!files || !files.length) return;
    const etiqueta = tipo === 'extra' ? $('f-extra-nombre').value.trim() : '';
    busy(true, 'Procesando fotografías…');
    try {
      /* el número sigue al mayor existente: al borrar una foto no se reusa un número
         (si se reusara, al subir se sobrescribiría el archivo de otra foto) */
      const usados = S.fotosEditor.filter((m) => m.tipo === tipo).map((m) => m.orden || 0);
      let orden = usados.length ? Math.max.apply(null, usados) : 0;
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
      FALTANTES.delete(S.editor.id);       // las fotos cuentan para los obligatorios
      renderTodo();
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
    FALTANTES.delete(S.editor.id);
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
    const totalTipo = ((PR() && PR().ruta[f.tipo]) || []).length;
    $('d-datos').innerHTML = [
      ['TIPO', `${TIPOS[f.tipo || 'ida']}${f.sesion ? ` (${f.sesion} de ${totalTipo})` : ''}`],
      ['ESTE (X)', Number(f.este).toLocaleString('es-EC')],
      ['NORTE (Y)', Number(f.norte).toLocaleString('es-EC')],
      ['ZONA / DATUM', `UTM ${PROY().zona}${PROY().hemisferio} · WGS84`],
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
    /* se muestran las miniaturas que ya están guardadas; la foto completa se abre al tocar */
    const fotosHtml = metas.map((m) => {
      const nom = m.tipo === 'extra' ? (m.etiqueta || 'Adicional')
        : m.tipo === 'placa' ? 'Placa' : 'Medición';
      return `<figure data-foto-id="${m.id}"><img src="${m.thumb}" alt="" loading="lazy"><figcaption>${esc(nom)} ${m.orden || ''}</figcaption></figure>`;
    });
    $('d-fotos').innerHTML = fotosHtml.join('') || '<p class="hint">Sin fotografías.</p>';

    /* observaciones: solo se muestra el bloque si hay algo escrito */
    const obs = String(f.observaciones || '').trim();
    if ($('d-obsPanel')) {
      $('d-obsPanel').classList.toggle('hidden', !obs);
      if ($('d-obs')) $('d-obs').textContent = obs;
    }
    $('d-fotosPanel').classList.toggle('hidden', !metas.length);

    const dr = f.drive || { estado: 'pend' };
    const faltaAqui = FALTANTES.get(f.id) || [];
    let estadoDrive;
    if (faltaAqui.length) {
      estadoDrive = '<b class="warn">No se puede subir todavía.</b> Falta:<ul class="falta-lista">' +
        faltaAqui.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>' +
        '<span class="tenue">La ficha se guarda igual; se subirá cuando esté completa.</span>';
    } else if (dr.estado === 'conflicto') {
      const aut = dr.autor || {};
      estadoDrive = '<b class="warn">Ya hay una ficha de este punto en Drive.</b> ' +
        `Subida el ${esc((dr.existente && dr.existente.actualizado) || 'fecha desconocida')}` +
        (aut.operador ? ` por ${esc(aut.operador)}` : '') +
        '.<br>Pulsa "Subir esta ficha a Drive" y elige si reemplazarla o conservar ambas.';
    } else if (dr.estado === 'subida') {
      estadoDrive = `Subida el ${new Date(dr.fecha).toLocaleString('es-EC')}.<br>Carpeta: <code>${esc(dr.ruta || '')}</code>`;
    } else if (dr.estado === 'error') {
      estadoDrive = `La última subida falló: ${esc(dr.error || '')}`;
    } else {
      estadoDrive = 'Todavía no se ha subido a Drive.';
    }
    $('d-drive').innerHTML = estadoDrive;
    if (!FALTANTES.has(f.id)) {
      faltantesFicha(f).then((falta) => {
        FALTANTES.set(f.id, falta);
        if (falta.length && S.sel && S.sel.id === f.id) verDetalle(f.id);
      }).catch(() => {});
    }

    S.miPunto = null;
    $('d-gps').textContent = 'Pulsa "¿A qué distancia estoy?" para medir.';
  }

  /* El detalle ya no dibuja un mapa: el croquis y "Ir al punto" alcanzan y así abre al instante. */

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

  /* ---- datos obligatorios para que la ficha se suba a Drive ---- */
  const OBLIGATORIOS = [
    ['receptor', 'tipo de antena'],
    ['alturaAntena', 'altura de la antena'],
    ['inicio', 'fecha y hora de inicio'],
    ['fin', 'fecha y hora de fin'],
    ['operador', 'operador']
  ];

  async function faltantesFicha(f) {
    const falta = [];
    OBLIGATORIOS.forEach(([k, txt]) => {
      if (k === 'alturaAntena') {
        if (!(Number(f[k]) > 0)) falta.push(txt);
      } else if (!String(f[k] == null ? '' : f[k]).trim()) {
        falta.push(txt);
      }
    });
    if (f.inicio && f.fin) {
      const d = duracionMin(f);
      if (d != null && d <= 0) falta.push('fin posterior al inicio');
    }
    let fotos = [];
    try { fotos = await Fotos.byFicha(f.id); } catch (e) { fotos = []; }
    if (!fotos.some((m) => m.tipo === 'punto')) falta.push('fotografía de la medición');
    if (!fotos.some((m) => m.tipo === 'placa')) falta.push('fotografía de la placa');
    return falta;
  }

  /* cache para pintar los chips de la lista sin consultar la base en cada fila */
  const FALTANTES = new Map();

  const textoFaltantes = (falta) => '<ul>' + falta.map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';

  async function subirUna(id, automatico) {
    const f = miFicha(id);
    if (!f) { toast('Guarda la ficha antes de subirla.', 'err'); return; }
    if (!Drive.configurado()) { toast('Configura la URL y la clave del script en la pestaña Drive.', 'err'); return; }
    const falta = await faltantesFicha(f);
    if (falta.length) {
      FALTANTES.set(f.id, falta);
      renderTodo();
      toast('Faltan datos obligatorios: la ficha no se sube todavía.', 'err');
      if (!automatico) {
        await avisar({
          titulo: 'Faltan datos obligatorios',
          html: '<p>Esta ficha todavía no se puede subir a Drive. Falta:</p>' + textoFaltantes(falta) +
            '<p class="tenue">Cuando completes esos datos, se subirá sola (si la subida automática está activa).</p>',
          botones: [{ txt: 'Entendido', clase: 'primary', valor: 'ok' }]
        });
      }
      return;
    }
    FALTANTES.delete(f.id);

    /* ¿ya hay una ficha de este punto en Drive? (nunca se borra nada sin preguntar) */
    let opc = { siExiste: '', token: '' };
    try {
      busy(true, 'Revisando Drive…');
      const info = await Drive.revisarExistente(f, PR().raizDrive);
      if (info && info.existe) {
        const aut = info.autor || {};
        const cuando = (info.existente && info.existente.actualizado) || aut.fecha || 'fecha desconocida';
        if (automatico) {
          f.drive = { estado: 'conflicto', fecha: Date.now(), existente: info.existente, autor: aut };
          await DB.put('fichas', f); S.fichas.set(id, f);
          renderTodo(); renderDrive();
          toast('Ya hay una ficha de este punto en Drive. Ábrela y decide si reemplazarla.', 'err');
          return;
        }
        busy(false);
        const mio = f.operador ? `La tuya es de <span class="dato">${esc(f.operador)}</span>.` : '';
        const otro = aut.operador
          ? (f.operador && aut.operador !== f.operador
            ? `<p class="alerta">La que ya está en Drive la subió otra persona: ${esc(aut.operador)}.</p>`
            : `<p>La subió <span class="dato">${esc(aut.operador)}</span>.</p>`)
          : '<p class="tenue">No se pudo leer quién la subió.</p>';
        const r = await avisar({
          titulo: 'Esta ficha ya está en Drive',
          html: `<p>Ya existe <span class="dato">${esc((info.existente && info.existente.nombre) || '')}</span> ` +
            `subida el <span class="dato">${esc(cuando)}</span>.</p>` + otro + '<p>' + mio + '</p>' +
            '<p class="tenue">Si reemplazas, la anterior se guarda en la subcarpeta <b>_anteriores</b>: no se borra.</p>',
          botones: [
            { txt: 'Cancelar', clase: '', valor: 'cancelar' },
            { txt: 'Conservar ambas (COPIA)', clase: '', valor: 'copia' },
            { txt: 'Reemplazar', clase: 'primary', valor: 'reemplazar' }
          ]
        });
        if (r !== 'copia' && r !== 'reemplazar') return;
        if (r === 'reemplazar') opc = { siExiste: 'reemplazar', token: '' };
        else opc = { siExiste: 'copia', token: '_COPIA' + (Number(info.copias || 0) + 1) };
      }
    } catch (e) {
      busy(false);
      if (e && e.code === 'op') {
        /* el script instalado es anterior a la comprobación de duplicados */
        toast('El script de Drive es antiguo: esta ficha se sube sin comprobar duplicados.', 'err');
        opc = { siExiste: '', token: '' };
      } else {
        toast('No se pudo revisar Drive: ' + e.message, 'err');
        return;
      }
    }

    try {
      busy(true, 'Preparando la subida…');
      const { blob } = await pdfDe(id);
      const fotos = await fotosParaDrive(id);
      const r = await Drive.subirFicha(f, blob, fotos, (t) => busy(true, t), PR().raizDrive, opc);
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
    let ok = 0, err = 0, incompletas = 0, conflictos = 0;
    for (const f of lista) {
      const falta = await faltantesFicha(f);
      if (falta.length) { incompletas++; FALTANTES.set(f.id, falta); continue; }
      busy(true, `Subiendo ${f.id} (${ok + err + 1} de ${lista.length})…`);
      let info = null;
      try {
        info = await Drive.revisarExistente(f, PR().raizDrive);
      } catch (eRev) {
        if (!eRev || eRev.code !== 'op') throw eRev;   // error real: se informa abajo
        info = null;                                   // script antiguo: se sube igual
      }
      try {
        if (info && info.existe) {
          /* la subida por lotes no decide sola: se marca y se resuelve a mano */
          f.drive = { estado: 'conflicto', fecha: Date.now(), existente: info.existente, autor: info.autor };
          conflictos++;
          await DB.put('fichas', f);
          S.fichas.set(f.id, f);
          renderDrive(); renderTodo();
          continue;
        }
        const { blob } = await pdfDe(f.id);
        const fotos = await fotosParaDrive(f.id);
        const r = await Drive.subirFicha(f, blob, fotos, null, PR().raizDrive);
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
    renderTodo();
    toast(`Subida terminada: ${ok} correcta(s)` + (err ? `, ${err} con error` : '') +
      (incompletas ? `, ${incompletas} sin subir por datos incompletos` : '') +
      (conflictos ? `, ${conflictos} ya existían en Drive` : '') + '.',
    (err || incompletas || conflictos) ? 'err' : 'ok');
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

    const todas = fichasProyecto();
    const total = todas.length;
    const subidas = todas.filter((f) => f.drive && f.drive.estado === 'subida').length;
    const errores = todas.filter((f) => f.drive && f.drive.estado === 'error').length;
    $('driveResumen').innerHTML = `Fichas guardadas: <b>${total}</b> · en Drive: <b>${subidas}</b> · pendientes: <b>${total - subidas - errores}</b>` +
      (errores ? ` · con error: <b class="err">${errores}</b>` : '');
    $('autoSubir').checked = !!S.ajustes.autoSubir;
    $('borrarOrig').checked = !!S.ajustes.borrarOrig;

    $('driveCola').innerHTML = fichasProyecto()
      .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')))
      .map((f) => {
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
      'operador', 'fotos_medicion', 'fotos_placa', 'fotos_extra', 'croquis', 'drive', 'observaciones'];
    /* las bases llevan una fila por jornada registrada */
    const trabajo = [];
    sesiones().forEach((s) => {
      if (s.rol === 'base') {
        const lista = fichasBase(s.codigo);
        if (!lista.length) trabajo.push({ s, f: null });
        else lista.forEach((f) => trabajo.push({ s, f }));
      } else trabajo.push({ s, f: miFicha(s.id) });
    });
    const filas = trabajo.map(({ s, f }) => {
      const p = P(s.codigo) || {};
      const c = por[s.id] || { punto: 0, placa: 0, extra: 0 };
      const d = f || {};
      const idFila = f ? f.id : s.id;
      const jornada = f && f.fecha ? f.fecha : (s.dia || '');
      return [idFila, s.codigo, s.tipo, jornada, (d.grupo || ''), s.n || '', p.parroquia, d.sector || p.sector, p.orden, p.e, p.n,
        d.materializacion || p.mat, d.receptor || '', d.alturaAntena || '', d.inicio || '', d.fin || '',
        d.duracionMin || '', d.metodo || METODO, d.mascara || MASCARA, d.intervalo || INTERVALO,
        d.operador || '', c.punto, c.placa, c.extra,
        f ? 'incluido' : '—',
        (d.drive && d.drive.estado) || (f ? 'pendiente' : 'sin ficha'),
        d.observaciones || ''];
    });
    const csv = '\ufeff' + [cols.join(';')].concat(filas.map((r) => r.map(csvQ).join(';'))).join('\r\n');
    bajarBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `avance_red_geodesica_${hoy()}.csv`);
  }

  function geojsonPuntos() {
    const feats = (PR() ? PR().puntos : []).map((p) => {
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
          obs_ida: ida ? ida.observaciones || '' : '', obs_vuelta: vuelta ? vuelta.observaciones || '' : '',
          receptor_ida: ida ? ida.receptor || '' : '', receptor_vuelta: vuelta ? vuelta.receptor || '' : '',
          dur_ida: ida ? ida.duracionMin || '' : '', dur_vuelta: vuelta ? vuelta.duracionMin || '' : '',
          base_jornadas: fichasBase(p.c).length,
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

  /* ---------- copia completa (PDF + fotos + datos) ---------- */
  const etiquetaDe = (f) => {
    const tipo = String(f.tipo || 'ida').toLowerCase();
    if (tipo === 'base') return 'BASE';
    if (tipo === 'unica') return 'UNICA';
    return tipo === 'vuelta' ? 'VUELTA' : 'IDA';
  };
  const fechaDe = (f) => String(f.fecha || hoy()).slice(0, 10);
  const carpetaDe = (f) => {
    const fecha = fechaDe(f);
    const [aa, mm, dd] = fecha.split('-');
    return `${fecha.replace(/-/g, '_')}/${etiquetaDe(f)}_${dd}_${mm}_${aa}_${f.codigo}`;
  };

  const LEEME = (titulo) => [
    'Copia de las fichas de campo · Red Geodésica Pedro Moncayo',
    'Generada: ' + new Date().toLocaleString('es-EC') + (titulo ? ' · ' + titulo : ''),
    '',
    'Cada carpeta tiene el mismo nombre que en Google Drive:',
    '  <año_mes_día>/<TIPO>_<dd_mm_aaaa>_<CÓDIGO>/',
    '    <CÓDIGO>_<TIPO>.pdf          ficha de una hoja',
    '    <CÓDIGO>_<TIPO>_medicion_N.jpg',
    '    <CÓDIGO>_<TIPO>_placa_N.jpg',
    '    <CÓDIGO>_<TIPO>_<etiqueta>_N.jpg',
    '    datos_<CÓDIGO>_<TIPO>.json    todos los datos de la ficha',
    '',
    'indice_fotos.csv lista cada fotografía con su ficha y su archivo.',
    'La app no incluye los croquis aquí: van dentro de cada PDF.'
  ].join('\n');

  async function paqueteZip(fichas, etiquetaArchivo) {
    const entradas = [];
    const indice = [['id', 'codigo', 'tipo', 'fecha', 'foto', 'etiqueta', 'orden', 'archivo', 'ancho', 'alto']];
    for (const f of fichas) {
      if (!f) continue;
      const etq = etiquetaDe(f);
      const carpeta = carpetaDe(f);
      const { blob: pdf } = await pdfDe(f.id);
      entradas.push({ name: `${carpeta}/${f.codigo}_${etq}.pdf`, blob: pdf });
      const datos = JSON.stringify({ app: 'inspeccion-gnss', version: CONFIG.version, exportado: new Date().toISOString(), ficha: f }, null, 2);
      entradas.push({ name: `${carpeta}/datos_${f.codigo}_${etq}.json`, blob: new Blob([datos], { type: 'application/json' }) });
      for (const m of await Fotos.byFicha(f.id)) {
        const blob = await Fotos.getBlob(m.id);
        if (!blob) continue;
        const nombre = `${carpeta}/${f.codigo}_${etq}_${NOMBRE_TIPO[m.tipo] || m.tipo}_${m.orden}.jpg`;
        entradas.push({ name: nombre, blob });
        indice.push([f.id, f.codigo, f.tipo, fechaDe(f), m.tipo, m.etiqueta || '', m.orden, nombre, m.w, m.h]);
      }
    }
    if (!entradas.length) { toast('No hay fichas guardadas para copiar.', 'err'); return false; }
    const csv = '\ufeff' + indice.map((r) => r.map(csvQ).join(';')).join('\r\n');
    entradas.push({ name: 'indice_fotos.csv', blob: new Blob([csv], { type: 'text/csv' }) });
    entradas.push({ name: 'LEEME.txt', blob: new Blob([LEEME(etiquetaArchivo)], { type: 'text/plain;charset=utf-8' }) });
    const zip = await Zip.build(entradas);
    bajarBlob(zip, `copia_fichas_${etiquetaArchivo.replace(/[^\w.-]+/g, '_')}_${hoy()}.zip`);
    return true;
  }

  async function exportarZip(id) {
    busy(true, 'Empaquetando la copia…');
    try {
      const fichas = id ? [miFicha(id)] : fichasProyecto();
      const hecho = await paqueteZip(fichas, id ? id : 'todas');
      if (hecho) toast('Copia generada.', 'ok');
    } catch (e) {
      toast('No se pudo generar la copia: ' + e.message, 'err');
    } finally { busy(false); }
  }

  /* copia de un día concreto (por la fecha de las fichas) */
  async function exportarDia(fecha) {
    const lista = fichasProyecto().filter((f) => fechaDe(f) === fecha);
    if (!lista.length) { toast('No hay fichas de ese día.', 'err'); return; }
    busy(true, `Empaquetando ${lista.length} ficha(s)…`);
    try {
      const hecho = await paqueteZip(lista, fecha.replace(/-/g, '_'));
      if (hecho) toast(`Copia del ${fecha.split('-').reverse().join('/')} generada.`, 'ok');
    } catch (e) {
      toast('No se pudo generar la copia: ' + e.message, 'err');
    } finally { busy(false); }
  }

  async function exportarRespaldo() {
    const lista = fichasProyecto().map((f) => {
      const c = Object.assign({}, f);
      delete c.croquis;
      return c;
    });
    const datos = {
      app: 'inspeccion-gnss', version: CONFIG.version, fecha: new Date().toISOString(),
      proyecto: PROYECTO, ajustes: S.ajustes, fichas: lista
    };
    bajarBlob(new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }), `respaldo_red_geodesica_${hoy()}.json`);
    $('backupInfo').textContent = `Respaldo generado con ${lista.length} ficha(s) de ${PR().corto}. Incluye los datos; no incluye fotografías ni croquis (usa el ZIP o Drive).`;
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
    if (el) el.textContent = `Versión ${CONFIG.version}${buildSW ? ' · build ' + buildSW : ''} · ${PROY().nombre}`;
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

    /* si el navegador bloquea el service worker, register() puede no devolver nada */
    if (!swReg || typeof swReg.addEventListener !== 'function') return;

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

    /* fichas viejas: eran del levantamiento de Pedro Moncayo */
    let migradas = 0;
    for (const f of S.fichas.values()) {
      if (!f.proyecto) { f.proyecto = 'pedro'; await DB.put('fichas', f); migradas++; }
    }
    if (migradas) await cargarFichas();

    await Drive.init().catch(() => {});
    const guardado = await DB.kvGet('proyecto', '').catch(() => '');
    const ultimo = (typeof PROYECTOS !== 'undefined' && PROYECTOS[guardado]) ? guardado : '';
    pedirProyecto(ultimo);   // el menú sale siempre al abrir; el último queda marcado
    renderTodo(); renderDrive();
    netState();
    estadoApp();
    cablear();
    document.body.dataset.listo = '1';
    console.log(`Inspección GNSS lista · ${fichas.length} ficha(s) guardada(s)`);
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
    /* días con fichas, para la copia por día */
    const dias = Array.from(new Set(fichasProyecto().map(fechaDe))).sort().reverse();
    const sel = $('diaCopia');
    const antes = sel.value;
    sel.innerHTML = dias.length
      ? dias.map((d) => `<option value="${d}">${d.split('-').reverse().join('/')}</option>`).join('')
      : '<option value="">— sin fichas —</option>';
    if (antes && dias.includes(antes)) sel.value = antes;
    $('zipInfo').textContent = dias.length
      ? `${S.fichas.size} ficha(s) guardada(s) en ${dias.length} día(s).`
      : 'Todavía no hay fichas guardadas.';

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
    $('btnLevantar').addEventListener('click', () => {
      if (!S.sel) return;
      if (S.sel.rol === 'base') levantarBase(S.sel.codigo);
      else abrirFicha(S.sel.id);
    });
    $('btnVerFicha').addEventListener('click', () => {
      if (!S.sel) return;
      const id = S.sel.rol === 'base' ? ((baseDeHoy(S.sel.codigo) || fichasBase(S.sel.codigo)[0] || {}).id) : S.sel.id;
      if (id) verDetalle(id);
    });
    $('btnBorrarFicha').addEventListener('click', () => {
      if (!S.sel) return;
      const id = S.sel.rol === 'base' ? ((baseDeHoy(S.sel.codigo) || {}).id) : S.sel.id;
      if (id) borrarFicha(id);
    });

    $('btnFichaBack').addEventListener('click', async () => {
      if (S.sucio) {
        const nueva = !miFicha(S.editor && S.editor.id);
        const r = await avisar({
          titulo: nueva ? '¿Desea abandonar la creación de la ficha?' : '¿Desea abandonar los cambios?',
          html: '<p>Hay datos escritos que no se han guardado' +
            (nueva ? '.' : ' en esta ficha.') + '</p>',
          botones: [
            { txt: 'Seguir editando', clase: '', valor: 'seguir' },
            { txt: 'Salir sin guardar', clase: 'primary', valor: 'salir' }
          ]
        });
        if (r !== 'salir') return;
      }
      S.sucio = false;
      await limpiarBorrador();
      mostrar('puntos'); renderTodo();
    });
    $('btnGuardar').addEventListener('click', () => guardarFicha());
    /* cualquier cambio en el formulario marca la ficha como "sin guardar" */
    ['input', 'change'].forEach((ev) => {
      $('v-ficha').addEventListener(ev, (e) => {
        const t = e.target;
        if (!t || t.id === 'camPunto' || t.id === 'camPlaca' || t.id === 'camExtra') return;
        S.sucio = true;
      }, true);
    });
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

    /* en el detalle, tocar una foto abre la versión completa */
    $('d-fotos').addEventListener('click', async (e) => {
      const fig = e.target.closest('[data-foto-id]');
      if (!fig) return;
      const blob = await Fotos.getBlob(fig.dataset.fotoId);
      if (blob) verImagen(URL.createObjectURL(blob));
    });

    const veloProy = $('v-proyecto');
    if (veloProy) {
      veloProy.addEventListener('click', (e) => {
        const b = e.target.closest('[data-proy]');
        if (b) elegirProyecto(b.dataset.proy);
      });
    }
    document.querySelectorAll('[data-cambiar-proyecto]').forEach((b) => {
      b.addEventListener('click', () => pedirProyecto());
    });

    /* brújula: la rosa se dibuja al abrir; el sensor se enciende con un toque */
    if ($('btnBrujula') && typeof Brujula !== 'undefined') {
      Brujula.dibujar();
      $('btnBrujula').addEventListener('click', async () => {
        const r = await Brujula.iniciar();
        if (!r.ok) toast(r.motivo, 'err');
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) Brujula.detener();
        else Brujula.reanudar();
      });
    }

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
        const r = await Drive.probar(u, c, (PR() ? PR().raizDrive : ''));
        await Drive.guardarConfig(u, c);
        renderDrive();
        const quien = r.cuenta ? ` (${r.cuenta})` : '';
        const raizTxt = r.raiz || (PR() ? PR().raizDrive : CONFIG.carpetaProyecto);
    toast('Conectado con Drive' + quien + '. Carpeta: ' + raizTxt, 'ok');
        $('driveCarpetaMsg').innerHTML = 'Listo. La carpeta es <b>' + esc(raizTxt) + '</b>' +
          (r.raizUrl ? ` — <a href="${esc(r.raizUrl)}" target="_blank" rel="noopener">abrir en Drive</a>` : '');
        if (r.raizUrl) await DB.kvSet(claveRaizUrl(), r.raizUrl);
      } catch (e) {
        toast(e.message, 'err');
        $('driveCarpetaMsg').textContent = e.message;
      } finally { busy(false); }
    });

    /* Abrir la carpeta en Drive.
       La pestaña se abre al instante (dentro del toque) porque si se abre después de
       esperar la respuesta del script, el navegador la bloquea como ventana emergente. */
    $('btnAbrirCarpeta').addEventListener('click', async () => {
      const ventana = window.open('', '_blank');
      let url = '';
      try { url = await DB.kvGet(claveRaizUrl(), ''); } catch (e) { url = ''; }
      if (!url && Drive.configurado()) {
        busy(true, 'Consultando la carpeta en Drive…');
        try {
          const r = await Drive.probar(undefined, undefined, (PR() ? PR().raizDrive : ''));
          url = r.raizUrl || '';
          if (url) await DB.kvSet(claveRaizUrl(), url);
        } catch (e) {
          if (ventana) ventana.close();
          toast(e.message, 'err');
          $('driveCarpetaMsg').textContent = e.message;
          return;
        } finally { busy(false); }
      }
      if (!url) {
        if (ventana) ventana.close();
        toast('Primero pulsa "Guardar y probar" para conectar con el script.', 'err');
        return;
      }
      if (ventana) ventana.location.replace(url);
      else {
        /* si el navegador bloqueó la pestaña, se deja un enlace grande para tocar */
        $('driveCarpetaMsg').innerHTML = `No se pudo abrir sola. Toca aquí: <a href="${esc(url)}" target="_blank" rel="noopener">abrir la carpeta en Drive</a>`;
        toast('Toca el enlace "abrir la carpeta en Drive".', 'err');
      }
    });

    $('btnSubirTodo').addEventListener('click', () => subirPendientes(false));
    $('btnReintentar').addEventListener('click', () => subirPendientes(true));
    $('autoSubir').addEventListener('change', async (e) => { S.ajustes.autoSubir = e.target.checked; await guardarAjustes(); });
    $('borrarOrig').addEventListener('change', async (e) => { S.ajustes.borrarOrig = e.target.checked; await guardarAjustes(); });

    $('btnBackup').addEventListener('click', exportarRespaldo);
    $('fileRestore').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importarRespaldo(f); e.target.value = ''; });
    $('btnZipAll').addEventListener('click', () => exportarZip(null));
    $('btnCopiaDia').addEventListener('click', () => {
      const d = $('diaCopia').value;
      if (!d) { toast('Todavía no hay fichas guardadas.', 'err'); return; }
      exportarDia(d);
    });
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
