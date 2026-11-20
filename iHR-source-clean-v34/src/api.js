import * as SecureStore from 'expo-secure-store';
import * as Application from 'expo-application';
export const BASE_URL = 'https://ihr.mtib.gov.my/';
export const EP = {
register:  { path: 'api/user_registration', method: 'POST', code: 'R', retry: true },
dashboard: { path: 'api/dashboard',         method: 'GET',  code: 'D', flip: true, retry: false, timeout: 12000 },
geotag:    { path: 'api/geotagging',        method: 'POST', code: 'G', retry: true, jsonFirst: true },
qr:        { path: 'api/qr_scanner',        method: 'POST', code: 'Q', retry: true },
fr:        { path: 'api/device_data',       method: 'POST', code: 'F', retry: true, jsonFirst: true },
fr2:       { path: 'api/device_datas',      method: 'POST', code: 'F', retry: true, jsonFirst: true },
fr3:       { path: 'api/biometric',         method: 'POST', code: 'F', retry: true, jsonFirst: true },
fr4:       { path: 'api/fr_scanner',        method: 'POST', code: 'F', retry: true, jsonFirst: true },
fr5:       { path: 'api/face_recognition',  method: 'POST', code: 'F', retry: true, jsonFirst: true },
fr6:       { path: 'api/face',              method: 'POST', code: 'F', retry: true, jsonFirst: true },
frAlt:     { path: 'api/fr',                method: 'POST', code: 'F', retry: true, jsonFirst: true },
frEnroll:  { path: 'api/face_registration', method: 'POST', code: 'F', retry: true, jsonFirst: true },
frEnrollAlt:{ path: 'api/save_face',        method: 'POST', code: 'F', retry: true, jsonFirst: true },
mia:       { path: 'api/mia_report',        method: 'POST', code: 'M', retry: true },
reason:    { path: 'api/reason',            method: 'POST', code: 'P', flip: true, retry: true },
reference: { path: 'api/reference',         method: 'GET',  code: 'P', flip: true, retry: true },
tabletRef: { path: 'api/tablet_reference',  method: 'GET',  code: 'T', flip: true, retry: true },
};
let override = null;
const realId = () => Application.getAndroidId() || 'unknown';
export const deviceId = () => override || realId();
export async function saveDeviceId(v) {
  const t = (v || '').trim();
  if (!t || t === realId()) { override = null; await SecureStore.deleteItemAsync('DEVICE_ID'); }
  else { override = t; await SecureStore.setItemAsync('DEVICE_ID', t); }
}
async function once(ep, body, kind, signal) {
  const get = ep.method === 'GET';
  const headers = { Accept: 'application/json', imei: String(deviceId()) };
  const clean = Object.entries(body).filter(([, v]) => v !== undefined && v !== null);
  let payload, qs = '';
  if (get) qs = clean.length ? '?' + clean.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
  else if (kind === 'form') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = clean.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  } else if (kind === 'multipart') {
    payload = new FormData();
    clean.forEach(([k, v]) => payload.append(k, String(v)));
  } else {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(Object.fromEntries(clean));
  }
  const res = await fetch(BASE_URL + ep.path + qs, { method: ep.method, headers, body: payload, signal });
  return { status: res.status, ok: res.ok, text: await res.text() };
}
export async function call(ep, body = {}) {
  const kinds = ep.method === 'GET' || !ep.retry ? ['json'] : ep.jsonFirst ? ['json', 'form', 'multipart'] : ['form', 'multipart', 'json'];
  let last = { status: 0, text: '' };
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind === 'multipart' && Object.keys(body).length === 0) break;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ep.timeout || 25000);
    try {
      const r = await once(ep, body, kind, ctl.signal);
      if (r.ok) { try { return JSON.parse(r.text); } catch { return { raw: r.text }; } }
      if (r.status === 405 && ep.flip) {
        try {
          const g = await once({ ...ep, method: ep.method === 'GET' ? 'POST' : 'GET' }, body, 'json', ctl.signal);
          if (g.ok) { try { return JSON.parse(g.text); } catch { return { raw: g.text }; } }
        } catch (_) { }
      }
      last = r;
      if (![400, 405, 415, 422, 500].includes(r.status)) break;
    } catch (e) {
      if (i > 0 && last.status) break;
      if (e.name === 'AbortError') throw new Error(`[${ep.code}001] Sambungan ke pelayan tamat masa`);
      throw new Error(`[${ep.code}003] Tiada sambungan ke pelayan (${e.message})`);
    } finally { clearTimeout(t); }
  }
  if (last.status === 413) throw new Error(`[${ep.code}413] Ralat Pelayan. Sila cuba sekali lagi`);
  let msg = null; try { const j = JSON.parse(last.text); if (typeof j === 'string') msg = j; else if (j && typeof j.message === 'string' && last.status !== 500) msg = j.message; } catch (_) {}
  if (msg) throw new Error(`${msg}`);
  const snip = String(last.text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
  throw new Error(`[${ep.code}00${last.status === 404 ? 1 : 2}] Ralat. Sila hubungi Bahagian Sumber Manusia untuk bantuan\nHTTP ${last.status}: ${snip}`);
}
const K = { no: 'STAFF_NO', id: 'STAFF_ID', name: 'STAFF_NAME' };
export async function loadSession() {
  const dev = await SecureStore.getItemAsync('DEVICE_ID'); if (dev) override = dev;
  const [staff_no, staff_id, name] = await Promise.all(Object.values(K).map((k) => SecureStore.getItemAsync(k)));
  return staff_no ? { staff_no, staff_id, name } : null;
}
export async function saveSession(s) {
  await SecureStore.setItemAsync(K.no, String(s.staff_no));
  await SecureStore.setItemAsync(K.id, String(s.staff_id ?? ''));
  await SecureStore.setItemAsync(K.name, String(s.name ?? ''));
}
export const clearSession = () => Promise.all(Object.values(K).map((k) => SecureStore.deleteItemAsync(k)));
const q2 = (n) => String(n).padStart(2, '0');
const dayKey = () => { const d = new Date(); return `TAGS_${d.getFullYear()}-${q2(d.getMonth() + 1)}-${q2(d.getDate())}`; };
export async function addLocalTag(method = 'geo') {
try { 
  const k = dayKey(); 
  const cur = JSON.parse((await SecureStore.getItemAsync(k)) || '[]'); 
  cur.push({ t: Date.now(), m: method }); 
  await SecureStore.setItemAsync(k, JSON.stringify(cur.slice(-20))); 
} catch (_) { }
}
export async function getLocalTags() {
  try { 
    const raw = JSON.parse((await SecureStore.getItemAsync(dayKey())) || '[]'); 
    return raw.map(x => typeof x === 'number' ? { t: x, m: 'geo' } : x);
  } catch (_) { return []; }
}
export function rows(obj, prefix = '', out = []) {
  if (obj == null || out.length > 30) return out;
  if (typeof obj !== 'object') { out.push([prefix, String(obj)]); return out; }
  Object.entries(obj).forEach(([k, v]) => {
    const key = prefix ? `${prefix} · ${k}` : k;
    if (v && typeof v === 'object') rows(v, key, out);
    else if (v !== '' && String(v).length < 120) out.push([key.replace(/_/g, ' '), String(v)]);
  });
  return out;
}
export const unwrap = (r) => (r && (r.data ?? r.staff_data ?? r.result)) ?? r;
const PHOTO_KEY = /(face|wajah|photo|image|img|picture|pic|avatar|gambar|foto|profile)/i;
const NOT_PHOTO = /(color|colour|type|count|msg|status|path_id)/i;
function toUri(v) {
  const s = String(v).trim();
  if (/^data:image\//i.test(s)) return s;
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\/ihr\.mtib\.gov\.my/i, 'https://ihr.mtib.gov.my');
  if (/^[A-Za-z0-9+/=\s]{200,}$/.test(s)) return 'data:image/jpeg;base64,' + s.replace(/\s+/g, '');
  if (s.length < 300 && !/\s/.test(s) && /[\/.]/.test(s)) return BASE_URL + s.replace(/^\/+/, '');
  return null;
}
export function findPhoto(r) {
  const seen = new Set();
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 3 || seen.has(o)) return null;
    seen.add(o);
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && v.length > 3 && PHOTO_KEY.test(k) && !NOT_PHOTO.test(k)) { const u = toUri(v); if (u) return u; }
    }
    for (const v of Object.values(o)) { if (v && typeof v === 'object') { const u = walk(v, d + 1); if (u) return u; } }
    return null;
  };
  return walk(r, 0);
}
export const KERJA_LUAR_TYPES = ['Mesyuarat', 'Kursus', 'Bengkel', 'Lawatan Tapak', 'Pameran', 'Lain-lain'];
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z]/g, '');
export function matchReasons(r) {
  const arr = Array.isArray(r) ? r : [r?.data, r?.reasons, r?.reason, r?.result].find(Array.isArray);
  if (!arr) return null;
  const items = arr.map((x) => (typeof x === 'string' ? { label: x } : { id: x?.id ?? x?.value ?? x?.code, label: x?.name ?? x?.label ?? x?.reason ?? x?.description ?? x?.title }));
  const out = KERJA_LUAR_TYPES.map((label) => ({ label, id: items.find((i) => norm(i.label) === norm(label))?.id }));
  return out.filter((o) => o.id !== undefined).length >= 3 ? out : null;
}
export const kerjaLuarFields = (opt, reason) => ({ outstation_type: opt?.id, reason });
const toOpt = (x, k) => (x && typeof x === 'object'
  ? { id: x.key ?? x.id ?? x.value ?? x.code, label: String(x.value ?? x.name ?? x.label ?? x.description ?? x.key ?? x.id ?? '') }
  : (k !== undefined ? { id: k, label: String(x) } : { id: x, label: String(x) }));
