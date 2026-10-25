'use strict';
/* =========================================================
   408 随身背诵 · 单文件版构建脚本
   用法（在 D:\agent\os 下）：node build_standalone.js
   产物：standalone.html —— 把 style.css、app.js、data/*.json 全部内联成一个 HTML，
         双击即开（file:// 也能用），可以直接发微信/QQ 到手机打开，或「添加到主屏幕」。
   原则：
     · 幂等：同样的输入 → 同样的输出（除时间戳外），可以反复执行；
     · 不手改产物：要改内容请改 index.html / style.css / app.js / data/*.json，再重新跑本脚本；
     · 只读源文件，只写 standalone.html。
   ========================================================= */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const OUT = path.join(ROOT, 'standalone.html');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function log(msg) { console.log(msg); }
function fail(msg) { console.error('✗ ' + msg); process.exitCode = 1; }

/* ---------- 1. 读取源文件 ---------- */
const sources = {
  html: read('index.html'),
  css: read('style.css'),
  js: read('app.js'),
  knowledge: JSON.parse(read('data/knowledge.json')),
  chapters: exists('data/chapters.json') ? JSON.parse(read('data/chapters.json')) : null,
  examTrend: (() => {
    try {
      return exists('data/exam_trend.json') ? JSON.parse(read('data/exam_trend.json')) : null;
    } catch (e) {
      log(`⚠️  data/exam_trend.json 读取失败（${e.message}），页面不显示考向徽章`);
      return null;
    }
  })(),
};

/* ---------- 2. 读取数据分片 data/_parts/*.json ---------- */
function loadParts() {
  const dir = path.join(ROOT, 'data', '_parts');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json') && f !== 'index.json');
  const parts = [];
  for (const f of files.sort()) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (json && Array.isArray(json.items)) parts.push({ name: f, items: json.items });
      else log(`⚠️  跳过 data/_parts/${f}：没有 items 数组`);
    } catch (e) {
      log(`⚠️  跳过 data/_parts/${f}：JSON 解析失败（${e.message}）`);
    }
  }
  return parts;
}
const parts = loadParts();

/* ---------- 3. 合并：唯一权威列表 ----------
   规则（与 app.js 运行时完全一致，保证「构建结果 == 线上结果」）：
     · 先放 knowledge.json 的 items，再按文件名顺序叠加 data/_parts/*.json；
     · 按 id 去重；同 id 时 status=final 覆盖 draft，同级则后出现的覆盖先出现的；
     · 冲突（同 id 出现在多个来源）全部记录，构建时打印，方便内容节点自查。
   重要：分片只是「来源」，最终写进 knowledge.items 的必须是合并后的扁平数组，
   这样前端只要认一个 items 就够，不会出现「只读到 14 条」的错觉。 */
const ALL = new Map();      // id -> { item, rank, from }
const CONFLICTS = [];       // { id, from: [..], winner }

function mergeInto(items, sourceName) {
  items.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || !raw.id) {
      log(`⚠️  ${sourceName} 里有缺 id 的条目，已跳过`);
      return;
    }
    const rank = raw.status === 'final' ? 1 : 0;
    const prev = ALL.get(raw.id);
    if (!prev) {
      ALL.set(raw.id, { item: raw, rank, from: sourceName });
      return;
    }
    // 记录冲突来源
    let c = CONFLICTS.find((x) => x.id === raw.id);
    if (!c) {
      c = { id: raw.id, from: [prev.from], winner: prev.from, winnerRank: prev.rank };
      CONFLICTS.push(c);
    }
    if (!c.from.includes(sourceName)) c.from.push(sourceName);
    if (rank >= prev.rank) {
      ALL.set(raw.id, { item: raw, rank, from: sourceName });
      c.winner = sourceName;
      c.winnerRank = rank;
    }
  });
}

mergeInto(sources.knowledge.items || [], 'knowledge.json');
parts.forEach((p) => mergeInto(p.items, `_parts/${p.name}`));

const MERGED_ITEMS = Array.from(ALL.values()).map((r) => r.item);

