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
**VUELTA** (segunda observación, de regreso). Son **55 fichas planificadas**:

- **36** de los 18 puntos de segundo y tercer orden (ida y vuelta, 3 puntos por sesión de 2 h).
- **18** de los tres de primer orden (`RG-52-03`, `RG-50-01`, `RG-50-06`): **una ficha por jornada**
  de ocupación como base 8 h (6 jornadas × 3 bases), porque la altura de la antena se mide de nuevo
  cada vez (trípode, altura inclinada). Si la campaña se alarga, la app ofrece la jornada siguiente
  (**BASE 7**, **BASE 8**…) sin tener que cambiar nada.
- **1** de `RG-SF-51-01`, que se mide una sola vez (junto a las bases).

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

### Qué se crea en Drive

```
Inspección GNSS - Pedro Moncayo/          ← la crea el script en el Drive del dueño
   2026_10_31/                            ← carpeta del día (la crea el script si no existe)
      IDA_31_10_2026_RG-52-02/            ← una carpeta por ficha: TIPO_dd_mm_aaaa_CÓDIGO
         RG-52-02_IDA.pdf
         RG-52-02_IDA_medicion_1.jpg
         RG-52-02_IDA_medicion_2.jpg
         RG-52-02_IDA_placa_1.jpg
         RG-52-02_IDA_acceso_vehicular_1.jpg
         datos_RG-52-02_IDA.json
      BASE3_31_10_2026_RG-50-01/          ← las bases llevan el número de jornada
         RG-50-01_BASE-3.pdf
   2026_11_15/
      VUELTA_15_11_2026_RG-53-01/
`

Dos niveles: **día** (aaa_mm_dd) y **ficha** (TIPO[jornada]_dd_mm_aaaa_CÓDIGO). El nombre sale
del tipo de ficha, la **fecha de la ficha** (la misma del PDF) y el código. Antes de crear cada
carpeta el script **busca por nombre**: si ya existe la reutiliza (aunque se haya movido a mano), de
modo que nunca se duplican carpetas del mismo día.
El nombre sale del **tipo de ficha** (IDA, VUELTA, BASE o UNICA), la **fecha de la ficha** (la misma
del PDF) y el **código**. La app no arma carpetas por día: esas las crea usted en Drive y **arrastra
cada carpeta** a la del día que corresponda. Si la carpeta ya fue movida y se vuelve a subir la
misma ficha, el script la busca y la reutiliza (no crea una copia).


Si un archivo ya existe con ese nombre, el anterior se envía a la papelera y se crea el nuevo (no
se duplica). Si la ficha cambia después de subida, vuelve a quedar como *pendiente*.

### Instalación (una sola vez, la hace el dueño de la carpeta)

1. Entrar a **script.google.com** con esa cuenta → **Nuevo proyecto**.
2. Borrar el contenido y pegar todo el archivo **`herramientas/Code.gs`**.
3. Cambiar `CLAVE` por una palabra secreta (la misma que se pondrá en la app).
4. **Implementar → Nueva implementación → Aplicación web**:
   - *Ejecutar como:* **Yo**
   - *Quién tiene acceso:* **Cualquier persona**
5. Autorizar los permisos y **copiar la URL** que termina en `/exec`.
6. En la app: pestaña **Drive** → revisar la URL, escribir la **CLAVE** → **Guardar y probar**.

> La URL ya viene puesta en `js/config.js` (`driveScriptUrl`). La **clave no se guarda en el
> código**: se escribe una vez en cada teléfono y queda en el almacenamiento local, para que no
> quede publicada en el repositorio de GitHub.

> **Si Google responde "403 Acceso denegado"**: la implementación quedó como *Solo yo*. Se
> corrige en Apps Script → **Implementar → Administrar implementaciones → lápiz (editar)** →
> *Quién tiene acceso:* **Cualquier persona** → **Implementar**. La misma URL sigue sirviendo.

> **Si cambias el código del script**: no basta con guardar. Hay que **Implementar → Administrar
> implementaciones → editar → Versión: nueva** y volver a implementar.

