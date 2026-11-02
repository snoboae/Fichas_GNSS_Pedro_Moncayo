# -*- coding: utf-8 -*-
"""Extrae los puntos de "30 MONOGRAFIA_PCA-signed.pdf" y arma un shapefile para ArcGIS.

Cada página es la monografía de un punto (PCA01…PCA30) con dos juegos de coordenadas:
  - UTM 17S (Transversa de Mercator)  -> es la que se usa
  - Proyección local TM-Rumiñahui     -> se guarda aparte (columnas LOC_*)
Se distinguen por la posición en la página (la UTM va en la columna izquierda) y se
verifican convirtiendo la latitud/longitud del propio PDF con pyproj.
"""
import os
import re

import unicodedata

import pymupdf
import shapefile
from pyproj import CRS, Transformer

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # inspeccion-gnss
BASE = os.path.dirname(APP)                                            # Inspección Geocaliza
PDF = os.path.join(BASE, "Ejemplos informes e imagenes", "30 MONOGRAFIA_PCA-signed.pdf")
SALIDA = os.path.join(BASE, "Shapefiles", "pca_monografia")

UTM = CRS.from_epsg(32717)                       # WGS 84 / UTM zona 17S
LOCAL = CRS.from_proj4(                          # TM-Rumiñahui (parámetros del PDF)
    "+proj=tmerc +lat_0=0 +lon_0=-78.5 +k=1.0004584 "
    "+x_0=778275 +y_0=10000000 +ellps=GRS80 +units=m +no_defs")
a_utm = Transformer.from_crs(CRS.from_epsg(4326), UTM, always_xy=True)
a_loc = Transformer.from_crs(CRS.from_epsg(4326), LOCAL, always_xy=True)


# ------------------------------------------------------------------ utilidades
def filas(pagina):
    """Palabras agrupadas por renglón, ordenadas por x."""
    palabras = sorted(pagina.get_text("words"), key=lambda r: (round(r[1] / 3), r[0]))
    grupos = []
    for w in palabras:
        if grupos and abs(grupos[-1]["y"] - w[1]) <= 2.5:
            grupos[-1]["w"].append(w)
        else:
            grupos.append({"y": w[1], "w": [w]})
    for g in grupos:
        g["w"].sort(key=lambda r: r[0])
    return grupos


def etiquetas(grupos, nombres):
    """[{x, y, x1, n}] de las etiquetas del encabezado, en orden de x."""
    salida = []
    for g in grupos:
        for w in g["w"]:
            if w[4] in nombres:
                salida.append({"x": w[0], "y": w[1], "x1": w[2], "n": w[4]})
    return sorted(salida, key=lambda e: e["x"])


def valor_debajo(grupos, etiqueta, x_limite):
    """Texto debajo de una etiqueta (los valores van en el renglón siguiente)."""
    for g in grupos:
        if not (etiqueta["y"] + 4 <= g["y"] <= etiqueta["y"] + 22):
            continue
        trozos = [w[4] for w in g["w"] if etiqueta["x"] - 12 <= w[0] < x_limite]
        if trozos:
            return re.sub(r"\s+", " ", " ".join(trozos)).strip()
    return ""


def dms_a_decimal(txt, hemis):
    m = re.match(r"(\d+)\D+(\d+)\D+([\d.]+)", txt or "")
    if not m:
        return None
    val = float(m.group(1)) + float(m.group(2)) / 60 + float(m.group(3)) / 3600
    return -val if (hemis or "").upper() in ("S", "O", "W") else val


def geografica(grupos, nombre):
    """('78°27'25.65206"', 'O') de la etiqueta indicada."""
    for g in grupos:
        textos = [w[4] for w in g["w"]]
        if nombre not in textos:
            continue
        i = textos.index(nombre)
        num = hemis = None
        for w in g["w"][i + 1:]:
            if num is None and re.search(r"\d+\D+\d+\D+[\d.]+", w[4]):
                num = w[4]
            elif num and hemis is None and w[4] in ("O", "W", "E", "N", "S"):
                hemis = w[4]
        if num:
            return num, hemis
    return None, None