/* ---------- 3b. 目录：由合并后的 items 按 chapter/section 自动聚合 ---------- */
const CHAPTER_NUM = /第\s*(\d+)\s*章/;
const SECTION_NUM = /^(\d+)\.(\d+)/;
const chapterNum = (n) => {
  const m = CHAPTER_NUM.exec(n || '');
  if (m) return Number(m[1]);
  const d = /^(\d+)/.exec(n || '');
  return d ? Number(d[1]) : 999;
};
const sectionNum = (n) => {
  const m = SECTION_NUM.exec(n || '');
  if (m) return Number(m[1]) * 1000 + Number(m[2]);
  const d = /^(\d+(?:\.\d+)?)/.exec(n || '');
  return d ? Number(d[1]) * 1000 : 999999;
};
const idSeq = (id) => {
  const m = /(\d+)\s*$/.exec(String(id || ''));
  return m ? Number(m[1]) : 9999;
};

function buildChapters(items) {
  const chMap = new Map();
  items.forEach((it) => {
    const chName = it.chapter || '未分类';
    const secName = it.section || '未分节';
    if (!chMap.has(chName)) chMap.set(chName, { chapter: chName, sections: new Map() });
    const ch = chMap.get(chName);
    if (!ch.sections.has(secName)) ch.sections.set(secName, { section: secName, topics: [] });
    ch.sections.get(secName).topics.push({ id: it.id, title: it.title || it.topic || '' });
  });
  return Array.from(chMap.values())
    .sort((a, b) => chapterNum(a.chapter) - chapterNum(b.chapter)
      || String(a.chapter).localeCompare(String(b.chapter), 'zh'))
    .map((ch) => ({
      chapter: ch.chapter,
      sections: Array.from(ch.sections.values())
        .sort((a, b) => sectionNum(a.section) - sectionNum(b.section)
          || String(a.section).localeCompare(String(b.section), 'zh'))
        .map((s) => ({
          section: s.section,
          topics: s.topics.slice().sort((a, b) => idSeq(a.id) - idSeq(b.id)
            || String(a.id).localeCompare(String(b.id))),
        })),
    }));
}

const CHAPTERS = buildChapters(MERGED_ITEMS);

/* ---------- 4. 内联数据块 ----------
   结构：
     knowledge.items —— 合并后的唯一权威列表（前端主要读它）
     chapters        —— 由 items 自动聚合的目录（章 → 节 → 考点）
     examTrend       —— 章节考向与分值（可选，缺失为 null，前端会优雅降级）
     cards           —— 考点卡（可选，缺失为 null，考点卡视图显示空态）
     sources         —— 来源溯源信息（只用于显示，不参与渲染）
   注意：不再把分片挂在并列的 parts 里当数据用，避免"前端只读到 14 条"。 */
const EXAM_TREND = (sources.examTrend && Array.isArray(sources.examTrend.chapters))
  ? sources.examTrend
  : null;

const CARDS = (() => {
  try {
    if (!exists('data/cards.json')) return null;
    const j = JSON.parse(read('data/cards.json'));
    return Array.isArray(j.chapters) ? j : null;
  } catch (e) {
    log(`⚠️  data/cards.json 解析失败，单文件版不带考点卡：${e.message}`);
    return null;
  }
})();

const inlinePayload = {
  builtAt: new Date().toISOString().replace('T', ' ').slice(0, 16),
  builder: 'build_standalone.js',
  knowledge: { items: MERGED_ITEMS },
  chapters: { chapters: CHAPTERS },
  examTrend: EXAM_TREND,
  cards: CARDS,
  sources: {
    base: { file: 'knowledge.json', count: (sources.knowledge.items || []).length },
    parts: parts.map((p) => ({ file: `_parts/${p.name}`, count: p.items.length })),
    merged: MERGED_ITEMS.length,
    conflicts: CONFLICTS.map((c) => ({ id: c.id, from: c.from, winner: c.winner })),
  },
};

function safeJson(obj) {
  // ⚠️ 坑：在 <script type="application/json"> 里，HTML 解析器会先处理字符实体
  //    —— "\/" 会被还原成 "/"，于是数据块里出现真正的 </script>，标签被提前闭合、数据截断。
  //    所以必须把 "<" 转成 JSON 合法的转义 \u003c（解析后仍是 "<"），
  //    同时顺便处理 U+2028/U+2029（旧 JS 引擎的换行陷阱）。
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/* ---------- 5. 组装 HTML ---------- */
let html = sources.html;

// 5.1 内联样式：<link rel="stylesheet" href="style.css"> → <style>
//     注意：index.html 里带了 ?v=xxx 的缓存击穿查询串，正则要容忍它
const cssTag = /<link rel="stylesheet" href="style\.css(?:\?[^"]*)?">/;
if (!cssTag.test(html)) fail('index.html 里找不到 style.css 的 <link>，请检查页面结构是否改动');
html = html.replace(cssTag, () => `<style>\n${sources.css}\n</style>`);

