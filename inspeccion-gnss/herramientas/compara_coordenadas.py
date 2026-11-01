# -*- coding: utf-8 -*-
"""Busca los códigos de punto en los PDF del informe y de la monografía y muestra
   las coordenadas que aparecen allí. Uso: compara_coordenadas.py RG-52-02 RG-54-04"""
import os
import re
import sys

import pymupdf

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
EJEMPLOS = os.path.join(RAIZ, "Ejemplos informes e imagenes")

PDFS = [
    ("INFORME", "Informe_2de3_Inspeccion_Pedro_Moncayo_2310.pdf"),
    ("MONOGRAFIA", "30 MONOGRAFIA_PCA-signed.pdf"),
]

def texto_de(nombre):
    ruta = os.path.join(EJEMPLOS, nombre)
    doc = pymupdf.open(ruta)
    partes = []
    for i, pagina in enumerate(doc):
        t = pagina.get_text("text")
        if t:
            partes.append((i + 1, t))
    doc.close()
    return partes

codigos = sys.argv[1:] or ["RG-52-02", "RG-54-04"]

for etiqueta, archivo in PDFS:
    print("=" * 70)
    print(etiqueta, "·", archivo)
    try:
        paginas = texto_de(archivo)
    except Exception as e:  # noqa: BLE001
        print("  no se pudo leer:", e)
        continue
    print("  páginas:", len(paginas))
    for cod in codigos:
        encontrados = 0
        for num, txt in paginas:
            plano = re.sub(r"\s+", " ", txt)
            if cod in plano:
                encontrados += 1
                pos = plano.find(cod)
                print(f"  [{cod}] pág {num}: …{plano[max(0, pos - 120):pos + 260]}…")
                if encontrados >= 2:
                    break
        if not encontrados:
            print(f"  [{cod}] no aparece en el texto")
