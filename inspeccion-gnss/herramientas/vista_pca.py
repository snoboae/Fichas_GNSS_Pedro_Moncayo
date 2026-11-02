# -*- coding: utf-8 -*-
"""Vista esquemática de los 30 puntos PCA (sin imagen satelital: el servicio no entrega
teselas a esta escala). Sirve para ver la distribución antes de abrirlos en ArcGIS."""
import math
import os

from PIL import Image, ImageDraw, ImageFont
from pyproj import CRS, Transformer

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CSV = os.path.join(BASE, "Shapefiles", "pca_monografia", "pca_monografia.csv")
SALIDA = os.path.join(BASE, "Shapefiles", "pca_monografia", "vista_pca.png")

W, H, M = 1500, 1100, 90
utm2geo = Transformer.from_crs(CRS.from_epsg(32717), CRS.from_epsg(4326), always_xy=True)

puntos = []
with open(CSV, encoding="utf-8-sig") as f:
    cab = f.readline().strip().split(";")
    for linea in f:
        v = linea.rstrip("\n").split(";")
        if len(v) < 5:
            continue
        d = dict(zip(cab, v))
        puntos.append((d["CODIGO"], float(d["ESTE"]), float(d["NORTE"])))

ex = [p[1] for p in puntos]
ny = [p[2] for p in puntos]
minx, maxx = min(ex) - 250, max(ex) + 250
miny, maxy = min(ny) - 250, max(ny) + 250
escala = min((W - 2 * M) / (maxx - minx), (H - 2 * M) / (maxy - miny))

img = Image.new("RGB", (W, H), (245, 246, 248))
dib = ImageDraw.Draw(img, "RGBA")

try:
    ft = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 26)
    fs = ImageFont.truetype("C:/Windows/Fonts/segoeuib.ttf", 16)
    fp = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 14)
except Exception:
    ft = fs = fp = ImageFont.load_default()


def px(e, n):
    return (M + (e - minx) * escala, H - M - (n - miny) * escala)


# rejilla cada 1 km
e0 = math.ceil(minx / 1000) * 1000
while e0 < maxx:
    x, _ = px(e0, miny)
    dib.line([(x, M - 20), (x, H - M)], fill=(208, 213, 220), width=1)
    dib.text((x + 4, H - M + 6), f"{e0 / 1000:.0f}", font=fp, fill=(120, 128, 140))
    e0 += 1000
n0 = math.ceil(miny / 1000) * 1000
while n0 < maxy:
    _, y = px(minx, n0)
    dib.line([(M - 20, y), (W - M, y)], fill=(208, 213, 220), width=1)
    dib.text((6, y - 8), f"{n0 / 1000:.0f}", font=fp, fill=(120, 128, 140))
    n0 += 1000

# puntos
for cod, e, n in puntos:
    x, y = px(e, n)
    dib.ellipse([x - 8, y - 8, x + 8, y + 8], fill=(198, 40, 40), outline=(255, 255, 255), width=2)
    dib.text((x + 12, y - 9), cod.replace("PCA", ""), font=fs, fill=(30, 40, 55))

# títulos, escala y notas
dib.text((M, 24), "Puntos de control PCA · Rumiñahui", font=ft, fill=(20, 35, 60))
dib.text((M, 58), f"{len(puntos)} puntos · WGS 84 / UTM 17S · ejes en kilómetros (UTM)",
         font=fp, fill=(90, 100, 115))

largo = 1000 * escala
x0, y0 = M, H - 34
dib.line([(x0, y0), (x0 + largo, y0)], fill=(20, 35, 60), width=3)
for xm in (x0, x0 + largo):
    dib.line([(xm, y0 - 6), (xm, y0 + 6)], fill=(20, 35, 60), width=3)
dib.text((x0 + largo / 2 - 16, y0 + 8), "1 km", font=fp, fill=(20, 35, 60))

dib.text((W - M - 200, 24), "N ↑", font=fs, fill=(20, 35, 60))
dib.text((W - M - 200, 52), "ejes: este / norte UTM", font=fp, fill=(120, 128, 140))

img.save(SALIDA)
print("vista:", SALIDA, img.size, "· escala", round(escala, 3), "px/m")