// 5.2 内联脚本：<script src="app.js" defer></script> → 内联（放在数据块之后，DOM 已解析）
const jsTag = /<script src="app\.js(?:\?[^"]*)?" defer><\/script>/;
if (!jsTag.test(html)) fail('index.html 里找不到 app.js 的 <script> 标签');
const inlineDataTag =
  `<!-- ===== 内联数据（由 build_standalone.js 自动生成，请勿手改）===== -->\n` +
  `<script type="application/json" id="inline-data">${safeJson(inlinePayload)}</script>\n` +
  `<!-- ===== 内联逻辑 ===== -->\n` +
  `<script>\n${sources.js}\n</script>`;
html = html.replace(jsTag, () => inlineDataTag);

// 5.3 去掉需要服务器的外链（单文件版里它们没有意义）：
//     manifest 必须是独立文件，无法内联；icon 用 data URI 内联，避免破图请求。
html = html.replace(/\s*<link rel="manifest" href="manifest\.json">\n?/, '\n');
html = html.replace(/\s*<link rel="apple-touch-icon" href="icons\/icon-192\.png">\n?/, '\n');

if (exists('icon.svg')) {
  const svgB64 = Buffer.from(read('icon.svg'), 'utf8').toString('base64');
  html = html.replace(
    /<link rel="icon" type="image\/svg\+xml" href="icon\.svg">/,
    `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,${svgB64}">`
  );
}

// 5.4 标记为单文件版（用于样式/调试区分 + 说明横幅）
html = html.replace('<html lang="zh-CN"', '<html lang="zh-CN" data-standalone="true"');
html = html.replace(
  '<title>408 随身背诵 · 操作系统</title>',
  `<title>408 随身背诵 · 操作系统（单文件版）</title>\n` +
  `  <!-- 单文件版：style.css + app.js + data/*.json 全部内联；双击即可使用，无需服务器 -->`
);

/* ---------- 6. 写出 ---------- */
fs.writeFileSync(OUT, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
log('');
log('✓ 已生成 standalone.html');
log('  ── 数据来源 ──');
log(`  knowledge.json           ${String((sources.knowledge.items || []).length).padStart(4)} 条`);
parts.forEach((p) => log(`  _parts/${p.name.padEnd(16)}  ${String(p.items.length).padStart(4)} 条`));
log(`  ── 合并后（按 id 去重，final 优先）──`);
log(`  知识点总数               ${String(MERGED_ITEMS.length).padStart(4)} 条` +
    `（去重掉 ${(sources.knowledge.items || []).length + parts.reduce((a, p) => a + p.items.length, 0) - MERGED_ITEMS.length} 条重复）`);

// 冲突清单：同 id 出现多次时打印，便于内容节点自查
if (CONFLICTS.length) {
  log(`  ── id 冲突 ${CONFLICTS.length} 处（已按规则取其一）──`);
  CONFLICTS.slice(0, 20).forEach((c) => {
    log(`    ${c.id}: ${c.from.join(' / ')} → 采用 ${c.winner}${c.winnerRank === 1 ? '（final）' : ''}`);
  });
  if (CONFLICTS.length > 20) log(`    … 其余 ${CONFLICTS.length - 20} 处省略`);
}

// 各章条数
log('  ── 各章条数 ──');
CHAPTERS.forEach((ch) => {
  const n = ch.sections.reduce((a, s) => a + s.topics.length, 0);
  log(`  ${ch.chapter.padEnd(14, ' ')} ${String(n).padStart(4)} 条 / ${ch.sections.length} 节`);
});

// 分级统计
const lv = { l1: 0, l2: 0, l3: 0 };
MERGED_ITEMS.forEach((it) => { lv[it.level] = (lv[it.level] || 0) + 1; });
log(`  ── 分级 ──  🔴l1=${lv.l1}  🔵l2=${lv.l2}  ⚪l3=${lv.l3}`);

log(`  内联：style.css ${kb(sources.css.length)} · app.js ${kb(sources.js.length)} · 数据 ${kb(safeJson(inlinePayload).length)}`);
log(`  产物：${OUT}  ${kb(Buffer.byteLength(html))}`);
log('');
log('  用法：双击 standalone.html 即可（file:// 直接打开，不需要服务器）。');
log('  手机：微信/QQ 发送该文件 → 手机打开 → 浏览器菜单「添加到主屏幕」。');
log('  ⚠️ 内容节点更新 data/_parts 后，一定要重新运行：node build_standalone.js');
