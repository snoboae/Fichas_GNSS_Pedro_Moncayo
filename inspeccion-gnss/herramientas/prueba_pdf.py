# -*- coding: utf-8 -*-
"""Utilidades de verificación para el desarrollo de la app (no forma parte de la app).

  1) genera un croquis y fotos de muestra para probar el PDF sin internet
  2) rasteriza un PDF a PNG para revisarlo a ojo
Uso:
  python herramientas/prueba_pdf.py demo      -> crea herramientas/_demo/*.jpg
  python herramientas/prueba_pdf.py render  archivo.pdf salida.png [dpi]
"""
import base64
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.join(AQUI, "_demo")


def croquis_demo(w=1400, h=886, path=None):
    """Imita una imagen satelital: manchas verdes/marrones, una vía y una sombra."""
    random.seed(7)
    im = Image.new("RGB", (w, h), (86, 104, 62))
    d = ImageDraw.Draw(im)
    for _ in range(260):
        x, y = random.randint(-80, w), random.randint(-80, h)
        r = random.randint(20, 150)
        c = random.choice([(70, 92, 52), (104, 118, 70), (128, 120, 84), (92, 84, 62), (58, 76, 46)])
        d.ellipse([x, y, x + r * 2, y + r], fill=c)
    # vía
    d.line([(-40, 620), (w + 40, 300)], fill=(176, 172, 160), width=26)
    d.line([(-40, 620), (w + 40, 300)], fill=(206, 202, 190), width=18)
    # techos
    for _ in range(40):
        x, y = random.randint(0, w - 90), random.randint(0, h - 70)
        d.rectangle([x, y, x + random.randint(30, 80), y + random.randint(24, 60)],
                    fill=random.choice([(150, 150, 158), (186, 178, 168), (120, 126, 130)]))
    im = im.filter(ImageFilter.GaussianBlur(1.1))
    d2 = ImageDraw.Draw(im)
    # etiqueta y punto, como los dibuja la app
    d2.rectangle([22, 22, 520, 110], fill=(255, 255, 255))
    d2.rectangle([22, 22, 28, 110], fill=(18, 58, 107))
    d2.text((44, 40), "RG-50-01", fill=(18, 58, 107))
    d2.text((44, 82), "UTM 17S - X 807.122 - Y 10.009.255", fill=(61, 76, 90))
    d2.ellipse([w // 2 - 17, h // 2 - 17, w // 2 + 17, h // 2 + 17], fill=(255, 255, 255))
    d2.ellipse([w // 2 - 9, h // 2 - 9, w // 2 + 9, h // 2 + 9], fill=(198, 40, 40))
    p = path or os.path.join(DEMO, "croquis.jpg")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, "JPEG", quality=88)
    return p


def foto_demo(w=1200, h=800, path=None, tono=(120, 132, 146)):
    im = Image.new("RGB", (w, h), tono)
    d = ImageDraw.Draw(im)
    d.rectangle([0, int(h * 0.62), w, h], fill=(96, 104, 74))
    d.rectangle([int(w * 0.18), int(h * 0.28), int(w * 0.62), int(h * 0.66)], fill=(178, 176, 168))
    d.rectangle([int(w * 0.18), int(h * 0.28), int(w * 0.62), int(h * 0.42)], fill=(150, 148, 140))
    d.ellipse([int(w * 0.72), int(h * 0.6), int(w * 0.86), int(h * 0.74)], fill=(214, 210, 200))
    p = path or os.path.join(DEMO, "foto.jpg")
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, "JPEG", quality=86)
    return p


def render(pdf_path, png_path, dpi=140):
    import pymupdf
    doc = pymupdf.open(pdf_path)
    for i, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi)
        out = png_path if len(doc) == 1 else png_path.replace(".png", f"-p{i + 1}.png")
        pix.save(out)
        print("render:", out, pix.width, "x", pix.height)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "demo":
        print(croquis_demo())
        print(foto_demo())
    elif len(sys.argv) > 1 and sys.argv[1] == "render":
        render(sys.argv[2], sys.argv[3], int(sys.argv[4]) if len(sys.argv) > 4 else 140)
    else:
        print(__doc__)
