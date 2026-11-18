/* FORPHOR 库存 — 试用版（数据存在本机浏览器）。
   数据结构：products 产品 / channels 渠道 / tx 流水。库存全部由流水计算。 */
(() => {
'use strict';
const APP_VERSION = '2026-11-18';
const KEY = 'forphor-erp-v2', UKEY = 'forphor-erp-user';
const USERS = ['Long', 'Burke'];
// need: 该类型需要哪一类渠道；null = 不需要渠道
const TYPES = {
  in:     { l: '进货',     need: null,      hint: '本仓 +' },
  sale:   { l: '销售',     need: 'sale',    hint: '本仓 −' },
  gift:   { l: '赠送',     need: 'gift',    hint: '本仓 −' },
  c_out:  { l: '寄出',     need: 'consign', hint: '本仓 → 寄售店，仍属于我们' },
  c_sold: { l: '寄售售出', need: 'consign', hint: '寄售店已卖出，店内库存 −' },
  c_back: { l: '调回',     need: 'consign', hint: '寄售店 → 本仓' },
  ret:    { l: '退货',     need: null,      hint: '本仓 +' },
  adj:    { l: '调整',     need: null,      hint: '盘点差异，可填负数' },
};
const CH_TYPES = { sale: '直营', drop: '代发', gift: '赠送', consign: '寄售' };
const fits = (c, need) => c.type === need || (need === 'sale' && c.type === 'drop');
const EYE = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = EYE.replace('</svg>', '<path d="M4 4l16 16"/></svg>');
const VIEWS = [['stock', '库存'], ['ledger', '流水'], ['settle', '对账'], ['products', '产品'], ['channels', '渠道'], ['settings', '设置']];

/* ---------- 存储层 ----------
   本机版：页面里带着 data/seed.js，数据存在这个浏览器里。
   线上版：页面里没有内置数据，数据存在 GitHub 私有仓库的 data.json，每次修改自动写回；两人同时改时按每条记录合并。 */
const CLOUD = !window.FORPHOR_SEED;
const CKEY = 'forphor-erp-cloud', CACHE = 'forphor-erp-cache-v1';
const EMPTY = () => ({ version: 6, products: [], channels: [], tx: [], settles: [], view: {}, patches: [] });
const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const Store = {
  load() {
    if (CLOUD) { try { const c = JSON.parse(localStorage.getItem(CACHE)); if (c && c.s && c.s.products) return c.s; } catch (e) {} return EMPTY(); }
    try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.products) return s; } catch (e) {}
    return JSON.parse(JSON.stringify(window.FORPHOR_SEED));
  },
  save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { return false; }
  },
};
/* data.json 的写法：每条记录一行，GitHub 的修改历史里能一眼看出改了哪几条 */
function dump(s) {
  return '{\n' + Object.keys(s).map(k => {
    const v = s[k], rows = Array.isArray(v) && v.length && v[0] && typeof v[0] === 'object';
    return ' ' + JSON.stringify(k) + ': ' + (rows ? '[\n' + v.map(x => '  ' + JSON.stringify(x)).join(',\n') + '\n ]' : JSON.stringify(v));
  }).join(',\n') + '\n}\n';
}
function toB64(text) { const b = new TextEncoder().encode(text); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b64) { const s = atob(String(b64 || '').replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0))); }
/* 三方合并：base = 上次同步时的数据，mine = 我这边，theirs = GitHub 上最新的。
   有 id 的列表（流水、对账、产品、渠道）按每一条合并：双方各自新增的都保留，只有一方改过的取改过的，两边都改了同一条时以我这边为准。 */
