/* Brújula para orientar el receptor GNSS hacia el norte.
   - Android: 'deviceorientationabsolute' (o 'deviceorientation' con absolute).
   - iPhone: 'deviceorientation' + webkitCompassHeading, con permiso que se pide
     desde el botón (iOS 13+ exige un toque).
   La rosa se dibuja una sola vez; después solo se gira y se cambia el color.
   Sin sensor: avisa y no molesta. Se detiene sola al ocultar la app. */
const Brujula = (() => {
  const TOL = 4;                 // grados de tolerancia para cantar "norte"
  const RUMBOS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  const NS = 'http://www.w3.org/2000/svg';

  let activa = false, queria = false;
  let rumbo = null;              // último rumbo recibido (0..360)
  let magnetico = false;         // ¿la lectura está referida al norte magnético?
  let mostrado = 0;              // rumbo suavizado que se dibuja
  let raf = 0, vibrado = false, vioEvento = false, temporizador = 0;
  let detenerFns = [];

  const $ = (id) => document.getElementById(id);

  /* ---------- dibujo de la rosa (una sola vez) ---------- */
  const el = (n, at) => {
    const e = document.createElementNS(NS, n);
    for (const k in at) e.setAttribute(k, at[k]);
    return e;
  };
  const punto = (brg, r) => {
    const a = (brg * Math.PI) / 180;
    return [100 + Math.sin(a) * r, 100 - Math.cos(a) * r];
  };

  function dibujar() {
    const svg = $('brujulaRosa');
    if (!svg || svg.dataset.lista === '1') return;
    svg.innerHTML = '';
    svg.appendChild(el('circle', { cx: 100, cy: 100, r: 97, class: 'aro' }));
    svg.appendChild(el('circle', { cx: 100, cy: 100, r: 84, class: 'aro2' }));

    for (let g = 0; g < 360; g += 5) {
      const mayor = g % 30 === 0;
      const medio = g % 10 === 0;
      const largo = mayor ? 12 : medio ? 8 : 4.5;
      const [x1, y1] = punto(g, 95);
      const [x2, y2] = punto(g, 95 - largo);
      svg.appendChild(el('line', { x1, y1, x2, y2, class: 'tk' + (mayor ? ' mayor' : medio ? ' medio' : '') }));
    }

    // grados cada 30
    for (let g = 0; g < 360; g += 30) {
      const [x, y] = punto(g, 74);
      const t = el('text', { x, y, class: 'grados', 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = g;
      svg.appendChild(t);
    }

    // cardinales
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(([txt, g]) => {
      const [x, y] = punto(g, 57);
      const t = el('text', { x, y, class: 'cardinal' + (txt === 'N' ? ' norte' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      t.textContent = txt;
      svg.appendChild(t);
    });

    // aguja: corta, para no tapar las letras
    svg.appendChild(el('polygon', { points: '100,58 108.5,100 91.5,100', class: 'aguja n' }));
    svg.appendChild(el('polygon', { points: '100,142 108.5,100 91.5,100', class: 'aguja s' }));
    svg.appendChild(el('circle', { cx: 100, cy: 100, r: 6.4, class: 'eje' }));

    svg.dataset.lista = '1';
  }

  /* ---------- lectura del sensor ---------- */
  /* Devuelve { h, mag } o null. 'mag' dice si el rumbo está referido al
     norte magnético: iOS lo entrega en webkitCompassHeading; en Android solo
     los eventos 'absolute' (deviceorientationabsolute) usan el magnetómetro. */
  function rumboDe(e, absoluto) {
    let h = null, mag = false;
    if (typeof e.webkitCompassHeading === 'number' && isFinite(e.webkitCompassHeading)) {
      h = e.webkitCompassHeading;                       // iOS: 0 = norte magnético, horario
      mag = true;
    } else if (typeof e.alpha === 'number' && isFinite(e.alpha)) {
      h = 360 - e.alpha;                                // alpha crece en sentido antihorario
      mag = !!absoluto || e.absolute === true;
    }
    if (h == null) return null;
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    return { h: ((h + Number(ang || 0)) % 360 + 360) % 360, mag };
  }

  /* ---------- pintado ---------- */
  const difNorte = (h) => Math.min(h, 360 - h);

  function pintar() {
    const caja = $('brujula');
    const rosa = $('brujulaRosa');
    if (!caja || !rosa) return;

    // suavizado por el camino corto
    if (rumbo != null) {
      /* ángulo continuo (sin normalizar): al cruzar el norte no salta de 359 a 0 */
      const d = ((rumbo - mostrado + 540) % 360) - 180;
      mostrado += d * 0.22;
    }
    const grados = ((Math.round(mostrado) % 360) + 360) % 360;
    rosa.style.transform = `rotate(${-mostrado}deg)`;

    const cerca = rumbo != null && magnetico && difNorte(rumbo) <= TOL;
    caja.classList.toggle('norte', !!cerca);
    caja.classList.toggle('sin-datos', rumbo == null);

    const g = $('brujulaGrados');
    if (g) g.textContent = rumbo == null ? '—' : String(grados).padStart(3, '0') + '°';
    const r = $('brujulaRumbo');
    if (r) {
      r.textContent = rumbo == null ? 'sin datos'
        : cerca ? 'NORTE MAG.' : RUMBOS[Math.round(grados / 22.5) % 16];
    }
    const m = $('brujulaMsg');
    if (m && rumbo != null) {
      m.textContent = !magnetico
        ? 'Este teléfono no está dando una orientación referida al norte magnético. ' +
          'Muévelo en forma de ocho para calibrar el magnetómetro y vuelve a intentar.'
        : cerca
          ? 'Alineado al norte magnético: ya puedes marcar la dirección del receptor.'
          : (difNorte(rumbo) < 45
            ? (rumbo < 180 ? '← Gira un poco a la izquierda' : 'Gira un poco a la derecha →')
            : 'Gira el teléfono hasta que la N quede arriba.');
    }

    // vibración corta al entrar en norte
    if (cerca && !vibrado) {
      vibrado = true;
      try { navigator.vibrate && navigator.vibrate(18); } catch (err) { /* nada */ }
    } else if (!cerca) vibrado = false;

    raf = requestAnimationFrame(pintar);
  }

  /* ---------- arranque y parada ---------- */
  function limpiar() {
    detenerFns.forEach((f) => { try { f(); } catch (e) { /* nada */ } });
    detenerFns = [];
    cancelAnimationFrame(raf);
    raf = 0;
    if (temporizador) { clearTimeout(temporizador); temporizador = 0; }
  }

  async function pedirPermiso() {
    const D = window.DeviceOrientationEvent;
    if (!D) return { ok: false, motivo: 'Este teléfono no tiene brújula o el navegador no la expone.' };
    if (typeof D.requestPermission === 'function') {
      try {
        const r = await D.requestPermission();
        if (r !== 'granted') {
          return { ok: false, motivo: 'Permiso de brújula denegado. Se habilita en Ajustes de Safari → Movimiento y orientación.' };
        }
      } catch (e) {
        return { ok: false, motivo: 'No se pudo pedir el permiso de la brújula: ' + e.message };
      }
    }
    return { ok: true };
  }

  async function iniciar() {
    dibujar();
    queria = true;
    if (activa) return { ok: true };
    const perm = await pedirPermiso();
    if (!perm.ok) {
      const m = $('brujulaMsg');
      if (m) m.textContent = perm.motivo;
      return perm;
    }

    const recibir = (e, absoluto) => {
      const r = rumboDe(e, absoluto);
      if (!r) return;
      if (!r.mag && magnetico) return;      // no dejar que una lectura relativa pise la magnética
      vioEvento = true;
      rumbo = r.h;
      magnetico = r.mag;
    };

    // el evento 'absolute' es el que está referido al norte magnético
    const oyenteAbs = (e) => recibir(e, true);
    const oyenteRel = (e) => { if (!magnetico) recibir(e, false); };
    window.addEventListener('deviceorientationabsolute', oyenteAbs, true);
    detenerFns.push(() => window.removeEventListener('deviceorientationabsolute', oyenteAbs, true));
    window.addEventListener('deviceorientation', oyenteRel, true);
    detenerFns.push(() => window.removeEventListener('deviceorientation', oyenteRel, true));

    activa = true;
    if (!raf) raf = requestAnimationFrame(pintar);

    const m = $('brujulaMsg');
    if (m) m.textContent = 'Buscando la brújula…';
    temporizador = setTimeout(() => {
      if (vioEvento) return;
      const mm = $('brujulaMsg');
      if (mm) mm.textContent = 'Este teléfono no está entregando la brújula. Revisa los permisos de movimiento/orientación del navegador.';
      detener();
    }, 2500);

    const b = $('btnBrujula');
    if (b) b.classList.add('hidden');
    return { ok: true };
  }

  function detener() {
    limpiar();
    activa = false;
    rumbo = null;
    magnetico = false;
    mostrado = 0;
    const caja = $('brujula');
    if (caja) { caja.classList.remove('norte'); caja.classList.add('sin-datos'); }
    const b = $('btnBrujula');
    if (b) b.classList.remove('hidden');
  }

  /* al volver a la app, si estaba encendida se reanuda */
  function reanudar() {
    if (queria && !activa) iniciar();
  }

  return { iniciar, detener, reanudar, dibujar, activa: () => activa, queria: () => queria };
})();
