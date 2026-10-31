# -*- coding: utf-8 -*-
"""Prepara los recursos gráficos de la app:
   - img/geocaliza.png, img/pedro-moncayo.png  (logos recortados, fondo blanco)
   - js/logos.js                               (los mismos logos en base64 para el PDF)
   - icons/icon-192.png, icon-512.png, icon-maskable-512.png
Uso: python herramientas/make_iconos.py
"""
import base64
import io
import os

from PIL import Image, ImageChops, ImageDraw

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.abspath(os.path.join(RAIZ, "..", "Ejemplos informes e imagenes"))
IMG = os.path.join(RAIZ, "img")
ICONS = os.path.join(RAIZ, "icons")

# Colores tomados de los logotipos
AZUL = (26, 62, 122)
VERDE = (124, 179, 66)
GRIS = (232, 236, 240)


def fondo_blanco(im, tol=14):
    """Convierte el fondo grisáceo del JPEG en blanco puro, sin tocar los blancos internos."""
    im = im.convert("RGB")
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            # fondo del logo de Pedro Moncayo = (247,247,247)
            if abs(r - g) < 6 and abs(g - b) < 6 and r >= 255 - tol - 8:
                px[x, y] = (255, 255, 255)
    return im


def recortar(im, margen=6):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 10 else 0)
    bb = diff.getbbox()
    if not bb:
        return im
    x0, y0, x1, y1 = bb
    x0 = max(0, x0 - margen); y0 = max(0, y0 - margen)
    x1 = min(im.size[0], x1 + margen); y1 = min(im.size[1], y1 + margen)
    return im.crop((x0, y0, x1, y1))


def guardar_logo(nombre_entrada, nombre_salida):
    im = Image.open(os.path.join(BASE, nombre_entrada))
    im = recortar(fondo_blanco(im))
    destino = os.path.join(IMG, nombre_salida)
    im.save(destino, "PNG", optimize=True)
    print(f"{nombre_salida}: {im.size[0]}x{im.size[1]} px, {os.path.getsize(destino)/1024:.1f} KB")
    return im, destino


def icono(tam, maskable=False):
    """Icono de la app: fondo azul, punto geodésico y texto GNSS."""
    S = tam * 4  # se dibuja grande y se reduce (antialias)
    im = Image.new("RGB", (S, S), AZUL)
    d = ImageDraw.Draw(im)
    if maskable:
        # zona segura: el contenido va al 60 % central
        k = 0.30
    else:
        k = 0.16
    x0 = int(S * k); x1 = S - x0
    cy = int(S * 0.44)
    r = int((x1 - x0) * 0.30)
    # anillo satelital
    d.ellipse([x0 + 6, cy - r + 6, x1 - 6, cy + r - 6], outline=VERDE, width=int(S * 0.030))
    # círculos concéntricos (ondas GNSS)
    for i, f in enumerate((0.42, 0.62)):
        rr = int(r * f)
        d.ellipse([S // 2 - rr, cy - rr, S // 2 + rr, cy + rr], outline=(255, 255, 255), width=int(S * 0.012))
    # punto central
    rr = int(r * 0.20)
    d.ellipse([S // 2 - rr, cy - rr, S // 2 + rr, cy + rr], fill=VERDE)
    # texto
    try:
        from PIL import ImageFont
        f = ImageFont.truetype("arialbd.ttf", int(S * 0.17))
    except Exception:
        f = None
    txt = "GNSS"
    tw = d.textlength(txt, font=f) if f else S * 0.4
    d.text((S / 2 - tw / 2, S * 0.66), txt, font=f, fill=(255, 255, 255))
    return im.resize((tam, tam), Image.LANCZOS)


def main():
    os.makedirs(IMG, exist_ok=True)
    os.makedirs(ICONS, exist_ok=True)
    g_img, g_path = guardar_logo("Geocaliza.jpeg", "geocaliza.png")
    p_img, p_path = guardar_logo("Pedro Moncayo.jpeg", "pedro-moncayo.png")

    with open(os.path.join(RAIZ, "js", "logos.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("/* Logos institucionales en base64 (generado por herramientas/make_iconos.py).\n"
                "   Se incluyen en el PDF sin pedir nada a la red. */\n")
        f.write("const LOGOS = {\n")
        for clave, ruta, im in (("geocaliza", g_path, g_img), ("pedroMoncayo", p_path, p_img)):
            b = base64.b64encode(open(ruta, "rb").read()).decode("ascii")
            f.write(f"  {clave}: {{ w: {im.size[0]}, h: {im.size[1]}, data: 'data:image/png;base64,{b}' }},\n")
        f.write("};\n")
    print("js/logos.js:", os.path.getsize(os.path.join(RAIZ, "js", "logos.js")) / 1024, "KB")

    icono(192).save(os.path.join(ICONS, "icon-192.png"), "PNG", optimize=True)
    icono(512).save(os.path.join(ICONS, "icon-512.png"), "PNG", optimize=True)
    icono(512, maskable=True).save(os.path.join(ICONS, "icon-maskable-512.png"), "PNG", optimize=True)
    for f in sorted(os.listdir(ICONS)):
        print("icons/", f, os.path.getsize(os.path.join(ICONS, f)) // 1024, "KB")


if __name__ == "__main__":
    main()