def coords_utm(grupos):
    """Lee las dos columnas de coordenadas por posición, no por renglón.

    La maquetación cambia de una página a otra (a veces el número va sobre la etiqueta),
    así que se usan las columnas 'COORDENADAS UTM' y 'PROYECCIÓN LOCAL' del encabezado:
      - Este  = número menor a 900000
      - Norte = número mayor o igual a 900000
    """
    x_utm = x_loc = None
    y_desde = y_hasta = None
    for fila in grupos:
        for w in fila["w"]:
            if w[4] == "UTM" and x_utm is None:
                x_utm = w[0]
                y_desde = fila["y"] + 2
            if w[4].startswith("PROYECCI") and x_loc is None:
                x_loc = w[0]
            if w[4] == "Zona:" and y_hasta is None:
                y_hasta = fila["y"] - 1
    if x_utm is None:
        return None
    corte = (x_loc - 25) if x_loc else (x_utm + 120)

    utm = {"e": None, "n": None}
    loc = {"e": None, "n": None}
    for fila in grupos:
        for w in fila["w"]:
            if not re.match(r"^\d{5,7}[.,]\d+$", w[4]):
                continue
            if y_desde and w[1] < y_desde:
                continue
            if y_hasta and w[1] > y_hasta + 4:
                continue
            if w[0] < x_utm - 45:
                continue
            valor = float(w[4].replace(",", "."))
            destino = utm if w[0] < corte else loc
            clave = "e" if valor < 900000 else "n"
            if destino[clave] is None:
                destino[clave] = valor
    if utm["e"] is None or utm["n"] is None:
        return None
    return {
        "este": utm["e"], "norte": utm["n"],
        "loc_e": loc["e"], "loc_n": loc["n"],
    }


def recorta(txt, maximo=230):
    """Recorta por bytes (el DBF cuenta bytes, no letras)."""
    b = (txt or "").encode("utf-8")
    if len(b) <= maximo:
        return txt
    return b[:maximo].decode("utf-8", "ignore").rstrip(" ,;.") + "…"


def normaliza(txt, canon=None):
    """Une variantes con y sin tilde (Sangolqui / Sangolquí)."""
    txt = limpiar(txt)
    if not canon:
        return txt
    sin = lambda s: "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower()
    for bien in canon:
        if sin(bien) == sin(txt):
            return bien
    return txt


def limpiar(txt):
    return re.sub(r"\s+", " ", txt or "").strip()


# ------------------------------------------------------------------ recorrido
doc = pymupdf.open(PDF)
puntos, avisos = [], []
PARROQUIAS = ("Sangolquí", "Cotogchoa", "San Pedro", "San Rafael", "Fajardo")
CORTES = ("CONTROL VERTICAL", "ANTENA RECEPTOR", "Accesibilidad:", "Materialización del punto",
          "Observaciones:", "Elaborado por:", "CROQUIS", "FOTOGRAFÍA", "Descripción")

for n, pagina in enumerate(doc, start=1):
    texto = pagina.get_text()
    g = filas(pagina)

    cod = re.search(r"PCA\s*0*(\d+)", texto)
    if not cod:
        avisos.append(f"p{n}: sin nominativo")
        continue
    codigo = "PCA%02d" % int(cod.group(1))

    lon_txt, lon_h = geografica(g, "Longitud")
    lat_txt, lat_h = geografica(g, "Latitud")
    lon = dms_a_decimal(lon_txt, lon_h or "O")
    lat = dms_a_decimal(lat_txt, lat_h or "S")

    coords = coords_utm(g)
    if not coords:
        avisos.append(f"{codigo}: sin coordenadas")
        continue
    este, norte = coords["este"], coords["norte"]
    loc_e, loc_n = coords["loc_e"], coords["loc_n"]

    enc = etiquetas(g, ["Provincia:", "Cantón:", "Parroquia:", "Sector:"])
    campos = {}
    for i, e in enumerate(enc):
        limite = enc[i + 1]["x"] - 2 if i + 1 < len(enc) else 10000
        campos[e["n"].rstrip(":")] = valor_debajo(g, e, limite)

    alt = None
    for fila in g:
        if any(w[4] == "Alt." for w in fila["w"]):
            for w in fila["w"]:
                if re.match(r"^\d{3,5}[.,]\d+$", w[4]):
                    alt = float(w[4].replace(",", "."))
                    break
            if alt:
                break

    fecha = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", texto)
    zona = re.search(r"\b(1[78])\s*S\b", texto)
    datum = re.search(r"ITRF\s*\d{4}", texto)
    epoca = re.search(r"Época de referencia:\s*\n?\s*([\d.]+)", texto)

    equipo = ("TOPCON Hiper V" if re.search(r"Hiper\s*V", texto)
              else ("TOPCON" if "TOPCON" in texto else ""))

    desc = ""
    m = re.search(r'El punto\s*"?%s"?\s*(.*)' % re.escape(codigo), texto, re.S)
    if m:
        resto = limpiar(m.group(1))
        for corte in CORTES:
            i = resto.find(corte)
            if i > 20:
                resto = resto[:i]
        desc = limpiar(resto)

    # control: la UTM del PDF debe coincidir con la calculada desde lat/lon
    control = ""
    if lat is not None and lon is not None:
        e2, n2 = a_utm.transform(lon, lat)
        dx, dy = e2 - este, n2 - norte
        if abs(dx) > 1 or abs(dy) > 1:
            control = f"revisar: UTM del PDF difiere {dx:+.2f} E / {dy:+.2f} N de lat/lon"
            avisos.append(f"{codigo}: {control} (lat/lon da {e2:.3f}/{n2:.3f})")
        if loc_e and loc_n:
            e3, n3 = a_loc.transform(lon, lat)
            if abs(e3 - loc_e) < 1.5 and abs(n3 - loc_n) < 1.5 and not control:
                control = "ok (UTM y local coherentes)"

    puntos.append({
        "codigo": codigo,
        "provincia": normaliza(campos.get("Provincia", "")),
        "canton": normaliza(campos.get("Cantón", "")),
        "parroquia": normaliza(campos.get("Parroquia", ""), PARROQUIAS),
        "sector": normaliza(campos.get("Sector", "")),
        "este": round(este, 3), "norte": round(norte, 3),
        "lat": round(lat, 9) if lat is not None else None,
        "lon": round(lon, 9) if lon is not None else None,
        "altitud": alt,
        "loc_e": round(loc_e, 3) if loc_e else None,
        "loc_n": round(loc_n, 3) if loc_n else None,
        "fecha": fecha.group(1) if fecha else "",
        "zona": (zona.group(0) if zona else "17 S").replace(" ", ""),
        "datum": datum.group(0) if datum else "ITRF2008",
        "epoca": epoca.group(1) if epoca else "",
        "equipo": equipo, "descripcion": desc, "control": control,
    })

