// 복사본: KINGJNU-sakayume/board `js/schema.js` (main, 2026-11-08에 받음, git blob 1d75a480a33d941cf9aa8aea4cb0a4ff42fa43ad).
// 이 세션에서는 board 저장소 API에 접근할 수 없어 커밋 sha를 확인하지 못했습니다. 규격이 바뀌면 다시 복사하고 이 줄을 갱신하세요.
// 앱이 올리는 보드 목록(manifest) 검증. 규격 문서: docs/TILES.md
// 원칙: 통과하지 못한 타일은 그리지 않는다(fail closed). 브라우저와 Node(scripts/check.mjs) 양쪽에서 쓴다.

export const SCHEMA_VERSION = 1;
export const SIZES = ['1x1', '2x1', '2x2', '4x1', '4x2'];
export const TONES = ['sleeve', 'hero', 'strip', 'plate', 'map', 'type'];
export const FORMS = ['num', 'list', 'line', 'cells'];
export const LIMITS = Object.freeze({ tiles: 24, rows: 12, items: 12, foot: 6, cells: 200, candidates: 50, text: 80, long: 160 });

const ID = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATA_IMG = /^data:image\/(png|jpeg|webp|gif|svg\+xml)[;,]/;

class Bad extends Error {}
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function obj(v, path) { if (!isObj(v)) throw new Bad(`${path}: 객체가 필요해요`); return v; }
function str(v, path, { max = LIMITS.text, opt = false } = {}) {
  if (v === undefined || v === null) { if (opt) return undefined; throw new Bad(`${path}: 글자가 필요해요`); }
  if (typeof v !== 'string' || !v.trim()) throw new Bad(`${path}: 빈 글자는 안 돼요`);
  if (v.length > max) throw new Bad(`${path}: ${max}자를 넘었어요`);
  return v;
}
function num(v, path, { min = -1e12, max = 1e12, int = false, opt = false } = {}) {
  if (v === undefined || v === null) { if (opt) return undefined; throw new Bad(`${path}: 숫자가 필요해요`); }
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (int && !Number.isInteger(v))) throw new Bad(`${path}: ${min}~${max} 범위의 ${int ? '정수' : '숫자'}여야 해요`);
  return v;
}
function bool(v, path) { if (v === undefined) return undefined; if (typeof v !== 'boolean') throw new Bad(`${path}: true/false 여야 해요`); return v; }
function arr(v, path, { min = 0, max, opt = false } = {}) {
  if (v === undefined || v === null) { if (opt) return undefined; throw new Bad(`${path}: 목록이 필요해요`); }
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new Bad(`${path}: ${min}~${max}개 목록이어야 해요`);
  return v;
}

function originOf(u) { try { const x = new URL(u); return x.protocol === 'https:' ? x.origin : null; } catch { return null; } }

function image(v, path, policy, { opt = true } = {}) {
  if (v === undefined || v === null) { if (opt) return undefined; throw new Bad(`${path}: 표지가 필요해요`); }
  obj(v, path);
  // src 가 없으면 글자 칸(mono). 공개 주소가 없는 표지도 표지가 필요한 톤(sleeve·hero)을 살릴 수 있게 한다.
  const src = str(v.src, `${path}.src`, { max: 200000, opt: true });
  const mono = str(v.mono, `${path}.mono`, { max: 2, opt: true });
  if (src === undefined && mono === undefined) throw new Bad(`${path}: src 나 mono 중 하나는 있어야 해요`);
  let ok = false;
  if (src === undefined) ok = false;
  else if (DATA_IMG.test(src)) ok = src.length <= 200000;
  else { const o = originOf(src); ok = !!o && policy.imageOrigins.includes(o) && src.length <= 600; }
  return {
    src: ok ? src : undefined,                       // 허용 안 된 출처는 버리고 글자 칸으로 그린다(타일은 살린다)
    alt: v.alt === '' ? '' : str(v.alt, `${path}.alt`, { opt: true }),   // 빈 alt 는 장식용 표지
    mono,
  };
}
function link(v, path, policy) {
  if (v === undefined || v === null) return undefined;
  const s = str(v, path, { max: 600 }), o = originOf(s);
  if (!o || !policy.linkOrigins.includes(o)) throw new Bad(`${path}: 허용되지 않은 주소예요`);
  return s;
}
function accent(v, path) {
  if (v === undefined || v === null) return undefined;
  obj(v, path);
  return { h: num(v.h, `${path}.h`, { min: 0, max: 360 }), s: num(v.s, `${path}.s`, { min: 0, max: 1 }) };
}
function progress(v, path) {
  if (v === undefined || v === null) return undefined;
  obj(v, path);
  const max = num(v.max, `${path}.max`, { min: 1e-9 }), value = num(v.value, `${path}.value`, { min: 0, max });
  return { value, max, text: str(v.text, `${path}.text`, { opt: true }) };
}
function row(v, path, policy) {
  obj(v, path);
  return {
    title: str(v.title, `${path}.title`),
    value: str(v.value, `${path}.value`, { opt: true, max: 24 }),
    sub: str(v.sub, `${path}.sub`, { opt: true }),
    rank: num(v.rank, `${path}.rank`, { opt: true, int: true, min: 0, max: 999 }),
    time: str(v.time, `${path}.time`, { opt: true, max: 8 }),
    trend: v.trend === undefined ? undefined : ['up', 'down', 'same'].includes(v.trend) ? v.trend : (() => { throw new Bad(`${path}.trend: up/down/same`); })(),
    cover: image(v.cover, `${path}.cover`, policy),
    progress: progress(v.progress, `${path}.progress`),
    now: bool(v.now, `${path}.now`),
    muted: bool(v.muted, `${path}.muted`),
  };
}
const rows = (v, path, policy, max = LIMITS.rows, opt = false) => {
  const a = arr(v, path, { min: 1, max, opt });
  return a && a.map((r, i) => row(r, `${path}[${i}]`, policy));
};

