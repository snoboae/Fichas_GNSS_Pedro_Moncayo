# -*- coding: utf-8 -*-
"""Genera los croquis de ubicación de todos los puntos y los guarda como JPEG en
   inspeccion-gnss/img/croquis/<código>.jpg (mismo diseño que el croquis de la app:
   imagen satelital Esri, cruz del punto, etiqueta, norte, escala y atribución).

   Uso:
     python herramientas/genera_croquis.py            # todos los puntos
     python herramientas/genera_croquis.py RG-52-02   # solo uno

   Se vuelve a ejecutar cuando cambien las coordenadas del diseño.
"""
import io
import json
import math
import os
import re
import sys
import time
import urllib.request

from PIL import Image, ImageDraw, ImageFont, ImageStat
from pyproj import Transformer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SALIDA = os.path.join(RAIZ, "img", "croquis")
TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/156.0.0.0 Safari/537.36"

W, H = 1100, 696
K = W / 1200.0
Z = 18                      # en Pedro Moncayo Esri tiene imagen hasta z18
NAVY = (18, 58, 107)
ROJO = (198, 40, 40)
TINTA = (22, 32, 43)
GRIS = (61, 76, 90)
ATRIB = "Imágenes © Esri, Maxar, Earthstar Geographics y la comunidad SIG"

FUENTES = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")

def fuente(px, bold=False):
    for nombre in (("arialbd.ttf" if bold else "arial.ttf"), ("segoeuib.ttf" if bold else "segoeui.ttf")):
        ruta = os.path.join(FUENTES, nombre)
        if os.path.exists(ruta):
            return ImageFont.truetype(ruta, px)
    return ImageFont.load_default()

def miles(n):
    return f"{n:,.0f}".replace(",", ".")

def leer_puntos():
    texto = open(os.path.join(RAIZ, "js", "datos.js"), encoding="utf-8").read()
    puntos = []
    for m in re.finditer(r'"c":\s*"([^"]+)".*?"e":\s*([\d.]+),\s*"n":\s*([\d.]+)', texto, re.S):
        puntos.append({"c": m.group(1), "e": float(m.group(2)), "n": float(m.group(3))})
    return puntos

