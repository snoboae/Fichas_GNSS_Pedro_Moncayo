# -*- coding: utf-8 -*-
"""Comprueba hasta qué nivel de zoom hay imagen Esri en los puntos del proyecto.
   Uso: python herramientas/verifica_teselas.py"""
import io
import math
import urllib.request

from PIL import Image, ImageStat

PTS = {
    'RG-50-01': (0.0836352, -78.2410432),
    'RG-52-03': (0.0294179, -78.3767925),
    'RG-54-04': (0.0799984, -78.1827979),
    'RG-SF-51-01': (0.1008516, -78.2571454),
}
BASE = ('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery'
        '/MapServer/tile/{z}/{y}/{x}')


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.log(math.tan(math.radians(lat)) + 1.0 / math.cos(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


for nombre, (lat, lon) in PTS.items():
    for z in (16, 17, 18, 19):
        x, y = tile_xy(lat, lon, z)
        url = BASE.format(z=z, y=y, x=x)
        try:
            datos = urllib.request.urlopen(url, timeout=25).read()
            im = Image.open(io.BytesIO(datos)).convert('RGB')
            st = ImageStat.Stat(im.resize((32, 32)))
            desv = sum(st.stddev) / 3.0
            print(f'{nombre:14s} z{z}  {len(datos)//1024:4d} KB  desviacion={desv:6.1f}')
        except Exception as e:  # noqa: BLE001
            print(f'{nombre:14s} z{z}  ERROR {e}')