function merge3(base, mine, theirs) {
  base = base || {}; const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const b = base[k], l = mine[k], r = theirs[k];
    const idList = v => Array.isArray(v) && v.every(x => x && typeof x === 'object' && x.id != null);
    if (idList(l) && idList(r) && (b == null || idList(b))) out[k] = mergeList(b || [], l, r);
    else if (same(l, b)) out[k] = r;
    else if (same(r, b)) out[k] = l;
    else if (l && r && typeof l === 'object' && typeof r === 'object' && !Array.isArray(l) && !Array.isArray(r)) out[k] = merge3(b && typeof b === 'object' ? b : {}, l, r);
    else out[k] = l;
    if (out[k] === undefined) delete out[k];
  }
  return out;
}
function mergeList(b, l, r) {
  const B = new Map(b.map(x => [x.id, x])), L = new Map(l.map(x => [x.id, x])), R = new Map(r.map(x => [x.id, x]));
  const pick = id => {
    const bx = B.get(id), lx = L.get(id), rx = R.get(id);
    if (lx && rx) return same(lx, bx) ? rx : lx;          // 两边都有：我没改就用对方的
    if (lx && !rx) return bx && same(lx, bx) ? null : lx;  // 对方删了：我也没改就跟着删
    if (rx && !lx) return bx && same(rx, bx) ? null : rx;  // 我删了：对方也没改就删
    return null;
  };
  const orderChanged = !same(b.map(x => x.id).filter(id => L.has(id)), l.map(x => x.id).filter(id => B.has(id)));
  const first = orderChanged ? l : r, second = orderChanged ? r : l, seen = new Set(), out = [];
  for (const x of [...first, ...second]) { if (seen.has(x.id)) continue; seen.add(x.id); const v = pick(x.id); if (v) out.push(v); }
  return out;
}
/* GitHub 读写 */
const Cloud = {
  cfg: (() => { try { return JSON.parse(localStorage.getItem(CKEY)) || {}; } catch (e) { return {}; } })(),
  sha: null, base: null, dirty: false, rev: 0, loaded: false, busy: false, again: false, timer: 0, last: null, err: '', missing: false, ok: false,
  ready() { return !!(this.cfg.token && this.cfg.owner && this.cfg.repo); },
  path() { return this.cfg.path || 'data.json'; },
  api(p) { return 'https://api.github.com/repos/' + encodeURIComponent(this.cfg.owner) + '/' + encodeURIComponent(this.cfg.repo) + (p ? '/' + p : ''); },
  async req(method, p, body) {
    let r;
    try {
      r = await fetch(this.api(p), { method, cache: 'no-store', headers: Object.assign({ Authorization: 'Bearer ' + this.cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    } catch (e) { const x = new Error('连不上 GitHub（可能没联网）'); x.net = true; throw x; }
    const j = await r.json().catch(() => ({}));
    return { status: r.status, j };
  },
  fail(r) {
    const m = r.status === 401 ? '访问令牌不对或已过期，请到「设置」重新填写'
      : r.status === 403 ? '这个令牌没有数据仓库的写入权限（Contents 要选 Read and write）'
      : r.status === 404 ? '找不到数据仓库：检查 GitHub 用户名、仓库名，以及令牌是否选了这个仓库'
      : 'GitHub 返回错误 ' + r.status + (r.j && r.j.message ? '：' + r.j.message : '');
    return new Error(m);
  },
  async get() {
    const r = await this.req('GET', 'contents/' + this.path().split('/').map(encodeURIComponent).join('/'));
    if (r.status === 404) { const repo = await this.req('GET', ''); if (repo.status !== 200) throw this.fail(repo); return { missing: true }; }
    if (r.status !== 200) throw this.fail(r);
    let b64 = r.j.content;
    if (!b64 && r.j.size) { const bl = await this.req('GET', 'git/blobs/' + r.j.sha); if (bl.status !== 200) throw this.fail(bl); b64 = bl.j.content; }
    return { sha: r.j.sha, s: JSON.parse(fromB64(b64)) };
  },
  async put(text, message) {
    const body = { message, content: toB64(text) }; if (this.sha) body.sha = this.sha;
    const r = await this.req('PUT', 'contents/' + this.path().split('/').map(encodeURIComponent).join('/'), body);
    if (r.status === 200 || r.status === 201) return r.j.content.sha;
    if (r.status === 409 || r.status === 422) return null;   // 对方刚改过，需要先合并
    throw this.fail(r);
  },
  cache() { try { localStorage.setItem(CACHE, JSON.stringify({ s: S, base: this.base, sha: this.sha, dirty: this.dirty, repo: this.cfg.owner + '/' + this.cfg.repo })); } catch (e) {} },
};
let S = Store.load();
let user = (() => { try { return localStorage.getItem(UKEY); } catch (e) { return null; } })() || USERS[0];
const ui = { q: '', act: null, show: 'all', cat: '', gen: null, smode: 'sold', simp: null, sopen: {}, scal: false, scalAdd: [], open: {}, closed: {}, lq: '', lt: '', lc: '', lh: false, lmax: 200, pq: '', pf: '', sch: '' };

const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const uid = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const money = v => v == null ? '—' : '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const P = id => S.products.find(p => p.id === id);
const C = id => S.channels.find(c => c.id === id);
const pname = p => p ? p.series + ' · ' + p.name : '（已删除）';

function save() {
  if (CLOUD) {
    if (!Cloud.loaded) return;
    Cloud.dirty = true; Cloud.rev++; Cloud.cache(); syncStatus();
    clearTimeout(Cloud.timer); Cloud.timer = setTimeout(cloudPush, 1200); return;
  }
  const ok = Store.save(S);
  $('#saved').textContent = ok ? '已保存在本机 ' + new Date().toTimeString().slice(0, 5) : '保存失败';
}

/* ---------- 计算库存 ---------- */
function compute() {
  const m = {};
  const drop = new Set(S.channels.filter(c => c.type === 'drop').map(c => c.id));
  for (const p of S.products) m[p.id] = { wh: 0, ch: {}, cum: {}, retc: {}, csold: {}, in: 0, ret: 0, adj: 0, sold: 0 };
  for (const t of S.tx) {
    const r = m[t.pid]; if (!r) continue;
    const q = t.qty, add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
    switch (t.type) {
      case 'in': r.wh += q; r.in += q; break;
      case 'sale': r.wh -= q; add(r.cum, t.ch, q); r.sold += q; break;
      case 'gift': r.wh -= q; add(r.cum, t.ch, q); break;
      case 'c_out': r.wh -= q; add(r.ch, t.ch, q); add(r.cum, t.ch, q); break;
      case 'c_sold': add(r.ch, t.ch, -q); add(r.csold, t.ch, q); r.sold += q; break;
      case 'c_back': add(r.ch, t.ch, -q); add(r.cum, t.ch, -q); r.wh += q; break;
      case 'ret': r.wh += q; if (drop.has(t.ch)) add(r.retc, t.ch, q); else r.ret += q; break;
      case 'adj': if (t.ch) add(r.ch, t.ch, q); else r.wh += q; r.adj += q; break;
    }
  }
  for (const k in m) m[k].out = Object.values(m[k].ch).reduce((a, b) => a + b, 0);
  return m;
}
const num = (v, cls = '') => `<td class="n ${v === 0 ? 'zero' : v < 0 ? 'neg' : ''} ${cls}">${v}</td>`;
function groups(list) {
  const g = new Map();
  for (const p of list) { if (!g.has(p.series)) g.set(p.series, []); g.get(p.series).push(p); }
  return g;
}
function match(p, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return [p.series, p.name, p.sku, p.barcode, p.en].some(v => String(v || '').toLowerCase().includes(q));
}

/* ---------- 产品颜色：按名字里的颜色词自动判断，可在行内手动改 ---------- */
const CMAP = [['2025 月华图', '#8e6bb8'], ['墨菊|黑', '#2b2b2b'], ['幽兰|兑白|白', '#f7f5ef'], ['银灰|灰|月松', '#b5b5b0'], ['棕|山峦|财鹿', '#8a6244'],
  ['丈青|藏青|菩提|夜空', '#27365e'], ['牛仔蓝', '#5b7fa6'], ['水蓝|波澜|晴空|流云|雪人', '#a9d0ec'], ['宝相|蓝|行云流水|月华图', '#3f6fb5'], ['沧浪', '#3e8c8a'],
  ['薄荷', '#aee0cc'], ['玉|锦鱼', '#9fd2b8'], ['绿|雪竹|吉象', '#4e9a6b'], ['粉紫|木兰', '#c9a7d8'], ['紫|冷梅|离火', '#8e6bb8'], ['豆沙', '#b5666b'],
  ['酒红|枣红', '#8e2a32'], ['桃|粉|喜鹊|连钱', '#f4afbd'], ['橙|橘|柿蒂', '#f08a3c'], ['红|灵龙|龙年毯', '#c8322b'], ['浅杏|腾云|化蝶|杯垫', '#ead7b7'],
  ['沙丘', '#d9b77e'], ['鹅黄|浅黄', '#f5e594'], ['黄|金|铜钱|春晓|摇钱树', '#f2c230']];
function guessColor(name) {
  let best = null, bi = 1e9, bl = 0;
  for (const [keys, hex] of CMAP) for (const k of keys.split('|')) {
    const i = String(name || '').indexOf(k);
    if (i >= 0 && (i < bi || (i === bi && k.length > bl))) { best = hex; bi = i; bl = k.length; }
  }
  return best;
}
/* 款号：FF + 系列 + 品类 + 颜色 + 序号，例如 FFSPTBBL01。颜色码决定这一行的底色 */
const SKU_SER = [['SP', '草木风骨'], ['NR', '自然灵境'], ['GP', '玄机几何'], ['MC', '瑞兽呈祥']];
const SKU_CAT = [['TB', '托特包', 'Accessories'], ['CB', '斜挎包 / 手机包', 'Accessories'], ['SB', '腋下包', 'Accessories'], ['PC', '收纳包', 'Accessories'], ['LS', '电脑包', 'Stationery'], ['PN', '笔袋', 'Stationery'], ['BC', '手账书衣', 'Stationery'],
  ['BK', '盖毯（旧：书衣也用过）', 'Homeware'], ['BT', '盖毯', 'Homeware'], ['WG', '挂毯', 'Homeware'], ['CS', '抱枕', 'Homeware'], ['CT', '杯垫', 'Homeware'], ['PM', '餐垫', 'Homeware'], ['KB', '针织碗', 'Homeware'], ['OB', '八角碗', 'Homeware'], ['VS', '容器', 'Homeware'], ['IH', '香插', 'Homeware'], ['CR', '筷架', 'Homeware'], ['OM', '挂件', 'Homeware'], ['SC', '围巾', 'Accessories'], ['LP', '灯', 'Lights']];
const SKU_COL = [['WH', '白', '#f7f5ef'], ['BE', '米白', '#ead7b7'], ['LA', '浅杏', '#f0d9b8'], ['BK', '黑', '#2b2b2b'], ['GR', '灰', '#b5b5b0'], ['GY', '灰', '#b5b5b0'], ['SL', '银', '#c4c6c8'], ['CH', '炭灰', '#55565a'], ['BR', '棕', '#8a6244'], ['KK', '卡其', '#d9b77e'],
  ['RD', '红', '#c8322b'], ['WN', '酒红', '#8e2a32'], ['MR', '枣红', '#8e2a32'], ['DR', '枣红', '#8e2a32'], ['TC', '砖红', '#b5563c'], ['PM', '豆沙红', '#b5666b'], ['PK', '粉', '#f4afbd'], ['OG', '橙', '#f08a3c'], ['YL', '黄', '#f2c230'], ['YE', '黄', '#f2c230'], ['LY', '浅黄', '#f5e594'], ['GD', '金', '#c9a44a'],
  ['GN', '绿', '#4e9a6b'], ['DG', '深绿', '#2f5d46'], ['MT', '抹茶', '#9db46a'], ['JD', '青玉', '#9fd2b8'], ['LB', '湖蓝', '#a9d0ec'], ['DB', '雾蓝', '#8fa9c2'], ['BL', '蓝', '#3f6fb5'], ['BU', '蓝', '#3f6fb5'], ['NB', '牛仔蓝', '#5b7fa6'], ['NV', '丈青 / 深蓝', '#27365e'], ['PR', '紫', '#8e6bb8'], ['PL', '紫', '#8e6bb8'], ['MV', '粉紫', '#c9a7d8'], ['MIX', '混色', '']];
const skuParts = sku => { const m = /^FF([A-Z]{2})([A-Z]{2})(MIX|[A-Z]{2})(\d{1,2})$/.exec(String(sku || '').trim().toUpperCase()); return m ? { ser: m[1], cat: m[2], col: m[3], num: m[4] } : null; };
function codeColor(sku) { const k = skuParts(sku), c = k && SKU_COL.find(x => x[0] === k.col); return c && c[2] ? c[2] : null; }
const colorOf = p => p.color || codeColor(p.sku) || guessColor(p.name);
const CATS4 = ['Lights', 'Homeware', 'Accessories', 'Stationery'];
function swatch(p) {
  const c = colorOf(p); if (!c) return '';
  const n = parseInt(c.slice(1), 16), lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return `background:${c};color:${lum > 0.6 ? '#161616' : '#fff'}`;
}
function addChannel(name, type) {
  name = String(name || '').trim(); if (!name) return null;
  let c = S.channels.find(x => x.name === name);
  if (c) c.active = true; else { c = { id: 'c' + uid(), name, type: type || 'consign', active: true }; S.channels.push(c); }
  save(); return c;
}
function moveChannel(id, targetId, after) {
  const c = C(id); if (!c || id === targetId) return;
  S.channels = S.channels.filter(x => x !== c);
  const i = S.channels.findIndex(x => x.id === targetId);
  S.channels.splice(i < 0 ? S.channels.length : i + (after ? 1 : 0), 0, c); save();
}
// 改渠道类型时，把这个渠道以前的流水一起换成新口径，数量不丢
function retypeChannel(c, type) {
  if (c.type === type) return;
  const out = { sale: 'sale', drop: 'sale', gift: 'gift', consign: 'c_out' }[type], keep = [];
  for (const t of S.tx) {
    if (t.ch !== c.id) { keep.push(t); continue; }
    if (['sale', 'gift', 'c_out'].includes(t.type)) { t.type = out; keep.push(t); }
    else if (t.type === 'c_back' && type === 'drop') { t.type = 'ret'; keep.push(t); }   // 代发：调回记成这个渠道的退货
    else if (t.type === 'c_back') { t.type = out; t.qty = -t.qty; keep.push(t); }   // 调回 = 少出了这么多
    else if (t.type === 'ret') keep.push(t);
    // 寄售售出、店内调整：换成直营 / 赠送后不再需要
  }
  S.tx = keep; c.type = type; save();
}
function addProduct(name, series) {
  name = String(name || '').trim(); if (!name) return null;
  const sib = S.products.find(x => x.series === (series || '未分类'));
  const p = { id: 'p' + uid(), series: series || '未分类', cat: sib ? sib.cat : (ui.cat || ''), name, en: '', sku: '', barcode: '', cost: null, price: null, note: '', active: true };
  let at = -1; S.products.forEach((x, i) => { if (x.series === p.series) at = i; });
  if (at < 0) S.products.push(p); else S.products.splice(at + 1, 0, p);
  save(); return p;
}

/* ---------- 库存（可直接改数字的表格） ---------- */
const GSHORT = { sale: '直营', drop: '代发', gift: '赠送', consign: '寄售' };
const GROUPS0 = 0, GROUPS = [['sale', '直营'], ['drop', '代发（有订单才发，发出即售出）'], ['gift', '赠送'], ['consign', '寄售（现在还在店里的数量，仍属于我们）']];
function viewState() { S.view = S.view || {}; S.view.hideSeries = S.view.hideSeries || []; S.view.order = (S.view.order || []).filter(t => GSHORT[t]); for (const [t] of GROUPS) if (!S.view.order.includes(t)) S.view.order.push(t); S.view.fold = S.view.fold || {}; return S.view; }
function gridCols() {
  const hidden = ui.show === 'hidden', v = viewState();
  return v.order.map(t => ({ t, l: GROUPS.find(g => g[0] === t)[1], fold: !!v.fold[t], chs: S.channels.filter(c => c.type === t && (c.active !== false) !== hidden) }));
}
function moveGroup(t, target, after) {
  const v = viewState(); if (t === target) return;
  v.order = v.order.filter(x => x !== t); const i = v.order.indexOf(target);
  v.order.splice(i < 0 ? v.order.length : i + (after ? 1 : 0), 0, t); save();
}
function cellVal(r, k) { return k === 'in' ? r.in : k === 'ret' ? r.ret : k === 'wh' ? r.wh : k.startsWith('rt:') ? (r.retc[k.slice(3)] || 0) : ((C(k.slice(3)) || {}).type === 'consign' ? r.ch : r.cum)[k.slice(3)] || 0; }
function applyDelta(pid, k, d) {
  if (!d) return;
  let type, ch = null;
  if (k === 'in') type = 'in'; else if (k === 'ret') type = 'ret'; else if (k === 'wh') type = 'adj';
  else if (k.startsWith('rt:')) { ch = k.slice(3); type = 'ret'; }
  else { ch = k.slice(3); type = { sale: 'sale', drop: 'sale', gift: 'gift', consign: 'c_out' }[C(ch).type]; }
  const date = today();
  const t = S.tx.find(x => x.auto && x.pid === pid && x.type === type && x.ch === ch && x.date === date && x.by === user);
  if (t) { t.qty += d; if (!t.qty) S.tx = S.tx.filter(x => x !== t); }
  else S.tx.push({ id: uid(), date, pid, type, ch, qty: d, by: user, note: '表格录入', auto: true });
  save();
}
function commitInput() {
  const el = $('#cellin'); if (!el) return;
  const v = parseInt(el.value, 10), k = el.dataset.col, pid = el.dataset.pid;
  if (isNaN(v) || (v < 0 && k !== 'wh')) return;
  applyDelta(pid, k, v - cellVal(compute()[pid], k));
}
const CAL_HOW = {
  back: { l: '退回本仓', type: 'c_back', dir: -1, fx: '本仓 +' },
  sold: { l: '其实卖掉了', type: 'c_sold', dir: -1, fx: '算卖出，账单金额另补' },
  loss: { l: '丢失 / 损坏 / 样品', type: 'adj', dir: -1, fx: '记为损耗，本仓不变' },
  out:  { l: '发货漏登', type: 'c_out', dir: 1, fx: '本仓 −' },
  plus: { l: '盘点多出', type: 'adj', dir: 1, fx: '本仓不变' },
};
function calSelect(diff) {   // diff < 0 店里少了，> 0 店里多了，0 还没改
  const opts = Object.entries(CAL_HOW).filter(([, h]) => !diff || Math.sign(diff) === h.dir).map(([k, h]) => `<option value="${k}" data-dir="${h.dir}">${h.l}（${h.fx}）</option>`).join('');
  return `<select class="calsel" ${diff ? '' : 'disabled'}><option value="">${diff ? '选去向…' : '—'}</option>${opts}</select>`;
}
function histTotal(id) {   // 对账记录最下面的合计：累计卖出件数、累计结算金额
  const rs = S.settles.filter(x => x.ch === id && !x.kind); if (!rs.length) return '';
  const n = rs.reduce((a, x) => a + x.lines.reduce((b, l) => b + (l.qty || 0), 0), 0), amt = Math.round(rs.reduce((a, x) => a + x.lines.reduce((b, l) => b + (l.price != null ? l.qty * l.price : 0), 0), 0) * 100) / 100;
  const m = compute(), tx = S.tx.filter(t => t.ch === id), sum = ty => tx.filter(t => ty.includes(t.type)).reduce((a, t) => a + t.qty, 0);
  const out = sum(['c_out']), back = sum(['c_back']), adj = sum(['adj']), ins = S.products.reduce((a, p) => a + (m[p.id].ch[id] || 0), 0);
  const loss = -tx.filter(t => t.type === 'adj' && t.qty < 0).reduce((a, t) => a + t.qty, 0), plus = tx.filter(t => t.type === 'adj' && t.qty > 0).reduce((a, t) => a + t.qty, 0);
  return `<tr class="htot"><td><b>合计（${rs.length} 次结算）</b></td><td class="n"><b>卖出 ${n} 件</b></td><td class="n"><b>${money(amt)}</b></td><td colspan="2"></td></tr>`
    + `<tr class="htot"><td colspan="5">在店 = 累计发出 <b>${out}</b> − 卖出 <b>${S.products.reduce((a, p) => a + (m[p.id].csold[id] || 0), 0)}</b>${back ? ` − 退回 <b>${back}</b>` : ''}${plus ? ` + 盘点多出 <b>${plus}</b>` : ''}${loss ? ` − 损耗 / 差异 <b>${loss}</b>` : ''} = <b>${ins}</b>${S.products.some(p => (m[p.id].ch[id] || 0) < 0) ? '　<span class="neg">有产品是负数：卖出比登记的发货多，发货可能漏登</span>' : ''}</td></tr>`;
}
function vStock() {
  const m = compute(), groupsCh = gridCols().filter(g => g.chs.length), hidden = ui.show === 'hidden';
  const cols = [];
  for (const g of groupsCh) {
    if (g.fold) { cols.push({ k: 'sum', g }); continue; }
    for (const c of g.chs) { cols.push({ k: 'ch:' + c.id, c, g }); if (c.type === 'drop') cols.push({ k: 'rt:' + c.id, c, g, sub: '退回' }); }
    if (g.t === 'sale' && !hidden) cols.push({ k: 'ret', g, sub: '退货' });
  }
  const hs = new Set(viewState().hideSeries), isHid = p => p.active === false || hs.has(p.series);
  const list = S.products.filter(p => (hidden ? isHid(p) : !isHid(p)) && (!ui.cat || p.cat === ui.cat) && match(p, ui.q) && !(ui.show === 'stock' && m[p.id].wh === 0 && m[p.id].out === 0));
  let wh = 0, out = 0, val = 0, costed = 0;
  for (const p of S.products) { if (p.active === false) continue; const r = m[p.id]; wh += r.wh; out += r.out; if (p.cost != null) { val += (r.wh + r.out) * p.cost; costed++; } }
  const nHid = S.products.filter(p => p.active === false && !hs.has(p.series)).length + hs.size + S.channels.filter(c => c.active === false).length;
  const visSeries = [...groups(list).keys()];
  const ncol = cols.length + 4;
  const cell = (p, r, k, cls = '', sub = '') => {
    const v = cellVal(r, k);
    if (ui.act === p.id + '|' + k) return `<td class="cell on ${cls}"><span class="stp"><button data-act="step" data-d="-1" tabindex="-1">－</button><input id="cellin" type="number" inputmode="numeric" data-pid="${p.id}" data-col="${k}" value="${v}"><button data-act="step" data-d="1" tabindex="-1">＋</button></span></td>`;
    return `<td class="n cell ${v < 0 ? 'neg' : ''} ${cls}" data-act="cell" data-pid="${p.id}" data-col="${k}">${v === 0 && k !== 'wh' ? '' : v}${sub}</td>`;
  };
  const soldTag = n => n ? `<small class="sold" title="这家店累计卖出 ${n} 件">卖${n}</small>` : '';
  const colCell = (p, r, c) => {
    if (c.k === 'sum') { const v = c.g.chs.reduce((a, x) => a + ((c.g.t === 'consign' ? r.ch : r.cum)[x.id] || 0), 0); return `<td class="n ro gl ${c.g.t === 'consign' ? 'cs' : ''}">${v || ''}${c.g.t === 'consign' ? soldTag(c.g.chs.reduce((a, x) => a + (r.csold[x.id] || 0), 0)) : ''}</td>`; }
    return cell(p, r, c.k, (c.g.t === 'consign' ? 'cs ' : '') + (c.sub ? 'rt ' : '') + (c === cols.find(x => x.g === c.g) ? 'gl' : ''), c.c && c.c.type === 'consign' && !c.sub ? soldTag(r.csold[c.c.id] || 0) : '');
  };
  let rows = '';
  for (const [series, ps] of groups(list)) {
    const closed = ui.closed[series] && !ui.q;
    rows += `<tr class="grp" data-act="fold" data-k="${esc(series)}" ${ui.q ? '' : `draggable="true" data-drag="s:${esc(series)}" data-drop="s:${esc(series)}" data-dir="v" title="按住可以上下拖动，调整品类顺序"`}><td class="c1"><i class="grip2">⠿</i>${closed ? '＋' : '－'} ${esc(series || '未分类')}<span class="sacts">${!hidden && !ui.q ? `<button class="x mv" data-act="smove" data-k="${esc(series)}" data-d="-1" title="上移这个品类" ${visSeries[0] === series ? 'disabled' : ''}>↑</button><button class="x mv" data-act="smove" data-k="${esc(series)}" data-d="1" title="下移这个品类" ${visSeries[visSeries.length - 1] === series ? 'disabled' : ''}>↓</button>` : ''}${hidden && !hs.has(series) ? '' : `<button class="x eye" data-act="hides" data-k="${esc(series)}" title="${hs.has(series) ? '恢复显示这个品类' : '隐藏整个品类（数量保留，在「已隐藏」里能找回）'}">${hs.has(series) ? EYE_OFF : EYE}</button>`}</span></td><td class="n c2">${ps.reduce((a, p) => a + m[p.id].wh, 0)}</td><td class="n cumin">${ps.reduce((a, p) => a + m[p.id].in, 0) || ''}</td><td class="n cumin cumsold">${ps.reduce((a, p) => a + m[p.id].sold, 0) || ''}</td>${cols.map(c => {
      const cs = c.g.t === 'consign', sum = f => ps.reduce((a, p) => a + (f(m[p.id]) || 0), 0), gl = c === cols.find(x => x.g === c.g) ? 'gl' : '';
      if (c.k === 'sum') return `<td class="n gl ${cs ? 'cs' : ''}">${sum(r => c.g.chs.reduce((a, x) => a + ((cs ? r.ch : r.cum)[x.id] || 0), 0)) || ''}${cs ? soldTag(sum(r => c.g.chs.reduce((a, x) => a + (r.csold[x.id] || 0), 0))) : ''}</td>`;
      const v = sum(r => cellVal(r, c.k));
      return `<td class="n ${cs ? 'cs' : ''} ${c.sub ? 'rt' : ''} ${gl}">${v || ''}${c.c && c.c.type === 'consign' && !c.sub ? soldTag(sum(r => r.csold[c.c.id])) : ''}</td>`;
    }).join('')}</tr>`;
    if (closed) continue;
    for (const p of ps) {
      const r = m[p.id];
      rows += `<tr data-drop="p:${p.id}" data-dir="v"><td class="c1 nm" style="${swatch(p)}" draggable="true" data-drag="p:${p.id}" title="按住可以上下拖动，调整同品类里的顺序"><button class="link" data-act="open" data-id="${p.id}">${esc(p.name)}</button>${p.note ? '<i class="dot" title="有待确认事项"></i>' : ''}${hidden && hs.has(p.series) && p.active !== false ? '' : `<button class="x eye" data-act="hidep" data-id="${p.id}" title="${hidden ? '恢复显示' : '隐藏这个产品（数量保留）'}">${hidden ? EYE_OFF : EYE}</button>`}</td>`
        + cell(p, r, 'wh', 'c2 wh') + cell(p, r, 'in', 'cumin') + `<td class="n ro cumin cumsold" title="各渠道累计卖出（直营 + 代发 + 寄售店已结算）">${r.sold || ''}</td>` + cols.map(c => colCell(p, r, c)).join('') + `</tr>`;
      if (ui.open[p.id]) {
        const at = Object.entries(r.ch).filter(e => e[1]).map(([k, v]) => `${esc(C(k)?.name || k)} ${v}`).join('　') || '无';
        const f = (k, l, w, type = 'text') => `<label>${l}<input type="${type}" ${type === 'number' ? 'step="0.01" min="0"' : ''} style="width:${w}px" data-pid="${p.id}" data-f="${k}" value="${esc(p[k] ?? '')}"></label>`;
        rows += `<tr class="det"><td colspan="${ncol}"><div class="edit">${f('name', '名称', 110)}${f('series', '系列', 150)}<label>分类<select data-pid="${p.id}" data-f="cat"><option value=""></option>${CATS4.map(c => `<option ${p.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>${f('sku', '款号', 110)}<button class="sm" data-act="gen" data-id="${p.id}">${ui.gen === p.id ? '收起' : '生成款号'}</button>${f('barcode', '条码', 130)}${f('cost', '成本 ¥', 70, 'number')}${f('price', '售价 ¥', 70, 'number')}<label>颜色<input type="color" data-pid="${p.id}" data-f="color" value="${colorOf(p) || '#e8e4da'}"></label><button class="sm" data-act="hidep" data-id="${p.id}">${hidden ? '恢复显示' : '隐藏'}</button></div>
          ${ui.gen === p.id ? (() => { const k = skuParts(p.sku) || {}; const opt = (list, cur) => list.map(x => `<option value="${x[0]}" ${x[0] === cur ? 'selected' : ''}>${x[0]} · ${x[1]}</option>`).join('');
            return `<div class="gen" data-pid="${p.id}"><span>款号 = FF + 系列 + 品类 + 颜色 + 序号</span><select id="gser"><option value="">系列</option>${opt(SKU_SER, k.ser)}</select><select id="gcat"><option value="">品类</option>${opt(SKU_CAT, k.cat)}</select><select id="gcol"><option value="">颜色</option>${opt(SKU_COL, k.col)}</select><input id="gnum" type="number" min="1" max="99" placeholder="序号" value="${k.num ? Number(k.num) : ''}" style="width:64px"><b id="gout"></b><i id="gsw"></i><button class="sm" data-act="genok" data-id="${p.id}">用这个款号</button><span class="hint" id="ghint"></span></div>`; })() : ''}
          <div class="cp"><span>各渠道单价</span>${S.channels.filter(c => c.active !== false && c.type !== 'gift' && ((r.cum[c.id] || 0) > 0 || (r.ch[c.id] || 0) !== 0)).map(c => { const o = S.cprice && S.cprice[c.id] && S.cprice[c.id][p.id], d = p.price == null ? '' : Math.round(p.price * rateOf(c) * 100) / 100; const cr = S.crate && S.crate[c.id] && S.crate[c.id][p.id]; return `<label>${esc(c.name)}<input data-cp="${c.id}" data-pid="${p.id}" value="${o != null ? o : cr != null ? Math.round(cr * 100) + '%' : ''}" placeholder="${d}"></label>`; }).join('')}<span class="hint">只列出这个产品进过的店。留空 = 零售价 × 这家店的结算比例（直营就是零售价）；也可以填一口价（如 395）或单独的比例（如 40%）</span></div>
          <div>${p.en ? esc(p.en) + '　' : ''}现在在寄售店：${at}${r.adj ? '　盘点调整 ' + r.adj : ''}${p.note ? '<br>待确认：' + esc(p.note) : ''}</div></td></tr>`;
      }
    }
    if (!hidden && !ui.q) {
      const hid = S.products.filter(p => p.series === series && p.active === false);
      rows += `<tr class="add"><td colspan="${ncol}"><div class="addrow">${hid.length ? `<span class="hint">加回：</span>${hid.map(p => `<button class="chip" data-act="hidep" data-id="${p.id}" style="${swatch(p)}" title="点一下恢复显示">＋ ${esc(p.name)}</button>`).join('')}` : ''}<input data-add="product" data-series="${esc(series)}" placeholder="＋ 新颜色 / 花纹，输入名字回车"></div></td></tr>`;
    }
  }
  if (!hidden && !ui.q) rows += `<tr class="add"><td colspan="${ncol}"><div class="addrow"><input data-add="series" placeholder="＋ 新系列，输入名字回车"></div></td></tr>`;
  const h1 = `<th class="c1" rowspan="2">产品</th><th class="n c2" rowspan="2">本仓</th><th class="n" rowspan="2" title="这个产品累计进了多少货">累计<br>进货</th><th class="n" rowspan="2" title="各渠道累计卖出：直营 + 代发 + 寄售店已结算的">累计<br>卖出</th>` + groupsCh.map((g, gi) => `<th class="gh ${g.t}" colspan="${cols.filter(c => c.g === g).length}" draggable="true" data-drag="g:${g.t}" data-drop="g:${g.t}" title="按住可以整组左右拖动，或点 ‹ › 移动"><button class="fold" data-act="gfold" data-id="${g.t}" title="${g.fold ? '展开' : '收起'}">${g.fold ? '＋' : '－'}</button> ${g.fold ? GSHORT[g.t] : g.l}<span class="gmv"><button class="x mv" data-act="gmove" data-id="${g.t}" data-d="-1" title="整组往左移" ${gi === 0 ? 'disabled' : ''}>‹</button><button class="x mv" data-act="gmove" data-id="${g.t}" data-d="1" title="整组往右移" ${gi === groupsCh.length - 1 ? 'disabled' : ''}>›</button></span></th>`).join('');
  const h2 = cols.map(c => c.k === 'sum' ? `<th class="n r2 sub gl">${c.g.t === 'consign' ? '在店' : '合计'}</th>` : c.sub ? `<th class="n r2 sub" title="${c.c ? esc(c.c.name) + ' 退回给我们的数量' : '直营渠道的客人退货'}">${c.sub}</th>`
    : `<th class="n r2 ${c.c.type} ${c === cols.find(x => x.g === c.g) ? 'gl' : ''}" draggable="true" data-drag="${c.c.id}" data-drop="${c.c.id}" title="按住可以左右拖动排序"><span>${esc(c.c.name)}</span><button class="x eye" data-act="hidec" data-id="${c.c.id}" title="${hidden ? '恢复显示' : '隐藏这个渠道（数量保留）'}">${hidden ? EYE_OFF : EYE}</button></th>`).join('');
  return `<div class="tools">
    <input type="search" id="q" placeholder="搜索名称 / 款号 / 条码" value="${esc(ui.q)}">
    <div class="seg">${[['all', '全部'], ['stock', '只看有库存'], ['hidden', `已隐藏 ${nHid || ''}`]].map(([k, l]) => `<button data-act="show" data-v="${k}" class="${ui.show === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="seg">${[['', '全部分类'], ...CATS4.map(c => [c, c])].map(([k, l]) => `<button data-act="cat" data-v="${k}" class="${ui.cat === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="addch"><input data-add="channel" placeholder="＋ 新渠道，输入名字回车"><select id="newch">${Object.entries(CH_TYPES).reverse().map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></span>
    <span class="tot">本仓 <b>${wh}</b>　寄售在店 <b>${out}</b>　累计进货 <b>${S.products.reduce((a, p) => a + m[p.id].in, 0)}</b>　累计卖出 <b>${S.products.reduce((a, p) => a + m[p.id].sold, 0)}</b>${costed ? `　库存金额 <b>${money(val)}</b>` : ''}</span></div>
  <div class="wrap grid"><table><thead><tr>${h1}</tr><tr>${h2}</tr></thead><tbody>${rows || `<tr><td colspan="${ncol}" class="empty">${hidden ? '没有隐藏的产品' : '没有符合的产品'}</td></tr>`}</tbody></table></div>
  <p class="hint">点任意一格，按 ＋ － 或直接改数字，自动保存。渠道组：左上角 － 收起成一列，‹ › 整组左右移；单个渠道按住拖动换位置，小眼睛隐藏。品类：↑ ↓ 上下移（也能按住拖动），小眼睛隐藏整个品类。隐藏的都在「已隐藏」里，数量都保留。寄售店的格子是现在还在店里的数量。</p>`;
}

/* ---------- 流水 ---------- */
function vLedger() {
  let list = S.tx.filter(t => (ui.lh || !t.hist) && (!ui.lt || t.type === ui.lt) && (!ui.lc || t.ch === ui.lc) && (!ui.lq || match(P(t.pid) || {}, ui.lq)));
  list = list.slice().reverse();
  const n = list.length; list = list.slice(0, ui.lmax);
  const rows = list.map(t => `<tr><td>${esc(t.date)}</td><td>${esc(TYPES[t.type]?.l || t.type)}</td><td>${esc(pname(P(t.pid)))}</td><td class="sku">${esc(P(t.pid)?.sku)}</td><td>${esc(t.ch ? C(t.ch)?.name || t.ch : '')}</td>${num(t.qty)}<td>${esc(t.by)}</td><td>${esc(t.note)}</td><td><button class="sm" data-act="del" data-id="${t.id}">删除</button></td></tr>`).join('');
  return `<div class="tools"><input type="search" id="lq" placeholder="搜索产品 / 款号 / 条码" value="${esc(ui.lq)}">
    <select id="lt"><option value="">全部类型</option>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${ui.lt === k ? 'selected' : ''}>${v.l}</option>`).join('')}</select>
    <select id="lc"><option value="">全部渠道</option>${S.channels.map(c => `<option value="${c.id}" ${ui.lc === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <label><input type="checkbox" id="lh" ${ui.lh ? 'checked' : ''}>显示历史导入</label><span class="hint">${n} 条</span></div>
  <div class="wrap"><table><thead><tr><th>日期</th><th>类型</th><th>产品</th><th>款号</th><th>渠道</th><th class="n">数量</th><th>记录人</th><th>备注</th><th></th></tr></thead>
  <tbody>${rows || `<tr><td colspan="9" class="empty">${ui.lh ? '没有记录' : '还没有新的记录。旧表导入的数据勾选「显示历史导入」可以看到。'}</td></tr>`}</tbody></table></div>
  ${n > ui.lmax ? '<div class="tools"><button data-act="more">显示更多</button></div>' : ''}`;
}

/* ---------- 渠道单价 ---------- */
const rateOf = c => c.rate != null ? c.rate : (c.type === 'consign' ? 0.6 : 1);
function priceFor(p, c) {
  const o = S.cprice && S.cprice[c.id] && S.cprice[c.id][p.id];
  if (o != null) return o;
  const r = S.crate && S.crate[c.id] && S.crate[c.id][p.id];
  return p.price == null ? null : Math.round(p.price * (r != null ? r : rateOf(c)) * 100) / 100;
}
function setPrice(cid, pid, v) {
  S.cprice = S.cprice || {}; S.cprice[cid] = S.cprice[cid] || {}; S.crate = S.crate || {}; S.crate[cid] = S.crate[cid] || {};
  if (typeof v === 'string') {   // 产品页里可以写「395」（一口价）、「40%」或「4折」（比例）
    const t = v.trim(), m = /^(\d+(?:\.\d+)?)\s*(%|折)$/.exec(t);
    delete S.crate[cid][pid];
    if (m) { S.crate[cid][pid] = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]) / 10; v = null; } else v = t === '' ? null : Number(t);
  }
  if (v == null || isNaN(v)) delete S.cprice[cid][pid]; else S.cprice[cid][pid] = v;
  save();
}
const lastMonth = () => { const d = new Date(); d.setDate(0); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };

/* ---------- 寄售对账 ---------- */
function vSettle() {
  ui.smode = 'sold'; const m = compute(), left = false;
  const cons = S.channels.filter(c => c.type === 'consign'), drops = S.channels.filter(c => c.type === 'drop' && c.active !== false);
  const inStore = c => S.products.reduce((a, p) => a + (m[p.id].ch[c.id] || 0), 0);
  if (!ui.sch || !C(ui.sch) || !['consign', 'drop'].includes(C(ui.sch).type)) ui.sch = (cons.find(c => c.active !== false && inStore(c) > 0) || cons[0] || drops[0] || {}).id || '';
  const shopBar = `<div class="tools shops">${cons.filter(c => c.active !== false || inStore(c)).map(c => `<button data-act="sch" data-id="${c.id}" class="${ui.sch === c.id ? 'on' : ''}">${esc(c.name)} <small>${inStore(c)}</small></button>`).join('')}${drops.map(c => `<button data-act="sch" data-id="${c.id}" class="${ui.sch === c.id ? 'on' : ''}">${esc(c.name)} <small>代发</small></button>`).join('')}</div>`;
  if (C(ui.sch) && C(ui.sch).type === 'drop') return vDrop(m, shopBar);
  const ch = C(ui.sch), imp = ui.simp && ui.simp.ch === ui.sch && !ui.simp.o ? ui.simp : null;
  const ps = S.products.filter(p => (m[p.id].ch[ui.sch] || 0) !== 0);
  const total = ps.reduce((a, p) => a + m[p.id].ch[ui.sch], 0);
  const rows = ps.map(p => { const n = m[p.id].ch[ui.sch], pr = priceFor(p, ch); return `<tr data-pid="${p.id}" data-have="${n}"><td class="nm" style="${swatch(p)}">${esc(pname(p))}</td><td class="n ${n < 0 ? 'neg' : ''}" ${n < 0 ? 'title="卖出的比系统里记的发货多，说明有补货没登记"' : ''}>${n}</td><td class="ed"><input class="num sold" type="number" min="0" max="${n}" inputmode="numeric"></td><td class="ed"><input class="num leftin" type="number" min="0" max="${n}" inputmode="numeric" value="${n}"></td>${imp && (imp.m || imp.f) ? '<td class="n bill"></td>' : ''}<td class="ed"><input class="num sp" type="number" min="0" step="0.01" inputmode="decimal" value="${pr ?? ''}" placeholder="单价"></td><td class="n amt"></td></tr>`; }).join('');
  // 以前的对账
  const list = (S.settles || []).filter(x => x.ch === ui.sch).slice().reverse().sort((a, b) => (b.manual ? b.date.slice(0, 7) : b.month || '').localeCompare(a.manual ? a.date.slice(0, 7) : a.month || ''));
  const hrows = list.map(x => {
    if (x.kind === 'calib') {
      let r = `<tr class="hrow" data-act="sopen" data-id="${x.id}"><td>${ui.sopen[x.id] ? '－' : '＋'} ${x.manual ? '手动校准在店数量' : `在店数量校准（截至 ${esc(x.month)}）`}${x.manual && x.src ? `<span class="hint">　${esc(x.src)}</span>` : ''}</td><td class="n">${x.lines.length} 款有调整</td><td class="n"></td><td>${esc(x.date)} 登记 · ${esc(x.by)}</td><td><button class="sm" data-act="unsettle" data-id="${x.id}">撤销</button></td></tr>`;
      if (ui.sopen[x.id]) r += `<tr class="det"><td colspan="5"><table class="lines"><thead><tr><th>产品</th><th class="n">校准前</th><th class="n">校准后</th><th class="n">调整</th><th>差异去向</th></tr></thead><tbody>${x.lines.map(l => `<tr><td>${esc(pname(P(l.pid)))}</td><td class="n">${l.from}</td><td class="n">${l.to}</td><td class="n">${l.to - l.from > 0 ? '+' : ''}${l.to - l.from}</td><td>${l.how && CAL_HOW[l.how] ? esc(CAL_HOW[l.how].l) + '<span class="hint">（' + CAL_HOW[l.how].fx + '）</span>' : '<span class="hint">没写去向：只改了在店数量，本仓和卖出都没动</span>'}</td></tr>`).join('')}</tbody></table><div>${x.manual ? '原因' : '依据'}：${esc(x.src)}。</div></td></tr>`;
      return r;
    }
    const n = x.lines.reduce((a, l) => a + l.qty, 0), amt = Math.round(x.lines.reduce((a, l) => a + (l.price != null ? l.qty * l.price : 0), 0) * 100) / 100, noPrice = x.lines.some(l => l.price == null), nb = (x.backs || []).reduce((a, l) => a + l.qty, 0);
    const lname = l => l.pid && P(l.pid) ? pname(P(l.pid)) : (l.name || '') + '（还没对上产品，没有扣库存）';
    let r = `<tr class="hrow" data-act="sopen" data-id="${x.id}"><td>${ui.sopen[x.id] ? '－' : '＋'} ${esc(x.month || x.date)} 结算${x.calib ? '（按剩余数校准）' : ''}${x.memo ? `<span class="hint">　${esc(x.memo)}</span>` : ''}</td><td class="n">卖出 ${n} 件${nb ? `<small class="sold">召回 / 调货 ${nb}（待确认）</small>` : ''}</td><td class="n">${money(amt)}${noPrice ? ' *' : ''}</td><td>${esc(x.date)} 登记 · ${esc(x.by)}</td><td><button class="sm" data-act="unsettle" data-id="${x.id}">撤销</button></td></tr>`;
    if (ui.sopen[x.id]) r += `<tr class="det"><td colspan="5"><table class="lines"><thead><tr><th>产品</th><th class="n">卖出</th><th class="n">结算单价</th><th class="n">金额</th></tr></thead><tbody>${x.lines.map(l => `<tr><td>${esc(lname(l))}${l.note ? `<span class="hint">　${esc(l.note)}</span>` : ''}</td><td class="n">${l.qty}</td><td class="n">${money(l.price)}</td><td class="n">${l.price == null ? '—' : money(Math.round(l.qty * l.price * 100) / 100)}</td></tr>`).join('')}${(x.backs || []).map(l => `<tr><td>${esc(pname(P(l.pid)))}<span class="hint">　${esc(l.note || '品牌召回')}，账单上写的，去向待确认，暂时没计入库存</span></td><td class="n">−${l.qty}</td><td class="n"></td><td class="n">—</td></tr>`).join('')}</tbody></table>${x.src ? `<div>来源：${esc(x.src)}</div>` : ''}${noPrice ? '<div>* 有的产品当时没填单价，金额不完整</div>' : ''}${x.priceNote ? `<div>${esc(x.priceNote)}</div>` : ''}</td></tr>`;
    return r;
  }).join('');
  if (ui.scal) {
    const cps = S.products.filter(p => (m[p.id].ch[ui.sch] || 0) !== 0 || ui.scalAdd.includes(p.id));
    const crow = cps.map(p => { const n = m[p.id].ch[ui.sch] || 0; return `<tr data-pid="${p.id}" data-have="${n}"><td class="nm" style="${swatch(p)}">${esc(pname(p))}</td><td class="n ${n < 0 ? 'neg' : ''}">${n}</td><td class="ed"><input class="num calin" type="number" min="0" inputmode="numeric" value="${Math.max(0, n)}"></td><td class="n caldiff">${n < 0 ? '+' + (-n) : ''}</td><td class="calhow">${calSelect(n < 0 ? -n : 0)}</td></tr>`; }).join('');
    return `<p class="note">店里的实际数量和系统对不上时用。改好「实际在店」后，每一处差异都要选它<b>去了哪里 / 从哪里来</b>：<br>店里少了 → 退回本仓（本仓 +）、其实卖掉了（算卖出）、丢失 / 损坏 / 样品（记为损耗）；店里多了 → 发货漏登（本仓 −）、盘点多出（本仓不变）。每次校准都留记录，可以撤销。</p>
    ${shopBar}
    <div class="wrap"><table class="settle"><thead><tr><th>产品</th><th class="n">系统里在店</th><th class="n">实际在店</th><th class="n">调整</th><th>差异去向</th></tr></thead><tbody>${crow || '<tr><td colspan="5" class="empty">这家店现在没有记录</td></tr>'}
    <tr class="add"><td colspan="5"><div class="addrow"><input id="caladd" list="plist3" placeholder="＋ 这家店还有别的产品，输入名字选一个"><datalist id="plist3">${S.products.filter(p => p.active !== false && !cps.includes(p)).map(x => `<option value="${esc(plabel(x))}">`).join('')}</datalist></div></td></tr></tbody></table></div>
    <div class="tools"><label>原因 <input id="calwhy" placeholder="比如：店铺退货 2 件、月底盘点" style="width:280px"></label><label>登记日期 <input type="date" id="sdate" value="${today()}"></label><button class="primary" data-act="calsave">保存校准</button><button data-act="scal">取消</button><p class="msg" id="smsg"></p></div>
    ${hrows ? `<h3 class="sub" id="hist">${esc(ch.name)} 的对账记录（点开看明细）</h3><div class="wrap hist"><table><tbody>${hrows}${histTotal(ch.id)}</tbody></table></div>` : ''}`;
  }
  let impBar = '';
  if (imp && imp.m) impBar = `<div class="tools imp"><b>${esc(imp.src || '粘贴的账单')}</b><span class="hint">是按月的进销存表，取哪个月？</span><select id="smi">${imp.m.months.map((x, i) => `<option value="${i}" ${i === imp.mi ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select><span class="hint" id="spres"></span><button class="sm" data-act="sclear">取消导入</button></div>`;
  else if (imp) impBar = `<div class="tools imp"><b>${esc(imp.f && imp.f.title ? imp.f.title : imp.src || '粘贴的账单')}</b><span class="hint" id="spres"></span><button class="sm" data-act="sclear">取消导入</button></div>`;
  return `<p class="note">每月收到店铺账单后：① 点店铺　② 导入账单或照着填数　③ 核对单价和金额　④ 保存。「账单上卖出」和「对账后还在店」填哪一个都行，另一个自动算。库存页那家店的数量会自动更新，每次对账都留有明细。</p>
  ${shopBar}
  ${rows ? `<div class="tools"><button data-act="sfile">导入账单 Excel</button><input type="file" id="sfile" accept=".xlsx,.xls,.csv" hidden>
    <button data-act="fillsold">全部卖完</button>
    <button data-act="scal">校准在店数量</button>
    ${list.length ? `<button class="link jump" data-act="tohist">已有 ${list.length} 条对账记录，点这里看 ↓</button>` : ''}
    <span class="hint">这家店我们拿 ${Math.round(rateOf(ch) * 100)}%（在「渠道」页改）</span>
    <details class="paste"><summary>没有 Excel 文件？从表格复制粘贴</summary><div><textarea id="spaste" rows="5" placeholder="选中账单表格（要有品名、款号或条码，以及数量），复制后粘贴到这里"></textarea><div class="tools"><button data-act="sparse">识别并填入</button></div></div></details></div>${impBar}` : ''}
  <div class="wrap"><table class="settle"><thead><tr><th>产品</th><th class="n">系统里在店</th><th class="n">账单上卖出</th><th class="n">对账后还在店</th>${imp && (imp.m || imp.f) ? '<th class="n">账单上的存</th>' : ''}<th class="n">结算单价</th><th class="n">金额</th></tr></thead>
  <tbody>${rows || `<tr><td colspan="6" class="empty">这家店现在没有我们的货</td></tr>`}</tbody>
  ${rows ? `<tfoot><tr><td>合计</td><td class="n">${total}</td><td class="n" id="sin">0</td><td class="n" id="sout">${left ? 0 : total}</td>${imp && (imp.m || imp.f) ? '<td></td>' : ''}<td></td><td class="n" id="samt">¥0</td></tr></tfoot>` : ''}</table></div>
  ${rows ? `<div class="tools"><label>结算月份 <input type="month" id="smonth" value="${lastMonth()}"></label><label>登记日期 <input type="date" id="sdate" value="${today()}"></label><button class="primary" data-act="settle">保存对账</button><p class="msg" id="smsg"></p></div>` : ''}
  ${hrows ? `<h3 class="sub" id="hist">${esc(ch.name)} 的对账记录（点开看明细）</h3><div class="wrap hist"><table><tbody>${hrows}${histTotal(ch.id)}</tbody></table></div>` : ''}`;
}
// 读一行：返回这次卖出的件数；null = 没填；NaN = 填错
function soldOf(tr) {
  const have = Number(tr.dataset.have), raw = tr.querySelector('.sold').value;
  if (raw === '') return null;
  const v = Number(raw); if (!Number.isInteger(v) || v < 0 || v > have) return NaN;
  return ui.smode === 'left' ? have - v : v;
}
function settleSum() {
  let a = 0, b = 0, amt = 0;
  document.querySelectorAll('#view tr[data-pid]').forEach(tr => {
    const have = Number(tr.dataset.have), s = soldOf(tr), i = tr.querySelector('.sold'), bad = Number.isNaN(s), left = ui.smode === 'left';
    const pr = tr.querySelector('.sp').value === '' ? null : Number(tr.querySelector('.sp').value);
    i.classList.toggle('bad', bad); tr.classList.toggle('done', !!s);
    const after = have - (s || 0);
    const li = tr.querySelector('.leftin'); if (document.activeElement !== li) li.value = bad ? '' : after;
    const amtEl = tr.querySelector('.amt'), ba = tr.dataset.bamt, mine = s && pr != null ? s * pr : 0, off = ba !== undefined && !bad && Math.abs(Number(ba) - mine) > 0.011;
    amtEl.textContent = (s && !bad ? (pr == null ? '缺单价' : money(mine)) : '') + (off ? ` ≠ 账单 ${money(Number(ba))}` : ''); amtEl.classList.toggle('neg', off);
    const bill = tr.querySelector('.bill'); if (bill && bill.dataset.v !== undefined && bill.dataset.v !== '') { const ok = Number(bill.dataset.v) === after; bill.textContent = bill.dataset.v + (ok ? '' : ' ≠'); bill.classList.toggle('neg', !ok); }
    if (bad) return;
    a += Number(i.value) || 0; b += left ? (s || 0) : after; if (s && pr != null) amt += s * pr;
  });
  if ($('#sin')) { $('#sin').textContent = a; $('#sout').textContent = b; $('#samt').textContent = money(amt); }
}
/* 导入账单：Excel 文件或粘贴的表格 → 二维数组 → 识别 */
const nz = x => String(x || '').replace(/福图|[\s\-—–·・\/【】（）()]/g, '');
function lcs(a, b) { let best = 0; const prev = new Array(b.length + 1).fill(0); for (let i = 1; i <= a.length; i++) { let diag = 0; for (let j = 1; j <= b.length; j++) { const t = prev[j]; prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0; if (prev[j] > best) best = prev[j]; diag = t; } } return best; }
function billMatch(cells, ps) {   // cells[0] 是品名，其余是条码 / 款号等
  const line = nz(cells.join(' ')), name = String(cells[0] || '').trim(), nn = nz(name);
  let c = ps.filter(p => p.barcode && cells.includes(p.barcode));
  if (c.length !== 1) c = ps.filter(p => p.sku && cells.includes(p.sku));
  if (c.length !== 1) {
    const grams = p => { const t = nz(p.en) + '|' + nz(p.name), g = new Set(); for (let i = 0; i < t.length - 1; i++) if (!t.slice(i, i + 2).includes('|')) g.add(t.slice(i, i + 2)); return g; };
    const G = ps.map(grams), cnt = {}; G.forEach(g => g.forEach(x => { cnt[x] = (cnt[x] || 0) + 1; }));
    const sc = ps.map((p, pi) => {
      const en = nz(p.en), l = nn ? lcs(nn, en + nz(p.series) + nz(p.name)) : 0, uniq = [...G[pi]].filter(x => cnt[x] === 1 && line.includes(x)).length;
      const base = (en && line.includes(en) ? 100 : 0) + (name && name === p.name ? 60 : 0) + (nn.length >= 2 && en.includes(nn) ? 50 : 0) + (l >= 3 ? l * 2 : 0);
      return base ? base + (p.name && line.includes(nz(p.name)) ? nz(p.name).length : 0) + uniq * 0.5 : 0;
    });
    const mx = Math.max(0, ...sc); c = mx > 0 ? ps.filter((p, i) => sc[i] === mx) : [];
  }
  return c.length === 1 ? c[0] : null;
}
function detectFlat(rows) {   // 一行一个产品、带表头的结算单
  const hd = x => String(x).replace(/\s/g, '');
  const SOLD = /^销售$|^销量$|销售数量|本月销量|销量/;
  const h = rows.slice(0, 8).findIndex(r => r.some(x => SOLD.test(hd(x))) && r.some(x => /名称|品名|商品编码|条码/.test(hd(x))));
  if (h < 0) return null;
  const head = rows[h].map(hd), col = re => head.findIndex(x => re.test(x));
  const f = { name: col(/名称|品名|商品编码/), code: col(/条码|条形码/), sold: col(SOLD), left: col(/(期末|本月|月末|现有)库存/), retail: col(/零售|标准售价|^售价$/), disc: col(/折扣/), sprice: col(/结算单价|结算价/), samt: col(/结算金额|结算合计/) };
  if (f.name < 0 && f.code < 0) return null;
  const lines = [];
  for (let i = h + 1; i < rows.length; i++) { const r = rows[i]; if (/^(合计|总计|制表)/.test(hd(r[0]) || hd(r[1]))) break; if (r.some(x => x)) lines.push(r); }
  let month = '';
  for (const r of rows.slice(0, h)) for (const x of r) { const mm = /(?:(20\d\d)年)?(\d{1,2})月/.exec(x); if (mm && !month) { const now = new Date(); let y = mm[1] ? Number(mm[1]) : now.getFullYear(); if (!mm[1] && Number(mm[2]) > now.getMonth() + 1) y--; month = y + '-' + mm[2].padStart(2, '0'); } }
  if (!month) for (const r of rows.slice(0, h)) { const c = r.filter(x => x); const n = c.find(x => /^(1[0-2]|[1-9])$/.test(x)); if (n && c.length <= 2) { const now = new Date(); let y = now.getFullYear(); if (Number(n) > now.getMonth() + 1) y--; month = y + '-' + n.padStart(2, '0'); } }
  return lines.length ? { f, lines, month, title: /月/.test(String(rows[0].find(x => x) || '')) ? String(rows[0].find(x => x)) : (month ? month + ' 结算单' : String(rows[0].find(x => x) || '')) } : null;
}
const isNum = x => /^-?\d+(\.0+)?$/.test(String(x).trim());
const toNum = x => { const v = Number(String(x).replace(/[,¥￥\s]/g, '')); return String(x).trim() === '' || isNaN(v) ? null : v; };
function detectMatrix(rows) {   // 按月的「进 / 销 / 存」表
  const h = rows.findIndex(r => r.filter(x => String(x).trim() === '销').length >= 1 && r.some(x => String(x).trim() === '存'));
  if (h < 0) return null;
  const head = rows[h].map(x => String(x).trim()), top = (rows[h - 1] || []).map(x => String(x).trim()), months = [], seen = {};
  head.forEach((x, j) => {
    if (x !== '销') return;
    const jin = head.lastIndexOf('进', j), jleft = head.indexOf('存', j);
    let label = ''; for (let k = j; k >= 0 && !label; k--) label = top[k] || '';
    seen[label] = (seen[label] || 0) + 1;
    months.push({ label: (label || `第 ${months.length + 1} 组`) + (seen[label] > 1 ? `（第 ${seen[label]} 个）` : ''), jin: jin >= 0 && j - jin <= 2 ? jin : -1, j, jleft: jleft >= 0 && jleft - j <= 2 ? jleft : -1 });
  });
  const lines = [];
  for (let i = h + 1; i < rows.length; i++) { const r = rows[i].map(x => String(x).trim()); if (!r[0]) break; if (!r.slice(1).some(isNum)) break; lines.push(r); }
  if (!lines.length) return null;
  let mi = 0; months.forEach((mo, i) => { if (lines.some(r => isNum(r[mo.j]) || (mo.jleft >= 0 && isNum(r[mo.jleft])))) mi = i; });
  return { months, lines, mi };
}
function setImport(rows, src) {
  rows = rows.map(r => r.map(x => x == null ? '' : String(x).trim())).filter(r => r.some(x => x));
  if (!rows.length) return;
  const od = detectOrders(rows), isDrop = C(ui.sch).type === 'drop';
  if (isDrop || od) {
    if (isDrop && od) { ui.simp = { ch: ui.sch, src, o: od }; render(); return; }
    render(); if ($('#smsg')) $('#smsg').textContent = isDrop ? '这个文件不像订单明细（需要有「SKU名称」和「件数」两列）。' : '这个文件是订单明细，适用于代发店铺；寄售店请导入结算单。'; return;
  }
  const fl = detectFlat(rows);
  ui.simp = { ch: ui.sch, src, rows, f: fl, m: fl ? null : detectMatrix(rows) };
  if (ui.simp.m) ui.simp.mi = ui.simp.m.mi;
  if (fl) {   // 账单上的折扣和零售价，顺手补进系统
    const c = C(ui.sch), ds = [...new Set(fl.lines.map(r => toNum(r[fl.f.disc])).filter(x => x > 0 && x <= 1))], notes = [];
    if (fl.f.disc >= 0 && ds.length === 1 && Math.abs(rateOf(c) - ds[0]) > 1e-9) { c.rate = ds[0]; notes.push(`这家店的结算折扣按账单改成了 ${Math.round(ds[0] * 100)}%`); }
    if (fl.f.retail >= 0) { let n = 0; for (const r of fl.lines) { const p = billMatch([r[fl.f.name] || '', r[fl.f.code] || ''], S.products.filter(x => x.active !== false)), v = toNum(r[fl.f.retail]); if (p && p.price == null && v > 0) { p.price = v; n++; } } if (n) notes.push(`${n} 个产品原来没有零售价，按账单补上了`); }
    ui.simp.notes = notes; if (notes.length) save();
  }
  render();
}
function applyImport() {
  const imp = ui.simp; if (!imp || imp.o || imp.ch !== ui.sch || !$('#view table.settle')) return;
  const trs = [...document.querySelectorAll('#view tr[data-pid]')], ps = trs.map(tr => P(tr.dataset.pid)), tr = p => trs[ps.indexOf(p)];
  const miss = []; let n = 0, msg = '';
  if (imp.f) {
    const f = imp.f.f, left = ui.smode === 'left';
    for (const r of imp.f.lines) {
      const sold = toNum(r[f.sold]), lf = f.left >= 0 ? toNum(r[f.left]) : null, nm = r[f.name] || r[f.code];
      const p = billMatch([r[f.name] || '', r[f.code] || ''], ps);
      if (!p) { if (sold || lf) miss.push(nz(nm).slice(0, 14)); continue; }
      const t = tr(p), v = left ? lf : sold;
      if (v != null) { t.querySelector('.sold').value = v; n++; }
      const b = t.querySelector('.bill'); if (b) b.dataset.v = lf == null ? '' : lf;
      const sp = f.sprice >= 0 ? toNum(r[f.sprice]) : null;
      if (sp != null) { t.querySelector('.sp').value = sp; if (priceFor(p, C(ui.sch)) !== sp) setPrice(ui.sch, p.id, sp); }
      const am = f.samt >= 0 ? toNum(r[f.samt]) : null; if (am != null && !left) t.dataset.bamt = am;
    }
    msg = `填入 ${n} 款（取「${left ? '期末库存' : '销量'}」）` + (imp.notes && imp.notes.length ? '；' + imp.notes.join('；') : '');
    if (imp.f.month && $('#smonth') && !imp.monthSet) { $('#smonth').value = imp.f.month; imp.monthSet = true; }
    else if (imp.f.month && $('#smonth')) $('#smonth').value = imp.f.month;
  } else if (imp.m) {
    const mo = imp.m.months[imp.mi], left = ui.smode === 'left';
    for (const r of imp.m.lines) {
      const p = billMatch([r[0]], ps); if (!p) { miss.push(r[0]); continue; }
      const t = tr(p), v = left ? (mo.jleft >= 0 ? r[mo.jleft] : '') : r[mo.j];
      if (isNum(v)) { t.querySelector('.sold').value = Number(v); n++; }
      const b = t.querySelector('.bill'); if (b) b.dataset.v = mo.jleft >= 0 && isNum(r[mo.jleft]) ? Number(r[mo.jleft]) : '';
    }
    msg = `填入 ${n} 款（取「${left ? '存' : '销'}」这一列）`;
  } else {
    const hits = [];
    for (const cells of imp.rows) { const p = billMatch(cells, ps); if (p) hits.push({ p, cells }); else if (/\d/.test(cells.join(''))) miss.push(cells.join(' ').slice(0, 24)); }
    const score = {};
    for (const h of hits) { const have = Number(tr(h.p).dataset.have); h.cells.forEach((x, i) => { if (/^\d{1,4}$/.test(x) && Number(x) <= have && x !== h.p.barcode) score[i] = (score[i] || 0) + 1; }); }
    const col = Object.keys(score).sort((a, b) => score[b] - score[a] || a - b)[0];
    if (col != null) for (const h of hits) { const x = h.cells[col]; if (/^\d{1,4}$/.test(x || '')) { tr(h.p).querySelector('.sold').value = x; n++; } }
    msg = `填入 ${n} 行` + (col != null ? `（数量取第 ${Number(col) + 1} 列）` : '，没找到数量列');
  }
  settleSum();
  const bad = document.querySelectorAll('#view input.sold.bad').length;
  if ($('#spres')) $('#spres').textContent = msg + (bad ? `；${bad} 行超过了系统里的在店数（标红）` : '') + (miss.length ? `；账单里有、这家店系统里没有的：${miss.slice(0, 6).join(' / ')}${miss.length > 6 ? ' …' : ''}` : '') + '。保存前请对一遍。';
}

/* ---------- 代发订单明细：把店铺的商品标题对到我们的产品 ---------- */
const ORDER_RULES = [
  { fam: /灯笼/, series: '灯笼灯', plus: '灯架', vars: [[/粉紫|紫/, '紫'], [/橙/, '橙'], [/蓝/, '蓝'], [/鹅黄/, '鹅黄'], [/薄荷/, '薄荷'], [/柔粉|粉/, '柔粉'], [/黄/, '黄']] },
  { fam: /织影灯|走马灯/, series: '走马灯', plus: '灯架', vars: [[/曜金|铜钱/, '铜钱'], [/灼灼|桃花/, '桃花'], [/月松/, '月松'], [/雪竹/, '雪竹'], [/冷梅/, '冷梅'], [/灵龙/, '灵龙']] },
  { fam: /挂历|月历|日历/, series: '挂历', vars: [[/2027.*摇钱树|摇钱树.*2027/, '2027 摇钱树'], [/摇钱树/, '2026 摇钱树'], [/2026.*月华图|月华图/, '2026 月华图'], [/2025|月相挂历|月亮挂历/, '2025 月华图']] },
  { fam: /八角/, series: '八角', vars: [[/红/, '红'], [/蓝/, '蓝'], [/紫/, '紫'], [/黄|金/, '金']] },
  { fam: /聚宝|针织碗/, series: '针织碗', vars: [[/斗金|黄/, '黄'], [/烟紫|紫/, '紫'], [/橘橙|橙/, '橙'], [/青玉|玉/, '玉'], [/木兰/, '木兰'], [/桃花/, '桃花']] },
  { fam: /抱枕/, series: '抱枕', vars: [[/铜钱|黄/, '黄'], [/如意|蓝/, '蓝'], [/盘长|紫/, '紫'], [/柿蒂|橙/, '橙']] },
  { fam: /盖毯|针织毯/, series: '龙年', vars: [[/./, '毯']] },
  { fam: /条纹.*(托特|单肩)/, series: '条纹', vars: [[/紫/, '紫'], [/红/, '红'], [/蓝/, '蓝'], [/黄/, '黄'], [/绿/, '绿']] },
  { fam: /香插|线香|吉象|财鹿|锦鱼|喜鹊/, series: '香插', vars: [[/雪华|雪人/, '雪人'], [/春晓/, '春晓'], [/沧浪/, '沧浪'], [/离火/, '离火'], [/山峦/, '山峦'], [/菩提/, '菩提'], [/锦鱼/, '锦鱼'], [/财鹿/, '财鹿'], [/吉象/, '吉象'], [/喜鹊/, '喜鹊']] },
];
// 标题里「颜色分类 / 规格 / 款式」后面那一段才是变体；前面是店铺写的营销标题
function orderSpec(title) {
  const t = String(title).replace(/\s+/g, ' ').trim();
  const m = /(?:颜色分类|商品规格|规格|款式|颜色)\s*[:：]\s*(.+)$/.exec(t);
  return { t, spec: m ? m[1] : t };
}
function orderMatch(title, products, alias) {
  const { t, spec } = orderSpec(title), key = orderKey(title);
  if (alias && alias[key]) { const ps = alias[key].map(id => products.find(p => p.id === id)).filter(Boolean); if (ps.length) return ps; }
  for (const r of ORDER_RULES) {
    if (!r.fam.test(t)) continue;
    const pool = products.filter(p => p.series.includes(r.series));
    for (const [re, nm] of r.vars) {
      if (!re.test(spec)) continue;
      const p = pool.find(x => x.name.includes(nm)); if (!p) return null;
      const plus = r.plus ? pool.find(x => x.name.includes(r.plus)) : null;
      return plus ? [p, plus] : [p];
    }
    return null;
  }
  return null;
}
// 同一个产品的各种标题写法归成一个键，用来记住手动指定的对应
function orderKey(title) {
  const { t, spec } = orderSpec(title);
  const fam = (ORDER_RULES.find(r => r.fam.test(t)) || {}).series || t.replace(/【[^】]*】|卷宗商店|wallpaperstore|福图|FORPHOR|[|丨\s]/gi, '').slice(0, 12);
  return fam + '｜' + spec.replace(/[\[（(【].*$/, '').replace(/[\s·・]/g, '');
}
function orderMonth(x, prev) {
  const s = String(x || '').trim(); let m;
  if ((m = /^(20\d\d)[\/\-.](\d{1,2})[\/\-.]\d{1,2}/.exec(s))) return m[1] + '-' + m[2].padStart(2, '0');
  if ((m = /^(\d{1,2})\/\d{1,2}\/(\d\d)\b/.exec(s))) return '20' + m[2] + '-' + m[1].padStart(2, '0');
  return prev || '';
}
function detectOrders(rows) {   // 订单明细：一行一单，有「SKU名称 / 件数」
  const hd = x => String(x).replace(/\s/g, '');
  const h = rows.slice(0, 6).findIndex(r => r.some(x => /SKU名称|商品名称|宝贝标题/.test(hd(x))) && r.some(x => /件数|数量/.test(hd(x))) && r.some(x => /快递单号|运单号|物流单号|支付时间|下单时间|付款时间|收件/.test(hd(x))));
  if (h < 0) return null;
  const head = rows[h].map(hd), col = re => head.findIndex(x => re.test(x));
  const f = { title: col(/SKU名称|商品名称|宝贝标题/), qty: col(/件数|数量/), time: col(/支付时间|下单时间|付款时间/), track: col(/快递单号|运单号|物流单号/) };
  const lines = []; let prev = '';
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i], title = String(r[f.title] || '').trim(); if (!title) continue;
    const month = orderMonth(f.time >= 0 ? r[f.time] : '', prev); prev = month;
    const track = f.track >= 0 ? String(r[f.track] || '') : '';
    const notes = r.filter((x, j) => j !== f.title && j !== f.time && j > f.qty).join(' ');   // 件数右边的备注、单号等
    const shipped = /[A-Za-z]{0,4}\d{9,}/.test(track);
    const back = /退回|收到退货|退货单号|退货物流/.test(notes);
    const cancel = !back && /取消|拦截|无需发货|仅退款|退款/.test(notes) && (!shipped || /拦截/.test(notes));
    const q = parseInt(r[f.qty], 10);
    lines.push({ title, qty: isNaN(q) ? 1 : q, noQty: isNaN(q), month, status: back ? 'back' : cancel ? 'cancel' : 'ok' });
  }
  return lines.length ? { lines } : null;
}
function dropCalc(imp) {
  const agg = {}, un = {}; let cancelN = 0, last = '', first = '9', noQty = 0;
  for (const l of imp.o.lines) {
    if (l.month && l.month > last) last = l.month; if (l.month && l.month < first) first = l.month; if (l.noQty) noQty++;
    const ps = orderMatch(l.title, S.products, S.alias);
    if (!ps) { const k = orderKey(l.title), u = un[k] = un[k] || { n: 0, ex: l.title, a: '9', b: '' }; u.n += l.qty; if (l.month < u.a) u.a = l.month; if (l.month > u.b) u.b = l.month; continue; }
    if (l.status === 'cancel') { cancelN += l.qty; continue; }
    for (const p of ps) { const a = agg[p.id] = agg[p.id] || { out: 0, back: 0 }; a.out += l.qty; if (l.status === 'back') a.back += l.qty; }
  }
  return { agg, un, cancelN, last, first, noQty };
}
function vDrop(m, shopBar) {
  const ch = C(ui.sch), imp = ui.simp && ui.simp.ch === ui.sch && ui.simp.o ? ui.simp : null;
  let body = '';
  if (imp) {
    const d = dropCalc(imp); let A = 0, B = 0, SA = 0, SB = 0, nd = 0;
    const rows = S.products.map(p => {
      const a = d.agg[p.id] || { out: 0, back: 0 }, so = m[p.id].cum[ch.id] || 0, sb = m[p.id].retc[ch.id] || 0;
      if (!a.out && !a.back && !so && !sb) return '';
      A += a.out; B += a.back; SA += so; SB += sb; const dif = a.out !== so || a.back !== sb; if (dif) nd++;
      const dd = (x, y) => x === y ? '' : `<span class="neg">${x - y > 0 ? '+' : ''}${x - y}</span>`;
      return `<tr><td class="nm" style="${swatch(p)}">${esc(pname(p))}</td><td class="n">${a.out}</td><td class="n">${a.back || ''}</td><td class="n mute">${so}</td><td class="n mute">${sb || ''}</td><td class="n">${dd(a.out, so)}</td><td class="n">${dd(a.back, sb)}</td></tr>`;
    }).join('');
    const un = Object.entries(d.un).sort((a, b) => b[1].n - a[1].n);
    body = `<div class="tools imp"><b>${esc(imp.src)}</b><span class="hint">${imp.o.lines.length} 行订单，${esc(d.first)} 到 ${esc(d.last)}。另有 ${d.cancelN} 件已取消、没有发出，不计入。${d.noQty ? `有 ${d.noQty} 行没写件数，按 1 件算。` : ''}只读取商品名、件数、时间和备注，不保存收件人信息。</span><button class="sm" data-act="sclear">取消导入</button></div>
    ${un.length ? `<h3 class="sub">有 ${un.length} 种商品名没认出来（共 ${un.reduce((a, x) => a + x[1].n, 0)} 件），告诉我它是哪个产品，以后就记住了</h3><div class="wrap narrow2"><table><tbody>${un.map(([k, u]) => `<tr><td>${esc(k.replace('｜', ' · '))}<div class="hint">${esc(u.ex.slice(0, 46))}　${esc(u.a)} ~ ${esc(u.b)}</div></td><td class="n">${u.n} 件</td><td class="ed"><input list="plist2" data-alias="${esc(k)}" placeholder="选产品"></td></tr>`).join('')}</tbody></table></div><datalist id="plist2">${S.products.map(x => `<option value="${esc(plabel(x))}">`).join('')}</datalist>` : ''}
    <div class="wrap"><table class="settle"><thead><tr><th>产品</th><th class="n">明细里发出</th><th class="n">明细里退回</th><th class="n">系统里发出</th><th class="n">系统里退回</th><th class="n">发出差</th><th class="n">退回差</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>合计</td><td class="n">${A}</td><td class="n">${B}</td><td class="n">${SA}</td><td class="n">${SB}</td><td class="n">${A - SA || ''}</td><td class="n">${B - SB || ''}</td></tr></tfoot></table></div>
    <div class="tools"><label>登记日期 <input type="date" id="sdate" value="${today()}"></label><button class="primary" data-act="dropsync" ${nd ? '' : 'disabled'}>按明细更新系统（${nd} 款有差异）</button><span class="hint">发出和退回都改成和明细一致，本仓跟着变。可以撤销。</span><p class="msg" id="smsg"></p></div>`;
  } else {
    body = `<div class="tools"><button data-act="sfile">导入订单明细 Excel</button><input type="file" id="sfile" accept=".xlsx,.xls,.csv" hidden><span class="hint">${esc(ch.name)} 是代发：导入他们的发货明细（从头到现在的完整表），系统逐款对比发出和退回的数量。</span><p class="msg" id="smsg"></p></div>`;
  }
  const list = (S.settles || []).filter(x => x.ch === ui.sch).slice().reverse();
  list.sort((a, b) => (b.kind === 'bill' ? b.month : '9').localeCompare(a.kind === 'bill' ? a.month : '9'));
  const hrows = list.map(x => {
    if (x.kind === 'bill') {
      const n = x.lines.reduce((a, l) => a + l.qty, 0);
      let r = `<tr class="hrow" data-act="sopen" data-id="${x.id}"><td>${ui.sopen[x.id] ? '－' : '＋'} ${esc(x.period || x.month)} 对账单${x.memo ? `<span class="hint">　${esc(x.memo)}</span>` : ''}</td><td class="n">卖出 ${n} 件　零售额 ${money(x.total)}${x.settle != null ? '　结算 ' + money(x.settle) : ''}</td><td>${esc(x.date)} 登记 · ${esc(x.by)}</td><td><button class="sm" data-act="unsettle" data-id="${x.id}">撤销</button></td></tr>`;
      if (ui.sopen[x.id]) r += `<tr class="det"><td colspan="4"><table class="lines"><thead><tr><th>账单上的品名</th><th>对应产品</th><th class="n">卖出</th><th class="n">零售价</th><th class="n">零售额</th></tr></thead><tbody>${x.lines.map(l => `<tr><td>${esc(l.name)}</td><td>${l.pid && P(l.pid) ? esc(pname(P(l.pid))) : '<span class="hint">账单没写颜色 / 还没对上</span>'}</td><td class="n">${l.qty}</td><td class="n">${money(l.retail)}</td><td class="n">${money(l.amt)}</td></tr>`).join('')}</tbody></table><div>来源：${esc(x.src)}。对账单只留记录，不改库存（发出数量以你们登记的为准）。</div></td></tr>`;
      return r;
    }
    let r = `<tr class="hrow" data-act="sopen" data-id="${x.id}"><td>${ui.sopen[x.id] ? '－' : '＋'} 按订单明细对齐（明细到 ${esc(x.month)}）</td><td class="n">发出 ${x.lines.reduce((a, l) => a + l.out, 0)}　退回 ${x.lines.reduce((a, l) => a + l.back, 0)}</td><td>${esc(x.date)} 登记 · ${esc(x.by)}</td><td><button class="sm" data-act="unsettle" data-id="${x.id}">撤销</button></td></tr>`;
    if (ui.sopen[x.id]) r += `<tr class="det"><td colspan="4"><table class="lines"><thead><tr><th>产品</th><th class="n">发出</th><th class="n">退回</th><th class="n">这次调整</th></tr></thead><tbody>${x.lines.map(l => `<tr><td>${esc(pname(P(l.pid)))}</td><td class="n">${l.out}</td><td class="n">${l.back || ''}</td><td class="n">${[l.dOut ? '发出 ' + (l.dOut > 0 ? '+' : '') + l.dOut : '', l.dBack ? '退回 ' + (l.dBack > 0 ? '+' : '') + l.dBack : ''].filter(Boolean).join('，') || '—'}</td></tr>`).join('')}</tbody></table><div>来源：${esc(x.src)}${x.keepWh ? '。这次只改了发出和退回的数，本仓保持原来的结存不变。' : ''}</div></td></tr>`;
    return r;
  }).join('');
  return `<p class="note">寄售店：每月导入结算单。代发店：导入发货明细，和系统逐款核对。</p>${shopBar}${body}
  ${hrows ? `<h3 class="sub">${esc(ch.name)} 的对账记录（点开看明细）</h3><div class="wrap hist"><table><tbody>${hrows}</tbody></table></div>` : ''}`;
}

/* ---------- 产品 ---------- */
function vProducts() {
  const used = new Set(S.tx.map(t => t.pid));
  const list = S.products.filter(p => match(p, ui.pq) && (ui.pf === 'note' ? p.note : ui.pf === 'cost' ? p.cost == null : ui.pf === 'bar' ? !p.barcode : true));
  const f = (p, k, cls = '', type = 'text') => `<td class="ed"><input class="${cls}" type="${type}" ${type === 'number' ? 'step="0.01" min="0" inputmode="decimal"' : ''} data-pid="${p.id}" data-f="${k}" value="${esc(p[k] ?? '')}"></td>`;
  const rows = list.map(p => `<tr>${f(p, 'series')}${f(p, 'name')}<td class="ed wide"><input data-pid="${p.id}" data-f="en" value="${esc(p.en ?? '')}"></td>${f(p, 'sku')}${f(p, 'barcode')}${f(p, 'cost', 'num', 'number')}${f(p, 'price', 'num', 'number')}<td class="ed wide"><input data-pid="${p.id}" data-f="note" value="${esc(p.note ?? '')}" title="${esc(p.note ?? '')}"></td><td><input type="checkbox" data-pid="${p.id}" data-f="active" ${p.active !== false ? 'checked' : ''}></td><td>${used.has(p.id) ? '' : `<button class="sm" data-act="delp" data-id="${p.id}">删除</button>`}</td></tr>`).join('');
  return `<p class="note">直接在格子里改，改完自动保存。成本和售价单位是人民币。款号、条码、售价来自贴纸汇总（标签总表）；「待确认」一栏写的是对应时拿不准的地方，确认后把那格清空即可。有流水的产品不能删除，只能取消「在售」。</p>
  <div class="tools"><input type="search" id="pq" placeholder="搜索名称 / 款号 / 条码" value="${esc(ui.pq)}">
    <select id="pf"><option value="">全部（${S.products.length}）</option><option value="note" ${ui.pf === 'note' ? 'selected' : ''}>只看待确认</option><option value="cost" ${ui.pf === 'cost' ? 'selected' : ''}>只看缺成本</option><option value="bar" ${ui.pf === 'bar' ? 'selected' : ''}>只看缺条码</option></select>
    <button data-act="addp">新增产品</button><span class="hint">${list.length} 个</span></div>
  <div class="wrap"><table><thead><tr><th>系列</th><th>名称 / 变体</th><th>标签品名</th><th>款号</th><th>条码</th><th class="n">成本</th><th class="n">售价</th><th>待确认</th><th>在售</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- 渠道 ---------- */
function vChannels() {
  const m = compute();
  let rows = '';
  for (const [type, label] of GROUPS) {
    const list = S.channels.filter(c => c.type === type);
    list.forEach((c, i) => {
      const at = S.products.reduce((a, p) => a + (m[p.id].ch[c.id] || 0), 0), cum = S.products.reduce((a, p) => a + (m[p.id].cum[c.id] || 0), 0);
      const used = S.tx.some(t => t.ch === c.id), off = c.active === false;
      rows += `<tr data-drop="${c.id}" data-dir="v" class="${off ? 'off' : ''}"><td class="grip" draggable="true" data-drag="${c.id}" title="按住上下拖动">⠿</td>
      <td class="ed"><input data-cid="${c.id}" data-f="name" value="${esc(c.name)}"></td>
      <td class="ed"><select data-cid="${c.id}" data-f="type">${Object.entries(CH_TYPES).map(([k, v]) => `<option value="${k}" ${c.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td class="ed"><input class="num pct" type="number" min="0" max="100" step="1" data-cid="${c.id}" data-f="rate" value="${Math.round(rateOf(c) * 100)}"> %</td>
      ${num(cum)}<td class="n">${c.type === 'consign' ? at : ''}</td>
      <td><button class="sm eye" data-act="hidec" data-id="${c.id}" title="${off ? '恢复显示' : '隐藏（数量保留）'}">${off ? EYE_OFF : EYE}</button> <span class="hint">${off ? '已隐藏' : ''}</span></td>
      <td><button class="sm" data-act="chup" data-id="${c.id}" ${i === 0 ? 'disabled' : ''}>↑</button> <button class="sm" data-act="chdown" data-id="${c.id}" ${i === list.length - 1 ? 'disabled' : ''}>↓</button></td>
      <td>${used ? '' : `<button class="sm" data-act="delc" data-id="${c.id}">删除</button>`}</td></tr>`;
    });
  }
  return `<p class="note">类型可以随时改：直营 = 卖出即出库；代发 = 合作店铺有订单我们才发，发出即售出，库存页多一列「退回」；寄售 = 货放在店里、卖出前仍属于我们；赠送 = KOL、朋友。改类型时，这个渠道以前的数量会一起换成新口径，不会丢。<br>不再合作的渠道点小眼睛隐藏：库存页不再显示这一列，但卖过的数量照样有效。拖左边的 ⠿ 或点 ↑ ↓ 调整顺序，库存页的列顺序跟着变。<br>结算比例 = 卖出一件我们拿零售价的百分之几。四六分填 60，五五分填 50，45/55 填 55。个别产品在这家店价格不一样的，点库存页的产品名，在「各渠道单价」里单独填。</p>
  <div class="tools"><span class="addch"><input data-add="channel" placeholder="＋ 新渠道，输入名字回车"><select id="newch">${Object.entries(CH_TYPES).reverse().map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></span></div>
  <div class="wrap"><table><thead><tr><th></th><th>名称</th><th>类型</th><th>结算比例（我们拿）</th><th class="n">累计出货</th><th class="n">现在在店</th><th>显示</th><th>顺序</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- 设置 ---------- */
function vSettings() {
  if (CLOUD) return vCloud();
  return `<div class="cards">
  <div><h3>程序版本</h3><p>${APP_VERSION}</p></div>
  <div><h3>数据保存在哪里</h3><p>现在是试用版，数据只存在这台电脑的这个浏览器里，Burke 那边看不到。上传到 GitHub 之后才会两人共用。试用期间建议改完就导出一份备份。</p></div>
  <div><h3>备份</h3><p>导出全部产品、渠道和流水为一个 JSON 文件；换电脑或出问题时可以导入恢复。</p><button data-act="export">导出备份</button> <button data-act="import">导入备份</button><input type="file" id="file" accept=".json,application/json" hidden></div>
  <div><h3>导出库存表</h3><p>当前库存导出成 CSV，可以用 Excel / Numbers 打开。</p><button data-act="csv">导出 CSV</button></div>
  <div><h3>恢复到初始数据</h3><p>丢弃这个浏览器里的所有修改，回到 2026-11-12 从旧表导入的状态。</p><button class="warn" data-act="reset">恢复初始数据</button><p class="msg" id="rmsg"></p></div></div>`;
}

function vCloud() {
  const c = Cloud.cfg, hist = c.owner && c.repo ? `https://github.com/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/commits/main/${Cloud.path()}` : '';
  const state = !Cloud.ready() ? '还没连接。填好下面三项，点「保存并连接」。'
    : Cloud.err ? `<span class="neg">${esc(Cloud.err)}</span>`
    : Cloud.missing ? '已连接，但仓库里还没有数据文件。请在下面上传初始数据。'
    : Cloud.loaded ? `已连接 <b>${esc(c.owner)}/${esc(c.repo)}</b>　·　${Cloud.dirty ? '有修改还没传上去' : '已同步'}${Cloud.last ? '　·　最后同步 ' + Cloud.last.toTimeString().slice(0, 5) : ''}` : '正在读取…';
  return `<div class="cards">
  <div><h3>GitHub 同步</h3><p>${state}</p><p class="hint">程序版本 ${APP_VERSION}</p>
    ${Cloud.ready() ? `<button data-act="csync">立即同步</button> ${hist ? `<a class="btnlink" href="${hist}" target="_blank" rel="noopener">查看修改历史 ↗</a>` : ''}` : ''}</div>
  ${Cloud.missing ? `<div><h3>上传初始数据（只需要做一次）</h3><p>选择一个数据文件：本机版「设置 → 导出备份」得到的 .json，或者 Claude 给你的「初始数据」文件。上传后你和 Burke 都用这一份。</p><button class="primary" data-act="cseed">选择文件并上传</button><input type="file" id="seedfile" accept=".json,application/json" hidden><p class="msg" id="seedmsg"></p></div>` : ''}
  <div><h3>连接设置</h3>
    <p><label>GitHub 用户名<br><input id="cowner" value="${esc(c.owner || 'Tarry-W')}" autocomplete="off"></label></p>
    <p><label>数据仓库（私有）<br><input id="crepo" value="${esc(c.repo || 'forphor-erp-data')}" autocomplete="off"></label></p>
    <p><label>访问令牌<br><input id="ctoken" type="password" value="${esc(c.token || '')}" placeholder="github_pat_…" autocomplete="off" style="width:100%;max-width:420px"></label></p>
    <button class="primary" data-act="cconnect">保存并连接</button> ${Cloud.ready() ? '<button data-act="cforget">在这台设备上退出</button>' : ''}
    <p class="hint">令牌只存在这台设备的这个浏览器里，不会上传到任何地方。换电脑、换浏览器、手机上打开，都要重新填一次。退出会清掉这台设备上的令牌和缓存，GitHub 上的数据不受影响。</p></div>
  <div><h3>备份</h3><p>导出全部数据为一个 JSON 文件，自己留一份。导入备份会<b>覆盖线上数据</b>（之前的版本在 GitHub 修改历史里还能找回）。</p><button data-act="export">导出备份</button> <button data-act="import">导入备份</button><input type="file" id="file" accept=".json,application/json" hidden></div>
  <div><h3>导出库存表</h3><p>当前库存导出成 CSV，可以用 Excel / Numbers 打开。</p><button data-act="csv">导出 CSV</button></div></div>`;
}
function syncStatus() {
  const el = $('#saved'); if (!el) return;
  if (!CLOUD) return;
  el.classList.toggle('neg', !!Cloud.err);
  el.textContent = !Cloud.ready() ? '还没连接 GitHub，请到「设置」'
    : Cloud.err ? Cloud.err + (Cloud.dirty ? '。修改先存在本机，会自动重试' : '')
    : Cloud.missing ? '仓库里还没有数据'
    : Cloud.busy ? '正在保存到 GitHub…'
    : Cloud.dirty ? '有修改，马上保存…'
    : Cloud.loaded ? '已同步 ' + (Cloud.last ? Cloud.last.toTimeString().slice(0, 5) : '') : '正在读取…';
}
function changeNote(b, s) {   // 写进 GitHub 修改历史的一句话
  if (!b) return '上传初始数据';
  const parts = [], txNew = [];
  for (const [k, name] of [['tx', '流水'], ['settles', '对账记录'], ['products', '产品'], ['channels', '渠道']]) {
    const B = new Map((b[k] || []).map(x => [x.id, JSON.stringify(x)])), ids = new Set(); let add = 0, mod = 0, del = 0;
    for (const x of s[k] || []) { ids.add(x.id); const o = B.get(x.id); if (o == null) { add++; if (k === 'tx') txNew.push(x); } else if (o !== JSON.stringify(x)) mod++; }
    for (const id of B.keys()) if (!ids.has(id)) del++;
    if (add) parts.push(`新增${add}条${name}`); if (mod) parts.push(`修改${mod}条${name}`); if (del) parts.push(`删除${del}条${name}`);
  }
  const det = txNew.slice(0, 3).map(t => { const p = (s.products || []).find(x => x.id === t.pid), c = (s.channels || []).find(x => x.id === t.ch); return `${(TYPES[t.type] || {}).l || t.type} ${p ? p.series + '·' + p.name : ''} ${t.qty}${c ? '（' + c.name + '）' : ''}`; });
  return (parts.join('，') || '调整显示 / 排序') + (det.length ? '：' + det.join('；') + (txNew.length > 3 ? '…' : '') : '');
}
const editing = () => !!(ui.act || ($('#dlg') && $('#dlg').open) || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName) && document.activeElement.id !== 'user'));
let pullAt = 0;
async function cloudPull(force) {
  if (!CLOUD || !Cloud.ready() || Cloud.busy) { syncStatus(); return; }
  if (!force && Date.now() - pullAt < 15000) return;
  pullAt = Date.now();
  try {
    const r = await Cloud.get(); Cloud.err = '';
    if (r.missing) { Cloud.missing = true; Cloud.loaded = false; syncStatus(); if (view === 'settings') render(); else location.hash = '#settings'; return; }
    Cloud.missing = false;
    let changed = false;
    if (r.sha !== Cloud.sha) {
      if (Cloud.loaded && Cloud.dirty && Cloud.base) S = merge3(Cloud.base, S, r.s);
      else S = r.s;
      Cloud.base = clone(r.s); Cloud.sha = r.sha; changed = true; viewState();
    }
    const first = !Cloud.loaded; Cloud.loaded = true; Cloud.last = new Date(); Cloud.cache(); syncStatus();
    if (changed || first) { if (editing()) Cloud.pending = true; else render(true); if (!first) toast('数据已更新（另一台设备刚改过）'); }
    if (Cloud.dirty) cloudPush();
  } catch (e) { Cloud.err = e.message; syncStatus(); if (view === 'settings') render(); }
}
async function cloudPush() {
  if (!CLOUD || !Cloud.loaded || !Cloud.ready()) return;
  if (Cloud.busy) { Cloud.again = true; return; }
  Cloud.busy = true; syncStatus();
  try {
    for (let i = 0; ; i++) {
      const rev0 = Cloud.rev, text = dump(S), snap = JSON.parse(text);
      const sha = await Cloud.put(text, user + '：' + changeNote(Cloud.base, snap));
      if (sha) { Cloud.sha = sha; Cloud.base = snap; Cloud.dirty = Cloud.rev !== rev0; break; }
      if (i >= 3) throw new Error('保存冲突重试了几次都没成功，请点「立即同步」');
      const r = await Cloud.get();   // 对方刚改过：取回最新的，合并后再存
      if (r.missing || !Cloud.base) { S = r.s || S; Cloud.base = clone(r.s); Cloud.sha = r.sha || null; Cloud.dirty = false; throw new Error('仓库里已经有数据了，已改用仓库里的数据'); }
      S = merge3(Cloud.base, S, r.s); Cloud.base = clone(r.s); Cloud.sha = r.sha; viewState();
      if (editing()) Cloud.pending = true; else render(true);
    }
    Cloud.err = ''; Cloud.last = new Date();
  } catch (e) {
    Cloud.err = e.message; if (e.net) setTimeout(cloudPush, 30000);
  } finally {
    Cloud.busy = false; Cloud.cache(); syncStatus();
    if (view === 'settings' && !editing()) render(true);
    if (Cloud.again) { Cloud.again = false; cloudPush(); }
  }
}
function toast(t) { let el = $('#toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); } el.textContent = t; el.className = 'show'; clearTimeout(toast.t); toast.t = setTimeout(() => el.className = '', 4000); }

/* ---------- 记一笔 ---------- */
const plabel = p => (p.sku ? p.sku + '｜' : '') + p.series + ' ' + p.name;
function findProduct(v) {
  v = String(v || '').trim(); if (!v) return null;
  const lo = v.toLowerCase(), act = S.products.filter(p => p.active !== false);
  return act.find(p => plabel(p) === v) || (act.filter(p => p.sku && p.sku.toLowerCase() === lo).length === 1 ? act.find(p => p.sku.toLowerCase() === lo) : null) || (act.filter(p => p.barcode === v).length === 1 ? act.find(p => p.barcode === v) : null)
    || (act.filter(p => match(p, v)).length === 1 ? act.find(p => match(p, v)) : null);
}
let rec = null;
function openRecord(pid, type) {
  rec = { type: type || 'sale', armed: false };
  const p = pid && P(pid);
  $('#dlg').innerHTML = `<h2>记一笔</h2><form method="dialog" id="rf">
    <div class="chips">${Object.entries(TYPES).map(([k, v]) => `<button type="button" data-t="${k}">${v.l}</button>`).join('')}</div>
    <p class="hint" id="rhint"></p>
    <label>产品（可输入名称、款号，或扫条码）<input id="rp" list="plist" autocomplete="off" value="${p ? esc(plabel(p)) : ''}"><datalist id="plist">${S.products.filter(x => x.active !== false).map(x => `<option value="${esc(plabel(x))}">`).join('')}</datalist></label>
    <label id="rcw">渠道<select id="rc"></select><input id="rcn" placeholder="新渠道的名字" hidden></label>
    <div class="row2"><label>数量<input id="rq" type="number" inputmode="numeric" step="1" value="1"></label><label>日期<input id="rd" type="date" value="${today()}"></label></div>
    <label>备注（可不填）<input id="rn"></label>
    <p class="msg" id="rmsg2"></p>
    <div class="acts"><button type="button" data-act="close">取消</button><button type="submit" class="primary" id="rs">保存</button></div></form>`;
  syncRecord();
  $('#dlg').showModal();
  (p ? $('#rq') : $('#rp')).focus(); if (p) $('#rq').select();
}
function syncRecord() {
  const T = TYPES[rec.type];
  document.querySelectorAll('#dlg .chips button').forEach(b => b.classList.toggle('on', b.dataset.t === rec.type));
  $('#rhint').textContent = T.hint;
  const need = T.need, sel = $('#rc'), prev = sel.value;
  let chs = [];
  if (need) chs = S.channels.filter(c => fits(c, need) && c.active !== false);
  else if (rec.type === 'ret') chs = S.channels.filter(c => fits(c, 'sale') && c.active !== false);
  $('#rcw').style.display = chs.length ? '' : 'none';
  sel.innerHTML = (need ? '' : '<option value="">不指定</option>') + chs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('') + (need ? '<option value="__new">＋ 新渠道…</option>' : '');
  $('#rcw').style.display = (chs.length || need) ? '' : 'none';
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
  $('#rcn').hidden = sel.value !== '__new';
  rec.armed = false; $('#rs').textContent = '保存'; $('#rmsg2').textContent = '';
}
function submitRecord() {
  const msg = $('#rmsg2'), q = Number($('#rq').value), T = TYPES[rec.type], date = $('#rd').value, typed = $('#rp').value.trim();
  let p = findProduct(typed), ch = $('#rc').value || null;
  if (!p && typed && !S.products.some(x => x.active !== false && match(x, typed))) {
    if (rec.newp !== typed) { rec.newp = typed; $('#rs').textContent = '新建并保存'; msg.textContent = `没有叫「${typed}」的产品。再点一次，会新建这个产品并保存。`; return; }
    p = addProduct(typed, '未分类'); rec.armed = true;
  }
  if (ch === '__new') { const c = addChannel($('#rcn').value, T.need); if (!c) { msg.textContent = '请填新渠道的名字。'; return; } ch = c.id; }
  if (!p) { const n = S.products.filter(x => x.active !== false && match(x, $('#rp').value.trim())).length; msg.textContent = n > 1 ? `有 ${n} 个产品符合（同一款号或条码的不同颜色），请从列表里选一个。` : '没有找到这个产品，请从列表里选一个。'; return; }
  if (!Number.isInteger(q) || q === 0 || (q < 0 && rec.type !== 'adj')) { msg.textContent = rec.type === 'adj' ? '数量要填整数，不能是 0。' : '数量要填大于 0 的整数。'; return; }
  if (T.need && !ch) { msg.textContent = '请先在「渠道」里添加一个' + CH_TYPES[T.need] + '渠道。'; return; }
  if (!date) { msg.textContent = '请填日期。'; return; }
  const r = compute()[p.id];
  let have = null;
  if (['sale', 'gift', 'c_out'].includes(rec.type)) have = r.wh; else if (['c_sold', 'c_back'].includes(rec.type)) have = r.ch[ch] || 0;
  if (have != null && q > have && !rec.armed) {
    rec.armed = true; $('#rs').textContent = '仍然保存';
    msg.textContent = `${['sale', 'gift', 'c_out'].includes(rec.type) ? '本仓' : C(ch).name}只有 ${have} 件，保存后会变成负数。确认无误请再点一次。`; return;
  }
  S.tx.push({ id: uid(), date, pid: p.id, type: rec.type, ch, qty: q, by: user, note: $('#rn').value.trim() });
  save(); $('#dlg').close(); render();
}

/* ---------- 渲染与事件 ---------- */
let view = 'stock';
function render(keepFocus) {
  const f = keepFocus && document.activeElement && document.activeElement.id, pos = f && document.activeElement.selectionStart;
  $('#nav').innerHTML = VIEWS.map(([k, l]) => `<a href="#${k}" class="${k === view ? 'on' : ''}">${l}</a>`).join('');
  $('#title').textContent = VIEWS.find(v => v[0] === view)[1];
  const w0 = $('#view .wrap'), sl = w0 ? w0.scrollLeft : 0, st = w0 ? w0.scrollTop : 0, sy = window.scrollY, same = $('#view').dataset.v === view;
  $('#view').dataset.v = view;
  $('#view').innerHTML = { stock: vStock, ledger: vLedger, settle: vSettle, products: vProducts, channels: vChannels, settings: vSettings }[view]();
  if (view === 'settle' && !ui.scal && C(ui.sch) && C(ui.sch).type === 'consign') { if (ui.simp) applyImport(); else settleSum(); }
  const w1 = $('#view .wrap'); if (same && w1) { w1.scrollLeft = sl; w1.scrollTop = st; window.scrollTo(0, sy); }
  if (f && $('#' + f)) { const el = $('#' + f); el.focus(); try { el.setSelectionRange(pos, pos); } catch (e) {} }
}
function route() { const h = location.hash.slice(1); view = VIEWS.some(v => v[0] === h) ? h : 'stock'; render(); window.scrollTo(0, 0); }
function download(name, text, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const armed = {}; let cellTimer = 0;
function twoStep(btn, key, label) { // 危险操作：第一次点变成确认，第二次才执行
  if (armed[key]) { delete armed[key]; return true; }
  for (const k in armed) delete armed[k];
  armed[key] = 1; btn.textContent = label; btn.classList.add('warn'); return false;
}

document.addEventListener('click', e => {
  if (ui.act && !e.target.closest('td.cell') && !e.target.closest('#dlg')) {
    clearTimeout(cellTimer); ui.act = null;
    if (!e.target.closest('[data-act]')) { render(); return; }
  }
  const chip = e.target.closest('#dlg .chips button'); if (chip) { rec.type = chip.dataset.t; syncRecord(); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, id = b.dataset.id;
  clearTimeout(cellTimer);
  if (a === 'cell') { ui.act = b.dataset.pid + '|' + b.dataset.col; render(); const i = $('#cellin'); if (i) { i.focus(); i.select(); } }
  else if (a === 'step') { const i = $('#cellin'); commitInput(); applyDelta(i.dataset.pid, i.dataset.col, Number(b.dataset.d)); render(); }
  else if (a === 'show') { ui.show = b.dataset.v; render(); }
  else if (a === 'cat') { ui.cat = b.dataset.v; render(); }
  else if (a === 'gen') { ui.gen = ui.gen === id ? null : id; ui.open[id] = true; render(); genPreview(); }
  else if (a === 'genok') { const code = genCode(); if (!code) { $('#ghint').textContent = '系列、品类、颜色、序号都要选。'; return; } const p = P(id), cat = (SKU_CAT.find(x => x[0] === $('#gcat').value) || [])[2]; p.sku = code; delete p.color; if (!p.cat && cat) p.cat = cat; ui.gen = null; save(); render(); }
  else if (a === 'hides') { const v = viewState(), k = b.dataset.k; v.hideSeries = v.hideSeries.includes(k) ? v.hideSeries.filter(x => x !== k) : v.hideSeries.concat(k); if (!v.hideSeries.length && ui.show === 'hidden' && !S.products.some(p => p.active === false) && !S.channels.some(c => c.active === false)) ui.show = 'all'; save(); render(); }
  else if (a === 'smove') { const k = b.dataset.k, d = Number(b.dataset.d), hs = new Set(viewState().hideSeries), order = [...new Set(S.products.filter(p => p.active !== false && !hs.has(p.series) && (!ui.cat || p.cat === ui.cat)).map(p => p.series))], i = order.indexOf(k), t = order[i + d]; if (t != null) { moveSeries(k, t, d > 0); render(); } }
  else if (a === 'gmove') { const vis = gridCols().filter(g => g.chs.length).map(g => g.t), i = vis.indexOf(id), t = vis[i + Number(b.dataset.d)]; if (t) { moveGroup(id, t, Number(b.dataset.d) > 0); render(); } }
  else if (a === 'hidep') { const p = P(id); p.active = p.active === false; save(); render(); }
  else if (a === 'hidec') { const c = C(id); c.active = c.active === false; save(); render(); }
  else if (a === 'chup' || a === 'chdown') {
    const c = C(id), same = S.channels.filter(x => x.type === c.type), i = same.indexOf(c), t = same[i + (a === 'chup' ? -1 : 1)];
    if (t) { moveChannel(id, t.id, a === 'chdown'); render(); }
  }
  else if (a === 'record') openRecord(id, b.dataset.type);
  else if (a === 'close') $('#dlg').close();
  else if (a === 'fold') { ui.closed[b.dataset.k] = !ui.closed[b.dataset.k]; render(); }
  else if (a === 'open') { ui.open[id] = !ui.open[id]; render(); }
  else if (a === 'more') { ui.lmax += 300; render(); }
  else if (a === 'del') { if (twoStep(b, 'del' + id, '确认删除')) { S.tx = S.tx.filter(t => t.id !== id); save(); render(); } }
  else if (a === 'delp') { if (twoStep(b, 'delp' + id, '确认删除')) { S.products = S.products.filter(p => p.id !== id); save(); render(); } }
  else if (a === 'delc') { if (twoStep(b, 'delc' + id, '确认删除')) { S.channels = S.channels.filter(c => c.id !== id); save(); render(); } }
  else if (a === 'addp') { ui.pq = ''; ui.pf = ''; S.products.unshift({ id: 'p' + uid(), series: '', cat: '', name: '', en: '', sku: '', barcode: '', cost: null, price: null, note: '', active: true }); save(); render(); $('#view td input').focus(); }
  else if (a === 'sch') { ui.sch = id; ui.simp = null; ui.scal = false; ui.scalAdd = []; render(); }
  else if (a === 'smode') { ui.smode = b.dataset.v; render(); }
  else if (a === 'sfile') $('#sfile').click();
  else if (a === 'sclear') { ui.simp = null; render(); }
  else if (a === 'scal') { ui.scal = !ui.scal; ui.scalAdd = []; ui.simp = null; render(); }
  else if (a === 'calsave') {
    const ch = ui.sch, sid = uid(), date = $('#sdate').value || today(), lines = [], msg = $('#smsg'); let bad = false;
    document.querySelectorAll('#view tr[data-pid]').forEach(tr => {
      const from = Number(tr.dataset.have), raw = tr.querySelector('.calin').value, to = Number(raw);
      if (raw === '' || !Number.isInteger(to) || to < 0) { bad = true; tr.querySelector('.calin').classList.add('bad'); return; }
      if (to !== from) lines.push({ pid: tr.dataset.pid, from, to });
    });
    if (bad) { msg.textContent = '标红的格子请填 0 或正整数。'; return; }
    if (!lines.length) { msg.textContent = '数量都没变，不需要保存。'; return; }
    let miss = false;
    for (const l of lines) { const tr = document.querySelector(`#view tr[data-pid="${l.pid}"]`), sel = tr.querySelector('.calsel'); l.how = sel ? sel.value : ''; if (!l.how || (CAL_HOW[l.how].dir < 0) !== (l.to < l.from)) { miss = true; if (sel) sel.classList.add('bad'); } }
    if (miss) { msg.textContent = '标红的差异请选一个去向。'; return; }
    for (const l of lines) { const d = Math.abs(l.to - l.from), h = CAL_HOW[l.how]; S.tx.push({ id: uid(), date, pid: l.pid, type: h.type, ch, qty: h.type === 'adj' ? l.to - l.from : d, by: user, note: '校准：' + h.l, sid }); }
    S.settles = S.settles || []; S.settles.push({ id: sid, ch, kind: 'calib', manual: true, month: date.slice(0, 7), date, by: user, src: $('#calwhy').value.trim() || '手动校准', lines });
    ui.scal = false; ui.scalAdd = []; ui.sopen[sid] = true; save(); render();
    if ($('#smsg')) $('#smsg').classList.add('ok'), $('#smsg').textContent = `已校准 ${lines.length} 款，记录在下面。`;
  }
  else if (a === 'tohist') { const h = $('#hist'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else if (a === 'dropsync') {
    const ch = ui.sch, d = dropCalc(ui.simp), m = compute(), sid = uid(), date = $('#sdate').value || today(), lines = [];
    for (const p of S.products) {
      const a = d.agg[p.id] || { out: 0, back: 0 }, so = m[p.id].cum[ch] || 0, sb = m[p.id].retc[ch] || 0;
      if (!a.out && !a.back && !so && !sb) continue;
      const dOut = a.out - so, dBack = a.back - sb;
      if (dOut) S.tx.push({ id: uid(), date, pid: p.id, type: 'sale', ch, qty: dOut, by: user, note: '按订单明细对齐', sid });
      if (dBack) S.tx.push({ id: uid(), date, pid: p.id, type: 'ret', ch, qty: dBack, by: user, note: '按订单明细对齐', sid });
      lines.push({ pid: p.id, out: a.out, back: a.back, dOut, dBack });
    }
    S.settles = S.settles || []; S.settles.push({ id: sid, ch, kind: 'orders', month: d.last, date, by: user, lines, src: ui.simp.src });
    ui.simp = null; ui.sopen[sid] = true; save(); render();
    if ($('#smsg')) $('#smsg').classList.add('ok'), $('#smsg').textContent = '已按明细更新，记录在下面。';
  }
  else if (a === 'sopen') { ui.sopen[id] = !ui.sopen[id]; render(); }
  else if (a === 'sparse') { const t = $('#spaste').value; setImport(t.split(/\r?\n/).map(l => l.split(/\t|,|，| {2,}/)), '粘贴的账单'); }
  else if (a === 'gfold') { const v = viewState(); v.fold[id] = !v.fold[id]; ui.act = null; save(); render(); }
  else if (a === 'fillsold') { document.querySelectorAll('#view tr[data-pid]').forEach(tr => { tr.querySelector('.sold').value = ui.smode === 'left' ? 0 : tr.dataset.have; }); settleSum(); }
  else if (a === 'unsettle') { if (twoStep(b, 'us' + id, '确认撤销')) { S.tx = S.tx.filter(t => t.sid !== id); S.settles = (S.settles || []).filter(x => x.id !== id); save(); render(); } }
  else if (a === 'settle') {
    const month = $('#smonth').value, ch = ui.sch, sid = uid(), add = [], lines = [], msg = $('#smsg'), date = $('#sdate').value || today(), calib = ui.smode === 'left'; let bad = false;
    document.querySelectorAll('#view tr[data-pid]').forEach(tr => {
      const n = soldOf(tr); if (Number.isNaN(n)) { bad = true; return; }
      const pv = tr.querySelector('.sp').value, price = pv === '' ? null : Number(pv);
      if (n) { add.push({ id: uid(), date, pid: tr.dataset.pid, type: 'c_sold', ch, qty: n, by: user, note: (month || date) + ' 对账', sid }); lines.push({ pid: tr.dataset.pid, qty: n, price }); }
    });
    if (bad) { msg.textContent = '标红的行数量超过了系统里的在店数量。先在库存页把这家店的数量改对，或者改这里的数。'; return; }
    if (!month) { msg.textContent = '请选结算月份。'; return; }
    if (!add.length) { msg.textContent = '还没有填任何数量，或者填的结果是没有卖出。'; return; }
    if ((S.settles || []).some(x => x.ch === ch && x.month === month) && !twoStep(b, 'dup' + ch + month, `${month} 已经对过一次，仍然保存`)) return;
    S.tx.push(...add); S.settles = S.settles || []; S.settles.push({ id: sid, ch, month, date, by: user, lines, calib, src: ui.simp && ui.simp.ch === ch ? ui.simp.src : '' });
    ui.simp = null; ui.sopen[sid] = true; save(); render();
    if ($('#smsg')) $('#smsg').classList.add('ok'), $('#smsg').textContent = `已保存 ${month} 账单：${lines.reduce((x, l) => x + l.qty, 0)} 件记为卖出。明细在下面。`;
  }
  else if (a === 'export') download(today() + '-forphor-erp-备份.json', JSON.stringify(S), 'application/json');
  else if (a === 'import') { if (!CLOUD || twoStep(b, 'import', '确认：用备份覆盖线上数据')) $('#file').click(); }
  else if (a === 'cconnect') {
    const cfg = { owner: $('#cowner').value.trim(), repo: $('#crepo').value.trim(), token: $('#ctoken').value.trim() };
    if (!cfg.owner || !cfg.repo || !cfg.token) { Cloud.err = '三项都要填'; render(); return; }
    const changedRepo = cfg.owner !== Cloud.cfg.owner || cfg.repo !== Cloud.cfg.repo;
    Cloud.cfg = cfg; try { localStorage.setItem(CKEY, JSON.stringify(cfg)); } catch (x) {}
    if (changedRepo) { Cloud.sha = null; Cloud.base = null; Cloud.loaded = false; Cloud.dirty = false; S = EMPTY(); }
    Cloud.err = ''; syncStatus(); render(); cloudPull(true);
  }
  else if (a === 'csync') { cloudPull(true); }
  else if (a === 'cforget') { if (twoStep(b, 'cforget', '确认退出（GitHub 上的数据不受影响）')) { try { localStorage.removeItem(CKEY); localStorage.removeItem(CACHE); } catch (x) {} Cloud.cfg = {}; Cloud.sha = null; Cloud.base = null; Cloud.loaded = false; Cloud.dirty = false; S = EMPTY(); syncStatus(); render(); } }
  else if (a === 'cseed') $('#seedfile').click();
  else if (a === 'csv') {
    const m = compute(), q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [['系列', '名称', '款号', '条码', '成本', '售价', '本仓', '寄售在外', '合计', '累计进货', '累计售出'].join(',')];
    for (const p of S.products) { const r = m[p.id]; lines.push([q(p.series), q(p.name), q(p.sku), q(p.barcode), p.cost ?? '', p.price ?? '', r.wh, r.out, r.wh + r.out, r.in, r.sold].join(',')); }
    download(today() + '-forphor-库存.csv', '﻿' + lines.join('\n'), 'text/csv');
  }
  else if (a === 'reset') { if (twoStep(b, 'reset', '确认恢复，丢弃所有修改')) { S = JSON.parse(JSON.stringify(window.FORPHOR_SEED)); save(); render(); } }
});
document.addEventListener('submit', e => { if (e.target.id === 'rf') { e.preventDefault(); submitRecord(); } });
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { ui.q = t.value; render(true); }
  else if (t.id === 'lq') { ui.lq = t.value; render(true); }
  else if (t.id === 'pq') { ui.pq = t.value; render(true); }
  else if (t.classList.contains('calin')) { const tr = t.closest('tr'), d = Number(t.value) - Number(tr.dataset.have); tr.querySelector('.caldiff').textContent = t.value === '' || !d ? '' : (d > 0 ? '+' : '') + d; t.classList.remove('bad');
    const old = tr.querySelector('.calsel'), keep = old && old.value && CAL_HOW[old.value] && Math.sign(d) === CAL_HOW[old.value].dir ? old.value : '';
    tr.querySelector('.calhow').innerHTML = calSelect(t.value === '' ? 0 : d); if (keep) tr.querySelector('.calsel').value = keep; }
  else if (t.classList.contains('calsel')) t.classList.remove('bad');
  else if (t.classList.contains('leftin')) {   // 直接改「对账后还在店」，卖出数跟着算
    const tr = t.closest('tr'), have = Number(tr.dataset.have), v = parseInt(t.value, 10), ok = !isNaN(v) && v >= 0 && v <= have;
    t.classList.toggle('bad', !ok && t.value !== ''); if (ok) tr.querySelector('.sold').value = have - v || ''; settleSum();
  }
  else if (t.classList.contains('sold') || t.classList.contains('sp')) settleSum();
  else if (t.closest('#dlg') && rec && rec.armed) { rec.armed = false; $('#rs').textContent = '保存'; $('#rmsg2').textContent = ''; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (['gser', 'gcat', 'gcol', 'gnum'].includes(t.id)) { if (t.id !== 'gnum') $('#gnum').value = t.id === 'gcol' && $('#gnum').value ? $('#gnum').value : ''; genPreview(); return; }
  if (t.id === 'caladd') { const p = findProduct(t.value); if (p) { const keep = {}; document.querySelectorAll('#view tr[data-pid]').forEach(tr => { keep[tr.dataset.pid] = [tr.querySelector('.calin').value, (tr.querySelector('.calsel') || {}).value]; }); ui.scalAdd.push(p.id); render(); for (const [k, [v, h]] of Object.entries(keep)) { const i = $(`#view tr[data-pid="${k}"] .calin`); if (i) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); const se = $(`#view tr[data-pid="${k}"] .calsel`); if (se && h && [...se.options].some(o => o.value === h)) se.value = h; } } } }
  else if (t.id === 'smi') { ui.simp.mi = Number(t.value); render(); }
  else if (t.id === 'sfile') {
    const f = t.files[0]; if (!f) return;
    f.arrayBuffer().then(buf => { const wb = XLSX.read(buf, { type: 'array' }); setImport(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }), f.name); })
      .catch(() => { if ($('#smsg')) $('#smsg').textContent = '这个文件读不出来，请换成 .xlsx，或者用复制粘贴。'; });
  }
  else if (t.classList.contains('sp')) { const tr = t.closest('tr'); setPrice(ui.sch, tr.dataset.pid, t.value === '' ? null : Number(t.value)); }
  else if (t.dataset.alias) { const p = findProduct(t.value); if (p) { S.alias = S.alias || {}; S.alias[t.dataset.alias] = [p.id]; save(); render(); } }
  else if (t.dataset.cp) { setPrice(t.dataset.cp, t.dataset.pid, t.value); render(); }
  else if (t.id === 'rc') { $('#rcn').hidden = t.value !== '__new'; if (!$('#rcn').hidden) $('#rcn').focus(); }
  else if (t.id === 'cellin') { commitInput(); clearTimeout(cellTimer); cellTimer = setTimeout(() => render(), 250); }
  else if (t.id === 'user') { user = t.value; try { localStorage.setItem(UKEY, user); } catch (x) {} }
  else if (t.id === 'lt') { ui.lt = t.value; render(); }
  else if (t.id === 'lc') { ui.lc = t.value; render(); }
  else if (t.id === 'lh') { ui.lh = t.checked; render(); }
  else if (t.id === 'pf') { ui.pf = t.value; render(); }
  else if (t.id === 'seedfile') {
    const f = t.files[0]; if (!f) return;
    f.text().then(x => { const d = JSON.parse(x); if (!d.products || !d.channels || !d.tx) throw 0; return d; })
      .then(d => { S = d; viewState(); Cloud.sha = null; Cloud.base = null; Cloud.missing = false; Cloud.loaded = true; Cloud.dirty = true; Cloud.rev++; render(); return cloudPush(); })
      .then(() => { if (!Cloud.err) { toast('初始数据已上传'); location.hash = '#stock'; } })
      .catch(() => { $('#seedmsg').textContent = '这个文件不是 ERP 的数据文件'; });
  }
  else if (t.id === 'file') {
    const f = t.files[0]; if (!f) return;
    f.text().then(x => { const d = JSON.parse(x); if (!d.products || !d.channels || !d.tx) throw 0; S = d; save(); render(); }).catch(() => { $('#saved').textContent = '导入失败：不是备份文件'; });
  }
  else if (t.dataset.pid) {
    const p = P(t.dataset.pid), k = t.dataset.f;
    if (k === 'active') p.active = t.checked;
    else if (k === 'cost' || k === 'price') { const v = t.value === '' ? null : Number(t.value); p[k] = v != null && (isNaN(v) || v < 0) ? null : v; if (p[k] == null) t.value = ''; }
    else p[k] = t.value.trim();
    if (view === 'stock' && ['name', 'series', 'color', 'cat', 'sku'].includes(k)) { save(); render(); return; }
    save();
  }
  else if (t.dataset.cid) {
    const c = C(t.dataset.cid), k = t.dataset.f;
    if (k === 'rate') { const v = Number(t.value); c.rate = isNaN(v) || t.value === '' ? null : Math.min(100, Math.max(0, v)) / 100; save(); }
    else if (k === 'name') { c.name = t.value.trim() || c.name; t.value = c.name; save(); } else if (k === 'type') { retypeChannel(c, t.value); render(); }
  }
});
document.addEventListener('keydown', e => {
  const add = e.target.dataset && e.target.dataset.add;
  if (add && e.key === 'Enter') {
    e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
    if (add === 'channel') { addChannel(v, $('#newch').value); ui.show = 'all'; render(); if (view !== 'stock') return; const w = $('#view .wrap'); const th = [...document.querySelectorAll('#view th.r2')].find(x => x.firstChild.textContent === v); if (th && w) w.scrollLeft = th.offsetLeft - 260; }
    else { const p = add === 'series' ? addProduct('新产品', v) : addProduct(v, e.target.dataset.series); ui.open[p.id] = add === 'series'; render(); if (add === 'series') { const i = $(`#view input[data-pid="${p.id}"][data-f="name"]`); i.focus(); i.select(); } else { const i = $(`#view input[data-add="product"][data-series="${CSS.escape(p.series)}"]`); if (i) i.focus(); } }
    return;
  }
  if (!ui.act) return;
  if (e.key === 'Enter' && e.target.id === 'cellin') { e.preventDefault(); commitInput(); ui.act = null; render(); }
  else if (e.key === 'Escape') { ui.act = null; render(); }
});
function genCode() { const a = $('#gser'), n = $('#gnum'); if (!a) return ''; const num = parseInt(n.value, 10); return a.value && $('#gcat').value && $('#gcol').value && num >= 1 && num <= 99 ? 'FF' + a.value + $('#gcat').value + $('#gcol').value + String(num).padStart(2, '0') : ''; }
function genPreview() {
  if (!$('#gser')) return;
  const ser = $('#gser').value, cat = $('#gcat').value, col = $('#gcol').value, n = $('#gnum');
  if (ser && cat && col && !n.value) {   // 序号：同系列同品类里，同名设计沿用已有序号，否则取下一个没用过的
    const used = S.products.map(p => skuParts(p.sku)).filter(k => k && k.ser === ser && k.cat === cat).map(k => Number(k.num));
    n.value = used.length ? Math.max(...used) + 1 : 1;
  }
  const code = genCode(), hex = (SKU_COL.find(x => x[0] === col) || [])[2] || '';
  $('#gout').textContent = code || 'FF' + (ser || '··') + (cat || '··') + (col || '··') + '··';
  $('#gsw').style.cssText = hex ? `background:${hex}` : 'display:none';
  const dup = code && S.products.filter(p => p.sku === code && p.id !== $('.gen').dataset.pid).map(p => pname(p));
  $('#ghint').textContent = dup && dup.length ? '已经有产品用了这个款号：' + dup.slice(0, 3).join('、') : '这一行的底色会跟着颜色码变';
}
/* 拖动排序（渠道） */
let drag = null;
const clearDrop = () => document.querySelectorAll('.dropa,.dropb').forEach(x => x.classList.remove('dropa', 'dropb'));
const isG = x => String(x).startsWith('g:');
const dkind = x => /^[gsp]:/.test(String(x)) ? String(x)[0] : 'c';
function moveSeries(a, b, after) {   // 把整个品类挪到另一个品类的前面 / 后面
  const mine = S.products.filter(p => p.series === a), rest = S.products.filter(p => p.series !== a);
  if (!mine.length || !rest.some(p => p.series === b)) return;
  const i = after ? rest.map(p => p.series).lastIndexOf(b) + 1 : rest.findIndex(p => p.series === b);
  rest.splice(i, 0, ...mine); S.products = rest; save();
}
function moveProduct(a, b, after) {
  const x = P(a), rest = S.products.filter(p => p.id !== a), i = rest.findIndex(p => p.id === b);
  if (!x || i < 0) return; rest.splice(i + (after ? 1 : 0), 0, x); S.products = rest; save();
}
const dropInfo = e => {
  const t = e.target.closest && e.target.closest('[data-drop]');
  if (!t || !drag || t.dataset.drop === drag || dkind(drag) !== dkind(t.dataset.drop)) return null;
  if (dkind(drag) === 'c' && (!C(drag) || C(t.dataset.drop).type !== C(drag).type)) return null;
  if (dkind(drag) === 'p' && (P(drag.slice(2)) || {}).series !== (P(t.dataset.drop.slice(2)) || {}).series) return null;
  const r = t.getBoundingClientRect(), after = t.dataset.dir === 'v' ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
  return { t, after };
};
document.addEventListener('dragstart', e => { const t = e.target.closest && e.target.closest('[data-drag]'); if (!t) return; drag = t.dataset.drag; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag); });
document.addEventListener('dragover', e => { const d = dropInfo(e); clearDrop(); if (!d) return; e.preventDefault(); d.t.classList.add(d.after ? 'dropb' : 'dropa'); });
document.addEventListener('drop', e => { const d = dropInfo(e); if (!d) return; e.preventDefault(); const k = dkind(drag), to = d.t.dataset.drop; if (k === 's') moveSeries(drag.slice(2), to.slice(2), d.after); else if (k === 'p') moveProduct(drag.slice(2), to.slice(2), d.after); else if (isG(drag)) moveGroup(drag.slice(2), d.t.dataset.drop.slice(2), d.after); else moveChannel(drag, d.t.dataset.drop, d.after); drag = null; render(); });
document.addEventListener('dragend', () => { drag = null; clearDrop(); });
window.addEventListener('hashchange', route);
$('#user').innerHTML = USERS.map(u => `<option ${u === user ? 'selected' : ''}>${u}</option>`).join('');
if (CLOUD) {
  try { const c = JSON.parse(localStorage.getItem(CACHE)); if (c && c.repo === Cloud.cfg.owner + '/' + Cloud.cfg.repo && c.sha) { Cloud.sha = c.sha; Cloud.base = c.base; Cloud.dirty = !!c.dirty; Cloud.loaded = true; } else if (c) S = EMPTY(); } catch (e) {}
  document.title = 'FORPHOR 库存';
  syncStatus();
  if (!Cloud.ready() && !location.hash) location.hash = '#settings';
  setInterval(() => { if (document.visibilityState === 'visible') cloudPull(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudPull(); });
  window.addEventListener('focus', () => cloudPull());
  document.addEventListener('focusout', () => setTimeout(() => { if (Cloud.pending && !editing()) { Cloud.pending = false; render(true); } }, 300));
  window.addEventListener('beforeunload', e => { if (Cloud.dirty || Cloud.busy) { e.preventDefault(); e.returnValue = ''; } });
} else $('#saved').textContent = '数据存在本机浏览器';
if ((S.version || 0) < 6) { for (const id of ['wallpaper', 'editor']) { const w = C(id); if (w && w.type === 'consign') retypeChannel(w, 'drop'); } S.version = 6; save(); }
viewState();
/* 补录的记录：data/patch-*.js 里的内容，每份只应用一次 */
(function applyPatches() {
  S.patches = S.patches || []; S.settles = S.settles || [];
  for (const pt of (window.FORPHOR_PATCHES || [])) {
    if (S.patches.includes(pt.id)) continue;
    const BY = 'Claude 补录';
    for (const [id, ty] of Object.entries(pt.retype || {})) if (C(id)) retypeChannel(C(id), ty);
    for (const [id, r] of Object.entries(pt.rates || {})) if (C(id)) C(id).rate = r;
    for (const [pid, v] of Object.entries(pt.retail || {})) if (P(pid) && P(pid).price == null) P(pid).price = v;
    for (const [ch, o] of Object.entries(pt.cprice || {})) { S.cprice = S.cprice || {}; S.cprice[ch] = Object.assign({}, o, S.cprice[ch] || {}); }
    S.alias = Object.assign({}, pt.alias || {}, S.alias || {});
    for (const [ch, o] of Object.entries(pt.crate || {})) { S.crate = S.crate || {}; S.crate[ch] = Object.assign({}, o, S.crate[ch] || {}); }
    if (pt.viewOrder) viewState().order = pt.viewOrder.slice();
    for (const mm of pt.memos || []) for (const x of S.settles) if (x.ch === mm.ch && x.month === mm.month && !x.kind) x.memo = mm.memo;
    for (const d of pt.txdel || []) { const i = S.tx.findIndex(t => t.pid === d.pid && t.type === d.type && (t.ch || null) === (d.ch || null) && t.qty === d.qty); if (i >= 0) S.tx.splice(i, 1); }
    for (const a of pt.txadd || []) if (P(a.pid)) S.tx.push(Object.assign({ id: uid(), by: BY }, a));
    for (const f of pt.linepid || []) for (const x of S.settles) if (x.ch === f.ch) for (const l of x.lines) if (!l.pid && l.name === f.name && P(f.pid)) l.pid = f.pid;
    for (const np of pt.addProducts || []) if (!P(np.id)) S.products.push(Object.assign({ en: '', cost: null, note: '', active: true }, np));
    const stSum = x => { const q = {}; for (const l of x.lines) { const k = l.pid || l.name; q[k] = (q[k] || 0) + (l.qty || 0); } return [Object.keys(q).filter(k => q[k]).sort().map(k => k + ':' + q[k]).join(','), 0]; };   // 只比每款的数量
    const official = pt.enforce ? (window.FORPHOR_PATCHES || []).flatMap(q => q.settles || []) : [];
    for (const st of official) {   // 以账单为准：同一家店同一个月，如果已有的登记和账单对不上，换成账单的
      const ex = S.settles.find(x => x.ch === st.ch && x.month === st.month && !x.kind); if (!ex) continue;
      const a = stSum(ex), b = stSum({ lines: st.lines.filter(l => P(l.pid) || l.name) });
      if (a[0] === b[0] && a[1] === b[1]) continue;
      S.tx = S.tx.filter(t => t.sid !== ex.id); S.settles = S.settles.filter(x => x !== ex);
    }
    const run = (q, only, extra) => {
    for (const st of (q.settles || []).concat(extra || [])) {
      if (only && !only.has(st.ch)) continue;
      if (!C(st.ch) || S.settles.some(x => x.ch === st.ch && x.month === st.month && !x.kind)) continue;
      const sid = uid(), lines = st.lines.filter(l => P(l.pid) || l.name), backs = (st.backs || []).filter(l => P(l.pid));
      const rec = { id: sid, ch: st.ch, month: st.month, date: st.date, by: st.by, src: st.src, lines };
      if (st.memo) rec.memo = st.memo; if (backs.length) rec.backs = backs;
      S.settles.push(rec);
      for (const l of lines) if (l.pid && l.qty) S.tx.push({ id: uid(), date: st.txdate, pid: l.pid, type: 'c_sold', ch: st.ch, qty: l.qty, by: st.by, note: st.month + ' 结算（补录）', sid });
      for (const l of backs) S.tx.push({ id: uid(), date: st.txdate, pid: l.pid, type: 'adj', ch: st.ch, qty: -l.qty, by: st.by, note: st.month + ' ' + (l.note || '品牌召回'), sid });
    }
    for (const b of q.back || []) { if (only && !only.has(b.ch)) continue; const r = compute()[b.pid], cur = r ? (r.ch[b.ch] || 0) : 0; if (cur > 0) S.tx.push({ id: uid(), date: b.date, pid: b.pid, type: 'c_back', ch: b.ch, qty: cur, by: BY, note: b.note }); }
    for (const [ch, t] of Object.entries(q.targets || {})) {
      if (!C(ch) || (only && !only.has(ch))) continue;
      const m = compute(), sid = uid(), lines = [];
      for (const [pid, to] of Object.entries(t.stock)) { if (!m[pid]) continue; const from = m[pid].ch[ch] || 0; if (from !== to) { S.tx.push({ id: uid(), date: today(), pid, type: 'adj', ch, qty: to - from, by: BY, note: '按账单校准在店数量', sid }); lines.push({ pid, from, to }); } }
      if (lines.length) S.settles.push({ id: sid, ch, kind: 'calib', month: t.asof, date: today(), by: BY, src: t.src, lines });
    }
    };
    if (pt.rebuild) {   // 以「在线表 + 账单」为准，把这几家寄售店从头重算一遍：清掉浏览器里所有旧的登记 / 校准，再按顺序重放
      const RB = new Set(pt.rebuild.filter(C)), seed = (window.FORPHOR_SEED || {}).tx || [];
      S.tx = S.tx.filter(t => !RB.has(t.ch)); S.settles = S.settles.filter(x => !RB.has(x.ch));
      for (const t of seed) if (RB.has(t.ch) && P(t.pid)) S.tx.push(Object.assign({}, t, { id: uid() }));
      for (const q of window.FORPHOR_PATCHES) {
        if (q === pt) break;
        for (const d of q.txdel || []) if (RB.has(d.ch)) { const i = S.tx.findIndex(t => t.pid === d.pid && t.type === d.type && t.ch === d.ch && t.qty === d.qty); if (i >= 0) S.tx.splice(i, 1); }
        for (const a of q.txadd || []) if (RB.has(a.ch) && P(a.pid)) S.tx.push(Object.assign({ id: uid(), by: BY }, a));
        run(q, RB);
        for (const ch of q.fillPrices || []) for (const x of S.settles) if (x.ch === ch && !x.kind && C(ch)) for (const l of x.lines) { const p = P(l.pid); if (l.price == null && p && p.price != null) { l.price = Math.round(p.price * rateOf(C(ch)) * 100) / 100; } }
    for (const mm of q.memos || []) for (const x of S.settles) if (x.ch === mm.ch && x.month === mm.month && !x.kind) { x.memo = mm.memo; if (mm.src) x.src = mm.src; }
        for (const ch of q.zeroNeg || []) { if (!RB.has(ch)) continue; const m = compute(); for (const p of S.products) { const v = m[p.id].ch[ch] || 0; if (v < 0) S.tx.push({ id: uid(), date: today(), pid: p.id, type: 'adj', ch, qty: -v, by: BY, note: '以账单卖出为准，补齐没登记的发货' }); } }
      }
    }
    run(pt, null, official);
    for (const bl of pt.bills || []) {   // 代发店的对账单：只留记录（卖出数量、金额），不改库存
      if (!C(bl.ch) || S.settles.some(x => x.ch === bl.ch && x.kind === 'bill' && x.month === bl.month)) continue;
      S.settles.push({ id: uid(), ch: bl.ch, kind: 'bill', month: bl.month, period: bl.period, date: bl.date, by: bl.by || BY, src: bl.src, lines: bl.lines, total: bl.total, settle: bl.settle, memo: bl.memo });
    }
    for (const od of pt.orders || []) {   // 代发店：发出 / 退回按订单明细对齐；本仓是你们原来记的结存，保持不变
      if (!C(od.ch) || S.settles.some(x => x.ch === od.ch && x.kind === 'orders')) continue;
      const m = compute(), sid = uid(), lines = [], date = today();
      for (const l of od.lines) {
        if (!m[l.pid]) continue;
        const dOut = l.out - (m[l.pid].cum[od.ch] || 0), dBack = l.back - (m[l.pid].retc[od.ch] || 0);
        if (dOut) S.tx.push({ id: uid(), date, pid: l.pid, type: 'sale', ch: od.ch, qty: dOut, by: BY, note: '按订单明细对齐', sid });
        if (dBack) S.tx.push({ id: uid(), date, pid: l.pid, type: 'ret', ch: od.ch, qty: dBack, by: BY, note: '按订单明细对齐', sid });
        if (od.keepWh && dOut - dBack) S.tx.push({ id: uid(), date, pid: l.pid, type: 'adj', ch: null, qty: dOut - dBack, by: BY, note: '按订单明细对齐时保持本仓原数', sid });
        lines.push({ pid: l.pid, out: l.out, back: l.back, dOut, dBack });
      }
      S.settles.push({ id: sid, ch: od.ch, kind: 'orders', month: od.month, date, by: BY, lines, src: od.src, keepWh: !!od.keepWh });
    }
    for (const ch of pt.fillPrices || []) for (const x of S.settles) if (x.ch === ch && !x.kind && C(ch)) for (const l of x.lines) { const p = P(l.pid); if (l.price == null && p && p.price != null) { l.price = Math.round(p.price * rateOf(C(ch)) * 100) / 100; x.priceNote = '单价按零售价 × 结算比例推算'; } }
    for (const mm of pt.memos || []) for (const x of S.settles) if (x.ch === mm.ch && x.month === mm.month && !x.kind) { x.memo = mm.memo; if (mm.src) x.src = mm.src; }
    if (pt.cats) for (const p of S.products) if (pt.cats[p.cat]) p.cat = pt.cats[p.cat];
    for (const [kw, c] of Object.entries(pt.catByName || {})) for (const p of S.products) if (p.name.includes(kw)) p.cat = c;
    if (pt.freezeColors) for (const p of S.products) { const g = guessColor(p.name), c = codeColor(p.sku); if (!p.color && g && c && g !== c) p.color = g; }   // 已有产品保持原来的底色
    { const q = pt, only = null; for (const ch of q.zeroNeg || []) { if (only && !only.has(ch)) continue; const m = compute(); for (const p of S.products) { const v = m[p.id].ch[ch] || 0; if (v < 0) S.tx.push({ id: uid(), date: today(), pid: p.id, type: 'adj', ch, qty: -v, by: BY, note: '以账单卖出为准，补齐没登记的发货' }); } } }
    if (pt.undoAutoAdj) {   // 寄售店的在店数量只按「发出 − 结算卖出 − 退回」算；Claude 自动加的校准、补齐、召回扣减全部撤掉
      const cons = new Set(S.channels.filter(c => c.type === 'consign').map(c => c.id));
      S.tx = S.tx.filter(t => !(t.type === 'adj' && cons.has(t.ch) && t.by === BY));
      S.settles = S.settles.filter(x => !(x.kind === 'calib' && cons.has(x.ch) && x.by === BY));
    }
    S.patches.push(pt.id); save();
  }
})();
route();
if (CLOUD) cloudPull(true);
window.__erp = { compute, state: () => S, save, render, merge3, cloud: () => Cloud, cloudPull, cloudPush };
})();
