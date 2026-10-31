/* Ajustes de la aplicación (valores de arranque).
   Lo que se cambie desde la app (pestaña Drive / Respaldo) queda guardado en el teléfono
   y tiene prioridad sobre estos valores. */
const CONFIG = {
  /* Puente con Google Drive (Google Apps Script).
     La URL del despliegue ya viene puesta; la CLAVE se escribe una vez en cada teléfono
     (pestaña Drive). Así la clave no queda publicada en el repositorio de GitHub.
     Instrucciones completas en el README. */
  driveScriptUrl: 'https://script.google.com/macros/s/AKfycbybhLqMYKUSv1x9VnsX4K5RPO9GFFAwu33GdYM1v6njOpuj4QJt8hwNZ9bMWj4fj2bn/exec',
  driveClave: '',

  /* Nombre de la carpeta raíz que crea el script en el Drive del dueño. */
  carpetaProyecto: 'Inspección GNSS - Pedro Moncayo',

  /* Tamaño máximo (px del lado mayor) de la copia liviana que se usa en la ficha.
     El original se conserva sin tocar para subirlo a Drive en alta resolución. */
  fotoLivianaPx: 1600,
  fotoMiniaturaPx: 240,

  /* Si el original pesa más que esto, a Drive se sube una copia de 3000 px
     (sigue siendo alta resolución y evita envíos demasiado grandes). */
  fotoMaxDriveMB: 8,

  version: '2.0.0'
};
