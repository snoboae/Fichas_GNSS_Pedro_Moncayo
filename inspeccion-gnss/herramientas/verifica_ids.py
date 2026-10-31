# -*- coding: utf-8 -*-
"""Comprueba que todos los ids que usa app.js existan en index.html.
   Uso: python herramientas/verifica_ids.py"""
import os
import re

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = open(os.path.join(raiz, 'js', 'app.js'), encoding='utf-8').read()
html = open(os.path.join(raiz, 'index.html'), encoding='utf-8').read()

ids_app = set(re.findall(r"\$\('([A-Za-z0-9_-]+)'\)", app))
ids_html = set(re.findall(r'id="([A-Za-z0-9_-]+)"', html))

faltan = sorted(i for i in ids_app if i not in ids_html)
print('ids usados en app.js:', len(ids_app))
print('FALTAN EN EL HTML:', faltan if faltan else 'ninguno')
sobran = sorted(i for i in ids_html if i not in ids_app)
print('ids del HTML que app.js no toca:', len(sobran))
print('  ', ', '.join(sobran))
