# -*- coding: utf-8 -*-
"""Verifica la tabla de rutas IDA / VUELTA y la compara con el diseño de la red."""
import io
import math
import os
import re

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Tabla leída de la imagen (fila por fila, izquierda a derecha)
IDA = [
    ["RG-52-02", "RG-52-01", "RG-53-03"],
    ["RG-52-04", "RG-53-04", "RG-53-02"],
    ["RG-51-02", "RG-51-01", "RG-53-01"],
    ["RG-51-03", "RG-50-04", "RG-50-05"],
    ["RG-50-03", "RG-54-04", "RG-50-02"],
    ["RG-54-03", "RG-54-02", "RG-54-01"],
]
VUELTA = [
    ["RG-54-03", "RG-54-01", "RG-54-02"],
    ["RG-50-03", "RG-50-02", "RG-54-04"],
    ["RG-51-03", "RG-50-05", "RG-50-04"],
    ["RG-53-01", "RG-51-02", "RG-51-01"],
    ["RG-53-02", "RG-52-04", "RG-53-04"],
    ["RG-53-03", "RG-52-01", "RG-52-02"],
]

def leer_puntos():
    texto = io.open(os.path.join(RAIZ, "js", "datos.js"), encoding="utf-8").read()
    puntos = {}
    for m in re.finditer(r'"c":\s*"([^"]+)".*?"parroquia":\s*"([^"]+)".*?"e":\s*([\d.]+),\s*"n":\s*([\d.]+).*?"orden":\s*(\d)', texto, re.S):
        puntos[m.group(1)] = {"parroquia": m.group(2), "e": float(m.group(3)), "n": float(m.group(4)), "orden": int(m.group(5))}
    return puntos

def plano(tabla):
    return [c for fila in tabla for c in fila]

P = leer_puntos()
ida, vuelta = plano(IDA), plano(VUELTA)

print(f"puntos en el diseño: {len(P)}")
print(f"IDA: {len(ida)} fichas · VUELTA: {len(vuelta)} fichas · total {len(ida) + len(vuelta)}")

print("\n1) códigos que no existen en el diseño:", [c for c in ida + vuelta if c not in P] or "ninguno")

dup_i = [c for c in set(ida) if ida.count(c) > 1]
dup_v = [c for c in set(vuelta) if vuelta.count(c) > 1]
print("2) repetidos en IDA:", dup_i or "ninguno")
print("   repetidos en VUELTA:", dup_v or "ninguno")

print("3) misma lista en IDA y VUELTA:", sorted(ida) == sorted(vuelta))
print("4) VUELTA es la IDA al revés:", vuelta == list(reversed(ida)))

faltan = [c for c in sorted(P) if c not in ida]
print("\n5) puntos del diseño SIN ruta asignada:", faltan)
for c in faltan:
    print(f"   · {c}  ({P[c]['orden']}° orden, {P[c]['parroquia']})")

# 6) recorrido: distancia entre puntos consecutivos
def dist(a, b):
    dE, dN = b["e"] - a["e"], b["n"] - a["n"]
    return math.hypot(dE, dN)

print("\n6) tramos del recorrido IDA (m):")
total = 0.0
for i in range(len(ida) - 1):
    d = dist(P[ida[i]], P[ida[i + 1]])
    total += d
    if d > 3000:
        print(f"   {ida[i]} -> {ida[i + 1]}: {d:,.0f} m   (salto largo)")
print(f"   distancia total IDA: {total / 1000:,.1f} km")

print("\n7) parroquia de cada posición de la ruta IDA:")
for i, c in enumerate(ida, 1):
    print(f"   {i:2d}. {c}  {P[c]['parroquia']}")
