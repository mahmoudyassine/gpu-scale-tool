#!/usr/bin/env python3
"""Rebuild the portable single-file version of GPUscale.net.

Inlines assets/styles.css, the four data/*.js files and assets/app.js into
one self-contained HTML file at dist/gpuscale_standalone.html. Run from the
site root:  python3 tools/build_single_file.py
"""
import base64, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
html = (ROOT/'index.html').read_text(encoding='utf-8')

def must_change(new, old, what):
    if new == old:
        sys.exit(f'build failed: {what} did not match anything in index.html')
    return new

css = (ROOT/'assets/styles.css').read_text(encoding='utf-8')
html = must_change(html.replace('<link rel="stylesheet" href="assets/styles.css">',
                                '<style>\n'+css+'</style>'), html, 'stylesheet link')

fav = base64.b64encode((ROOT/'assets/favicon.svg').read_bytes()).decode()
html = must_change(html.replace('<link rel="icon" type="image/svg+xml" href="assets/favicon.svg">',
                                '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,'+fav+'">'),
                   html, 'svg favicon link')
html = re.sub(r'\n<link rel="(icon" type="image/png|apple-touch-icon|manifest|canonical)[^>]*>', '', html)
html = re.sub(r'\n<meta (property="og:|name="twitter:)[^>]*>', '', html)
html = re.sub(r'\n<link rel="canonical"[^>]*>', '', html)

scripts = ''.join((ROOT/p).read_text(encoding='utf-8')
                  for p in ['data/models.js','data/gpus.js','data/quants.js','data/usecases.js','assets/app.js'])
inlined = '<script>\n'+scripts.replace('</script>','<\\/script>')+'\n</script>'
# lambda replacement: re.sub must not treat backslashes in the JS as escape templates
html = must_change(re.sub(r'<script src="data/models\.js"></script>.*?<script src="assets/app\.js"></script>',
                          lambda m: inlined, html, flags=re.S), html, 'data/app script block')

for leftover in re.findall(r'(?:src|href)="assets/[^"]+"', html):
    sys.exit(f'build failed: unresolved asset reference {leftover}')

out = ROOT/'dist/gpuscale_standalone.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'wrote {out} ({out.stat().st_size:,} bytes)')
