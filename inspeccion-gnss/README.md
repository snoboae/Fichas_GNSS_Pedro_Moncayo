# Fichas GNSS · Red Geodésica Pedro Moncayo

Aplicación web (PWA) para **levantar en campo la ficha de cada punto de control** de la red
geodésica del Cantón Pedro Moncayo y **generar la ficha en una sola hoja A4**, además de subir la
ficha, las fotografías en alta resolución y los datos a **Google Drive**.

> **Estas fichas son de campo, no son las monografías definitivas.** Sirven para organizar la
> información levantada en sitio: qué punto, dónde está (UTM), con qué receptor y en qué horario se
> midió, cómo quedó el sitio (croquis y dos fotografías) y con qué observaciones. Las monografías
> del IGM se arman después con el procesamiento de los datos.

Se abre desde el navegador (Chrome en Android, Safari en iPhone) y se puede instalar en la
pantalla de inicio. **No es una APK**: funciona igual en Android e iOS, y una vez abierta con
internet queda guardada en el teléfono y abre **sin conexión**.

- Proyecto: *Implementación de un Sistema de Red Geodésica para el Cantón Pedro Moncayo*
- Contrato N.° 004-CPC-GADMPM-2026-VSC · Proceso CPC-GADMPM-2026-006
- Entidad: GAD Municipal del Cantón Pedro Moncayo — Dirección de Gestión de Avalúos y Catastros
- Consultor: GEOCALIZA — Consultoría Integral
- Sistema de referencia: **WGS84 · UTM 17S (EPSG:32717)**

---

## 1. Cómo se usa en campo

Cada punto se levanta **dos veces**: la **IDA** (primera observación, en el orden del recorrido) y la
**VUELTA** (segunda observación, de regreso). Son **37 fichas planificadas** (más las bases de cada día):

- **36** de los 18 puntos de segundo y tercer orden (ida y vuelta, 3 puntos por sesión de 2 h).
- **1** de `RG-SF-51-01`, que se mide una sola vez (junto a las bases).
- **Las bases no se cuentan en el total**: los tres puntos de primer orden (`RG-52-03`, `RG-50-01`,
  `RG-50-06`) aparecen **una sola vez** en la lista; al levantarlos la app pregunta
  *"¿Crear una ficha de base para hoy?"* y la ficha del día lleva la fecha en el nombre
  (`RG-50-01-BASE-2026-11-01`), porque la altura de la antena se mide de nuevo cada jornada.

> **Los días del plan son tentativos.** La app no amarra ningún punto a una fecha: los números
> (1…18) son el orden del recorrido y las **jornadas** (BASE 1, BASE 2…) son la cantidad de veces
> que se ocupó esa base, no días del calendario. La carpeta en Drive usa la **fecha real** de la
> ficha, y cualquier punto se puede levantar en cualquier orden: si la campaña se corre un día, no
> hay que cambiar nada.

El desplegable **Puntos** muestra las 44 fichas posibles, en el orden del recorrido y con su etiqueta
**IDA** o **VUELTA** y el número de la ruta (1…18). Las que ya están guardadas llevan **✓ verde**.

1. Elegir **Puntos** → abrir el desplegable → elegir, por ejemplo, `3 · RG-53-03 · IDA`.
2. **IR AL PUNTO** pregunta con qué app ir (**Google Maps**, **Waze** o **Maps de iPhone**).
3. **LEVANTAR FICHA** abre la ficha de esa sesión (la IDA y la VUELTA son fichas distintas).
4. Llenar los datos y **Guardar ficha**.
5. El punto queda con **✓ verde** para esa sesión; el panel muestra también si la otra sesión ya está.

Campos con candado (🔒) = vienen del diseño de la red y no se pueden editar:

| Se llena automáticamente (solo lectura) | Lo llena el operador en campo |
|---|---|
| Código (es el identificador del punto), parroquia, sector/sitio, orden, coordenada X e Y (UTM 17S), materialización | Receptor GNSS, altura de la antena (acepta coma o punto), **inicio** y **fin** (fecha y hora, con botón **Ahora**), operador, fotografía de la medición, fotografía de la placa y fotos adicionales con su nombre |

La **fecha de la ficha** es la del inicio de la observación; la duración se calcula sola.

**Fijo por el TR (no se pide):** método *estático diferencial*, máscara de 10° e intervalo de 1 s.

> El **avance** que muestra la app es el de **ese teléfono**. Para saber el avance de todo el equipo se
> usan las fichas subidas a Drive (o el CSV de cada teléfono).
## 2. Croquis

Los **22 croquis ya vienen generados con la app**, en `img/croquis/<código>.jpg` (imagen satelital
Esri, cruz en el punto, código y coordenadas UTM, norte, escala y atribución). Por eso:

- **No hay que generarlos** en campo ni en oficina, y **no necesitan internet**.
- Se guardan en el service worker, así que también funcionan sin conexión.
- La ficha y el PDF los usan directamente; no se guardan dentro de cada ficha (así las fichas
  pesan menos).

Si algún día cambian las coordenadas del diseño, se regeneran todos en un minuto:

```
python herramientas/genera_croquis.py            # los 22
python herramientas/genera_croquis.py RG-52-02   # solo uno
```

> En el cantón Pedro Moncayo Esri entrega imagen hasta el **zoom 18**; en el 19 responde con la
> tesela "Map data not yet available". El generador lo detecta y no deja huecos.
## 3. Fotografías

En la ficha hay tres bloques:

1. **Fotografía de la medición** — el punto con el equipo montado. Es la que se imprime.
2. **Fotografía de la placa** — primer plano de la placa o del mojón. Es la que se imprime.
3. **Agregar más fotos** — fotos adicionales (accesos, entorno, detalles). Antes de tomarlas se
   escribe el **nombre de la foto** para identificarla; se suben a Drive con ese nombre y **no** se
   imprimen.

- Se pueden tomar con la cámara o elegir de la galería.
- Se guardan **dos versiones**: el **original de la cámara** (alta resolución, es el que se sube a
  Drive) y una **copia liviana de 1600 px** para la ficha y el PDF. Si el original supera 8 MB, a
  Drive se envía una copia de 3000 px.
- En la pestaña Drive hay una opción para **liberar los originales** después de subirlos.
## 4. La ficha (PDF de una sola hoja)

A4 horizontal, una página, con los logos del GAD Pedro Moncayo y de Geocaliza. El título es el
proyecto y el punto se identifica por su **código**:

1. **Identificación del punto** — código, orden, parroquia, fecha, provincia, cantón y sector/sitio.
2. **Ubicación, materialización y observación** — Este/Norte, zona UTM y datum, método y parámetros
   del TR; materialización, receptor, altura de antena e **inicio – fin** de la observación.
3. **Croquis de ubicación** (imagen satelital).
4. **Registro fotográfico** — foto de la medición y foto de la placa.
5. **Firma del operador** y una nota que aclara que es un documento de campo.

Desde **Detalle** se puede descargar o compartir el PDF, exportar el punto a GeoJSON o descargar
las fotos en un ZIP. Ejemplo: `../Ejemplos fichas/Ejemplo ficha RG-50-01 (una hoja).pdf`.
## 5. Google Drive (sin OAuth, con un script de Google)

La app sube los archivos a un **Google Apps Script** publicado por el dueño de la carpeta. No hay
que crear proyecto en Google Cloud, no hay pantalla de permisos de Google y no caduca.

### Copia de seguridad en el teléfono

En **Respaldo → Copia completa en el teléfono** hay un `.zip` con el **PDF**, las **fotografías** y los
**datos** de cada ficha, con las mismas carpetas que en Drive
(`2026_11_01/IDA_01_11_2026_RG-52-02/`), más un `LEEME.txt` y un `indice_fotos.csv`:

- **Copia de ese día**: eliges la fecha y baja solo lo de esa jornada.
- **Copia de todas las fichas**: todo lo que hay en el teléfono.

El navegador no puede escribir en una carpeta elegida por su cuenta: en **Android** el ZIP cae en
**Descargas** y en **iPhone** se abre el menú para guardarlo en **Archivos**, donde sí puedes escoger
la carpeta (por ejemplo crear una llamada “Fichas GNSS”). Conviene hacer la copia del día al terminar
la jornada; Google Drive sigue siendo la copia principal.

### Dos levantamientos

Al abrir la app se elige con qué se va a trabajar:

| Levantamiento | Puntos | Fichas | Carpeta en Drive |
|---|---|---|---|
| **Pruebas Rumiñahui** | PCA01, PCA03, PCA04 (control, una medición cada uno) | 3 | `Pruebas GNSS - Rumiñahui/` |
| **Levantamiento GNSS Pedro Moncayo** | los 22 de la red + 3 bases + 1 adicional | 37 + bases | `Inspección GNSS - Pedro Moncayo/` |

Son **independientes**: las fichas guardadas, el avance, el CSV/GeoJSON, el ZIP de copia y el respaldo
`.json` de un levantamiento **no incluyen nada del otro**.

Para volver al menú de levantamientos hay un botón **Cambiar** en dos sitios: en la barra
*"Levantamiento: …"* que está arriba de la lista de puntos, y en **Respaldo → Levantamiento abierto**.
La app recuerda el último usado al abrirse (el menú vuelve a salir si se cierra y se abre).

Los tres croquis de Rumiñahui salen de la propia monografía y vienen incluidos en la app, igual que
los 22 de Pedro Moncayo.

