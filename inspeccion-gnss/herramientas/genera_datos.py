# -*- coding: utf-8 -*-
"""Genera js/datos.js (catálogo de los 22 puntos de la red geodésica).

Fuente: "Informe_2de3_Inspeccion_Pedro_Moncayo_2310.docx" (Tabla 1: diseño de la red
geodésica, Tabla 2: resumen de intervenciones por sitio y sección 4: inspección in situ).
Las coordenadas están en WGS84 / UTM zona 17S (EPSG:32717).

Uso:  python herramientas/genera_datos.py
Requiere: python-docx (solo si se quiere volver a leer el informe; el catálogo ya va aquí).
"""
import json
import os
import re
import sys

# --------------------------------------------------------------------------------------
# 1) Catálogo base: Tabla 1 del informe (N°, Orden, Código, Este, Norte, Parroquia, Sitio)
#    + Tabla 2 (elemento/materialización y trabajos previstos por sitio).
# --------------------------------------------------------------------------------------
PUNTOS = [
    # codigo, orden, parroquia, sector, este, norte, materializacion
    ("RG-50-01", "Primer", "Tabacundo", "Mirador Mojanda", 807122, 10009255, "Mojón Tipo A"),
    ("RG-50-02", "Tercer", "Tabacundo", "Sector Simón Bolívar - Isleta canalizadora", 811669, 10006902, "Mojón Tipo B"),
    ("RG-50-03", "Tercer", "Tabacundo", "Parque central - Iglesia", 809287, 10005365, "Placa 12 cm"),
    ("RG-50-04", "Segundo", "Tabacundo", "Casa Comunal Luis Freire - Sector 3", 812900, 10003854, "Placa 12 cm"),
    ("RG-50-05", "Tercer", "Tabacundo", "Casa Comunal de Angumba", 810625, 10003279, "Placa 12 cm"),
    ("RG-50-06", "Primer", "Tabacundo", "Loma de Canamvalle", 812951, 10001897, "Mojón Tipo A"),
    ("RG-51-01", "Segundo", "La Esperanza", "Tanque de distribución Guaraqui", 805008, 10006707, "Mojón Tipo B"),
    ("RG-51-02", "Tercer", "La Esperanza", "Parque central La Esperanza", 806137, 10004512, "Placa 12 cm"),
    ("RG-51-03", "Tercer", "La Esperanza", "Cubinche - Iglesia Cubinche", 806901, 10001902, "Mojón Tipo B"),
    ("RG-52-01", "Segundo", "Malchingui", "Sector Yanatola - Reservorio agua", 796195, 10007787, "Mojón Tipo B"),
    ("RG-52-02", "Tercer", "Malchingui", "Santa Marianitas - coliseo", 795475, 10005316, "Placa 12 cm"),
    ("RG-52-03", "Primer", "Malchingui", "Casa Comunal San Juan", 792000, 10003255, "Mojón Tipo A"),
    ("RG-52-04", "Tercer", "Malchingui", "Entrada pista de aeromodelismo", 794886, 9998945, "Mojón Tipo B"),
    ("RG-53-01", "Tercer", "Tocachi", "Parque Central Tocachi", 801783, 10004956, "Placa 12 cm"),
    ("RG-53-02", "Tercer", "Tocachi", "Iglesia Cochasquí", 798999, 10003905, "Placa 12 cm"),
    ("RG-53-03", "Segundo", "Tocachi", "Vía al Parque Arqueológico Cochasquí", 801246, 10001352, "Placa 12 cm"),
    ("RG-53-04", "Segundo", "Tocachi", "Parque Tanda", 796607, 9999844, "Placa 12 cm"),
    ("RG-54-01", "Segundo", "Tupigachi", "Casa Comunal Santa Mónica", 811397, 10013407, "Placa 12 cm"),
    ("RG-54-02", "Segundo", "Tupigachi", "Loma Gorda - Parada de buses", 813086, 10011519, "Mojón Tipo B"),
    ("RG-54-03", "Segundo", "Tupigachi", "Bellavista - Casa Comunal", 810260, 10010277, "Mojón Tipo B"),
    ("RG-54-04", "Tercer", "Tupigachi", "Centro de Tupigachi - Barrio La Estación", 813611, 10008853, "Mojón Tipo B"),
    # El informe (Tabla 2) lo ubica en Tupigachi, pero la Tabla 1 —la del diseño con
    # coordenadas— lo asigna a La Esperanza: la vía a las Lagunas de Mojanda sale de
    # La Esperanza. Se toma La Esperanza (ver PENDIENTES.md).
    ("RG-SF-51-01", "Segundo", "La Esperanza", "Vía a Lagunas de Mojanda", 805328, 10011160, "Mojón Tipo B"),
]

