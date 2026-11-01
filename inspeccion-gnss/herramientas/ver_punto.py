# -*- coding: utf-8 -*-
"""Dibuja un recorte satelital (Esri) alrededor de un punto de la red, con una cruz
   en la coordenada de diseño y un círculo de 25 m de radio para juzgar el desfase.

   Uso: ver_punto.py RG-52-02 [zoom]
"""
import io
import json
import math
import os
import re
import sys
import urllib.request

from PIL import Image, ImageDraw
from pyproj import Transformer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "herramientas", "_demo")

TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36"

def leer_puntos():
    """Extrae c, parroquia, sector, e, n de js/datos.js sin ejecutar JS."""
    ruta = os.path.join(RAIZ, "js", "datos.js")
    texto = open(ruta, encoding="utf-8").read()
    puntos = []
    for m in re.finditer(r'"c":\s*"([^"]+)".*?"e":\s*([\d.]+),\s*"n":\s*([\d.]+)', texto, re.S):
        puntos.append({"c": m.group(1), "e": float(m.group(2)), "n": float(m.group(3))})
    return puntos

def tiles(lat, lon, z, nx, ny):
    """Devuelve la matriz de teselas que cubre el punto."""
    n = 2 ** z
    xt = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    yt = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    x0, y0 = int(xt) - nx // 2, int(yt) - ny // 2
    return x0, y0, xt, yt

def descargar(x, y, z):
    url = TILE.format(z=z, x=x, y=y)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")

def main():
    cod = sys.argv[1] if len(sys.argv) > 1 else "RG-52-02"
    z = int(sys.argv[2]) if len(sys.argv) > 2 else 18
    puntos = leer_puntos()
    p = next((x for x in puntos if x["c"] == cod), None)
    if not p:
        raise SystemExit("no encontré " + cod)

    tr = Transformer.from_crs("EPSG:32717", "EPSG:4326", always_xy=True)
    lon, lat = tr.transform(p["e"], p["n"])

    nx = ny = 4
    x0, y0, xt, yt = tiles(lat, lon, z, nx, ny)
    lienzo = Image.new("RGB", (256 * nx, 256 * ny))
    for i in range(nx):
        for j in range(ny):
            lienzo.paste(descargar(x0 + i, y0 + j, z), (256 * i, 256 * j))

    # posición del punto dentro del lienzo
    px = (xt - x0) * 256
    py = (yt - y0) * 256
    # metros por píxel en esta latitud y zoom
    mpp = 156543.03392804097 * math.cos(math.radians(lat)) / (2 ** z)

    dib = ImageDraw.Draw(lienzo)
    for radio_m, color in ((25, (255, 230, 0)), (100, (255, 120, 0))):
        r = radio_m / mpp
        dib.ellipse([px - r, py - r, px + r, py + r], outline=color, width=3)
    d = 26
    dib.line([px - d, py, px + d, py], fill=(255, 0, 0), width=4)
    dib.line([px, py - d, px, py + d], fill=(255, 0, 0), width=4)
    dib.ellipse([px - 6, py - 6, px + 6, py + 6], fill=(255, 0, 0))

    os.makedirs(SALIDA, exist_ok=True)
    destino = os.path.join(SALIDA, f"punto-{cod}.png")
    lienzo.save(destino)
    print(f"{cod}: E={p['e']:.0f} N={p['n']:.0f} -> lat={lat:.7f} lon={lon:.7f}")
    print(f"  ms/píxel en z{z}: {mpp:.2f} · imagen {lienzo.width}x{lienzo.height} · {destino}")

if __name__ == "__main__":
    main()