### Qué se puede guardar y qué se sube

La ficha **se guarda siempre**, aunque esté a medias: si falta algo, la app avisa con la lista y la
marca como **incompleta** (chip ámbar en la lista y en el detalle).

**Para subirla a Drive hacen falta estos siete datos** (el resto es opcional):

1. Tipo de antena (campo *Receptor GNSS*)
2. Altura de la antena
3. Fecha y hora de **inicio**
4. Fecha y hora de **fin**
5. Operador
6. Fotografía de la medición
7. Fotografía de la placa

Mientras falte alguno, la subida (automática y manual) no se hace: el botón explica qué falta.
La copia local (ZIP del día y respaldo `.json`) sí incluye las fichas incompletas, para no perder trabajo.

Al salir de una ficha con cambios sin guardar, la app pregunta antes de descartarlos.

### Si una ficha ya está en Drive

Antes de subir, la app pregunta al script si ese punto ya tiene ficha ese día. Si existe, muestra
**cuándo se subió y quién la subió** y ofrece una sola decisión: **guardar una copia** (o *Ahora no*).

Si aceptas, tu ficha se guarda completa en una **subcarpeta `COPIA`** dentro de la carpeta de esa ficha
(y si ya hubiera una, en `COPIA 1`, `COPIA 2`…). Así quedan las dos, cada una con su PDF, sus fotos y su
`datos.json`, sin mezclarse:

```
IDA_03_11_2026_RG-52-02/
    RG-52-02_IDA.pdf  …                    ← la primera
    COPIA/ RG-52-02_IDA.pdf  …             ← la segunda
```

**Nunca se borra ni se reemplaza nada.** Si dices *Ahora no*, la ficha queda marcada como **conflicto**
en la lista (chip rojo) para resolverla cuando quieras.

### Observaciones (opcional)

Cada ficha tiene un campo **Observaciones** que no es obligatorio: sirve para dejar por escrito lo que
no cabe en los demás campos (acceso, novedades, estado del punto, coordinación con la comunidad).
Sale en el **PDF** como bloque *5 · Observaciones* (solo si tiene texto; si está vacío, la ficha se ve
exactamente igual que antes), se ve en el detalle de la ficha, y va también en el CSV, el GeoJSON y el
`.json` que se sube a Drive.

En la lista de puntos de Pedro Moncayo, las **tres bases de primer orden aparecen primero**.

### Brújula (para orientar el receptor)

En **Puntos**, debajo de *Exportar*, hay una brújula que sirve para dejar el receptor mirando al norte:

- Se enciende con el botón **Activar brújula** (en iPhone el navegador exige un toque; Android también).
- La rosa gira con el teléfono y abajo se lee el rumbo en grados (`347°`) y el nombre (`NNO`, `E`, `S`…).
- Cuando apuntas al **norte magnético** (±4°) todo el dial pasa de **azul a verde** y vibra una vez;
  la lectura dice `NORTE MAG.` para que no haya duda de a qué norte se refiere.
- Usa **siempre la lectura absoluta** (magnetómetro): si el teléfono solo entrega orientación relativa,
  la app lo avisa, no se pone verde y pide calibrar moviendo el teléfono en forma de ocho.
- **Norte magnético ≠ norte geográfico**: la diferencia es la declinación del lugar (en el callejón
  interandino, unos 2–3° al oeste). La app usa el magnético a propósito, que es el que se puede medir
  en campo con el teléfono; no aplica corrección.
- Se apaga sola al salir de la app y se reanuda al volver. Si el teléfono no tiene brújula, avisa y no
  molesta.

**iPhone**: la primera vez Safari pide permiso (*Ajustes → Safari → Movimiento y orientación* debe estar
activo); si se deniega, la app lo dice. Hay que abrirla en **Safari** o desde el ícono instalado, no
dentro del navegador de WhatsApp/Instagram.

**Calibrar no es rutina**: el magnetómetro se calibra solo. Muévelo en forma de ocho solo cuando la
aguja se quede pegada, salte o apunte claramente mal: al llegar a un sitio nuevo, cerca de metal o del
carro, o después de un golpe. Alcanza con hacerlo **al empezar la jornada** en el sitio; no hace falta en
cada punto. Ojo con las fundas con imán y con los clips magnéticos para el teléfono: desvían la brújula
de forma permanente mientras estén puestos.

### Qué se crea en Drive

```
Inspección GNSS - Pedro Moncayo/          ← la crea el script en el Drive del dueño
   2026_10_31/                            ← carpeta del día (la crea el script si no existe)
      IDA_31_10_2026_RG-52-02/            ← una carpeta por ficha: TIPO_dd_mm_aaaa_CÓDIGO
         RG-52-02_IDA.pdf
         RG-52-02_IDA_medicion_1.jpg
         RG-52-02_IDA_placa_1.jpg
         RG-52-02_IDA_acceso_vehicular_1.jpg
         datos_RG-52-02_IDA.json
      BASE_31_10_2026_RG-50-01/           ← base de primer orden (una por día)
         RG-50-01_BASE.pdf
   2026_11_15/
      VUELTA_15_11_2026_RG-53-01/
```

