# -*- coding: utf-8 -*-
"""Croquis de los Puntos Vista Atrás: imagen satelital con el hito y su VA,
la línea entre ambos y la escala.

   Uso:  python herramientas/genera_croquis_va.py            (los 22)
         python herramientas/genera_croquis_va.py VA-50-01    (uno)
"""
import io
import math
import os
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
NAVY = (18, 58, 107)
ROJO = (198, 40, 40)
VERDE = (16, 122, 87)
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
    """PUNTOS_VA y PUNTOS desde datos.js usando node (evita reimplementar el parser)."""
    import json
    import subprocess

    node = os.environ.get("NODE_EXE", "node")
    guion = (
        "const fs=require('fs');"
        "const s=fs.readFileSync(process.argv[1],'utf8');"
        "const r=new Function('window', s + '; return {PUNTOS_VA, PUNTO_HITO};')({});"
        "const salida=r.PUNTOS_VA.map(p=>{const h=r.PUNTO_HITO(p.c)||{};"
        "return {c:p.c, e:p.e, n:p.n, eH:h.e, nH:h.n, hito:h.c||p.hito, fuente:p.fuente};});"
        "process.stdout.write(JSON.stringify(salida));"
    )
    datos = os.path.join(RAIZ, "js", "datos.js")
    salida = subprocess.run([node, "-e", guion, datos], capture_output=True, text=True, check=True)
    return json.loads(salida.stdout)