const toList = (v) => {
  if (Array.isArray(v)) return v.map((x) => toOpt(x));
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => toOpt(x, k));
  return [];
};
export function parseReference(r) {
  const seen = new Set(); let out = null, working = null;
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return;
    seen.add(o);
    if (!Array.isArray(o)) for (const [k, v] of Object.entries(o)) {
      if (!out && /outstation|kerja.?luar|outdoor/i.test(k) && v && typeof v === 'object') out = toList(v);
      else if (!working && /working.?type|activity|attendance.?type/i.test(k) && v && typeof v === 'object') working = toList(v);
    }
    for (const v of Object.values(o)) walk(v, d + 1);
  };
  walk(r, 0);
  const clean = (l) => (l || []).filter((o) => o.id !== undefined && o.id !== null && o.label);
  out = clean(out); working = clean(working);
  return out.length ? { outstation: out, working } : null;
}
export function parseTabletLocations(r) {
  const seen = new Set();
  const list = [];
  const walk = (o, d) => {
    if (!o || typeof o !== 'object' || d > 5 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) {
      o.forEach((item) => walk(item, d + 1));
      return;
    }
    const imeiVal = o.imei ?? o.device_imei ?? o.kod ?? o.code;
    const locVal = o.location ?? o.lokasi ?? o.name ?? o.label ?? o.title ?? o.description;
    if (imeiVal && locVal && typeof imeiVal !== 'object' && typeof locVal !== 'object') {
      const locName = String(locVal).trim();
      const typeStr = o.type ? ` (${o.type})` : '';
      list.push({
        label: `${locName}${typeStr}`,
        location: locName,
        imei: String(imeiVal).trim(),
      });
      return;
    }
    const entries = Object.entries(o);
    if (entries.length > 0 && entries.every(([k, v]) => typeof v === 'string' && k.length >= 8 && v.length >= 2)) {
      entries.forEach(([k, v]) => {
        list.push({ label: v.trim(), location: v.trim(), imei: k.trim() });
      });
      return;
    }
    Object.values(o).forEach((v) => walk(v, d + 1));
  };
  walk(r, 0);
  const unique = new Map();
  list.forEach((x) => {
    const k = `${x.label}::${x.imei}`;
    if (!unique.has(k)) unique.set(k, x);
  });
  return [...unique.values()];
}
export const peek = (r) => { try { return JSON.stringify(r).replace(/\s+/g, ' ').slice(0, 300); } catch (_) { return String(r).slice(0, 300); } };
