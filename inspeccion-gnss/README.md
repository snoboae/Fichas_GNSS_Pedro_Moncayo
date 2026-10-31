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

1. **Puntos** → *Seleccionar punto* (lista desplegable con los 22 códigos del diseño).
2. Al elegir un código aparecen las dos opciones:
   - **IR AL PUNTO** → abre Maps con la ruta al punto.
   - **LEVANTAR FICHA** → abre el formulario con los datos del punto ya llenos.
3. Se completan los datos de la observación, se toman las fotos y se pulsa **Guardar ficha**.
4. El punto queda con **✓ verde** en la lista desplegable y en la lista de puntos.

Campos con candado (🔒) = vienen del diseño de la red y no se editan:

| Se llena automáticamente | Lo llena el operador en campo |
|---|---|
| Código, nombre del punto, parroquia, sector/sitio, orden, coordenada X e Y (UTM 17S), materialización propuesta, fecha (la del inicio) | Receptor GNSS, altura de la antena, **inicio** y **fin** (fecha y hora juntos), operador, fotografía del punto, fotografía de la placa, descripción, accesibilidad y observaciones |

**Fijo por el TR (no se pide):** posicionamiento **estático diferencial**, máscara **10°**,
intervalo **1 s**. La app lo imprime en la ficha.

## 2. Croquis

Se arma automáticamente con la **imagen satelital Esri** (World Imagery) centrada en el punto, con
el punto marcado, norte, escala gráfica, código y coordenadas UTM.

> En el cantón Pedro Moncayo Esri entrega imagen hasta el **zoom 18**; en el 19 responde con la
> tesela "Map data not yet available". La app lo detecta y usa solo la imagen real.

**Se completa solo si falta:** si una ficha se guarda sin croquis (por falta de señal), la app la
marca como *sin croquis* y lo genera automáticamente cuando vuelve el internet (al abrir la app o
al recuperar conexión), sin que el operador haga nada. La ficha se vuelve a marcar como pendiente
de subir, para que el PDF que llegue a Drive ya tenga el croquis.

### Preparar los croquis en oficina (recomendado antes de salir a campo)

En **Puntos → "Preparar croquis de los 22 puntos"** la app genera y guarda el croquis de todos los
puntos de una vez (~1 segundo por punto). Después, al abrir una ficha **sin internet**, el croquis
ya está listo.

## 3. Fotografías

- **Del punto** y **de la placa**. Se pueden tomar con la cámara o elegir de la galería.
- En la ficha se imprimen **dos**: la **primera** foto del punto y la **primera** de la placa.
- Las **adicionales** se guardan y se suben a Drive, pero no se imprimen (así lo indica la app en
  cada foto: *"En la ficha"* / *"Solo Drive"*).
- Se guardan **dos versiones**: el **original de la cámara** (alta resolución, es el que se sube a
  Drive) y una **copia liviana de 1600 px** para la ficha y el PDF. Si el original supera 8 MB, a
  Drive se envía una copia de 3000 px (sigue siendo alta resolución).
- En la pestaña Drive hay una opción para **liberar los originales** después de subirlos.

## 4. La ficha (PDF de una sola hoja)

A4 horizontal, una página, con los logos del GAD Pedro Moncayo y de Geocaliza:

1. **Identificación del punto** — nombre, código, orden, fecha, provincia, cantón, parroquia, sector.
2. **Ubicación, materialización y observación** — Este/Norte, zona UTM y datum, método y parámetros
   del TR; materialización, receptor, altura de antena y **inicio – fin** de la observación.
3. **Croquis de ubicación** (imagen satelital).
4. **Registro fotográfico** — foto del punto y foto de la placa.
5. **Observaciones y accesibilidad**.
6. **Firma del operador** y una nota que aclara que es un registro de campo.

Desde **Detalle** se puede descargar o compartir el PDF, exportar el punto a GeoJSON o descargar
las fotos en un ZIP. Ejemplo: `../Ejemplos fichas/Ejemplo ficha RG-50-01 (una hoja).pdf`.

## 5. Google Drive (sin OAuth, con un script de Google)

La app sube los archivos a un **Google Apps Script** publicado por el dueño de la carpeta. No hay
que crear proyecto en Google Cloud, no hay pantalla de permisos de Google y no caduca.

### Qué se crea en Drive

```
Inspección GNSS - Pedro Moncayo/           ← la crea el script en el Drive del dueño
   2026-10-31/                             ← una carpeta por día de observación
      RG-50-01/
         RG-50-01.pdf                      ← la ficha de una hoja
         RG-50-01_punto_1.jpg              ← fotografías en resolución original
         RG-50-01_punto_2.jpg
         RG-50-01_placa_1.jpg
         datos_RG-50-01.json               ← todos los datos de la ficha
```

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
| `js/mapimg.js` | croquis satelital Esri + mapa interactivo |
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