// 톤(형태)별 data 검사. 각 함수는 정리된 data 를 돌려준다.
const DATA = {
  sleeve: (d, p, pol) => ({
    label: str(d.label, `${p}.label`), title: str(d.title, `${p}.title`),
    sub: str(d.sub, `${p}.sub`, { opt: true, max: LIMITS.long }), pill: str(d.pill, `${p}.pill`, { opt: true, max: 20 }),
    progress: progress(d.progress, `${p}.progress`), cover: image(d.cover, `${p}.cover`, pol, { opt: false }),
    list: rows(d.list, `${p}.list`, pol, LIMITS.rows, true), listLabel: str(d.listLabel, `${p}.listLabel`, { opt: true }),
  }),
  hero: (d, p, pol) => ({
    label: str(d.label, `${p}.label`), title: str(d.title, `${p}.title`),
    sub: str(d.sub, `${p}.sub`, { opt: true }), progress: progress(d.progress, `${p}.progress`),
    cover: image(d.cover, `${p}.cover`, pol, { opt: false }),
    list: rows(d.list, `${p}.list`, pol, 4, true), listLabel: str(d.listLabel, `${p}.listLabel`, { opt: true }),
  }),
  strip: (d, p, pol) => ({
    label: str(d.label, `${p}.label`), square: bool(d.square, `${p}.square`),
    items: arr(d.items, `${p}.items`, { min: 1, max: LIMITS.items }).map((it, i) => {
      obj(it, `${p}.items[${i}]`);
      return { title: str(it.title, `${p}.items[${i}].title`), cover: image(it.cover, `${p}.items[${i}].cover`, pol) };
    }),
  }),
  plate: (d, p) => {
    const r = d.roulette === undefined ? undefined : obj(d.roulette, `${p}.roulette`);
    return {
      label: str(d.label, `${p}.label`), name: str(d.name, `${p}.name`, { max: 12 }),
      roman: str(d.roman, `${p}.roman`, { opt: true, max: 30 }), sub: str(d.sub, `${p}.sub`, { opt: true }),
      roulette: r && { candidates: arr(r.candidates, `${p}.roulette.candidates`, { min: 2, max: LIMITS.candidates }).map((c, i) => str(c, `${p}.roulette.candidates[${i}]`, { max: 12 })) },
    };
  },
  map: (d, p) => {
    const cols = num(d.cols, `${p}.cols`, { int: true, min: 2, max: 12 });
    return {
      label: str(d.label, `${p}.label`), summary: str(d.summary, `${p}.summary`), cols,
      cells: arr(d.cells, `${p}.cells`, { min: 1, max: LIMITS.cells }).map((c, i) => {
        obj(c, `${p}.cells[${i}]`);
        if (!['none', 'off', 'on', 'last'].includes(c.state)) throw new Bad(`${p}.cells[${i}].state: none/off/on/last`);
        return { state: c.state, name: str(c.name, `${p}.cells[${i}].name`, { opt: true, max: 6 }) };
      }),
    };
  },
  num: (d, p) => ({
    label: str(d.label, `${p}.label`),
    value: typeof d.value === 'number' ? String(num(d.value, `${p}.value`)) : str(d.value, `${p}.value`, { max: 12 }),
    unit: str(d.unit, `${p}.unit`, { opt: true, max: 8 }), caption: str(d.caption, `${p}.caption`, { opt: true }),
    sub: str(d.sub, `${p}.sub`, { opt: true, max: LIMITS.long }),
    foot: d.foot === undefined ? undefined : arr(d.foot, `${p}.foot`, { min: 1, max: LIMITS.foot }).map((f, i) => {
      obj(f, `${p}.foot[${i}]`); return { k: str(f.k, `${p}.foot[${i}].k`, { max: 10 }), v: str(f.v, `${p}.foot[${i}].v`, { max: 10 }) };
    }),
  }),
  list: (d, p, pol) => ({ label: str(d.label, `${p}.label`), rows: rows(d.rows, `${p}.rows`, pol), foot: str(d.foot, `${p}.foot`, { opt: true }) }),
  line: (d, p) => ({
    label: str(d.label, `${p}.label`), title: str(d.title, `${p}.title`, { max: LIMITS.long }),
    sub: str(d.sub, `${p}.sub`, { opt: true }), pill: str(d.pill, `${p}.pill`, { opt: true, max: 20 }),
    progress: progress(d.progress, `${p}.progress`),
  }),
  cells: (d, p) => {
    const total = num(d.total, `${p}.total`, { int: true, min: 1, max: 60 });
    return { label: str(d.label, `${p}.label`), total, filled: num(d.filled, `${p}.filled`, { int: true, min: 0, max: total }) };
  },
};