Dos niveles: **día** (`aaaa_mm_dd`) y **ficha** (`TIPO_dd_mm_aaaa_CÓDIGO`). Antes de crear cada
carpeta el script **busca por nombre**: si ya existe la reutiliza, de modo que nunca se duplican
carpetas del mismo día.
https://USUARIO.github.io/REPOSITORIO/inspeccion-gnss/
```

Opciones: `publicar.bat -Nuevo` (crear otro repositorio), `-Reconfigurar`,
`-Simular` (muestra qué subiría, sin conectarse), `-GuardarToken` (cambiar el API KEY).

En el teléfono: abrir esa dirección con Chrome/Safari y elegir **Instalar app** o
**Añadir a pantalla de inicio**.

### Cómo llega la versión nueva a los teléfonos

Cada vez que se publica, el script cambia la versión del `sw.js` (un código corto calculado con el
contenido). Con eso el teléfono sabe que hay algo nuevo:

1. La app **busca actualizaciones sola** al abrirse, al volver a primer plano (cuando el operador la
   retoma) y cada 15 minutos si queda abierta.
2. Si encuentra una versión nueva, aparece una barra abajo:
   **“Hay una versión nueva (vXXXX). [Actualizar] ×”**.
   - **Actualizar** recarga en un segundo con la versión nueva.
   - **×** la deja para después (no vuelve a molestar en esa sesión).
   - Si el operador está **llenando una ficha**, la barra **no lo interrumpe**: el aviso queda
     pendiente y aparece al salir del formulario, para no perder lo que iba escribiendo.
3. En **Respaldo → Estado de la app** hay un botón **“Buscar actualización”** (con la versión
   instalada, p. ej. `build v09961618`), para forzarla en el momento.
4. Aunque no se pulse nada, **las fichas nunca se pierden** (viven en el teléfono) y la próxima vez
   que se abra la app ya se carga la versión nueva.

> En iPhone, si la app está en la pantalla de inicio, iOS a veces tarda en revisar el service
> worker. Por eso el aviso automático al volver a la app y el botón manual: con cualquiera de los
> dos se actualiza sin reinstalar nada.

## 9. Estructura de archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | pantallas: Puntos, Ficha, Detalle, Drive, Respaldo |
| `css/app.css` | estilos (modo claro y oscuro) |
| `js/datos.js` | **los 22 puntos** (código, orden, parroquia, sitio, UTM, materialización, trabajos, notas). Generado por `herramientas/genera_datos.py` |
| `js/config.js` | ajustes de arranque (URL y clave del script de Drive, versión, tamaños de foto) |
| `js/geo.js` | UTM ↔ geográficas (WGS84), distancias y rumbos |
| `js/mapimg.js` | mapa interactivo del detalle (los croquis son archivos en `img/croquis/`) |
| `js/fotos.js` | compresión, originales, miniaturas |
| `js/pdf.js` | la ficha de una hoja |
| `js/drive.js` | envío de archivos al script de Apps Script |
| `js/db.js` | almacenamiento local (IndexedDB) |
| `js/zip.js` | exportación de fotos en ZIP |
| `js/logos.js` | logos en base64 para el PDF (generado por `herramientas/make_iconos.py`) |
| `sw.js`, `manifest.webmanifest` | funcionamiento sin conexión e instalación |
| `herramientas/Code.gs` | **el script que se pega en script.google.com** |
| `herramientas/` | scripts de desarrollo: datos, iconos, pruebas del PDF, del motor, de la base y de Drive |
| `../publicar.bat`, `../publicar.ps1` | publicación en GitHub Pages (en la carpeta de arriba) |

## 10. Notas técnicas

- **Coordenadas**: WGS84 / UTM zona 17S (EPSG:32717). La conversión a latitud/longitud (solo para
  Maps y para centrar el croquis) usa las series de Krüger, validada contra `pyproj`.
- **PDF**: se genera en el teléfono, sin servidor. Las fotos se insertan a 1200 px para que el
  archivo pese ~250–400 KB y se pueda enviar por WhatsApp.
- **Base local**: al actualizar desde una versión anterior, las fichas guardadas se migran solas
  (la fecha y hora separadas pasan a un solo campo de inicio).
- **Privacidad**: los datos no salen del teléfono salvo al subir a Drive o al compartir un archivo.

## 11. Pendientes y decisiones

Ver **`../PENDIENTES.md`** (fuera de esta carpeta).
