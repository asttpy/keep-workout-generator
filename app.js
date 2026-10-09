/* =====================================================
 * Keep 运动数据生成器 — 纯本地，无任何外部依赖
 * ===================================================== */
"use strict";

/* ============ 工具函数 ============ */
const $ = id => document.getElementById(id);

// 可复现随机数（mulberry32）
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtPace(secPerKm) {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}

function fmtDuration(sec) {
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

function parsePace(text) { // "6:30" → 秒/公里；"6.5" 也接受（分钟）
  const t = (text || "").trim();
  if (!t) return NaN;
  if (t.includes(":")) {
    const [m, s] = t.split(":").map(Number);
    if (!isFinite(m) || !isFinite(s) || m < 0 || s < 0 || s >= 60) return NaN;
    return m * 60 + s;
  }
  const v = Number(t);
  return isFinite(v) && v > 0 ? Math.round(v * 60) : NaN;
}

let toastTimer = null;
function showToast(msg, isErr = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============ 坐标系转换（WGS-84 / GCJ-02 / BD-09） ============ */
// Keep 按 GPS 标准读取 WGS-84；高德/腾讯用 GCJ-02，百度用 BD-09，需转换避免数百米偏移
const _GEO_A = 6378245, _GEO_EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}
function _tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(y * Math.PI) + 40 * Math.sin(y / 3 * Math.PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * Math.PI) + 320 * Math.sin(y * Math.PI / 30)) * 2 / 3;
  return r;
}
function _tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * Math.PI) + 20 * Math.sin(2 * x * Math.PI)) * 2 / 3;
  r += (20 * Math.sin(x * Math.PI) + 40 * Math.sin(x / 3 * Math.PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * Math.PI) + 300 * Math.sin(x / 30 * Math.PI)) * 2 / 3;
  return r;
}
// WGS-84 → GCJ-02，参数与返回均为 [lng, lat]
function wgs2gcjLL(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = _tLat(lng - 105, lat - 35), dLng = _tLng(lng - 105, lat - 35);
  const radLat = lat / 180 * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - _GEO_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180) / ((_GEO_A * (1 - _GEO_EE)) / (magic * sqrtMagic) * Math.PI);
  dLng = (dLng * 180) / (_GEO_A / sqrtMagic * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}
// GCJ-02 → WGS-84（迭代逼近，误差 < 1m）
function gcj2wgsLL(lng, lat) {
  let wLng = lng, wLat = lat;
  for (let i = 0; i < 3; i++) {
    const g = wgs2gcjLL(wLng, wLat);
    wLng += lng - g[0];
    wLat += lat - g[1];
  }
  return [wLng, wLat];
}
// BD-09 → GCJ-02
function bd2gcjLL(lng, lat) {
  const x = lng - 0.0065, y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * Math.PI * 3000 / 180);
  const th = Math.atan2(y, x) - 0.000003 * Math.cos(x * Math.PI * 3000 / 180);
  return [z * Math.cos(th), z * Math.sin(th)];
}
// GCJ-02 → BD-09
function gcj2bdLL(lng, lat) {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * Math.PI * 3000 / 180);
  const th = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * Math.PI * 3000 / 180);
  return [z * Math.cos(th) + 0.0065, z * Math.sin(th) + 0.006];
}
// 任意坐标系 → WGS-84，[lng, lat]
function toWgsLL(lng, lat, crs) {
  if (crs === "gcj02") return gcj2wgsLL(lng, lat);
  if (crs === "bd09") { const g = bd2gcjLL(lng, lat); return gcj2wgsLL(g[0], g[1]); }
  return [lng, lat];
}
// WGS-84 → 任意坐标系，[lng, lat]
function fromWgsLL(lng, lat, crs) {
  if (crs === "gcj02") return wgs2gcjLL(lng, lat);
  if (crs === "bd09") { const g = wgs2gcjLL(lng, lat); return gcj2bdLL(g[0], g[1]); }
  return [lng, lat];
}

// 从文本（坐标对或地图链接）解析出源坐标系下的 {lat, lng, crs}
function parseCoordText(text) {
  const t = (text || "").trim();
  if (!t) return null;
  let crs = $("crs").value;
  const lower = t.toLowerCase();
  if (/amap\.com|autonavi|gaode/.test(lower)) crs = "gcj02";
  else if (/baidu\.com|bmap/.test(lower)) crs = "bd09";
  else if (/google\./.test(lower)) crs = "wgs84";

  const pair = (a, b) => {
    a = Number(a); b = Number(b);
    if (!isFinite(a) || !isFinite(b)) return null;
    // 中国境内纬度 0~56、经度 72~136，据此自动判断先后顺序
    if (Math.abs(a) > 56 && Math.abs(b) <= 56) return { lat: b, lng: a, crs };
    return { lat: a, lng: b, crs };
  };
  let m;
  // Google 分享链接 @lat,lng
  if ((m = lower.match(/@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/))) return pair(m[1], m[2]);
  // lat=..&lng=..
  const mLat = lower.match(/lat=(-?\d{1,3}\.\d+)/), mLng = lower.match(/lng=(-?\d{1,3}\.\d+)/);
  if (mLat && mLng) return pair(mLat[1], mLng[1]);
  // 高德 position=lng,lat / 百度 location=lat,lng / center=..
  if ((m = lower.match(/(?:position|location|center|coord(?:inate)?s?)=(-?\d{1,3}\.\d+)[,%\s]+(-?\d{1,3}\.\d+)/))) {
    return crs === "gcj02" ? pair(m[1], m[2]) : pair(m[2], m[1]);
  }
  // 纯文本坐标对
  if (!/https?:|\bwww\./.test(lower)) {
    const nums = t.match(/-?\d{1,3}(?:\.\d+)?/g);
    if (nums && nums.length >= 2) return pair(nums[0], nums[1]);
  }
  return null;
}