def world_px(lat, lon, z):
    s = 256 * (2 ** z)
    sin = math.sin(math.radians(lat))
    return ((lon + 180) / 360 * s, (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * s)


def descargar_tesela(z, x, y):
    req = urllib.request.Request(TILE.format(z=z, x=x, y=y), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        im = Image.open(io.BytesIO(r.read())).convert("RGB")
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
    lon1, lat1 = tr.transform(p["eH"], p["nH"])       # hito
    lon2, lat2 = tr.transform(p["e"], p["n"])         # VA

    # zoom según la separación, con repliegue si ese nivel no tiene imagen
    sep = math.hypot(p["e"] - p["eH"], p["n"] - p["nH"])
    lat_c = (lat1 + lat2) / 2

    def arma(z):
        mpp = 156543.03392 * math.cos(math.radians(lat_c)) / (2 ** z)
        cx1b, cy1b = world_px(lat1, lon1, z)
        cx2b, cy2b = world_px(lat2, lon2, z)
        cxb, cyb = (cx1b + cx2b) / 2, (cy1b + cy2b) / 2
        oxb, oyb = cxb - W / 2, cyb - H / 2
        x0b, x1b = int(math.floor(oxb / 256)), int(math.floor((oxb + W) / 256))
        y0b, y1b = int(math.floor(oyb / 256)), int(math.floor((oyb + H) / 256))
        topeb = 2 ** z
        lonab = Image.new("RGB", (W, H), (223, 230, 236))
        okb = 0
        for xb in range(x0b, x1b + 1):
            for yb in range(y0b, y1b + 1):
                if yb < 0 or yb >= topeb:
                    continue
                try:
                    imb = descargar_tesela(z, xb % topeb, yb)
                except Exception:  # noqa: BLE001
                    imb = None
                if imb:
                    lonab.paste(imb, (int(xb * 256 - oxb), int(yb * 256 - oyb)))
                    okb += 1
                time.sleep(0.02)
        return {
            "z": z, "mpp": mpp, "lona": lonab, "ok": okb,
            "px1": cx1b - oxb, "py1": cy1b - oyb, "px2": cx2b - oxb, "py2": cy2b - oyb,
        }

    candidatos = [19, 18, 17] if sep < 70 else [18, 17, 16]
    lona = None
    for z in candidatos:
        mpp = 156543.03392 * math.cos(math.radians(lat_c)) / (2 ** z)
        # que la separación quepa con margen
        if sep > 0.6 * min(W, H) * mpp:
            continue
        datos = arma(z)
        if datos["ok"] >= 2:
            break
        datos = None
    if not datos:
        raise RuntimeError("no se pudo descargar ninguna tesela")
    lona = datos["lona"]
    mpp = datos["mpp"]
    z = datos["z"]
    px1, py1 = datos["px1"], datos["py1"]
    px2, py2 = datos["px2"], datos["py2"]

    capa = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dib = ImageDraw.Draw(capa)
    # ---- línea entre hito y VA ----
    for color, ancho in (((255, 255, 255, 200), int(5 * K)), (VERDE + (235,), int(2.6 * K))):
        dib.line([(px1, py1), (px2, py2)], fill=color, width=ancho)

    # ---- marcador del HITO (cuadrado navy) ----
    s1 = 9 * K
    dib.rectangle([px1 - s1 - 2, py1 - s1 - 2, px1 + s1 + 2, py1 + s1 + 2], fill=(255, 255, 255, 240))
    dib.rectangle([px1 - s1, py1 - s1, px1 + s1, py1 + s1], fill=NAVY + (255,), outline=(0, 0, 0, 110), width=1)
    dib.line([(px1 - s1 * 2.2, py1), (px1 - s1, py1)], fill=(255, 255, 255, 230), width=int(3 * K))
    dib.line([(px1 + s1, py1), (px1 + s1 * 2.2, py1)], fill=(255, 255, 255, 230), width=int(3 * K))
    dib.line([(px1, py1 - s1 * 2.2), (px1, py1 - s1)], fill=(255, 255, 255, 230), width=int(3 * K))
    dib.line([(px1, py1 + s1), (px1, py1 + s1 * 2.2)], fill=(255, 255, 255, 230), width=int(3 * K))

    # ---- marcador del VA (círculo rojo con punto) ----
    r1, r2 = 8 * K, 15 * K
    dib.ellipse([px2 - r2, py2 - r2, px2 + r2, py2 + r2], fill=(255, 255, 255, 245))
    dib.ellipse([px2 - r1, py2 - r1, px2 + r1, py2 + r1], fill=ROJO + (255,), outline=(0, 0, 0, 90), width=max(1, int(2 * K)))
    dib.ellipse([px2 - 2.6 * K, py2 - 2.6 * K, px2 + 2.6 * K, py2 + 2.6 * K], fill=(255, 255, 255, 255))

    # ---- letra dentro de cada marca ----
    f_marca = fuente(int(13 * K), True)
    dib.text((px1, py1 + 0.5 * K), "H", font=f_marca, fill=(255, 255, 255, 255), anchor="mm")
    dib.text((px2, py2 + 0.5 * K), "V", font=f_marca, fill=(255, 255, 255, 255), anchor="mm")

    # ---- etiqueta del código del VA ----
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

    # ---- leyenda: hito y VA ----
    f_leg = fuente(int(17 * K), True)
    filas = [
        ("cuadrado", "HITO " + p["hito"], NAVY),
        ("circulo", p["c"], ROJO),
    ]
    lh = 30 * K
    ly = by + bh + 12 * K
    lw = 210 * K
    rounded(dib, (bx, ly, bx + lw, ly + lh * len(filas) + 12 * K), int(9 * K), (255, 255, 255, 242), NAVY + (110,), max(1, int(1.2 * K)))
    yy = ly + 10 * K
    for tipo, txt, col in filas:
        cx_ic, cy_ic = bx + 20 * K, yy + 10 * K
        if tipo == "cuadrado":
            dib.rectangle([cx_ic - 6 * K, cy_ic - 6 * K, cx_ic + 6 * K, cy_ic + 6 * K], fill=col + (255,))
            dib.text((cx_ic, cy_ic), "H", font=fuente(int(9 * K), True), fill=(255, 255, 255, 255), anchor="mm")
        elif tipo == "circulo":
            dib.ellipse([cx_ic - 6 * K, cy_ic - 6 * K, cx_ic + 6 * K, cy_ic + 6 * K], fill=col + (255,))
            dib.text((cx_ic, cy_ic), "V", font=fuente(int(9 * K), True), fill=(255, 255, 255, 255), anchor="mm")
        else:
            dib.line([(cx_ic - 9 * K, cy_ic), (cx_ic + 9 * K, cy_ic)], fill=col + (255,), width=max(2, int(3 * K)))
        dib.text((bx + 38 * K, cy_ic), txt, font=f_leg, fill=(22, 32, 43, 255), anchor="lm")
        yy += lh

    # ---- norte ----
    ncx, ncy, nr = W - 58 * K, 62 * K, 30 * K
    dib.ellipse([ncx - nr, ncy - nr, ncx + nr, ncy + nr], fill=(255, 255, 255, 235), outline=NAVY + (90,), width=max(1, int(1.2 * K)))
    dib.polygon([(ncx, ncy - 20 * K), (ncx + 9 * K, ncy + 10 * K), (ncx, ncy + 4 * K), (ncx - 9 * K, ncy + 10 * K)], fill=NAVY + (255,))
    dib.text((ncx, ncy + 27 * K), "N", font=fuente(int(15 * K), True), fill=TINTA + (255,), anchor="ms")

    # ---- escala ----
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
    return sep, z, os.path.getsize(salida)


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
            sep, z, tam = genera(p, salida)
            total += tam
            print(f"OK  {p['c']:<12} sep={sep:6.1f} m  z={z}  {tam / 1024:.0f} KB")
        except Exception as e:  # noqa: BLE001
            print(f"ERR {p['c']}: {e}")
    print(f"\n{len(puntos)} croquis · {total / 1048576:.2f} MB en {SALIDA}")


if __name__ == "__main__":
    main()