def world_px(lat, lon, z):
    s = 256 * (2 ** z)
    sin = math.sin(math.radians(lat))
    return ((lon + 180) / 360 * s, (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * s)

def descargar_tesela(z, x, y):
    req = urllib.request.Request(TILE.format(z=z, x=x, y=y), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
    # ¿tesela "Map data not yet available"? (uniforme y clara)
    est = ImageStat.Stat(im.convert("L").resize((24, 24)))
    if est.mean[0] > 195 and est.stddev[0] < 9:
        return None
    return im

def rounded(dib, caja, radio, relleno, borde=None, grosor=1):
    dib.rounded_rectangle(caja, radius=radio, fill=relleno, outline=borde, width=grosor)

def texto_ancho(dib, txt, f):
    caja = dib.textbbox((0, 0), txt, font=f)
    return caja[2] - caja[0]

def genera(p, salida):
    tr = Transformer.from_crs("EPSG:32717", "EPSG:4326", always_xy=True)
    lon, lat = tr.transform(p["e"], p["n"])

    cx, cy = world_px(lat, lon, Z)
    ox, oy = cx - W / 2, cy - H / 2
    x0, x1 = int(math.floor(ox / 256)), int(math.floor((ox + W) / 256))
    y0, y1 = int(math.floor(oy / 256)), int(math.floor((oy + H) / 256))
    tope = 2 ** Z

    lona = Image.new("RGB", (W, H), (223, 230, 236))
    ok = 0
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            if y < 0 or y >= tope:
                continue
            try:
                im = descargar_tesela(Z, x % tope, y)
            except Exception:  # noqa: BLE001
                im = None
            if im:
                lona.paste(im, (int(x * 256 - ox), int(y * 256 - oy)))
                ok += 1
            time.sleep(0.02)

    if ok == 0:
        raise RuntimeError("no se pudo descargar ninguna tesela")

    capa = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dib = ImageDraw.Draw(capa)
    px, py = cx - ox, cy - oy

    # ---- cruz del punto ----
    r1, r2, tick = 9 * K, 17 * K, 30 * K
    for color, ancho in (((255, 255, 255, 235), 5 * K), (ROJO + (255,), 2.6 * K)):
        for (ax, ay, bx, by) in ((-tick, 0, -r1, 0), (r1, 0, tick, 0), (0, -tick, 0, -r1), (0, r1, 0, tick)):
            dib.line([(px + ax, py + ay), (px + bx, py + by)], fill=color, width=int(round(ancho)))
    dib.ellipse([px - r2, py - r2, px + r2, py + r2], fill=(255, 255, 255, 235))
    dib.ellipse([px - r1, py - r1, px + r1, py + r1], fill=ROJO + (255,), outline=(0, 0, 0, 90), width=max(1, int(2 * K)))

    # ---- etiqueta del código ----
    f1, f2 = fuente(int(30 * K), True), fuente(int(18 * K))
    l1 = p["c"]
    l2 = f"UTM 17S · X {miles(p['e'])} · Y {miles(p['n'])}"
    w1, w2 = texto_ancho(dib, l1, f1), texto_ancho(dib, l2, f2)
    pad, h1, h2 = 14 * K, 36 * K, 24 * K
    bx, by = 22 * K, 22 * K
    bw, bh = max(w1, w2) + pad * 2, h1 + h2 + pad * 1.4
    rounded(dib, (bx, by, bx + bw, by + bh), int(9 * K), (255, 255, 255, 242), NAVY + (128,), max(1, int(1.4 * K)))
    rounded(dib, (bx, by, bx + 5.5 * K, by + bh), int(2.5 * K), NAVY + (255,))
    dib.text((bx + pad, by + h1 - 4 * K), l1, font=f1, fill=NAVY + (255,), anchor="ls")
    dib.text((bx + pad, by + h1 + h2 - 5 * K), l2, font=f2, fill=GRIS + (255,), anchor="ls")

    # ---- norte ----
    ncx, ncy, nr = W - 58 * K, 62 * K, 30 * K
    dib.ellipse([ncx - nr, ncy - nr, ncx + nr, ncy + nr], fill=(255, 255, 255, 235), outline=NAVY + (90,), width=max(1, int(1.2 * K)))
    dib.polygon([(ncx, ncy - 20 * K), (ncx + 9 * K, ncy + 10 * K), (ncx, ncy + 4 * K), (ncx - 9 * K, ncy + 10 * K)], fill=NAVY + (255,))
    dib.text((ncx, ncy + 27 * K), "N", font=fuente(int(15 * K), True), fill=TINTA + (255,), anchor="ms")

    # ---- escala ----
    mpp = 156543.03392 * math.cos(math.radians(lat)) / (2 ** Z)
    bruto = mpp * W * 0.2
    pot = 10 ** math.floor(math.log10(bruto))
    f = bruto / pot
    largo = (5 if f >= 5 else 2 if f >= 2 else 1) * pot
    ancho_px = largo / mpp
    sbx, sby = 30 * K, H - 34 * K
    rounded(dib, (sbx - 14 * K, sby - 30 * K, sbx + ancho_px + 14 * K, sby + 22 * K), int(7 * K), (255, 255, 255, 235))
    dib.rectangle([sbx, sby - 3 * K, sbx + ancho_px, sby + 3 * K], fill=TINTA + (255,))
    dib.rectangle([sbx, sby - 3 * K, sbx + ancho_px / 2, sby + 3 * K], fill=(255, 255, 255, 255))
    dib.rectangle([sbx, sby - 3 * K, sbx + ancho_px, sby + 3 * K], outline=TINTA + (255,), width=max(1, int(1.2 * K)))
    etiqueta = (f"{largo / 1000:g} km" if largo >= 1000 else f"{largo:g} m")
    dib.text((sbx, sby - 12 * K), etiqueta, font=fuente(int(17 * K), True), fill=TINTA + (255,), anchor="ls")

    # ---- atribución ----
    fa = fuente(int(15 * K))
    ta = texto_ancho(dib, ATRIB, fa)
    dib.rectangle([W - ta - 20 * K, H - 28 * K, W, H], fill=(255, 255, 255, 224))
    dib.text((W - 10 * K, H - 8 * K), ATRIB, font=fa, fill=(36, 52, 65, 255), anchor="rs")

    # ---- marco ----
    dib.rectangle([1.5 * K, 1.5 * K, W - 1.5 * K, H - 1.5 * K], outline=NAVY + (115,), width=max(2, int(3 * K)))

    final = Image.alpha_composite(lona.convert("RGBA"), capa).convert("RGB")
    os.makedirs(os.path.dirname(salida), exist_ok=True)
    final.save(salida, "JPEG", quality=85, optimize=True)
    return lat, lon, os.path.getsize(salida)

def main():
    codigos = sys.argv[1:]
    puntos = leer_puntos()
    if codigos:
        puntos = [p for p in puntos if p["c"] in codigos]
    if not puntos:
        raise SystemExit("no hay puntos para generar")
    total = 0
    for p in puntos:
        salida = os.path.join(SALIDA, p["c"] + ".jpg")
        try:
            lat, lon, tam = genera(p, salida)
            total += tam
            print(f"OK  {p['c']:<12} lat={lat:.7f} lon={lon:.7f}  {tam / 1024:.0f} KB")
        except Exception as e:  # noqa: BLE001
            print(f"ERR {p['c']}: {e}")
    print(f"\n{len(puntos)} croquis · {total / 1048576:.2f} MB en {SALIDA}")

if __name__ == "__main__":
    main()