/* ============ 路径形状生成（米制平面坐标，原点在起点） ============ */
// 返回点数组 [{x, y}]，单位米
function buildShapeMeters(shape, targetDistM, wigglePct, seed) {
  const rnd = mulberry32(seed);
  const w = wigglePct / 100;
  let pts = [];

  if (shape === "loop") {
    const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2, p3 = rnd() * Math.PI * 2;
    const R = 1000;
    const N = 1440;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      const r = R * (1 + w * 0.8 * Math.sin(3 * th + p1) + w * 0.5 * Math.sin(7 * th + p2) + w * 0.35 * Math.sin(11 * th + p3));
      pts.push({ x: r * Math.sin(th), y: r * Math.cos(th) });
    }
  } else if (shape === "outback") {
    const half = 500; // 单程基准长度，后面整体缩放
    const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2;
    const N = 720;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = t * half;
      const y = half * (w * 0.35 * Math.sin(t * Math.PI * 3 + p1) + w * 0.18 * Math.sin(t * Math.PI * 8 + p2));
      pts.push({ x, y });
    }
    const back = pts.slice(0, -1).reverse().map(p => ({ x: p.x, y: p.y }));
    pts = pts.concat(back);
  } else if (shape === "figure8") {
    // Gerono 双纽线：x = a·cos t, y = a·sin t·cos t
    const a = 1000;
    const p1 = rnd() * Math.PI * 2;
    const N = 1440;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const wob = 1 + w * 0.5 * Math.sin(5 * t + p1);
      pts.push({ x: a * Math.cos(t) * wob, y: a * Math.sin(t) * Math.cos(t) * wob });
    }
  } else { // stadium 跑道形
    const r = 350, straight = 900;
    const p1 = rnd() * Math.PI * 2;
    const wob = () => 1 + w * 0.25 * (rnd() - 0.5) * 2;
    pts.push({ x: -straight / 2, y: -r * wob() });
    const NS = 240, NA = 240;
    for (let i = 1; i <= NS; i++) pts.push({ x: -straight / 2 + (straight * i) / NS, y: -r * wob() });
    for (let i = 1; i <= NA; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / NA;
      pts.push({ x: straight / 2 + r * Math.cos(a) * wob(), y: r * Math.sin(a) });
    }
    for (let i = 1; i <= NS; i++) pts.push({ x: straight / 2 - (straight * i) / NS, y: r * wob() });
    for (let i = 1; i <= NA; i++) {
      const a = Math.PI / 2 + (Math.PI * i) / NA;
      pts.push({ x: -straight / 2 + r * Math.cos(a) * wob(), y: r * Math.sin(a) });
    }
    pts.push(pts[0]);
    void p1;
  }

  // 缩放，使路径总长 = 目标距离
  const total = polyLength(pts);
  if (total <= 0) return pts;
  const s = targetDistM / total;
  return pts.map(p => ({ x: p.x * s, y: p.y * s }));
}

// 导入 GPX：以质心为原点转成米制坐标
function buildImportedMeters(gpxPoints, targetDistM) {
  let cx = 0, cy = 0;
  for (const p of gpxPoints) { cx += p.x; cy += p.y; }
  cx /= gpxPoints.length; cy /= gpxPoints.length;
  const k = Math.cos((cy / 111320) * Math.PI / 180) || 1e-9;
  const pts = gpxPoints.map(p => ({ x: (p.x - cx) * 111320 * k, y: (p.y - cy) * 111320 }));
  const total = polyLength(pts);
  if (total <= 0) return pts;
  const s = targetDistM / total;
  return pts.map(p => ({ x: p.x * s, y: p.y * s }));
}

/* 标准 400 米田径场：直道 85.33m × 2 + 半径 36.5m 圆弧 × 2 = 400m，逆时针
 * 返回带法线的单圈路径查询器（法线指向跑道外侧，用于圈间漂移） */
function buildTrackPath(distM, rotDeg, seed) {
  const R = 36.5;
  const S = (400 - 2 * Math.PI * R) / 2; // ≈85.33m
  const rnd = mulberry32(((seed | 0) + 5) >>> 0);
  const p1 = rnd() * Math.PI * 2, p2 = rnd() * Math.PI * 2;
  const rot = (Number(rotDeg) || 0) * Math.PI / 180;
  const c = Math.cos(rot), s = Math.sin(rot);
  const raw = [];
  const NB = 160, NA = 200;
  for (let i = 0; i < NB; i++) raw.push({ x: -S / 2 + (S * i) / NB, y: -R, nx: 0, ny: -1 });
  for (let i = 0; i <= NA; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / NA;
    raw.push({ x: S / 2 + R * Math.cos(a), y: R * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  for (let i = 1; i <= NB; i++) raw.push({ x: S / 2 - (S * i) / NB, y: R, nx: 0, ny: 1 });
  for (let i = 1; i < NA; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / NA;
    raw.push({ x: -S / 2 + R * Math.cos(a), y: R * Math.sin(a), nx: Math.cos(a), ny: Math.sin(a) });
  }
  raw.push({ ...raw[0] });
  // 旋转到指定朝向
  let pts = raw.map(p => ({
    x: p.x * c - p.y * s, y: p.x * s + p.y * c,
    nx: p.nx * c - p.ny * s, ny: p.nx * s + p.ny * c,
  }));
  // 低频空间抖动：沿法线的平滑形变（幅值 ~0.3m），让每圈不是完美几何，更像真实 GPS 轨迹
  const wa = rnd() * Math.PI * 2, wb = rnd() * Math.PI * 2;
  pts = pts.map((p, i) => {
    const a = (i / (pts.length - 1)) * 400;
    const amp = 0.22 * Math.sin(a / 400 * Math.PI * 2 * 3 + wa) + 0.14 * Math.sin(a / 400 * Math.PI * 2 * 7 + wb);
    return { x: p.x + p.nx * amp, y: p.y + p.ny * amp, nx: p.nx, ny: p.ny };
  });
  // 缩放回精确 400 米周长
  const cum0 = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum0[i] = cum0[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const sc = 400 / (cum0[cum0.length - 1] || 400);
  if (sc !== 1) pts = pts.map(p => ({ x: p.x * sc, y: p.y * sc, nx: p.nx, ny: p.ny }));
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const total = cum[cum.length - 1] || 400;
  return {
    lapLen: total,
    laps: distM / total,
    p1, p2,
    at(arc) {
      let a = arc % total;
      if (a < 0) a += total;
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= a) lo = mid; else hi = mid;
      }
      const seg = cum[hi] - cum[lo];
      const t = seg > 0 ? (a - cum[lo]) / seg : 0;
      const p0 = pts[lo], p1p = pts[hi];
      let nx = p0.nx + (p1p.nx - p0.nx) * t, ny = p0.ny + (p1p.ny - p0.ny) * t;
      const n = Math.hypot(nx, ny) || 1;
      return {
        x: p0.x + (p1p.x - p0.x) * t,
        y: p0.y + (p1p.y - p0.y) * t,
        nx: nx / n, ny: ny / n,
      };
    },
  };
}

function polyLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return len;
}

// 预计算累计弧长，支持按弧长取点
function makePathLookup(pts) {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  const total = cum[cum.length - 1];
  return {
    total,
    at(arc) {
      if (arc <= 0) return pts[0];
      if (arc >= total) return pts[pts.length - 1];
      let lo = 0, hi = cum.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= arc) lo = mid; else hi = mid;
      }
      const seg = cum[hi] - cum[lo];
      const t = seg > 0 ? (arc - cum[lo]) / seg : 0;
      return {
        x: pts[lo].x + (pts[hi].x - pts[lo].x) * t,
        y: pts[lo].y + (pts[hi].y - pts[lo].y) * t,
      };
    },
  };
}

/* ============ 配速策略 ============ */
const PRESETS = {
  uniform: [{ w: 34, f: 1 }, { w: 33, f: 1 }, { w: 33, f: 1 }],
  front: [{ w: 30, f: 1.12 }, { w: 40, f: 1.0 }, { w: 30, f: 0.88 }],
  sprint: [{ w: 75, f: 0.96 }, { w: 10, f: 1.25 }, { w: 15, f: 0.9 }],
  custom: [{ w: 33, f: 1.1 }, { w: 34, f: 0.95 }, { w: 33, f: 0.95 }],
};