export function validateTile(t, path, policy) {
  obj(t, path);
  const id = t.id;
  if (typeof id !== 'string' || !ID.test(id)) throw new Bad(`${path}.id: 소문자·숫자·- 로 32자 이내`);
  if (!TONES.includes(t.tone)) throw new Bad(`${path}.tone: ${TONES.join('/')}`);
  let form;
  if (t.tone === 'type') { if (!FORMS.includes(t.form)) throw new Bad(`${path}.form: ${FORMS.join('/')}`); form = t.form; }
  else if (t.form !== undefined) throw new Bad(`${path}.form: type 톤에서만 써요`);
  const sizes = arr(t.sizes, `${path}.sizes`, { min: 1, max: SIZES.length });
  sizes.forEach((s) => { if (!SIZES.includes(s)) throw new Bad(`${path}.sizes: ${SIZES.join('/')} 중에서`); });
  if (new Set(sizes).size !== sizes.length) throw new Bad(`${path}.sizes: 같은 크기가 두 번 있어요`);
  const size = t.size === undefined ? sizes[0] : t.size;
  if (!sizes.includes(size)) throw new Bad(`${path}.size: sizes 안에 있어야 해요`);
  const detail = t.detail === undefined ? undefined : (() => {
    obj(t.detail, `${path}.detail`);
    return { title: str(t.detail.title, `${path}.detail.title`), rows: rows(t.detail.rows, `${path}.detail.rows`, policy) };
  })();
  return {
    id, tone: t.tone, form, sizes, size,
    name: str(t.name, `${path}.name`, { max: 30 }),
    show: t.default === undefined ? true : bool(t.default, `${path}.default`),
    href: link(t.href, `${path}.href`, policy),
    accent: accent(t.accent, `${path}.accent`),
    detail,
    data: DATA[form || t.tone](obj(t.data, `${path}.data`), `${path}.data`, policy),
  };
}

/** manifest 전체 검사. 머리(app, generated_at)가 틀리면 타일 0개. 타일 하나가 틀리면 그 타일만 뺀다. */
export function validateManifest(m, policy) {
  const out = { ok: false, app: null, generated_at: null, tiles: [], errors: [] };
  try {
    obj(m, 'manifest');
    if (m.version !== SCHEMA_VERSION) throw new Bad(`version: ${SCHEMA_VERSION} 이어야 해요`);
    if (typeof m.app !== 'string' || !ID.test(m.app)) throw new Bad('app: Hub 목적지 id 여야 해요');
    if (typeof m.generated_at !== 'string' || !ISO.test(m.generated_at) || Number.isNaN(Date.parse(m.generated_at))) throw new Bad('generated_at: ISO 8601 시각');
    arr(m.tiles, 'tiles', { min: 0, max: LIMITS.tiles });
    out.app = m.app; out.generated_at = m.generated_at;
  } catch (e) { out.errors.push({ id: null, message: e.message }); return out; }
  const seen = new Set();
  m.tiles.forEach((t, i) => {
    try {
      const v = validateTile(t, `tiles[${i}]`, policy);
      if (seen.has(v.id)) throw new Bad(`tiles[${i}].id: 같은 id가 이미 있어요`);
      seen.add(v.id); out.tiles.push(v);
    } catch (e) { out.errors.push({ id: t && t.id, message: e.message }); }
  });
  out.ok = true;
  return out;
}
