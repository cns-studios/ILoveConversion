#!/usr/bin/env python3
"""Turns the legal Markdown templates into ILC's static pages.

Usage: python3 scripts/build_legal.py   (from the repo root)
Supports the Markdown the templates use: # / ## headings, paragraphs (line breaks kept),
- and 1. lists, pipe tables, **bold**, [links](/path) and [PLACEHOLDER] markers.
"""
import html
import re
import sys
from pathlib import Path

SITE = 'https://ilc.cns-studios.com'

PAGES = [
    {
        'src': 'terms.md', 'out': 'terms.html', 'path': '/terms.html',
        'title': 'Terms of Service',
        'description': 'Terms of Service for ILC (ILoveConversion), the free file converter, compressor and QR code maker by CNS Studios.',
    },
    {
        'src': 'privacy.md', 'out': 'privacy.html', 'path': '/privacy.html',
        'title': 'Privacy Policy',
        'description': 'How ILC (ILoveConversion) processes personal data: local mode keeps files on your device, online mode deletes uploads automatically. GDPR information.',
    },
    {
        'src': 'data-processing.md', 'out': 'data-processing.html', 'path': '/data-processing.html',
        'title': 'How ILC handles your data',
        'description': 'A plain-language summary of what happens to your files in ILC: what is stored, for how long, and who can see it.',
    },
]

LINKS = {'/privacy': '/privacy.html', '/terms': '/terms.html', '/data-processing': '/data-processing.html'}

ANCHORS = {}


def inline(text):
    text = html.escape(text, quote=False)

    def link(m):
        href = LINKS.get(m.group(2), m.group(2))
        return f'<a href="{html.escape(href)}">{m.group(1)}</a>'

    text = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)', link, text)
    text = re.sub(r'\[([A-Z]{2,}[^\]]*)\]', r'<mark class="placeholder">[\1]</mark>', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)

    def section_ref(m):
        nums = re.sub(r'\d+', lambda n: f'<a href="#{ANCHORS[n.group(0)]}">{n.group(0)}</a>' if n.group(0) in ANCHORS else n.group(0), m.group(2))
        return m.group(1) + nums

    return re.sub(r'\b(sections? )(\d+(?: (?:and|to) \d+)?)', section_ref, text)


def slug(heading):
    heading = re.sub(r'^\d+\.\s*', '', heading)
    return re.sub(r'[^a-z0-9]+', '-', heading.lower()).strip('-')


def table(rows):
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows]
    head, body = cells[0], [r for r in cells[1:] if not all(re.fullmatch(r':?-+:?', c) for c in r)]
    out = ['<div class="legal-table"><table>', '<thead><tr>']
    out += [f'<th scope="col">{inline(c)}</th>' for c in head]
    out.append('</tr></thead><tbody>')
    for r in body:
        out.append('<tr>' + ''.join(f'<td data-label="{html.escape(h)}">{inline(c)}</td>' for h, c in zip(head, r)) + '</tr>')
    out.append('</tbody></table></div>')
    return '\n'.join(out)


def blocks(lines):
    """Groups lines into (kind, lines) blocks."""
    out, cur, kind = [], [], None

    def flush():
        nonlocal cur, kind
        if cur:
            out.append((kind, cur))
        cur, kind = [], None

    for line in lines:
        if not line.strip():
            flush()
            continue
        k = ('table' if line.startswith('|') else 'ul' if line.startswith('- ')
             else 'ol' if re.match(r'\d+\.\s', line) else 'p')
        if kind and k != kind:
            flush()
        kind = k
        cur.append(line)
    flush()
    return out


def render_block(kind, lines):
    if kind == 'table':
        return table(lines)
    if kind in ('ul', 'ol'):
        items = [re.sub(r'^(- |\d+\.\s)', '', l) for l in lines]
        return f'<{kind}>\n' + '\n'.join(f'<li>{inline(i)}</li>' for i in items) + f'\n</{kind}>'
    return '<p>' + '<br>\n'.join(inline(l) for l in lines) + '</p>'


def convert(md):
    lines = md.strip('\n').split('\n')
    assert lines[0].startswith('# '), 'template must start with a # title'
    title = lines[0][2:].replace(' - ILC', '')
    rest = lines[1:]

    while rest and not rest[0].strip():
        rest.pop(0)
    meta = rest.pop(0)

    ANCHORS.clear()
    for line in rest:
        m = re.match(r'## (\d+)\.', line)
        if m:
            ANCHORS[m.group(1)] = slug(line[3:].strip())

    intro, sections, cur = [], [], None
    for line in rest:
        if line.startswith('## '):
            cur = {'heading': line[3:].strip(), 'lines': []}
            sections.append(cur)
        elif cur is None:
            intro.append(line)
        else:
            cur['lines'].append(line)

    parts = [f'<h1 class="legal-title">{inline(title)}</h1>', f'<p class="legal-updated">{inline(meta)}</p>']
    if any(l.strip() for l in intro):
        parts.append('<section class="legal-section">\n' + indent('\n'.join(render_block(*b) for b in blocks(intro)), 4) + '\n</section>')
    for s in sections:
        body = '\n'.join(render_block(*b) for b in blocks(s['lines']))
        parts.append(f'<section class="legal-section" id="{slug(s["heading"])}">\n    <h2>{inline(s["heading"])}</h2>\n{indent(body, 4)}\n</section>')
    return '\n\n'.join(parts)


def indent(text, n):
    pad = ' ' * n
    return '\n'.join(pad + l if l else l for l in text.split('\n'))


def page(cfg, body):
    url = SITE + cfg['path']
    title = html.escape(cfg['title'])
    desc = html.escape(cfg['description'])
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} · ILC</title>
    <meta name="description" content="{desc}">
    <meta name="robots" content="index, follow">
    <meta name="color-scheme" content="dark">
    <link rel="canonical" href="{url}">
    <meta property="og:type" content="article">
    <meta property="og:site_name" content="ILC · ILoveConversion">
    <meta property="og:url" content="{url}">
    <meta property="og:title" content="{title} · ILC">
    <meta property="og:description" content="{desc}">
    <meta property="og:image" content="{SITE}/og-image.jpg">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="stylesheet" href="/style.css">
    <link rel="icon" href="/favicon.ico" sizes="any">
    <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <meta name="theme-color" content="#09090b">
    <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
</head>
<body>
    <div id="app">
        <header class="site-header">
            <a href="/" class="brand" aria-label="ILoveConversion home">
                <img class="brand-logo" src="/logo.png" alt="" width="46" height="46">
                <span class="brand-name">ILC</span>
            </a>
        </header>
        <main class="legal-content">
{indent(body, 12)}
        </main>
        <footer class="site-footer">
            <a href="/terms.html">Terms of Service</a>
            <a href="/privacy.html">Privacy Policy</a>
            <a href="/data-processing.html">Data Processing</a>
        </footer>
    </div>
</body>
</html>
'''


def main():
    root = Path(__file__).resolve().parent.parent
    frontend = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'frontend'
    templates = Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'legal'
    for cfg in PAGES:
        md = (templates / cfg['src']).read_text(encoding='utf-8')
        out = frontend / cfg['out']
        out.write_text(page(cfg, convert(md)), encoding='utf-8')
        left = sorted(set(re.findall(r'\[([A-Z]{2,}[^\]]*)\]', md)))
        print(f'{out}: {len(left)} placeholder(s) left: {", ".join(left) or "none"}')


if __name__ == '__main__':
    main()