function getSegments() {
  const rows = [...document.querySelectorAll("#segRows .seg-row")];
  const segs = rows.map(r => ({
    w: Number(r.querySelector(".seg-w").value) || 0,
    f: Number(r.querySelector(".seg-f").value) || 1,
  })).filter(s => s.w > 0);
  if (!segs.length) return [{ w: 1, f: 1 }];
  // 归一化：Σ w_i·f'_i = Σ w_i → 时间加权平均系数 = 1
  const wSum = segs.reduce((a, s) => a + s.w, 0);
  const meanF = segs.reduce((a, s) => a + s.w * s.f, 0) / wSum;
  return segs.map(s => ({ w: s.w / wSum, f: meanF > 0 ? s.f / meanF : 1 }));
}

// 返回函数：timeFrac(0~1) → 配速系数
function factorFn(segs) {
  return tf => {
    let acc = 0;
    for (const s of segs) {
      if (tf <= acc + s.w || acc + s.w >= 1 - 1e-9) {
        return s.f;
      }
      acc += s.w;
    }
    return segs[segs.length - 1].f;
  };
}

/* ============ 记录生成核心 ============ */
// 输入：参数对象，输出：TCX 所需的完整记录（点、汇总）
function generateRecord(opt) {
  const {
    sport, start, durationSec, distKm, weight,
    avgHr, maxHr, calories,
    shapeSource, wigglePct, seed, elevation, importedPath,
  } = opt;

  const distM = distKm * 1000;
  let path = null, track = null;
  if (shapeSource === "imported") {
    path = makePathLookup(buildImportedMeters(importedPath, distM));
  } else if (shapeSource === "track") {
    track = buildTrackPath(distM, opt.trackRot, seed);
  } else {
    path = makePathLookup(buildShapeMeters(shapeSource, distM, wigglePct, seed));
  }

  const segs = getSegments();
  const fAt = factorFn(segs);
  const vAvg = distM / durationSec; // m/s
  const avgPaceSec = durationSec / distKm; // 秒/公里

  // 逐秒积分弧长
  const arcAt = new Float64Array(durationSec + 1);
  for (let s = 1; s <= durationSec; s++) {
    arcAt[s] = arcAt[s - 1] + vAvg * fAt(s / durationSec);
  }

  const cosLat = Math.cos(opt.lat * Math.PI / 180);
  const toGeo = p => ({
    lat: opt.lat + p.y / 111320,
    lng: opt.lng + p.x / (111320 * cosLat),
  });

  // 圈间漂移：跑道模式，在第 1~2 道之间缓慢变化（米）
  const driftAt = track
    ? (lap => Math.min(0.95, Math.max(0.05,
        0.4 + 0.4 * Math.sin(lap * 0.83 + track.p1) + 0.2 * Math.sin(lap * 0.31 + track.p2))))
    : null;

  // GPS 噪声：平滑随机游走（常态 ±0.6m，封顶 ±2.5m），模拟真实手机 GPS
  const noiseRnd = mulberry32((((seed | 0) * 31) + 7) >>> 0);
  let gnx = 0, gny = 0;
  const meterAt = arc => {
    let mx, my;
    if (track) {
      const pos = track.at(arc);
      const d = driftAt(arc / track.lapLen);
      mx = pos.x + pos.nx * d;
      my = pos.y + pos.ny * d;
    } else {
      const pos = path.at(arc);
      mx = pos.x; my = pos.y;
    }
    gnx = gnx * 0.85 + (noiseRnd() - 0.5) * 1.1;
    gny = gny * 0.85 + (noiseRnd() - 0.5) * 1.1;
    gnx = Math.max(-2.5, Math.min(2.5, gnx));
    gny = Math.max(-2.5, Math.min(2.5, gny));
    return { x: mx + gnx, y: my + gny };
  };

  const elevBase = 10, elevAmp = elevation ? (track ? 2 : 9) : 0;
  const STEP = 5;
  const points = [], meters = [];
  for (let s = 0; s <= durationSec; s += STEP) {
    const arc = arcAt[s];
    const m = meterAt(arc);
    meters.push(m);
    const g = toGeo(m);
    const f = fAt(s / durationSec);
    const pt = {
      time: s,
      lat: g.lat, lng: g.lng,
      ele: elevAmp ? elevBase + elevAmp * (0.6 * Math.sin(arc / 300) + 0.4 * Math.sin(arc / 97)) : elevBase,
      dist: arc,
      f,
    };
    if (avgHr) {
      const t = Math.min(1, Math.max(0, 0.5 + (f - 1) * 1.6));
      pt.hr = Math.round(avgHr + (maxHr - avgHr) * t + Math.sin(arc / 53) * 1.5);
      pt.hr = Math.max(60, Math.min(230, pt.hr));
    }
    points.push(pt);
  }
  // 末点校准
  const last = points[points.length - 1];
  if (last.time !== durationSec) {
    const m = meterAt(distM);
    meters.push(m);
    const g = toGeo(m);
    const endPt = {
      time: durationSec, lat: g.lat, lng: g.lng,
      ele: elevAmp ? elevBase + elevAmp * (0.6 * Math.sin(distM / 300) + 0.4 * Math.sin(distM / 97)) : elevBase,
      dist: distM, f: fAt(1),
    };
    if (avgHr) endPt.hr = avgHr;
    points.push(endPt);
  }

  const kcal = calories && calories > 0 ? calories : estimateCalories(sport, distKm, durationSec, weight);

  return {
    sport, start, durationSec, distKm, kcal, avgPaceSec, points, meters,
    laps: track ? track.laps : 0,
  };
}

function estimateCalories(sport, distKm, durationSec, weight) {
  const hours = durationSec / 3600;
  let met;
  if (sport === "Running") met = Math.max(6, (distKm / hours) * 1.036);
  else if (sport === "Biking") met = Math.max(4, 3.5 + (distKm / hours) * 0.35);
  else met = Math.max(2.5, (distKm / hours) * 0.9);
  return Math.round(met * weight * hours);
}

/* ============ TCX 组装 ============ */
const SPORT_MAP = { Running: "Running", Biking: "Biking", Other: "Other" };

