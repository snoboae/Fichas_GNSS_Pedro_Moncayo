/* Croquis de ubicación del punto.
   Los croquis de los 22 puntos ya vienen generados en img/croquis/<código>.jpg
   (herramientas/genera_croquis.py), así que en campo no hay que generarlos ni hace
   falta internet. Aquí solo queda el mapa interactivo de la vista de detalle. */
const Croquis = (() => {
  const LAYER = {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Imágenes © Esri, Maxar, Earthstar Geographics y la comunidad SIG',
    maxZoom: 18
  };
  const W = 1100, H = 696;           // tamaño de los croquis incluidos

  /* Mapa interactivo (Leaflet) para la vista de detalle. */
  function mapa(el, lat, lon, codigo) {
    const mapa = L.map(el, { zoomControl: true, attributionControl: true }).setView([lat, lon], 18);
    L.tileLayer(LAYER.url, { maxZoom: 19, maxNativeZoom: LAYER.maxZoom, attribution: 'Imágenes © Esri' }).addTo(mapa);
    const icono = L.divIcon({
      className: 'pin-gnss',
      html: '<div class="pin-halo"></div><div class="pin-core"></div>',
      iconSize: [26, 26], iconAnchor: [13, 13]
    });
    L.marker([lat, lon], { icon: icono, title: codigo }).addTo(mapa);
    return mapa;
  }

  return { mapa, LAYER, W, H };
})();