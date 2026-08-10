"""Systematic British-spelling scan: pattern classes, not a hand-written list."""
import os, re, sys
from collections import defaultdict

SKIP_DIRS = {'node_modules', 'dist', '.git', '.vite', 'coverage'}
EXTS = {'.ts', '.tsx', '.js', '.mjs', '.json', '.jsonc', '.css', '.html', '.md', '.yml', '.yaml'}

# Words that legitimately end in these strings in US English too.
OK_ISE = {
 'advertise','advise','arise','chastise','circumcise','comprise','compromise','concise',
 'demise','despise','devise','disguise','enterprise','excise','exercise','franchise',
 'guise','improvise','incise','likewise','merchandise','noise','otherwise','paradise',
 'poise','praise','precise','premise','promise','raise','revise','rise','supervise',
 'surmise','surprise','televise','treatise','wise','clockwise','anticlockwise','bruise',
 'cruise','louise','expertise','malaise','mortise','baptise','apprise','reprise','noises',
}
OK_OUR = {
 'four','hour','our','pour','sour','tour','your','flour','contour','detour','devour',
 'scour','velour','glamour','dour','troubadour','saviour','armour',
}
OK_RE = {  # -re endings that are correct in US English
 'are','acre','cadre','genre','macabre','massacre','mediocre','ogre','timbre','euchre',
 'were','there','where','here','more','score','store','before','core','bore','sore','tore',
 'wore','pore','ore','spore','chore','shore','snore','ignore','restore','explore','adore',
 'anymore','furthermore','therefore','centre_ok_never',
}

CLASSES = [
    ('-ise/-isation for -ize', re.compile(r'\b[A-Za-z]{3,}is(?:e|es|ed|ing|ation|ations|able|ability|er|ers)\b')),
    ('-our for -or',           re.compile(r'\b[A-Za-z]{2,}our(?:s|ed|ing|ful|less|able)?\b')),
    ('-re for -er',            re.compile(r'\b[A-Za-z]{3,}re(?:s|d)?\b')),
    ('-yse for -yze',          re.compile(r'\b[A-Za-z]{3,}ys(?:e|es|ed|ing)\b')),
    ('-ogue for -og',          re.compile(r'\b[A-Za-z]{3,}ogue(?:s)?\b')),
    ('-ce noun for -se',       re.compile(r'\b(?:licence|defence|offence|pretence|practise|vice-licence)\b', re.I)),
    ('ae/oe ligature',         re.compile(r'\b[A-Za-z]*(?:aemia|aedia|aeric|oeuvr|oetus|oesoph|aeroplane|orthopaed|archaeolog|anaesthe|paediatr|foet)[A-Za-z]*\b', re.I)),
    ('doubled consonant',      re.compile(r'\b[A-Za-z]{2,}(?:lled|lling|ller|llor|lment|mmed|mmer|mme|ppp)\b')),
    ('misc britishisms',       re.compile(r'\b(?:grey|greyish|tyres?|kerbs?|storeys?|ploughs?|draughts?|cheques?|aluminium|sceptic\w*|moulds?|smoulder\w*|moustache\w*|whilst|amongst|learnt|spelt|burnt|dreamt|leapt|gaol|pyjamas|artefacts?|enquir\w+|sulphur\w*|speciality|specialities|orientated|maths|towards|backwards|forwards|upwards|programmes?|centres?|centred|colours?|coloured|litres?|metres?|fibres?|calibres?|sombre|lustre|spectres?|meagre|theatres?)\b', re.I)),
]

def stem_ok(word, ending, ok_set):
    w = word.lower()
    return w in ok_set or any(w == o or w.endswith(o) for o in ok_set)

findings = defaultdict(list)
for root, dirs, files in os.walk('.'):
    dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
    for f in files:
        if os.path.splitext(f)[1] not in EXTS:
            continue
        path = os.path.join(root, f)
        try:
            lines = open(path, encoding='utf-8').read().splitlines()
        except Exception:
            continue
        for n, line in enumerate(lines, 1):
            if 'aria-labelledby' in line:
                line = line.replace('aria-labelledby', '')
            for label, pat in CLASSES:
                for m in pat.finditer(line):
                    w = m.group(0)
                    lw = w.lower()
                    if label.startswith('-ise') and stem_ok(lw, 'ise', OK_ISE):   continue
                    if label.startswith('-our') and stem_ok(lw, 'our', OK_OUR):   continue
                    if label.startswith('-re ') and stem_ok(lw, 're', OK_RE):     continue
                    if label.startswith('-yse') and lw in {'analyse'} - {'analyse'}: continue
                    findings[label].append((path, n, w, line.strip()[:100]))

total = 0
for label, hits in findings.items():
    seen = {}
    for path, n, w, line in hits:
        seen.setdefault(w.lower(), []).append(f'{path}:{n}')
    print(f'\n=== {label} — {len(seen)} distinct ===')
    for w, where in sorted(seen.items()):
        total += len(where)
        print(f'  {w:24} {len(where):3}x  {where[0]}')
print(f'\nTOTAL candidate hits: {total}')