function buildTcx(rec) {
  const iso = d => d.toISOString();
  const sport = SPORT_MAP[rec.sport] || "Running";
  const parts = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">');
  parts.push("<Activities>");
  parts.push(`<Activity Sport="${sport}">`);
  parts.push(`<Id>${iso(rec.start)}</Id>`);
  parts.push(`<Lap StartTime="${iso(rec.start)}">`);
  parts.push(`<TotalTimeSeconds>${rec.durationSec}</TotalTimeSeconds>`);
  parts.push(`<DistanceMeters>${(rec.distKm * 1000).toFixed(1)}</DistanceMeters>`);
  parts.push(`<MaximumSpeed>${(Math.max(...rec.points.map(p => 1000 * rec.distKm / rec.durationSec * p.f)) ).toFixed(2)}</MaximumSpeed>`);
  parts.push(`<Calories>${rec.kcal}</Calories>`);
  if (rec.points[0].hr) {
    const hrs = rec.points.map(p => p.hr);
    parts.push(`<AverageHeartRateBpm xsi:type="HeartRateInBeatsPerMinute_t"><Value>${Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length)}</Value></AverageHeartRateBpm>`);
    parts.push(`<MaximumHeartRateBpm xsi:type="HeartRateInBeatsPerMinute_t"><Value>${Math.max(...hrs)}</Value></MaximumHeartRateBpm>`);
  }
  parts.push("<Intensity>Active</Intensity>");
  parts.push("<Track>");
  const startMs = rec.start.getTime();
  for (const p of rec.points) {
    parts.push("<Trackpoint>");
    parts.push(`<Time>${new Date(startMs + p.time * 1000).toISOString()}</Time>`);
    parts.push(`<Position><LatitudeDegrees>${p.lat.toFixed(6)}</LatitudeDegrees><LongitudeDegrees>${p.lng.toFixed(6)}</LongitudeDegrees></Position>`);
    parts.push(`<AltitudeMeters>${p.ele.toFixed(1)}</AltitudeMeters>`);
    parts.push(`<DistanceMeters>${p.dist.toFixed(1)}</DistanceMeters>`);
    if (p.hr) parts.push(`<HeartRateBpm xsi:type="HeartRateInBeatsPerMinute_t"><Value>${p.hr}</Value></HeartRateBpm>`);
    parts.push("</Trackpoint>");
  }
  parts.push("</Track>");
  parts.push("</Lap>");
  parts.push("</Activity>");
  parts.push("</Activities>");
  parts.push("</TrainingCenterDatabase>");
  return parts.join("\n");
}

function tcxFilename(rec) {
  const d = rec.start;
  const tag = { Running: "running", Biking: "cycling", Other: "walking" }[rec.sport] || "workout";
  return `keep_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}_${tag}.tcx`;
}

/* ============ ZIP 打包（STORE，无依赖） ============ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(files) { // files: [{name, text}]
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const chunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const data = enc.encode(f.text);
    const nameBytes = enc.encode(f.name);
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // UTF-8 文件名
    lh.setUint16(8, 0, true);      // STORE
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    chunks.push(new Uint8Array(lh.buffer), nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += 30 + nameBytes.length + data.length;
  }

  const cdStart = offset;
  const cdChunks = [];
  for (const c of central) {
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, c.crc, true);
    ch.setUint32(20, c.size, true);
    ch.setUint32(24, c.size, true);
    ch.setUint16(28, c.nameBytes.length, true);
    ch.setUint32(42, c.offset, true);
    cdChunks.push(new Uint8Array(ch.buffer), c.nameBytes);
    offset += 46 + c.nameBytes.length;
  }

  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, central.length, true);
  eocd.setUint16(10, central.length, true);
  eocd.setUint32(12, offset - cdStart, true);
  eocd.setUint32(16, cdStart, true);
  return new Blob([...chunks, ...cdChunks, new Uint8Array(eocd.buffer)], { type: "application/zip" });
}

/* ============ GPX 导入 ============ */
let importedGpx = null; // [{lat, lng}] 存为 {x:lng, y:lat}

function handleGpxFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const doc = new DOMParser().parseFromString(reader.result, "application/xml");
      if (doc.querySelector("parsererror")) throw new Error("XML 解析失败");
      const nodes = doc.getElementsByTagName("trkpt");
      if (!nodes.length) throw new Error("未找到 trkpt 轨迹点");
      const pts = [];
      for (const n of nodes) {
        const lat = parseFloat(n.getAttribute("lat"));
        const lng = parseFloat(n.getAttribute("lon"));
        if (isFinite(lat) && isFinite(lng)) pts.push({ x: lng, y: lat });
      }
      if (pts.length < 10) throw new Error("轨迹点过少");
      importedGpx = pts;
      $("gpxNote").textContent = `已导入 ${pts.length} 个轨迹点，将按目标距离等比缩放`;
      $("gpxNote").className = "field-note ok";
    } catch (e) {
      importedGpx = null;
      $("gpxNote").textContent = `导入失败：${e.message}`;
      $("gpxNote").className = "field-note err";
    }
  };
  reader.readAsText(file);
}

/* ============ 轨迹地图预览（可拖拽移动位置 / 滚轮缩放） ============ */
const SVG_W = 400, SVG_H = 260;
const NICE_STEPS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
// 视图状态：mpp=米/像素，cx/cy=视图中心的米制世界坐标（y 向北）
const mapView = { mpp: 1, cx: 0, cy: 0 };
let currentMeters = null;
// 路线中心的 WGS-84 坐标（权威值，导出用此值）
const wgsCenter = { lat: 32.108221, lng: 118.911572 };

function fitMapView(meters) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of meters) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(maxX - minX, 8), h = Math.max(maxY - minY, 8);
  mapView.mpp = Math.max(w / (SVG_W - 70), h / (SVG_H - 60), 0.02);
  mapView.cx = (minX + maxX) / 2;
  mapView.cy = (minY + maxY) / 2;
}

