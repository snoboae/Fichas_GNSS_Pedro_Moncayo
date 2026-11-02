# -*- coding: utf-8 -*-
"""Saca el croquis de ubicación de cada monografía (PCA01, PCA03, PCA04) para que la app
lo muestre como los otros 22 (img/croquis/<código>.jpg).

En la página, el croquis va en la columna izquierda (bajo "CROQUIS DE UBICACIÓN") y la
fotografía en la derecha; se elige por la caja donde está colocado cada imagen.
"""
import io
import os

import pymupdf
from PIL import Image

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PDF = os.path.join(BASE, "Ejemplos informes e imagenes", "30 MONOGRAFIA_PCA-signed.pdf")
DESTINO = os.path.join(BASE, "inspeccion-gnss", "img", "croquis")
OBJETIVO = ("PCA01", "PCA03", "PCA04")

doc = pymupdf.open(PDF)
os.makedirs(DESTINO, exist_ok=True)
hechos = []

for pagina in doc:
    texto = pagina.get_text()
    cod = next((c for c in OBJETIVO if c in texto and c not in hechos), None)
    if not cod:
        continue

    # y de la etiqueta "CROQUIS"
    y_etiq = None
    for w in pagina.get_text("words"):
        if w[4] == "CROQUIS":
            y_etiq = w[1]
            break
    if y_etiq is None:
        print(cod, ": sin etiqueta de croquis")
        continue

    mejor = None
    for img in pagina.get_images(full=True):
        xref = img[0]
        for r in pagina.get_image_rects(xref):
            # columna izquierda y justo debajo de la etiqueta
            if r.x0 > 290 or r.y0 < y_etiq - 15 or r.y0 > y_etiq + 70:
                continue
            area = (r.x1 - r.x0) * (r.y1 - r.y0)
            if area < 5000:
                continue
            if not mejor or area > mejor[0]:
                mejor = (area, xref)
    if not mejor:
        print(cod, ": no se encontró el croquis")
        continue

    pix = pymupdf.Pixmap(doc, mejor[1])
    if pix.n - pix.alpha >= 4:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
    if img.width > 1400:
        img = img.resize((1400, round(img.height * 1400 / img.width)), Image.LANCZOS)
    salida = os.path.join(DESTINO, cod + ".jpg")
    img.save(salida, "JPEG", quality=82, optimize=True)
    hechos.append(cod)
    print(f"{cod}: {img.size[0]}x{img.size[1]}  {os.path.getsize(salida) // 1024} KB")

faltan = [c for c in OBJETIVO if c not in hechos]
print("faltan:", faltan if faltan else "ninguno")
