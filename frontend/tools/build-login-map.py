#!/usr/bin/env python3
"""
Сборка карты для экрана входа: подложка и маршруты между филиалами.

Запускается руками и редко — когда переехал филиал, открылся новый или
понадобился другой охват карты. В сборку фронтенда не входит.

    python3 frontend/tools/build-login-map.py

Кладёт два файла в frontend/public/map:
    anapa.svg    — берег, зелень и улицы, статическая подложка
    routes.json  — готовые маршруты между филиалами по улицам

Данные берутся из OpenStreetMap: геометрия через Overpass API, координаты
филиалов — из справочника медцентров (заполняются в админке; здесь они
продублированы, потому что скрипт в базу не ходит).

Важное: константы проекции ниже обязаны совпадать с frontend/src/pages/
loginMapGeo.js. Поменять здесь и не поменять там — значит развести метки с
картой; никакой ошибки при этом не будет, всё просто встанет не на свои места.

Данные © участники OpenStreetMap, лицензия ODbL.
"""
import json, math, heapq, urllib.request, urllib.parse, os, time
from collections import defaultdict

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'map')

# ── Проекция. Ровно то же, что в loginMapGeo.js ─────────────────────────────
RENDER = 5.56          # единиц холста на единицу рисунка; см. комментарий там же
LAT_TOP, LAT_BOTTOM, LON_CENTER, LAT_MID = 44.906, 44.765, 37.360, 44.836
PAD = 80               # поле вокруг рисунка, по нему ходит камера
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT_MID))
VW, VH = 300.0, 436.0
H_M = (LAT_TOP - LAT_BOTTOM) * M_LAT
W_M = H_M * 0.688
LON_LEFT = LON_CENTER - W_M / M_LON / 2

def prj(lat, lon, scale=1.0):
    return (((lon - LON_LEFT) * M_LON / W_M) * VW * scale,
            ((LAT_TOP - lat) * M_LAT / H_M) * VH * scale)

def metres(a, b):
    return math.hypot((a[1] - b[1]) * M_LON, (a[0] - b[0]) * M_LAT)

# ── Филиалы. Должны совпадать со справочником медцентров ────────────────────
BRANCHES = [
    ('Альфа',  44.8804053, 37.3303100),
    ('Кидс',   44.8819372, 37.3302617),
    ('Проф',   44.8921781, 37.3385178),
    ('Линия',  44.8760013, 37.3248157),
    ('3К',     44.8677232, 37.3330990),
    ('Смайл',  44.8804053, 37.3303100),
    ('Сукко',  44.7793929, 37.3937547),
]

# ── Выгрузка из Overpass ────────────────────────────────────────────────────
# Магистрали и берег берутся на весь прямоугольник, городские улицы — только
# вокруг филиалов: жилая сеть на весь район весит втрое больше и в кадр не
# попадает никогда.
QUERIES = {
    'base': """[out:json][timeout:90];
(
  way["natural"="coastline"](44.74,37.20,44.93,37.48);
  way["highway"~"^(motorway|trunk|primary|secondary)$"](44.74,37.20,44.93,37.48);
);
out geom;""",
    'streets': """[out:json][timeout:90];
(
  way["highway"~"^(tertiary|residential|unclassified|living_street)$"](44.860,37.305,44.900,37.355);
  way["highway"~"^(tertiary|residential|unclassified|living_street)$"](44.770,37.380,44.792,37.402);
);
out geom;""",
    'cover': """[out:json][timeout:90];
(
  way["leisure"~"^(park|garden|recreation_ground|pitch)$"](44.765,37.29,44.906,37.43);
  way["landuse"~"^(forest|grass|meadow|village_green|cemetery|orchard|vineyard)$"](44.765,37.29,44.906,37.43);
  way["natural"~"^(wood|scrub|beach|water|sand)$"](44.765,37.29,44.906,37.43);
);
out geom;""",
}