Con eso, cualquier teléfono que tenga la app configurada sube a esa carpeta. Los archivos quedan a
nombre del dueño del script (una cuenta institucional), que es lo deseable para el proyecto.

### Cuotas y el plan de Google One

El plan **Google One Basic (100 GB)** solo cambia el **espacio** disponible: 100 GB en vez de los
15 GB gratuitos. **No cambia** los límites de Apps Script ni hace falta para nada más:

- Apps Script (cuenta de consumidor): **20.000** llamadas a servicios externos por día, **90 min**
  de ejecución por día y **6 min** por ejecución. Con 22 fichas se usan ~150 llamadas en total.
- El tope práctico por archivo es de decenas de MB; por eso la app manda cada archivo por separado.
- Los archivos subidos **consumen espacio de la cuenta dueña del script**. Con 100 GB hay de sobra
  (22 puntos × ~6 fotos × 4 MB ≈ 0,5 GB).

En resumen: el plan ayuda por el espacio y la tranquilidad, no por la velocidad ni por permisos.

### Varias personas

- Todos usan **la misma URL y clave**; no hay que invitar a nadie: el script corre con la cuenta
  del dueño y guarda en su Drive.
- Cada teléfono guarda las fichas localmente y las sube cuando tiene internet.
- La clave protege el script: sin ella, cualquiera que descubriera la URL podría subir archivos.
  Si se filtra, se cambia `CLAVE` y se vuelve a implementar (la app pide la nueva).

## 6. Respaldo

- **Respaldo (.json)**: todas las fichas (sin fotos ni croquis), para pasar los datos a otro
  teléfono o respaldar antes de actualizar.
- **Fotos (ZIP)**: todas las fotografías con un índice CSV.
- **Avance (CSV)** y **puntos (GeoJSON)**: para revisar el avance en Excel/QGIS.
- Los datos viven **en el teléfono** (IndexedDB). La nube es Drive, y solo sube lo que se pide.

## 7. Sin internet

- La app abre y funciona completa: fichas, fotos, PDF, respaldo y cálculos.
- **El croquis y la subida a Drive se completan solos** cuando vuelve el internet (el croquis de
  las fichas guardadas, y la subida si se tiene la subida automática activada).
- El botón **Mi ubicación** del detalle usa el GPS del teléfono (no necesita datos) y muestra la
  distancia y el rumbo hasta el punto.

## 8. Publicar la app (GitHub Pages) con el API KEY

El publicador está **en la carpeta de arriba** (`Inspección Geocaliza/publicar.bat`), junto a esta
carpeta, y publica solo `inspeccion-gnss/` (no toca el resto del repositorio).

Doble clic en **`publicar.bat`**. El script:

1. **Pide el API KEY (token) de GitHub** la primera vez. Se pega sin que se vea en pantalla y queda
   guardado en el **Administrador de credenciales de Windows**; las siguientes veces no lo pide
   (con `publicar.bat -GuardarToken` se reemplaza). Crear el token en GitHub →
   *Settings → Developer settings → Personal access tokens*: token clásico con permiso **`repo`**
   (lo más simple, permite crear repositorios) o fine-grained con *Contents*, *Pages* y
   *Administration*.
2. Muestra **la lista de tus repositorios** y permite:
   - escribir el **número** de uno existente, o
   - escribir un **nombre nuevo** → lo **crea** (público, que es lo que GitHub Pages necesita) y
     activa Pages en la rama `gh-pages`.
   Si ya hay un repositorio recordado, primero pregunta: *Enter* para usarlo, o el nombre de otro
   (existente o nuevo). Con `-Nuevo` obliga a pedir el nombre desde cero.
3. Publica la app en la subcarpeta `inspeccion-gnss/` y actualiza la versión de `sw.js` para que
   los teléfonos se actualicen solos.
4. Al terminar **imprime el enlace para compartir**, lo **copia al portapapeles** y lo deja
   anotado en `Inspección Geocaliza/publicar.url.txt`:

```
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