# Trabajos previstos (Tabla 2) según la materialización.
TRABAJOS = {
    "Mojón Tipo A": "Excavación de 0,80 m x 0,80 m y profundidad de hasta 1,20 m; fundición de "
                    "mojón de concreto tipo IGM (base inferior 0,60 x 0,60 m; base superior "
                    "0,25 x 0,25 m; altura 0,90 a 1,20 m) con placa de aluminio empotrada.",
    "Mojón Tipo B": "Excavación de 0,65 m x 0,65 m y profundidad de 0,30 m; fundición de mojón de "
                    "concreto tipo IGM (base inferior 0,45 x 0,45 m; base superior 0,25 x 0,25 m; "
                    "altura 0,30 m) con placa de aluminio empotrada.",
    "Placa 12 cm": "Empotramiento a ras de suelo de una placa de aluminio de 12 cm de diámetro "
                   "(calado circular superficial y fijación con mortero).",
}

# Notas de la inspección in situ (sección 4 del informe), por código.
NOTAS = {
    "RG-50-01": ["Mirador turístico de gran afluencia: socializar con los líderes del sector para evitar "
                 "malentendidos sobre supuestas privatizaciones del suelo.",
                 "Punto de vista atrás VA-50-01: placa de 5 cm a ~50 m al norte del hito, sobre el bordillo."],
    "RG-50-02": ["Conseguir la socialización del presidente del barrio para implantar el hito en el espacio "
                 "público de tierra identificado, garantizando la libre circulación vehicular.",
                 "Punto de vista atrás VA-50-02: placa de 5 cm a ~50 m al noreste del hito, sobre el bordillo."],
    "RG-50-03": ["Caso puntual: la placa se instala en el graderío de la iglesia; requiere negociación con el "
                 "párroco y autorización formal para intervenir infraestructura patrimonial.",
                 "Punto de vista atrás VA-50-03: placa de 5 cm a ~50 m al oeste del hito, sobre el bordillo."],
    "RG-50-04": ["Remover el adoquín de la superficie, excavar 0,65 x 0,65 m, fundir el mojón y reinstalar "
                 "los adoquines circundantes; requiere autorización del presidente de la casa comunal.",
                 "Punto de vista atrás VA-50-04: a ~60 m al suroeste del hito."],
    "RG-50-05": ["Calado circular superficial sobre la vereda interna de la casa comunal; explicar a la "
                 "directiva los beneficios técnicos y firmar el acta de conformidad.",
                 "Punto de vista atrás VA-50-05: placa de 5 cm a ~30 m al oeste del hito, sobre la vereda."],
    "RG-50-06": ["Reconfirmar con Relaciones Comunitarias el acta formal que autorice la excavación y la "
                 "presencia de antenas a 50 m (figura como 'ya socializado por el GAD').",
                 "Punto de vista atrás VA-50-06: mojón cilíndrico a ~80 m al oeste, junto al camino de acceso."],
    "RG-51-01": ["Coordinar con la junta de agua o el presidente comunitario el uso del espacio junto al "
                 "tanque; el punto se reubicará en la zona plana próxima.",
                 "Punto de vista atrás VA-51-01: mojón cilíndrico a ~50 m al oeste del hito."],
    "RG-51-02": ["Validar que árboles o postes a 10-20 m no afecten las lecturas satelitales futuras.",
                 "Punto de vista atrás VA-51-02: placa de 5 cm a ~50 m al este del hito, sobre una vereda."],
    "RG-51-03": ["Solicitar permiso formal a los encargados de la iglesia para intervenir el atrio."],
    "RG-52-01": ["Coordinar con la comunidad el acceso al reservorio de agua."],
    "RG-52-02": ["Coordinar con la administración del coliseo el horario de intervención."],
    "RG-52-03": ["Socializar con la directiva de la casa comunal; excavación profunda de 1,20 m."],
    "RG-52-04": ["Verificar la no interferencia con la operación de la pista de aeromodelismo."],
    "RG-53-01": ["Coordinar con el GAD parroquial de Tocachi el permiso de intervención del parque."],
    "RG-53-02": ["Intervención en el atrio de la iglesia de Cochasquí: coordinar con la comunidad."],
    "RG-53-03": ["Punto en la vía al Parque Arqueológico: prever seguridad vial durante la observación."],
    "RG-53-04": ["Coordinar con el GAD parroquial el uso del parque Tanda."],
    "RG-54-01": ["Coordinar con la directiva de la casa comunal Santa Mónica."],
    "RG-54-02": ["Punto junto a la parada de buses: prever seguridad y libre circulación peatonal."],
    "RG-54-03": ["Coordinar con la directiva de Bellavista."],
    "RG-54-04": ["Punto en el barrio La Estación: coordinar con la directiva barrial."],
    "RG-SF-51-01": ["Punto adicional (no fiscalizado por el IGM). Verificar el estado de la vía a las "
                    "Lagunas de Mojanda y la visibilidad satelital del sitio."],
}