def overpass(query):
    # Overpass охотно отвечает отказом при частых запросах — пробуем несколько раз
    for attempt in range(4):
        req = urllib.request.Request(
            'https://overpass-api.de/api/interpreter',
            data=query.encode('utf-8'),
            headers={'User-Agent': 'alfa-wiki-login-map/1.0'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:
            print('   попытка %d не удалась (%s), ждём' % (attempt + 1, e))
            time.sleep(20)
    raise SystemExit('Overpass не ответил')

def thin(pts, eps):
    out = [pts[0]]
    for p in pts[1:-1]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= eps:
            out.append(p)
    out.append(pts[-1])
    return out

def d_of(pts, close=False):
    return 'M%.1f %.1f' % pts[0] + ''.join('L%.1f %.1f' % p for p in pts[1:]) + ('Z' if close else '')

def area(pts):
    a = 0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2

print('Выгружаю OpenStreetMap…')
data = {k: overpass(q) for k, q in QUERIES.items()}

# ── Подложка ────────────────────────────────────────────────────────────────
# Берег в OSM разрезан на куски; сшиваем по совпадающим концам. Направление у
# линии берега такое, что суша слева, — значит замыкание по левому краю холста
# даёт море.
ways = [[(g['lat'], g['lon']) for g in e['geometry']]
        for e in data['base']['elements']
        if e.get('tags', {}).get('natural') == 'coastline']
by_start = defaultdict(list)
for w in ways:
    by_start[(round(w[0][0], 6), round(w[0][1], 6))].append(w)
used, chains = set(), []
for w in ways:
    if id(w) in used:
        continue
    chain = list(w)
    used.add(id(w))
    while True:
        k = (round(chain[-1][0], 6), round(chain[-1][1], 6))
        nxt = next((c for c in by_start.get(k, []) if id(c) not in used), None)
        if not nxt:
            break
        used.add(id(nxt))
        chain.extend(nxt[1:])
    chains.append(chain)
chains.sort(key=len, reverse=True)
coast = [p for p in (prj(la, lo) for la, lo in chains[0])
         if -60 <= p[0] <= VW + 60 and -60 <= p[1] <= VH + 60]
coast = thin(coast, 1.1)
sea = d_of(coast) + 'L-95 %.1f L-95 %.1f Z' % (coast[-1][1], coast[0][1])

GREEN = {'park', 'garden', 'recreation_ground', 'grass', 'forest', 'wood', 'meadow',
         'village_green', 'scrub', 'orchard', 'vineyard', 'cemetery', 'pitch'}
SAND = {'beach', 'sand'}
WATER = {'water', 'swimming_pool'}
cover = {'green': [], 'sand': [], 'water': []}
for e in data['cover']['elements']:
    g = e.get('geometry') or []
    if len(g) < 4:
        continue
    t = e.get('tags', {})
    kind = t.get('leisure') or t.get('landuse') or t.get('natural')
    bucket = 'green' if kind in GREEN else 'sand' if kind in SAND else 'water' if kind in WATER else None
    if not bucket:
        continue
    pts = thin([prj(p['lat'], p['lon']) for p in g], 0.55)
    if len(pts) < 3 or area(pts) < 0.9:
        continue
    cover[bucket].append(d_of(pts, close=True))

roads = {'big': [], 'mid': [], 'small': []}
CLASS = {'motorway': 'big', 'trunk': 'big', 'primary': 'big', 'secondary': 'mid'}
for e in data['base']['elements']:
    hw = e.get('tags', {}).get('highway')
    if hw not in CLASS:
        continue
    pts = thin([prj(p['lat'], p['lon']) for p in e['geometry']], 1.1)
    if len(pts) > 1:
        roads[CLASS[hw]].append(d_of(pts))
for e in data['streets']['elements']:
    g = e.get('geometry') or []
    if len(g) < 2:
        continue
    pts = thin([prj(p['lat'], p['lon']) for p in g], 0.7)
    if len(pts) < 2:
        continue
    if math.hypot(pts[-1][0] - pts[0][0], pts[-1][1] - pts[0][1]) < 1.2 and len(pts) < 4:
        continue
    roads['small'].append(d_of(pts))

# Приставка lm- обязательна: файл встраивается в страницу разметкой, а тег
# <style> внутри встроенного SVG действует на весь документ. Общие имена вроде
# .road или .land столкнулись бы со стилями приложения.
STYLE = ('.lm-land{fill:#F3F0E9}.lm-sea{fill:#A9D6EA}.lm-water{fill:#A9D6EA}'
         '.lm-green{fill:#CBE3B7}.lm-sand{fill:#F0E3C2}'
         '.lm-surf{fill:none;stroke:#8CBDD4;stroke-width:.34}'
         '.lm-case{fill:none;stroke:#E2DBCC;stroke-linecap:round}'
         '.lm-case-mid{stroke-width:.74}.lm-case-big{stroke-width:1.06}'
         '.lm-road{fill:none;stroke:#FFF;stroke-linecap:round}'
         '.lm-road-small{stroke:#FBFAF6;stroke-width:.3}.lm-road-mid{stroke-width:.5}'
         '.lm-road-big{stroke:#FBE6A4;stroke-width:.78}')
def paths(cls, arr):
    return ''.join('<path class="%s" d="%s"/>' % (cls, d) for d in arr)

# Размер в процентах, а не в единицах: контейнер задаёт разметка страницы.
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%d %d %d %d" '
       'width="100%%" height="100%%" preserveAspectRatio="none">'
       % (-PAD, -PAD, VW + PAD * 2, VH + PAD * 2)
       + '<style>' + STYLE + '</style>'
       + '<rect class="lm-land" x="%d" y="%d" width="%d" height="%d"/>' % (-PAD, -PAD, VW + PAD * 2, VH + PAD * 2)
       + '<path class="lm-sea" d="%s"/>' % sea
       + paths('lm-green', cover['green']) + paths('lm-sand', cover['sand'])
       + paths('lm-water', cover['water'])
       + '<path class="lm-surf" d="%s"/>' % d_of(coast)
       + paths('lm-road lm-road-small', roads['small'])
       + paths('lm-case lm-case-mid', roads['mid']) + paths('lm-case lm-case-big', roads['big'])
       + paths('lm-road lm-road-mid', roads['mid']) + paths('lm-road lm-road-big', roads['big'])
       + '</svg>')
open(os.path.join(OUT, 'anapa.svg'), 'w', encoding='utf-8').write(svg)
print('anapa.svg: %d байт' % len(svg))

# ── Маршруты ────────────────────────────────────────────────────────────────
# Узлы у смежных линий в OSM общие, поэтому граф собирается по id узлов без
# сближения координат: если две улицы пересекаются, у них буквально один узел.
coord, adj = {}, defaultdict(list)
for src in ('base', 'streets'):
    for e in data[src]['elements']:
        if e.get('type') != 'way' or 'highway' not in e.get('tags', {}):
            continue
        ids, geo = e.get('nodes') or [], e.get('geometry') or []
        if len(ids) != len(geo) or len(ids) < 2:
            continue
        for nid, g in zip(ids, geo):
            coord[nid] = (g['lat'], g['lon'])
        for a, b in zip(ids, ids[1:]):
            w = metres(coord[a], coord[b])
            # Односторонность не учитываем: маршрут декоративный, по нему никто
            # не поедет, а запреты поворотов сделали бы граф рваным.
            adj[a].append((b, w))
            adj[b].append((a, w))

def nearest(lat, lon):
    best, bd = None, 1e18
    for nid, c in coord.items():
        d = metres(c, (lat, lon))
        if d < bd:
            best, bd = nid, d
    return best, bd

def dijkstra(start, goal):
    dist, prev, heap, seen = {start: 0.0}, {}, [(0.0, start)], set()
    while heap:
        d, n = heapq.heappop(heap)
        if n in seen:
            continue
        seen.add(n)
        if n == goal:
            break
        for m, w in adj[n]:
            nd = d + w
            if nd < dist.get(m, 1e18):
                dist[m] = nd
                prev[m] = n
                heapq.heappush(heap, (nd, m))
    if goal not in dist:
        return None
    path, n = [goal], goal
    while n != start:
        n = prev[n]
        path.append(n)
    return list(reversed(path))

anchors = {}
for name, lat, lon in BRANCHES:
    nid, d = nearest(lat, lon)
    anchors[name] = nid
    print('  %-7s ближайшая улица в %4.0f м' % (name, d))

routes, missing = {}, []
key = lambda lat, lon: '%.5f,%.5f' % (lat, lon)
for i, (n1, la1, lo1) in enumerate(BRANCHES):
    for n2, la2, lo2 in BRANCHES[i + 1:]:
        if anchors[n1] == anchors[n2]:
            continue                      # один адрес — маршрута нет
        path = dijkstra(anchors[n1], anchors[n2])
        if not path:
            missing.append((n1, n2))
            continue
        line = thin([prj(*coord[n], scale=RENDER) for n in path], 3.0)
        a, b = key(la1, lo1), key(la2, lo2)
        if a > b:
            line = list(reversed(line))
        routes['|'.join(sorted([a, b]))] = [[round(x, 1), round(y, 1)] for x, y in line]

if missing:
    print('  НЕ НАЙДЕНЫ маршруты:', missing)
json.dump(routes, open(os.path.join(OUT, 'routes.json'), 'w'),
          ensure_ascii=False, separators=(',', ':'))
print('routes.json: %d маршрутов, %d байт'
      % (len(routes), os.path.getsize(os.path.join(OUT, 'routes.json'))))
