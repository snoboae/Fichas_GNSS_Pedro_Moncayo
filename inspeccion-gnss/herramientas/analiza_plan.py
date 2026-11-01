# -*- coding: utf-8 -*-
"""Analiza el plan de campo por sesiones (día · horario · receptor) y comprueba si
   la VUELTA reproduce la IDA al revés a nivel de sesión.

   Uso: analiza_plan.py
"""
import io
import math
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Tabla de la imagen: (día, ruta, horario, [GNSS4, GNSS5, GNSS6])
SESIONES = [
    ("1-2", "Primer orden (bases)", "08:00-16:00", None),
    ("3", "IDA Occidente", "08:00-10:00", ["RG-52-02", "RG-52-01", "RG-53-03"]),
    ("3", "IDA Occidente", "11:00-13:00", ["RG-52-04", "RG-53-04", "RG-53-02"]),
    ("3", "IDA Occidente", "14:00-16:00", ["RG-51-02", "RG-51-01", "RG-53-01"]),
    ("4", "IDA Centro", "08:00-10:00", ["RG-51-03", "RG-50-04", "RG-50-05"]),
    ("4", "IDA Oriente urbano", "11:00-13:00", ["RG-50-03", "RG-54-04", "RG-50-02"]),
    ("4", "IDA Oriente urbano", "14:00-16:00", ["RG-54-03", "RG-54-02", "RG-54-01"]),
    ("5", "VUELTA Oriente", "08:00-10:00", ["RG-54-03", "RG-54-01", "RG-54-02"]),
    ("5", "VUELTA Oriente", "11:00-13:00", ["RG-50-03", "RG-50-02", "RG-54-04"]),
    ("5", "VUELTA Oriente", "14:00-16:00", ["RG-51-03", "RG-50-05", "RG-50-04"]),
    ("6", "VUELTA Occidente", "08:00-10:00", ["RG-53-01", "RG-51-02", "RG-51-01"]),
    ("6", "VUELTA Occidente", "11:00-13:00", ["RG-53-02", "RG-52-04", "RG-53-04"]),
    ("6", "VUELTA Occidente", "14:00-16:00", ["RG-53-03", "RG-52-01", "RG-52-02"]),
]
BASES = ["RG-52-03", "RG-50-01", "RG-50-06"]

def leer_puntos():
    texto = io.open(os.path.join(RAIZ, "js", "datos.js"), encoding="utf-8").read()
    puntos = {}
    for m in re.finditer(r'"c":\s*"([^"]+)".*?"parroquia":\s*"([^"]+)".*?"e":\s*([\d.]+),\s*"n":\s*([\d.]+).*?"orden":\s*(\d)', texto, re.S):
        puntos[m.group(1)] = {"parroquia": m.group(2), "e": float(m.group(3)), "n": float(m.group(4)), "orden": int(m.group(5))}
    return puntos

P = leer_puntos()
moviles = [s for s in SESIONES if s[3]]

print("SESIONES DE CAMPO")
for dia, ruta, hor, codes in moviles:
    print(f"  Día {dia} · {hor} · {ruta:<22} → {', '.join(codes)}")

print("\n1) ¿Cada punto aparece una vez en la ida y una vez en la vuelta?")
ida = [c for s in moviles[:6] for c in s[3]]
vuelta = [c for s in moviles[6:] for c in s[3]]
print("   ida   :", len(ida), "fichas ·", len(set(ida)), "puntos distintos")
print("   vuelta:", len(vuelta), "fichas ·", len(set(vuelta)), "puntos distintos")
print("   misma lista:", sorted(ida) == sorted(vuelta))

print("\n2) ¿La vuelta repite las mismas sesiones al revés?")
ok = True
for i in range(6):
    a, b = set(moviles[i][3]), set(moviles[11 - i][3])
    igual = a == b
    ok = ok and igual
    print(f"   IDA {i + 1} {moviles[i][2]:<12} {'=' if igual else '≠'} VUELTA {6 - i} {moviles[11 - i][2]:<12} {'✓' if igual else '✗ ' + str(sorted(a ^ b))}")
print("   conclusión:", "la vuelta es la ida al revés, sesión por sesión" if ok else "hay diferencias")

print("\n3) ¿El orden dentro de cada sesión (asignación a GNSS 4/5/6) es el espejo?")
for i in range(6):
    a, b = moviles[i][3], moviles[11 - i][3]
    print(f"   IDA  {a}  →  VUELTA {b}   {'espejo exacto' if b == list(reversed(a)) else 'no es espejo: ' + str(b)}")

print("\n4) Tamaño geográfico de cada sesión (¿son puntos vecinos?)")
def dist(a, b):
    return math.hypot(a["e"] - b["e"], a["n"] - b["n"])
for dia, ruta, hor, codes in moviles:
    ds = [(codes[i], codes[j], dist(P[codes[i]], P[codes[j]])) for i in range(len(codes)) for j in range(i + 1, len(codes))]
    mayor = max(d[2] for d in ds)
    print(f"   Día {dia} {hor}: separación máxima {mayor:,.0f} m")
    distancias = ", ".join(f"{a[3:]}-{b[3:]} {d:,.0f} m" for a, b, d in ds)
    print(f"      {distancias}")

print("\n5) Recorrido por día (centro de cada sesión y distancia entre centros)")
centros = {}
for dia, ruta, hor, codes in moviles:
    e = sum(P[c]["e"] for c in codes) / len(codes)
    n = sum(P[c]["n"] for c in codes) / len(codes)
    centros.setdefault(dia, []).append((hor, e, n, codes))
for dia, lista in centros.items():
    total = 0.0
    prev = None
    for hor, e, n, codes in lista:
        if prev:
            total += math.hypot(e - prev[0], n - prev[1])
        prev = (e, n)
    print(f"   Día {dia}: {total / 1000:.1f} km entre los centros de sus 3 sesiones ({lista[0][3][0][:5]} → {lista[-1][3][-1][:5]})")

print("\n6) Puntos del diseño y sus sesiones planificadas")
for c in sorted(P):
    n = ida.count(c) + vuelta.count(c)
    rol = "BASE" if c in BASES else ("móvil" if n else "SIN PLAN")
    print(f"   {c}: {n} ficha(s) · {rol}")