PROYECTO = {
    "nombre": "Implementación de un Sistema de Red Geodésica para el Cantón Pedro Moncayo",
    "producto": "Registro de campo de la red geodésica",
    "contrato": "Contrato N.° 004-CPC-GADMPM-2026-VSC",
    "proceso": "CPC-GADMPM-2026-006",
    "entidad": "GAD Municipal del Cantón Pedro Moncayo",
    "area": "Dirección de Gestión de Avalúos y Catastros",
    "consultor": "GEOCALIZA — Consultoría Integral",
    "provincia": "Pichincha",
    "canton": "Pedro Moncayo",
    "zona": 17,
    "hemisferio": "S",
    "epsg": "EPSG:32717",
    "datum": "WGS84",
    "epoca": "",
}

ORDEN_NUM = {"Primer": 1, "Segundo": 2, "Tercer": 3}


def tranformar():
    filas = []
    for cod, orden, parr, sector, e, n, mat in PUNTOS:
        filas.append({
            "c": cod,
            "nombre": sector,
            "parroquia": parr,
            "sector": sector,
            "e": e,
            "n": n,
            "orden": ORDEN_NUM[orden],
            "mat": mat,
            "trabajos": TRABAJOS[mat],
            "notas": NOTAS.get(cod, []),
        })
    # Orden natural por código: RG-50-01 … RG-54-04, RG-SF-51-01
    def clave_codigo(p):
        m = re.match(r"^RG-(\d{2}|SF)-(\d{2})-(\d{2})$", p["c"])
        return (m.group(1) == "SF", m.group(1), m.group(2), m.group(3)) if m else (True, p["c"], "", "")

    filas.sort(key=clave_codigo)
    return filas


def validar(filas):
    """Comprueba las coordenadas contra pyproj si está disponible."""
    try:
        from pyproj import Transformer
    except ImportError:
        print("AVISO: pyproj no disponible, no se validan coordenadas.")
        return
    tr = Transformer.from_crs("EPSG:32717", "EPSG:4326", always_xy=True)
    print(f"{'CÓDIGO':<14}{'ESTE':>9}{'NORTE':>10}   {'LATITUD':>12}{'LONGITUD':>13}")
    for p in filas:
        lon, lat = tr.transform(p["e"], p["n"])
        if not (-0.35 <= lat <= 0.30 and -78.75 <= lon <= -78.10):
            print("  !! fuera del cantón:", p["c"], lat, lon)
        print(f"{p['c']:<14}{p['e']:>9}{p['n']:>10}   {lat:>12.7f}{lon:>13.7f}")


def escribir_js(filas, destino):
    cab = (
        "/* Catálogo de los puntos de la red geodésica del Cantón Pedro Moncayo.\n"
        "   GENERADO por herramientas/genera_datos.py — no editar a mano.\n"
        "   Fuente: Informe de la inspección in situ de los 21 puntos de control (2 de 3),\n"
        "   Tablas 1 y 2 y sección 4. Coordenadas WGS84 / UTM 17S (EPSG:32717).\n"
        "   El orden de los campos y el texto de 'trabajos' y 'notas' provienen del informe. */\n"
    )
    cuerpo = []
    cuerpo.append("const PROYECTO = " + json.dumps(PROYECTO, ensure_ascii=False, indent=2) + ";\n")
    cuerpo.append("const PUNTOS = [")
    for p in filas:
        cuerpo.append("  " + json.dumps(p, ensure_ascii=False) + ",")
    cuerpo.append("];\n")
    cuerpo.append(
        "/* Materializaciones que ofrece la ficha (el diseño se propone, la ficha registra lo ejecutado). */\n"
        "const MATERIALIZACIONES = ['Mojón Tipo A', 'Mojón Tipo B', 'Placa 12 cm', 'Placa 5 cm', 'Otro'];\n\n"
        "/* Receptores GNSS disponibles en el equipo de campo. */\n"
        "const RECEPTORES = ['Hi-Target V90', 'Gintec G40 Pro', 'Gintec G40 Plus', 'Foif A60 Pro'];\n"
    )
    with open(destino, "w", encoding="utf-8", newline="\n") as f:
        f.write(cab + "\n".join(cuerpo))
    print("Escrito:", destino, "puntos:", len(filas))


if __name__ == "__main__":
    filas = tranformar()
    validar(filas)
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    escribir_js(filas, os.path.join(raiz, "js", "datos.js"))
