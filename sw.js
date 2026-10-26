/* =========================================================
   408 随身背诵 · sw.js（Service Worker）
   策略：
   · 预缓存应用外壳（index/style/app/manifest/图标）
   · data/*.json 走「网络优先，失败回落缓存」——考点更新后刷新即可拿到最新
   · 其余同源 GET 走「缓存优先」
   注意：Service Worker 只在 http(s) 下可用；file:// 打开时不会注册（见 app.js）。
   修改缓存内容请递增 CACHE_VERSION，旧缓存会在 activate 时清理。
   ========================================================= */
'use strict';

const CACHE_VERSION = 'os408-v6';
const CACHE_NAME = `os408-${CACHE_VERSION}`;

// 相对路径：支持部署在子目录（如 http://ip:8000/）
// 说明：data/_parts/*.json 是内容节点的分片，文件名会持续变化，
//       不适合写死在此；它们走 fetch 的「网络优先 + 失败回落缓存」策略。
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './data/knowledge.json',
  './data/chapters.json',
  './data/exam_trend.json',
  './data/cards.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch((err) => {
        // 任一资源 404 时不要卡死安装流程，记录后继续
        console.warn('[sw] 预缓存有资源失败：', err);
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('os408-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// 缓存名以 /data/ 结尾命中
function isDataRequest(url) {
  return /\/data\/.*\.json$/i.test(url.pathname) || /\/manifest\.json$/i.test(url.pathname);
}

// 兜底拦截：任何请求若被服务器返回 HTML（典型：404 页面 / 兜底跳首页），
// 绝不能用 HTML 冒充 JSON 或 JS 交给页面（会导致 JSON.parse 报 "Unexpected token '<'"）。
// 返回真正的网络错误，交给上层 catch 走缓存回落或报错。
const EXPECT = {
  json: /\.json$/i,
  js: /\.m?js$/i,
  css: /\.css$/i,
};
function contentTypeOk(url, res) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  for (const [kind, re] of Object.entries(EXPECT)) {
    if (re.test(url.pathname)) return !ct.includes('text/html');
  }
  return true;
}

function guardedFetch(req, url) {
  return fetch(req).then((res) => {
    if (res && res.ok && !contentTypeOk(url, res)) {
      // 服务器把非资源内容当 HTML 返回：视为失败
      return Promise.reject(new Error('[sw] content-type mismatch: ' + url.pathname));
    }
    return res;
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 零外部依赖：不代理跨域

  // 数据文件：网络优先（拿最新考点），离线回落缓存
  if (isDataRequest(url)) {
    event.respondWith(
      guardedFetch(req, url)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        // 回落顺序：缓存里的同名 JSON → 明确的网络错误（绝不返回 index.html 冒充 JSON）
        .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('[sw] 数据未缓存且网络不可用：' + url.pathname))))
    );
    return;
  }

  // 导航请求：网络优先，离线回退到缓存的 index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 静态资源：**代码类**（html/js/css）走网络优先，避免「按钮在、点了没反应」的旧逻辑问题
  // 其余（图标等）缓存优先，省流量
  const isCode = /\.(?:html|js|css)$/i.test(url.pathname) || url.pathname.endsWith('/');
  if (isCode) {
    event.respondWith(
      guardedFetch(req, url)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('[sw] 离线且未缓存：' + url.pathname))))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return guardedFetch(req, url).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
