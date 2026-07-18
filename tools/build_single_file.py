#!/usr/bin/env python3
"""Rebuild the portable single-file version of GPUscale.net.

Inlines assets/styles.css, the four data/*.js files and assets/app.js into
one self-contained HTML file at dist/gpuscale_standalone.html. Run from the
site root:  python3 tools/build_single_file.py
"""
import base64, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT/'index.html').read_text(encoding='utf-8')

css = (ROOT/'assets/styles.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="assets/styles.css">', '<style>\n'+css+'</style>')

fav = base64.b64encode((ROOT/'assets/favicon.svg').read_bytes()).decode()
html = html.replace('assets/favicon.svg', 'data:image/svg+xml;base64,'+fav)
html = re.sub(r'\n<link rel="(icon" type="image/png|apple-touch-icon)[^>]*>', '', html)
html = re.sub(r'\n<meta property="og:image"[^>]*>', '', html)

scripts = ''.join((ROOT/p).read_text(encoding='utf-8')
                  for p in ['data/models.js','data/gpus.js','data/quants.js','data/usecases.js','assets/app.js'])
html = re.sub(r'<script src="data/models\.js"></script>.*?<script src="assets/app\.js"></script>',
              '<script>\n'+scripts.replace('</script>','<\\/script>')+'\n</script>', html, flags=re.S)

out = ROOT/'dist/gpuscale_standalone.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