// Web 墨卡托：纬度（度）→ [0,1] 归一化 Y
function latToMercY(lat) {
  const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

function renderTrackMap(meters, refit) {
  currentMeters = meters;
  const svg = $("trackSvg");
  if (!meters || !meters.length) { svg.innerHTML = ""; return; }
  if (refit) fitMapView(meters);
  const toS = p => [
    SVG_W / 2 + (p.x - mapView.cx) / mapView.mpp,
    SVG_H / 2 - (p.y - mapView.cy) / mapView.mpp,
  ];
  const d = meters.map((p, i) => `${i ? "L" : "M"}${toS(p)[0].toFixed(1)} ${toS(p)[1].toFixed(1)}`).join("");
  const [sx, sy] = toS(meters[0]);
  const [ex, ey] = toS(meters[meters.length - 1]);

  // 卫星底图（高德瓦片，GCJ-02 对齐；仅在用户勾选时联网加载）
  const satOn = $("satToggle").checked;
  let tiles = "";
  if (satOn) {
    const cosL = Math.cos(wgsCenter.lat * Math.PI / 180);
    const cLat = wgsCenter.lat + mapView.cy / 111320;
    const cLng = wgsCenter.lng + mapView.cx / (111320 * cosL);
    const g = wgs2gcjLL(cLng, cLat);
    const zoom = Math.max(3, Math.min(18, Math.round(Math.log2(156543.03392 * Math.cos(g[1] * Math.PI / 180) / mapView.mpp))));
    const n = Math.pow(2, zoom);
    const mppTile = 156543.03392 * Math.cos(g[1] * Math.PI / 180) / n; // 米/瓦片像素
    const k = mppTile / mapView.mpp; // 瓦片像素 → viewBox 单位
    const mx = ((g[0] + 180) / 360) * n * 256;
    const my = latToMercY(g[1]) * n * 256;
    const tx0 = Math.floor((mx - SVG_W / 2 / k) / 256), tx1 = Math.floor((mx + SVG_W / 2 / k) / 256);
    const ty0 = Math.floor((my - SVG_H / 2 / k) / 256), ty1 = Math.floor((my + SVG_H / 2 / k) / 256);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        tiles += `<image x="${(SVG_W / 2 + (tx * 256 - mx) * k).toFixed(1)}" y="${(SVG_H / 2 + (ty * 256 - my) * k).toFixed(1)}" width="${(256 * k).toFixed(1)}" height="${(256 * k).toFixed(1)}" preserveAspectRatio="none" href="https://webst0${((wx + ty) % 4) + 1}.is.autonavi.com/appmaptile?style=6&x=${wx}&y=${ty}&z=${zoom}"/>`;
      }
    }
  }

  // 背景网格（间隔随缩放级别取整值；卫星模式下不画）
  let grid = "";
  if (!satOn) {
    let step = NICE_STEPS[NICE_STEPS.length - 1];
    for (const s of NICE_STEPS) { if (s / mapView.mpp >= 45) { step = s; break; } }
    const xL = mapView.cx - (SVG_W / 2) * mapView.mpp, xR = mapView.cx + (SVG_W / 2) * mapView.mpp;
    const yB = mapView.cy - (SVG_H / 2) * mapView.mpp, yT = mapView.cy + (SVG_H / 2) * mapView.mpp;
    for (let gx = Math.ceil(xL / step) * step; gx <= xR; gx += step) {
      const x = (SVG_W / 2 + (gx - mapView.cx) / mapView.mpp).toFixed(1);
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="${SVG_H}" stroke="var(--border)" stroke-width="0.5"/>`;
    }
    for (let gy = Math.ceil(yB / step) * step; gy <= yT; gy += step) {
      const y = (SVG_H / 2 - (gy - mapView.cy) / mapView.mpp).toFixed(1);
      grid += `<line x1="0" y1="${y}" x2="${SVG_W}" y2="${y}" stroke="var(--border)" stroke-width="0.5"/>`;
    }
  }

  // 比例尺
  let barLen = NICE_STEPS[NICE_STEPS.length - 1];
  for (const s of NICE_STEPS) { if (s / mapView.mpp >= 60) { barLen = s; break; } }
  const barPx = barLen / mapView.mpp;
  const barLabel = barLen >= 1000 ? `${barLen / 1000} km` : `${barLen} m`;
  const barX = 14, barY = SVG_H - 16;
  const scaleBar =
    `<line x1="${barX}" y1="${barY}" x2="${(barX + barPx).toFixed(1)}" y2="${barY}" stroke="var(--text-2)" stroke-width="2"/>` +
    `<line x1="${barX}" y1="${barY - 4}" x2="${barX}" y2="${barY + 4}" stroke="var(--text-2)" stroke-width="1.5"/>` +
    `<line x1="${(barX + barPx).toFixed(1)}" y1="${barY - 4}" x2="${(barX + barPx).toFixed(1)}" y2="${barY + 4}" stroke="var(--text-2)" stroke-width="1.5"/>` +
    `<text x="${(barX + barPx / 2).toFixed(1)}" y="${barY - 7}" text-anchor="middle" font-size="10" fill="var(--text-2)">${barLabel}</text>`;

  svg.innerHTML = tiles + grid + scaleBar +
    `<path d="${d}" fill="none" stroke="var(--track-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="5" fill="var(--track-line)"/>` +
    `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="9" fill="none" stroke="var(--track-line)" stroke-opacity="0.4" stroke-width="1.5"/>` +
    `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="var(--text-2)"/>`;
}

/* ============ 配速曲线（分段可拖动） ============ */
let paceView = null, paceViewKey = "", paceDrag = null, paceLayout = null;

function paceViewFor(segs, avgPaceSec) {
  const paces = segs.map(s => avgPaceSec / s.f);
  const pMin = Math.min(...paces), pMax = Math.max(...paces);
  const pad = Math.max((pMax - pMin) * 0.3, avgPaceSec * 0.08);
  return { pTop: pMin - pad, pBot: pMax + pad };
}

function renderPaceSvg(rec) {
  const svg = $("paceSvg");
  const segs = getSegments();
  const W = 400, H = 150, padL = 52, padR = 12, padT = 14, padB = 22;
  // 拖动期间冻结纵轴范围，保证手感稳定；非拖动且参数变化时重新适配
  if (!paceDrag) {
    const key = `${rec.avgPaceSec.toFixed(2)}|${segs.length}`;
    if (paceViewKey !== key) {
      paceView = paceViewFor(segs, rec.avgPaceSec);
      paceViewKey = key;
    }
  }
  const { pTop, pBot } = paceView;
  const y = p => padT + (p - pTop) / (pBot - pTop) * (H - padT - padB);
  const paceFor = yv => pTop + (yv - padT) / (H - padT - padB) * (pBot - pTop);
  const x = tf => padL + tf * (W - padL - padR);
  paceLayout = { segs, x, paceFor, pTop, pBot };

  const paces = segs.map(s => rec.avgPaceSec / s.f);
  let d = "", handles = "";
  let acc = 0;
  segs.forEach((s, i) => {
    const x1 = x(acc), x2 = x(acc + s.w);
    const yv = y(paces[i]);
    d += `${i ? "L" : "M"}${x1.toFixed(1)} ${yv.toFixed(1)}L${x2.toFixed(1)} ${yv.toFixed(1)}`;
    const dragging = paceDrag && paceDrag.i === i;
    handles += `<circle class="pace-handle" cx="${((x1 + x2) / 2).toFixed(1)}" cy="${yv.toFixed(1)}" r="${dragging ? 6 : 4.5}" fill="var(--surface)" stroke="var(--pace-line)" stroke-width="2"/>`;
    if (dragging) {
      handles += `<text x="${((x1 + x2) / 2).toFixed(1)}" y="${(yv - 10).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--pace-line)">${fmtPace(paces[i])}/km</text>`;
    }
    acc += s.w;
  });
  const area = `${d}L${x(1).toFixed(1)} ${H - padB}L${x(0).toFixed(1)} ${H - padB}Z`;

  // 网格线：按常用配速系数标注实际配速
  let gridLines = "";
  [0.7, 0.85, 1, 1.15, 1.3, 1.5].forEach(f => {
    const p = rec.avgPaceSec / f;
    if (p >= pTop && p <= pBot && p > 0) {
      const isAvg = f === 1;
      gridLines +=
        `<line x1="${padL}" y1="${y(p).toFixed(1)}" x2="${W - padR}" y2="${y(p).toFixed(1)}" stroke="${isAvg ? "var(--text-2)" : "var(--border)"}" ${isAvg ? 'stroke-dasharray="4 4" ' : ""}stroke-width="1"/>` +
        `<text x="${padL - 6}" y="${(y(p) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--text-2)">${isAvg ? "平均 " : ""}${fmtPace(p)}</text>`;
    }
  });

  svg.innerHTML =
    `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--border)"/>` +
    `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${H - padB}" stroke="var(--border)"/>` +
    gridLines +
    `<path d="${area}" fill="var(--pace-fill)"/>` +
    `<path d="${d}" fill="none" stroke="var(--pace-line)" stroke-width="2" stroke-linejoin="round"/>` +
    handles +
    `<text x="${padL}" y="${H - 6}" font-size="10" fill="var(--text-2)">0:00</text>` +
    `<text x="${W - padR}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--text-2)">${fmtDuration(rec.durationSec)}</text>`;
}

function statCard(k, v) {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function renderSinglePreview() {
  const rec = currentSingleRecord();
  if (!rec) {
    currentMeters = null;
    $("trackSvg").innerHTML = "";
    return;
  }
  $("summaryGrid").innerHTML =
    statCard("距离", `${rec.distKm.toFixed(2)}<small>km</small>`) +
    statCard("时长", fmtDuration(rec.durationSec)) +
    statCard("平均配速", `${fmtPace(rec.avgPaceSec)}<small>/km</small>`) +
    statCard("卡路里", `${rec.kcal}<small>kcal</small>`) +
    (rec.points[0].hr ? statCard("平均心率", `${Math.round(rec.points.reduce((a, p) => a + p.hr, 0) / rec.points.length)}<small>bpm</small>`) : "");
  renderTrackMap(rec.meters, true);
  if (rec.laps) {
    $("trackNote").textContent = `按当前距离约 ${rec.laps.toFixed(1)} 圈（每圈 400 米，逆时针）`;
  }
  renderPaceSvg(rec);
}

/* ============ 状态读取 ============ */
function currentSingleRecord() {
  const start = $("startTime").value ? new Date($("startTime").value) : null;
  if (!start || isNaN(start)) return null;
  const durationSec = Math.max(60, Math.round(Number($("duration").value) * 60));
  const distKm = Number($("distance").value);
  if (!isFinite(distKm) || distKm <= 0) return null;
  const shapeSel = $("shape").value;
  if (shapeSel === "imported" && !importedGpx) return null;

  return generateRecord({
    sport: $("sport").value,
    start,
    durationSec,
    distKm,
    weight: Number($("weight").value) || 65,
    avgHr: Number($("avgHr").value) || 0,
    maxHr: Number($("maxHr").value) || 190,
    calories: Number($("calories").value) || 0,
    shapeSource: shapeSel,
    wigglePct: Number($("wiggle").value),
    seed: Number($("seed").value) || 1,
    elevation: $("elevation").checked,
    trackRot: Number($("trackRot").value) || 0,
    lat: wgsCenter.lat,
    lng: wgsCenter.lng,
    importedPath: importedGpx,
  });
}

/* ============ 批量生成 ============ */
let batchRecords = [];

function generateBatch() {
  const from = $("bFrom").value, to = $("bTo").value;
  if (!from || !to || new Date(from) > new Date(to)) {
    showToast("请设置有效的日期范围", true);
    return null;
  }
  const paceSec = parsePace($("bPace").value);
  if (!isFinite(paceSec)) {
    showToast("基准配速格式不正确，示例：6:00", true);
    return null;
  }
  const dMin = Number($("bDistMin").value), dMax = Number($("bDistMax").value);
  if (!isFinite(dMin) || !isFinite(dMax) || dMin <= 0 || dMax < dMin) {
    showToast("距离范围不正确", true);
    return null;
  }
  const weekdays = [...document.querySelectorAll("#bWeekdays input:checked")].map(i => Number(i.value));
  if (!weekdays.length) {
    showToast("请至少选择一个运动日", true);
    return null;
  }
  const [h1, m1] = $("bTimeStart").value.split(":").map(Number);
  const [h2, m2] = $("bTimeEnd").value.split(":").map(Number);
  const t1 = (h1 || 7) * 60 + (m1 || 0), t2 = (h2 || 8) * 60 + (m2 || 30);
  const jitter = Number($("bJitter").value) || 0;
  const rnd = mulberry32((Number($("bSeed").value) || 1) + 99);

  const recs = [];
  const d0 = new Date(from + "T00:00:00");
  const d1 = new Date(to + "T00:00:00");
  for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
    if (!weekdays.includes(d.getDay())) continue;
    const distKm = +(dMin + rnd() * (dMax - dMin)).toFixed(2);
    const jit = 1 + (rnd() * 2 - 1) * (jitter / 100);
    const durationSec = Math.round(distKm * paceSec * jit);
    const winMin = Math.max(t2 - t1, 0);
    const startMin = t1 + Math.floor(rnd() * winMin);
    const start = new Date(d);
    start.setHours(Math.floor(startMin / 60), startMin % 60, Math.floor(rnd() * 60), 0);
    recs.push({
      sport: $("sport").value,
      start,
      durationSec,
      distKm,
      weight: Number($("weight").value) || 65,
      avgHr: Number($("avgHr").value) || 0,
      maxHr: Number($("maxHr").value) || 190,
      calories: Number($("calories").value) || 0,
      shapeSource: $("shape").value,
      wigglePct: Number($("wiggle").value),
      seed: (Number($("bSeed").value) || 1) * 1000 + recs.length,
      elevation: $("elevation").checked,
      trackRot: Number($("trackRot").value) || 0,
      lat: wgsCenter.lat,
      lng: wgsCenter.lng,
      importedPath: importedGpx,
    });
  }
  if (!recs.length) {
    showToast("该日期范围内没有符合运动日的日期", true);
    return null;
  }
  return recs.map(generateRecord);
}

function renderBatchPreview(recs) {
  const totalKm = recs.reduce((a, r) => a + r.distKm, 0);
  const totalSec = recs.reduce((a, r) => a + r.durationSec, 0);
  const totalKcal = recs.reduce((a, r) => a + r.kcal, 0);
  $("batchSummary").innerHTML =
    statCard("记录数", `${recs.length}<small>条</small>`) +
    statCard("总距离", `${totalKm.toFixed(1)}<small>km</small>`) +
    statCard("总时长", fmtDuration(totalSec)) +
    statCard("总卡路里", `${totalKcal}<small>kcal</small>`);
  const tbody = $("batchTable").querySelector("tbody");
  tbody.innerHTML = recs.map(r => {
    const d = r.start;
    return `<tr><td>${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}</td>` +
      `<td>${pad2(d.getHours())}:${pad2(d.getMinutes())}</td>` +
      `<td>${r.distKm.toFixed(2)} km</td>` +
      `<td>${fmtDuration(r.durationSec)}</td>` +
      `<td>${fmtPace(r.avgPaceSec)} /km</td>` +
      `<td>${r.kcal} kcal</td></tr>`;
  }).join("");
}

/* ============ 模式切换 ============ */
function syncShapeUI() {
  const v = $("shape").value;
  $("geoRow").hidden = v === "imported";
  $("gpxRow").hidden = v !== "imported";
  $("wiggleRow").hidden = v === "track" || v === "imported";
  $("trackRow").hidden = v !== "track";
  $("trackNote").hidden = v !== "track";
}

function setMode(batch) {
  $("tabSingle").classList.toggle("active", !batch);
  $("tabBatch").classList.toggle("active", batch);
  $("secSingle").hidden = batch;
  $("secBatch").hidden = !batch;
  $("previewSingle").hidden = batch;
  $("previewBatch").hidden = !batch;
  $("btnExportSingle").hidden = batch;
  $("btnBatchGen").hidden = !batch;
  $("btnExportZip").hidden = !batch;
  $("btnExportZip").disabled = batchRecords.length === 0;
  if (batch) {
    $("batchSummary").innerHTML = statCard("提示", "点击下方按钮生成");
    $("batchTable").querySelector("tbody").innerHTML = "";
  } else {
    renderSinglePreview();
  }
}

/* ============ 分段编辑器 ============ */
function renderSegRows(segs) {
  const box = $("segRows");
  box.innerHTML = "";
  segs.forEach(s => {
    const row = document.createElement("div");
    row.className = "seg-row";
    row.innerHTML =
      `<input class="seg-w" type="number" value="${Math.round(s.w * 100)}" min="1" max="100" step="1">` +
      `<input class="seg-f" type="number" value="${s.f.toFixed(2)}" min="0.3" max="2" step="0.05">` +
      `<button class="seg-del" type="button" title="删除该分段">×</button>`;
    row.querySelector(".seg-del").addEventListener("click", () => {
      row.remove();
      if (!$("segRows").children.length) addSegRow(100, 1);
      markPaceChip("custom");
      renderSinglePreview();
    });
    box.appendChild(row);
  });
}

function addSegRow(w, f) {
  const row = document.createElement("div");
  row.className = "seg-row";
  row.innerHTML =
    `<input class="seg-w" type="number" value="${w}" min="1" max="100" step="1">` +
    `<input class="seg-f" type="number" value="${f}" min="0.3" max="2" step="0.05">` +
    `<button class="seg-del" type="button" title="删除该分段">×</button>`;
  row.querySelector(".seg-del").addEventListener("click", () => {
    row.remove();
    if (!$("segRows").children.length) addSegRow(100, 1);
    renderSinglePreview();
  });
  $("segRows").appendChild(row);
}

function markPaceChip(preset) {
  document.querySelectorAll("#paceStrategy .chip").forEach(c =>
    c.classList.toggle("active", c.dataset.preset === preset));
  $("segEditor").hidden = preset !== "custom";
}

/* ============ 主题 ============ */
function initTheme() {
  const saved = localStorage.getItem("kwdg-theme");
  const dark = saved ? saved === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $("themeBtn").textContent = dark ? "☀️" : "🌙";
}

/* ============ 事件绑定 ============ */
function init() {
  // 默认开始时间：今天 07:30
  const now = new Date();
  const def = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}T07:30`;
  $("startTime").value = def;

  // 批量默认日期：本周一 ~ 本周日
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  $("bFrom").value = `${monday.getFullYear()}-${pad2(monday.getMonth() + 1)}-${pad2(monday.getDate())}`;
  $("bTo").value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  initTheme();
  $("themeBtn").addEventListener("click", () => {
    const dark = document.documentElement.dataset.theme === "dark";
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    localStorage.setItem("kwdg-theme", dark ? "light" : "dark");
    $("themeBtn").textContent = dark ? "🌙" : "☀️";
  });

  $("tabSingle").addEventListener("click", () => setMode(false));
  $("tabBatch").addEventListener("click", () => setMode(true));

  // 表单变化 → 实时预览
  ["sport", "startTime", "duration", "distance", "weight", "avgHr", "maxHr", "calories",
   "shape", "seed", "trackRot"].forEach(id =>
    $(id).addEventListener("input", () => { renderSinglePreview(); }));

  // 经纬度输入（按所选坐标系）→ 更新 WGS-84 中心
  const readCenter = () => {
    const crs = $("crs").value;
    const lat = Number($("lat").value), lng = Number($("lng").value);
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      const w = toWgsLL(lng, lat, crs);
      wgsCenter.lng = w[0]; wgsCenter.lat = w[1];
    }
    renderSinglePreview();
  };
  $("lat").addEventListener("input", readCenter);
  $("lng").addEventListener("input", readCenter);
  $("crs").addEventListener("change", () => {
    // 坐标系切换：同一定位点的数值重新投影显示
    const src = fromWgsLL(wgsCenter.lng, wgsCenter.lat, $("crs").value);
    $("lat").value = src[1].toFixed(6);
    $("lng").value = src[0].toFixed(6);
    renderSinglePreview();
  });
  $("coordParse").addEventListener("click", () => {
    const r = parseCoordText($("coordPaste").value);
    if (!r || !isFinite(r.lat) || !isFinite(r.lng)) {
      showToast("未能识别坐标，请粘贴如 “39.9086, 116.3974” 或地图分享链接", true);
      return;
    }
    $("crs").value = r.crs;
    $("lat").value = r.lat.toFixed(6);
    $("lng").value = r.lng.toFixed(6);
    const w = toWgsLL(r.lng, r.lat, r.crs);
    wgsCenter.lng = w[0]; wgsCenter.lat = w[1];
    $("coordPaste").value = "";
    renderSinglePreview();
    showToast(`已定位：${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`);
  });
  $("coordPaste").addEventListener("keydown", e => {
    if (e.key === "Enter") $("coordParse").click();
  });

  // 轨迹地图：拖拽移动路线位置、滚轮/按钮缩放
  const mapSvg = $("trackSvg");
  const toSvgPt = e => {
    const pt = mapSvg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = mapSvg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: SVG_W / 2, y: SVG_H / 2 };
  };
  function zoomAt(pSvg, k) {
    if (!currentMeters) return;
    const wx = mapView.cx + (pSvg.x - SVG_W / 2) * mapView.mpp;
    const wy = mapView.cy - (pSvg.y - SVG_H / 2) * mapView.mpp;
    mapView.mpp = Math.min(2000, Math.max(0.03, mapView.mpp * k));
    mapView.cx = wx - (pSvg.x - SVG_W / 2) * mapView.mpp;
    mapView.cy = wy + (pSvg.y - SVG_H / 2) * mapView.mpp;
    renderTrackMap(currentMeters, false);
  }
  let drag = null;
  mapSvg.addEventListener("pointerdown", e => {
    if (!currentMeters) return;
    drag = { id: e.pointerId, p: toSvgPt(e), cx: mapView.cx, cy: mapView.cy };
    mapSvg.setPointerCapture(e.pointerId);
    mapSvg.classList.add("grabbing");
  });
  mapSvg.addEventListener("pointermove", e => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = toSvgPt(e);
    // 灵敏度 0.45：路线移动速度为光标的 45%，便于精细对准跑道
    const dxM = (p.x - drag.p.x) * mapView.mpp * 0.45; // 光标向东移动的米数
    const dyM = (p.y - drag.p.y) * mapView.mpp * 0.45; // 光标向下移动的米数
    mapView.cx = drag.cx - dxM;
    mapView.cy = drag.cy + dyM;
    // 路线跟随光标 → 地理中心相应平移
    const cosLat = Math.cos(wgsCenter.lat * Math.PI / 180) || 1e-9;
    wgsCenter.lng += dxM / (111320 * cosLat);
    wgsCenter.lat -= dyM / 111320;
    const src = fromWgsLL(wgsCenter.lng, wgsCenter.lat, $("crs").value);
    $("lat").value = src[1].toFixed(6);
    $("lng").value = src[0].toFixed(6);
    renderTrackMap(currentMeters, false);
  });
  const endDrag = e => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      mapSvg.classList.remove("grabbing");
    }
  };
  mapSvg.addEventListener("pointerup", endDrag);
  mapSvg.addEventListener("pointercancel", endDrag);
  mapSvg.addEventListener("wheel", e => {
    e.preventDefault();
    zoomAt(toSvgPt(e), e.deltaY > 0 ? 1.2 : 1 / 1.2);
  }, { passive: false });
  $("mapZoomIn").addEventListener("click", () => zoomAt({ x: SVG_W / 2, y: SVG_H / 2 }, 1 / 1.4));
  $("mapZoomOut").addEventListener("click", () => zoomAt({ x: SVG_W / 2, y: SVG_H / 2 }, 1.4));
  $("mapReset").addEventListener("click", () => renderSinglePreview());
  $("satToggle").addEventListener("change", () => renderTrackMap(currentMeters, false));

  // 配速曲线拖动：抓住任一分段上下拖动即可调节该段配速（平均配速保持不变）
  const paceSvg = $("paceSvg");
  const p2svg = e => {
    const pt = paceSvg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const m = paceSvg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  };
  const hitSegment = xv => {
    if (!paceLayout) return -1;
    let acc = 0, best = -1, bestD = Infinity;
    paceLayout.segs.forEach((s, i) => {
      const x1 = paceLayout.x(acc), x2 = paceLayout.x(acc + s.w);
      const d = xv < x1 ? x1 - xv : xv > x2 ? xv - x2 : 0;
      if (d < bestD) { bestD = d; best = i; }
      acc += s.w;
    });
    return bestD <= 24 ? best : -1;
  };
  const paceDragMove = e => {
    if (!paceDrag || !paceLayout) return;
    const rec = currentSingleRecord();
    if (!rec) return;
    const p = p2svg(e);
    const targetPace = Math.min(
      Math.max(paceLayout.paceFor(p.y), rec.avgPaceSec / 1.6, paceLayout.pTop + 2),
      Math.min(rec.avgPaceSec / 0.6, paceLayout.pBot - 2));
    const targetF = rec.avgPaceSec / targetPace;
    // 闭式解：拖动后 renormalize 仍使该段有效系数恰为 targetF
    const rows = [...$("segRows").children];
    let S = 0, Wt = 0, wi = 0;
    rows.forEach((r, j) => {
      const w = Number(r.querySelector(".seg-w").value) || 0;
      const f = j === paceDrag.i ? 0 : (Number(r.querySelector(".seg-f").value) || 1);
      if (w > 0) {
        S += w * f;
        Wt += w;
        if (j === paceDrag.i) wi = w;
      }
    });
    const denom = Wt - targetF * wi;
    let raw = denom > 1e-6 ? targetF * S / denom : 2;
    raw = Math.min(2, Math.max(0.3, raw));
    rows[paceDrag.i].querySelector(".seg-f").value = raw.toFixed(2);
    renderSinglePreview();
  };
  paceSvg.addEventListener("pointerdown", e => {
    const i = hitSegment(p2svg(e).x);
    if (i < 0) return;
    const rows = [...$("segRows").children];
    if (!rows[i]) return;
    paceDrag = { i };
    markPaceChip("custom"); // 拖动即视为自定义配速
    paceSvg.setPointerCapture(e.pointerId);
    paceDragMove(e);
  });
  paceSvg.addEventListener("pointermove", e => { if (paceDrag) paceDragMove(e); });
  const endPaceDrag = () => {
    if (paceDrag) {
      paceDrag = null;
      renderSinglePreview();
    }
  };
  paceSvg.addEventListener("pointerup", endPaceDrag);
  paceSvg.addEventListener("pointercancel", endPaceDrag);

  // 开始时间快捷调整：支持提前生成未来日期的数据，之后再导入 Keep
  document.querySelectorAll(".time-nudge button").forEach(btn => {
    btn.addEventListener("click", () => {
      const days = Number(btn.dataset.nudge);
      if (!days) {
        const n = new Date();
        $("startTime").value = `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}T07:30`;
      } else {
        const cur = $("startTime").value ? new Date($("startTime").value) : new Date();
        cur.setDate(cur.getDate() + days);
        $("startTime").value = `${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}T${pad2(cur.getHours())}:${pad2(cur.getMinutes())}`;
      }
      renderSinglePreview();
    });
  });

  $("wiggle").addEventListener("input", () => {
    $("wiggleVal").textContent = `${$("wiggle").value}%`;
    renderSinglePreview();
  });
  $("elevation").addEventListener("change", renderSinglePreview);
  $("seedDice").addEventListener("click", () => {
    $("seed").value = Math.floor(Math.random() * 99999);
    renderSinglePreview();
  });
  $("shape").addEventListener("change", () => {
    syncShapeUI();
    renderSinglePreview();
  });
  $("gpxFile").addEventListener("change", e => {
    if (e.target.files[0]) handleGpxFile(e.target.files[0]);
  });

  // 配速预设
  document.querySelectorAll("#paceStrategy .chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const p = chip.dataset.preset;
      markPaceChip(p);
      if (p !== "custom") renderSegRows(PRESETS[p]);
      renderSinglePreview();
    });
  });
  $("segAdd").addEventListener("click", () => {
    addSegRow(20, 1);
    markPaceChip("custom");
    renderSinglePreview();
  });
  $("segRows").addEventListener("input", () => {
    markPaceChip("custom");
    renderSinglePreview();
  });

  // 导出
  $("btnExportSingle").addEventListener("click", () => {
    const rec = currentSingleRecord();
    if (!rec) {
      showToast("请先填写有效的开始时间和距离" + ($("shape").value === "imported" && !importedGpx ? "，并导入 GPX 文件" : ""), true);
      return;
    }
    download(new Blob([buildTcx(rec)], { type: "application/xml" }), tcxFilename(rec));
    showToast(`已导出 ${tcxFilename(rec)}`);
  });

  $("btnBatchGen").addEventListener("click", () => {
    const recs = generateBatch();
    if (!recs) return;
    batchRecords = recs;
    renderBatchPreview(recs);
    $("btnExportZip").disabled = false;
    showToast(`已生成 ${recs.length} 条记录`);
  });

  $("btnExportZip").addEventListener("click", () => {
    if (!batchRecords.length) return;
    const files = batchRecords.map(r => ({ name: tcxFilename(r), text: buildTcx(r) }));
    download(makeZip(files), `keep_workouts_${files.length}.zip`);
    showToast(`已导出 ${files.length} 条记录的 ZIP`);
  });

  $("bSeedDice").addEventListener("click", () => {
    $("bSeed").value = Math.floor(Math.random() * 99999);
  });

  // 初始渲染
  renderSegRows(PRESETS.uniform);
  markPaceChip("uniform");
  syncShapeUI();
  renderSinglePreview();
}

document.addEventListener("DOMContentLoaded", init);
