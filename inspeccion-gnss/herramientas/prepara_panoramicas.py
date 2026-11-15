# -*- coding: utf-8 -*-
"""Copia las panorámicas de cada VA a img/panoramica/VA-xx-xx.jpg (redimensionadas)."""
import os

from PIL import Image

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FOT = os.path.join(RAIZ, "FOTOS-20261115T170244Z-1-001", "FOTOS")
SAL = os.path.join(RAIZ, "inspeccion-gnss", "img", "panoramica")
os.makedirs(SAL, exist_ok=True)

ANCHO = 1100        # suficiente para verla a pantalla completa en el teléfono
CALIDAD = 78

hechas, faltan = [], []
for carpeta in sorted(os.listdir(FOT)):
    d = os.path.join(FOT, carpeta)
    if not os.path.isdir(d):
        continue
    va = "VA" + carpeta[2:]          # RG-50-01 -> VA-50-01
    # se aceptan nombres como VA-PANORAMICA, VA PANORAMICA, Pano_VA_50_01 o Panoramica_VA_54_02
    pan = [f for f in os.listdir(d)
           if ("panoramic" in f.lower() or "pano" in f.lower())
           and f.lower().endswith((".jpg", ".jpeg", ".png"))]
    pan = [f for f in pan if not f.lower().startswith("img_") and "coordenada" not in f.lower()]
    if not pan:
        faltan.append(va)
        continue
    origen = os.path.join(d, sorted(pan)[0])
    im = Image.open(origen).convert("RGB")
    # respetar la orientación EXIF si la hubiera
    try:
        from PIL import ImageOps
        im = ImageOps.exif_transpose(im)
    except Exception:  # noqa: BLE001
        pass
    if im.width > ANCHO:
        alto = round(im.height * ANCHO / im.width)
        im = im.resize((ANCHO, alto), Image.LANCZOS)
    destino = os.path.join(SAL, va + ".jpg")
    calidad = CALIDAD
    while True:
        im.save(destino, "JPEG", quality=calidad, optimize=True, progressive=True)
        if os.path.getsize(destino) <= 170 * 1024 or calidad <= 60:
            break
        calidad -= 8
    hechas.append((va, sorted(pan)[0], im.size, os.path.getsize(destino) // 1024))

for va, nom, tam, kb in hechas:
    print(f"OK  {va:13} {nom:24} {tam[0]}x{tam[1]}  {kb} KB")
print()
print("con panorama:", len(hechas), "· sin panorama:", len(faltan), (faltan or ""))
print("total:", sum(k for *_, k in hechas), "KB en", SAL)