# ------------------------------------------------------------------ shapefile
os.makedirs(SALIDA, exist_ok=True)
base = os.path.join(SALIDA, "pca_monografia")

with open(base + ".prj", "w", encoding="ascii") as f:
    f.write(UTM.to_wkt(version="WKT1_ESRI"))

with shapefile.Writer(base, shapeType=shapefile.POINT, encoding="utf-8") as w:
    w.field("CODIGO", "C", 12)
    w.field("PROVINCIA", "C", 24)
    w.field("CANTON", "C", 24)
    w.field("PARROQUIA", "C", 28)
    w.field("SECTOR", "C", 40)
    w.field("ESTE", "N", 13, 3)
    w.field("NORTE", "N", 13, 3)
    w.field("LATITUD", "N", 13, 9)
    w.field("LONGITUD", "N", 13, 9)
    w.field("ALTITUD", "N", 9, 3)
    w.field("ZONA", "C", 6)
    w.field("DATUM", "C", 12)
    w.field("EPOCA", "C", 8)
    w.field("FECHA", "C", 10)
    w.field("EQUIPO", "C", 24)
    w.field("LOC_E", "N", 13, 3)
    w.field("LOC_N", "N", 13, 3)
    w.field("CONTROL", "C", 90)
    w.field("DESCRIP", "C", 240)
    for p in puntos:
        w.point(p["este"], p["norte"])
        w.record(p["codigo"], p["provincia"], p["canton"], p["parroquia"], p["sector"],
                 p["este"], p["norte"], p["lat"], p["lon"], p["altitud"],
                 p["zona"], p["datum"], p["epoca"], p["fecha"], p["equipo"],
                 p["loc_e"], p["loc_n"], recorta(p["control"], 85), recorta(p["descripcion"], 236))

with open(base + ".cpg", "w", encoding="ascii") as f:
    f.write("UTF-8")

# ------------------------------------------------------------------ CSV
csv = os.path.join(SALIDA, "pca_monografia.csv")
cols = ["codigo", "provincia", "canton", "parroquia", "sector", "este", "norte",
        "lat", "lon", "altitud", "zona", "datum", "epoca", "fecha", "equipo",
        "loc_e", "loc_n", "control", "descripcion"]
with open(csv, "w", encoding="utf-8-sig", newline="") as f:
    f.write(";".join(c.upper() for c in cols) + "\n")
    for p in puntos:
        f.write(";".join(limpiar(str(p[c] if p[c] is not None else "")) for c in cols) + "\n")

print(f"puntos: {len(puntos)}  ({puntos[0]['codigo']} … {puntos[-1]['codigo']})")
print(f"este  : {min(p['este'] for p in puntos):.1f} .. {max(p['este'] for p in puntos):.1f}")
print(f"norte : {min(p['norte'] for p in puntos):.1f} .. {max(p['norte'] for p in puntos):.1f}")
print(f"altitud: {min(p['altitud'] for p in puntos):.1f} .. {max(p['altitud'] for p in puntos):.1f}")
print("parroquias:", sorted({p['parroquia'] for p in puntos}))
sec = sorted({p['sector'] for p in puntos})
print("sectores:", sec[:8], "…" if len(sec) > 8 else "")
print("fechas:", sorted({p['fecha'] for p in puntos}))
print("avisos:", len(avisos))
for a in avisos:
    print("  -", a)
print("archivos en", SALIDA)
for nombre in sorted(os.listdir(SALIDA)):
    print(f"  {nombre}  {os.path.getsize(os.path.join(SALIDA, nombre)):,} bytes".replace(",", "."))
