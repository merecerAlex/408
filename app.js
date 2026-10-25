/* =========================================================
   408 随身背诵 · app.js
   纯静态前端：只负责「fetch 数据 → 渲染 → 交互」。
   ⚠️ 本文件不包含任何知识点正文（正文只存在于 data/knowledge.json）。
      这里仅有的中文字符串是界面文案（按钮、提示、分级标签名）。
   ========================================================= */
'use strict';

(function () {
  /* ---------------- 常量配置 ---------------- */
  const DATA_URL = 'data/knowledge.json';
  const TREE_URL = 'data/chapters.json';
  const EXAM_TREND_URL = 'data/exam_trend.json';
  const CARDS_URL = 'data/cards.json';
  const APP_VERSION = '0.1.0-mvp';
  const THEME_KEY = 'os408.theme';
  const VIEW_KEY = 'os408.view';
  const PROGRESS_KEY = 'os408.progress.v2';

  // 分级标签：与任务单一致，l1 红 / l2 蓝 / l3 灰
  const LEVELS = {
    l1: { label: '必背原话', short: '必背', icon: '🔴', order: 1 },
    l2: { label: '核心理解', short: '理解', icon: '🔵', order: 2 },
    l3: { label: '拓展了解', short: '拓展', icon: '⚪', order: 3 },
  };

  /* ---------------- 应用状态 ---------------- */
  const state = {
    items: [],          // 全部知识点（来自 knowledge.json）
    byId: new Map(),
    tree: [],           // 目录树（来自 chapters.json）
    query: '',          // 搜索词
    level: 'all',       // 分级筛选：all | l1 | l2 | l3
    view: 'list',       // list | card | cards | mastery
    openPanels: new Set(), // 列表里已展开的章节 key
    openSections: new Set(), // 列表里已展开的节 key（节级折叠）
    openTopics: new Set(), // 列表里已展开答案的考点 id
    deck: [],           // 抽卡池（筛选后的有序列表）
    cardIndex: 0,
    cardSection: 'all', // 抽卡的小节筛选
    flipped: false,
    drawerOpen: false,
    seq: 0,             // 渲染序号，用于丢弃过期的异步渲染
    // —— 考点卡 ——
    cardsData: null,    // data/cards.json 原始数据
    cardsChapter: 'all',
    cardsDoc: 'all',
    openCardSecs: new Set(), // 考点卡里已展开的小节
    cardsCollapsed: new Set(), // 考点卡里被用户收起的章（默认全展开）
    // —— 掌握列表 ——
    masteryChapter: 'all',
    masteryGrade: 'all',
    openMasterySecs: new Set(),
    masteryCollapsed: new Set(), // 掌握列表里被用户收起的章（默认全展开）
    // —— 背诵记忆 ——
    progress: { cards: {} },     // { id: {grade:'known'|'fuzzy'|'unknown', reviews, lastSeen} }
    round: { no: 1, grades: new Map(), stats: { known: 0, fuzzy: 0, unknown: 0 } },
    // —— 章节考向与分值（可选数据，缺失时为 null，界面上什么都不显示）——
    examTrend: null,             // { chapters: [...] } 原始数据
    trendIndex: new Map(),       // '章名' → 章对象；'章名|节名' → 节对象
  };

  /* ---------------- DOM 引用 ---------------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    topbar: $('topbar'),
    menuBtn: $('btn-menu'),
    themeBtn: $('btn-theme'),
    themeIcon: $('theme-icon'),
    brandSub: $('brand-sub'),
    search: $('search'),
    clearBtn: $('btn-clear'),
    levelChips: $('level-chips'),
    viewTabs: document.querySelectorAll('.viewtab'),
    viewList: $('view-list'),
    viewCard: $('view-card'),
    viewCards: $('view-cards'),
    viewMastery: $('view-mastery'),
    skeleton: $('skeleton'),
    error: $('state-error'),
    errorTitle: $('state-error-title'),
    errorMsg: $('state-error-msg'),
    errorHelp: $('state-error-help'),
    retry: $('btn-retry'),
    listMeta: $('list-meta'),
    list: $('list'),
    cardChapter: $('card-chapter'),
    cardSection: $('card-section'),
    cardPos: $('card-pos'),
    cardScope: $('card-scope'),
    flipcard: $('flipcard'),
    cardBadgesFront: $('card-badges-front'),
    cardBadgesBack: $('card-badges-back'),
    cardTitleFront: $('card-title-front'),
    cardKwFront: $('card-kw-front'),
    cardTitleBack: $('card-title-back'),
    cardAnswer: $('card-answer'),
    cardSource: $('card-source'),
    prev: $('btn-prev'),
    next: $('btn-next'),
    flip: $('btn-flip'),
    random: $('btn-random'),
    drawer: $('drawer'),
    drawerBody: $('drawer-body'),
    drawerClose: $('btn-drawer-close'),
    scrim: $('scrim'),
    expandAll: $('btn-expand-all'),
    collapseAll: $('btn-collapse-all'),
    footer: $('footer'),
    live: $('live'),
    // —— 背诵记忆 ——
    drillRound: $('drill-round'),
    drillStat: $('drill-stat'),
    drillRate: $('drill-rate'),
    drillTip: $('drill-tip'),
    settle: $('settle'),
    settleRoundno: $('settle-roundno'),
    settleLine: $('settle-line'),
    settleHint: $('settle-hint'),
    settleAgain: $('btn-settle-again'),
    settleAll: $('btn-settle-all'),
    settleClose: $('btn-settle-close'),
    drawerProgress: $('drawer-progress'),
    exportBtn: $('btn-export'),
    importBtn: $('btn-import'),
    fileImport: $('file-import'),
    // —— 考点卡 ——
    cardsChapter: $('cards-chapter'),
    cardsDoc: $('cards-doc'),
    cardsMeta: $('cards-meta'),
    cardsBody: $('cards-body'),
    // —— 掌握列表 ——
    masteryChapter: $('mastery-chapter'),
    masteryGrade: $('mastery-grade'),
    masterySummary: $('mastery-summary'),
    masteryMeta: $('mastery-meta'),
    masteryBody: $('mastery-body'),
    forgetAll: $('btn-forget-all'),
  };

  /* ---------------- 小工具 ---------------- */
  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 把搜索词按空白切成多个关键词（支持「死锁 PV」多词） */
  function splitQuery(q) {
    return q.trim().split(/\s+/).filter(Boolean);
  }

  /** 文本是否命中所有关键词 */
  function matchesAll(text, terms) {
    return terms.every((t) => text.includes(t));
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /**
   * 安全高亮：先把原文整体转义，再对已转义文本插入 <mark>。
   * 因为关键词也已转义，不会破坏 HTML 结构（无 XSS 风险）。
   */
  function highlight(text, terms) {
    const safe = escapeHtml(text);
    if (!terms.length) return safe;
    const pattern = terms
      .slice()
      .sort((a, b) => b.length - a.length)
      .map((t) => escapeRegExp(escapeHtml(t)))
      .join('|');
    if (!pattern) return safe;
    return safe.replace(new RegExp(`(${pattern})`, 'gi'), '<mark class="hl">$1</mark>');
  }

  /**
   * 把答案文本转成安全的 HTML：
   *   · 先 escapeHtml，保证没有任何注入风险；
   *   · 再把 **重点** 转成 <strong>（内容节点用这套轻量标记强调关键词）；
   *   · 换行交给 CSS 的 white-space: pre-wrap，不额外处理。
   * 未闭合的 ** 原样保留，不吞字。
   */
  function richText(text) {
    let s = escapeHtml(normalize(text));
    // 成对的 **重点** → <strong>
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // 源数据里偶有未成对的 **（如「创建 PCB**；」）→ 直接去掉，避免页面上出现裸星号
    s = s.replace(/\*\*/g, '');
    return s;
  }

  function levelInfo(level) {
    return LEVELS[level] || { label: '未分级', short: '?', icon: '·', order: 9 };
  }

  function levelBadge(level, opts) {
    const info = levelInfo(level);
    const text = opts && opts.short ? info.short : info.label;
    return `<span class="lvl lvl--${escapeHtml(level)}">${info.icon} ${escapeHtml(text)}</span>`;
  }

  function announce(msg) {
    el.live.textContent = '';
    // 稍后再写，保证读屏器重复播报同样的文字
    window.setTimeout(() => { el.live.textContent = msg; }, 30);
  }

  function normalize(s) {
    return String(s == null ? '' : s);
  }

  /* ---------------- 数据加载 ---------------- */
  /**
   * 读取「内联数据块」：
   *   <script type="application/json" id="inline-data"> 里放 { knowledge:{items:[…]}, chapters:{…}, theme? }
   *   —— 这是 standalone.html（单文件版）用的机制：数据、样式、脚本全在一个 HTML 里，
   *   双击即开、发微信/QQ 给手机也能用，不需要服务器。
   *   普通版本（index.html）没有这个块，返回 null，自动回落到 fetch。
   */
  function readInlineData() {
    const node = document.getElementById('inline-data');
    if (!node) return null;
    const raw = node.textContent || '';
    if (!raw.trim()) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      const err = new Error('standalone.html 内联数据块损坏：' + e.message);
      err.kind = 'json';
      err.url = 'index.html#inline-data';
      throw err;
    }
  }

  /** 是否有内联数据（决定后续是否需要 fetch 分片/目录） */
  let hasInline = false;

  /**
   * fetch JSON，并把「为什么失败」翻译成人话。
   * 注意：不吞错误——真实原因会原样抛给 showError() 展示。
   * cache: 'no-store' —— 必须绕开 HTTP 缓存：
   *   内容节点新增分片时，旧的 404 响应若被缓存住，浏览器就不会再去取，
   *   结果「分片少加载一半」而且极难排查。
   */
  async function fetchJson(url, opts) {
    const options = opts || {};
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404 && options.optional) return null; // 可选数据源缺失是正常情况
    if (!res.ok) {
      const err = new Error(`${url} → HTTP ${res.status} ${res.statusText || ''}`.trim());
      err.kind = 'http';
      err.code = res.status;
      err.url = url;
      throw err;
    }
    try {
      return await res.json();
    } catch (e) {
      const err = new Error(`${url} → JSON 解析失败：${e.message}`);
      err.kind = 'json';
      err.url = url;
      throw err;
    }
  }

  /**
   * 多数据源合并：
   *   1. data/knowledge.json 的 items（基线，必需）
   *   2. data/_parts/*.json 的 items（内容节点的分片，可选，缺失不报错）
   *      · 首选 data/_parts/index.json（{"parts":["ch3_3_1.json", ...]}）—— 最可靠
   *      · 没有 index.json 时，按下面的候选名逐个尝试（404 静默忽略）
   *   合并规则：按 id 去重；同 id 时 status=final 覆盖 draft；同级时后加载的（分片）覆盖先加载的。
   * 这样内容节点往 _parts 里丢一个新文件，主人刷新页面就能看到，不需要改任何代码。
   *
   * ⚠️ 兜底候选必须覆盖实际用到的命名（ch3_3_1.json 这种带下划线的也常见）。
   *    候选清单只是「无 index 时」的降级方案；正式做法是在 _parts 下放一个 index.json。
   */
  const PART_URLS = [
    // 无 index 时的兜底猜测（多层命名都试一遍，404 会被静默忽略）
    'data/_parts/ch1ch2.json',
    'data/_parts/ch1.json', 'data/_parts/ch2.json', 'data/_parts/ch3.json',
    'data/_parts/ch4.json', 'data/_parts/ch5.json', 'data/_parts/ch6.json',
    'data/_parts/ch7.json', 'data/_parts/ch8.json', 'data/_parts/ch9.json',
    'data/_parts/ch1_2.json', 'data/_parts/ch3_1.json', 'data/_parts/ch3_2.json',
    'data/_parts/ch3_3.json', 'data/_parts/ch3_3_1.json', 'data/_parts/ch3_3_2.json',
    'data/_parts/ch4_1.json', 'data/_parts/ch4_2.json', 'data/_parts/ch4_3.json', 'data/_parts/ch4_4.json',
    'data/_parts/ch5_1.json', 'data/_parts/ch5_2.json', 'data/_parts/ch5_3.json',
  ];

  async function loadPartIndex() {
    // 先看 index.json 是否给了清单
    let manifest = null;
    try {
      manifest = await fetchJson('data/_parts/index.json', { optional: true });
    } catch (e) { manifest = null; }
    if (manifest && Array.isArray(manifest.parts) && manifest.parts.length) {
      return manifest.parts.map((p) => 'data/_parts/' + String(p).replace(/^.*[\\/]/, ''));
    }
    return null;
  }

  async function loadParts() {
    const urls = (await loadPartIndex()) || PART_URLS;
    const results = await Promise.all(urls.map(async (u) => {
      try {
        const json = await fetchJson(u, { optional: true });
        return { url: u, json };
      } catch (e) {
        // 分片坏掉不应让整页崩掉：记录后继续
        console.warn('[408] 分片读取失败，已跳过：', u, e.message);
        return { url: u, json: null, error: e.message };
      }
    }));
    return results.filter((r) => r.json && Array.isArray(r.json.items));
  }

  /** 把一条原始数据规范化为内部结构（缺字段不崩） */
  function normalizeItem(raw) {
    // 兼容简写层级：chapter 缺失时可从 id 里兜底（os-ch3-3.2-001）
    const idMatch = /\bch(\d)\b/i.exec(normalize(raw.id));
    const chapter = normalize(raw.chapter) || (idMatch ? `第${idMatch[1]}章` : '未分类');
    return {
      id: normalize(raw.id),
      chapter,
      section: normalize(raw.section),
      topic: normalize(raw.topic || raw.title),
      level: LEVELS[raw.level] ? raw.level : 'l3',
      title: normalize(raw.title || raw.topic),
      answer: normalize(raw.answer),
      keywords: Array.isArray(raw.keywords) ? raw.keywords.map(normalize).filter(Boolean) : [],
      source: normalize(raw.source),
      status: normalize(raw.status),
      fromPart: normalize(raw.__fromPart),
    };
  }

  /** 合并：final 优先，同级后者覆盖前者 */
  function mergeItems(baseItems, partItems) {
    const map = new Map();
    const put = (item, rank) => {
      const prev = map.get(item.id);
      if (!prev) { map.set(item.id, { item, rank }); return; }
      if (rank >= prev.rank) map.set(item.id, { item, rank });
    };
    baseItems.forEach((raw) => put(normalizeItem(raw), raw.status === 'final' ? 1 : 0));
    partItems.forEach((raw) => put(normalizeItem(raw), raw.status === 'final' ? 1 : 0));
    return Array.from(map.values()).map((r) => r.item);
  }

  /* ---------------- 目录树：按 items 自动聚合 ---------------- */
  const CHAPTER_NUM = /第\s*(\d+)\s*章/;
  const SECTION_NUM = /^(\d+)\.(\d+)/;

  function chapterNumber(name) {
    const m = CHAPTER_NUM.exec(name || '');
    if (m) return Number(m[1]);
    const d = /^(\d+)/.exec(name || '');
    return d ? Number(d[1]) : 999;
  }

  function sectionNumber(name) {
    const m = SECTION_NUM.exec(name || '');
    if (m) return Number(m[1]) * 1000 + Number(m[2]);
    const d = /^(\d+(?:\.\d+)?)/.exec(name || '');
    return d ? Number(d[1]) * 1000 : 999999;
  }

  /**
   * 由知识点自身的 chapter / section / id 自动生成「章 → 节 → 考点」目录树。
   * 不再手工维护 chapters.json，避免内容节点新增考点后目录漏项。
   * 排序：章按「第N章」数字，节按「x.y」数字，考点按 id 结尾数字。
   */
  function buildTree(items) {
    const chapters = new Map();
    for (const it of items) {
      const chKey = it.chapter || '未分类';
      if (!chapters.has(chKey)) chapters.set(chKey, { chapter: chKey, sections: new Map() });
      const ch = chapters.get(chKey);
      const secKey = it.section || '未分节';
      if (!ch.sections.has(secKey)) ch.sections.set(secKey, { section: secKey, topicIds: [] });
      ch.sections.get(secKey).topicIds.push(it.id);
    }
    const seqOf = (id) => {
      const m = /(\d+)\s*$/.exec(id || '');
      return m ? Number(m[1]) : 9999;
    };
    return Array.from(chapters.values())
      .map((ch) => ({
        chapter: ch.chapter,
        sections: Array.from(ch.sections.values())
          .map((s) => ({
            section: s.section,
            topicIds: s.topicIds.slice().sort((a, b) => seqOf(a) - seqOf(b) || String(a).localeCompare(String(b))),
          }))
          .sort((a, b) => sectionNumber(a.section) - sectionNumber(b.section)
            || String(a.section).localeCompare(String(b.section), 'zh')),
        chapterNum: chapterNumber(ch.chapter),
      }))
      .sort((a, b) => a.chapterNum - b.chapterNum
        || String(a.chapter).localeCompare(String(b.chapter), 'zh'))
      .map((c) => ({ chapter: c.chapter, sections: c.sections }));
  }

  /* ---------------- 章节考向与分值（可选数据） ----------------
     data/exam_trend.json 结构（由知识点节点产出）：
       { chapters: [ { chapter, weight, scoreRange, years, focus[], confidence,
                       sections: [ { section, weight, scoreRange, years, focus[], typical, evidence[] } ] } ] }
     说明：weight / scoreRange 都是**区间估计**，不是官方精确分值。
     界面只展示区间文案，并在 title 里注明来源与性质，避免误导。
     数据缺失时 indexExamTrend 返回空 Map，trendBadge 返回空字符串 → 界面无任何痕迹、不报错。
  ------------------------------------------------------------ */
  function indexExamTrend(trend) {
    const idx = new Map();
    if (!trend || !Array.isArray(trend.chapters)) return idx;
    trend.chapters.forEach((ch) => {
      if (!ch || !ch.chapter) return;
      const name = normalize(ch.chapter).trim();
      if (!name) return;
      idx.set(name, ch);
      (ch.sections || []).forEach((sec) => {
        if (!sec || !sec.section) return;
        idx.set(name + '|' + normalize(sec.section).trim(), sec);
      });
    });
    return idx;
  }

  /** 取某章 / 某节的考向信息：节级优先，没有则回落章级 */
  function trendOf(chapter, section) {
    const idx = state.trendIndex;
    if (!idx || !idx.size) return null;
    const chName = normalize(chapter).trim();
    const secName = normalize(section).trim();
    if (secName) {
      const sec = idx.get(chName + '|' + secName);
      if (sec && (sec.weight || sec.scoreRange)) return sec;
    }
    const ch = idx.get(chName);
    return ch && (ch.weight || ch.scoreRange) ? ch : null;
  }

  /** 频率 → 视觉档位（只用于上色，不改文案） */
  function trendTone(weight) {
    const w = normalize(weight);
    if (w.indexOf('高') >= 0) return 'high';
    if (w.indexOf('中') >= 0) return 'mid';
    if (w.indexOf('低') >= 0) return 'low';
    return 'default';
  }

  /**
   * 把冗长的 scoreRange 压成手机上放得下的一句话。
   * 例：「选择题 2 分 × 4~6 + 综合题 8~16 分（合计约 16~28 分）」
   *   → 「选择题 2分×4~6 + 综合题 8~16分」
   * 原则：只删修饰与括号说明，不改变数值与区间表达，绝不制造"精确分值"的错觉。
   */
  function shortScore(score) {
    let s = normalize(score);
    // 去掉括号内的补充说明（如「（合计约 16~28 分）」「（约 0~4 分）」）
    s = s.replace(/[（(][^）)]*[）)]/g, '');
    // 去掉「；通常不单独出综合题」这类定性尾巴
    s = s.replace(/[；;].*$/, '');
    // 压缩空格：2 分 × 4~6 → 2分×4~6
    s = s.replace(/\s*([分×~])\s*/g, '$1').replace(/\s*\+\s*/g, ' + ');
    return s.trim();
  }

  /**
   * 渲染考向徽章。没有数据 → 返回空字符串（不占位、不报错）。
   * 文案示例：🔥 高频 · 选择题 2 分 × 4~6 + 综合题 8~16 分
   * title：把 years / focus / 依据一并给出，并明确"区间估计"。
   */
  function trendBadge(chapter, section, opts) {
    const t = trendOf(chapter, section);
    if (!t) return '';
    const options = opts || {};
    const weight = normalize(t.weight).trim();
    const score = normalize(t.scoreRange).trim();
    const tone = trendTone(weight);

    const tip = [
      `考向区间估计，非官方分值（来源：data/exam_trend.json）`,
      weight ? `频率：${weight}` : '',
      score ? `分值：${score}` : '',
      t.years ? `历年：${normalize(t.years)}` : '',
      (t.focus && t.focus.length) ? `重点：${t.focus.join('、')}` : '',
      t.confidence ? `依据：${normalize(t.confidence)}` : '',
    ].filter(Boolean).join('\n');

    const parts = [];
    if (weight) parts.push(`<span class="trend__w">🔥 ${escapeHtml(weight)}</span>`);
    if (score) {
      if (options.compact) {
        // 紧凑版（卡片 / 抽屉）：只取「选择题 N 分 × a~b」这种主结构，
        // 完整分值说明放在 title 里，避免手机上被截断成一堆省略号
        const brief = shortScore(score);
        parts.push(`<span class="trend__s">${escapeHtml(brief)}</span>`);
      } else {
        parts.push(`<span class="trend__s">${escapeHtml(score)}</span>`);
      }
    }

    const cls = `trend trend--${tone}${options.compact ? ' trend--compact' : ''}`;
    return `<span class="${cls}" title="${escapeHtml(tip)}" role="note" aria-label="${escapeHtml(
      [weight, score].filter(Boolean).join('，') + '（区间估计）'
    )}">${parts.join('<span class="trend__dot" aria-hidden="true">·</span>')}</span>`;
  }

  async function loadData(report) {
    el.error.hidden = true;
    el.skeleton.hidden = false;

    // 0) 单文件版（standalone.html）：数据已内联，优先使用，完全不需要 fetch
    const inline = readInlineData();
    hasInline = !!inline;

    let knowledge;
    let parts = [];
    let chapters = null;

    if (inline) {
      knowledge = inline.knowledge || { items: [] };
      if (!Array.isArray(knowledge.items)) {
        const err = new Error('内联数据里没有 knowledge.items 数组');
        err.kind = 'shape';
        throw err;
      }
      chapters = inline.chapters || null;
      // 单文件版可以再带上「打包时的分片」，逻辑与在线版一致
      if (Array.isArray(inline.parts)) {
        parts = inline.parts
          .filter((p) => p && Array.isArray(p.items))
          .map((p) => ({ url: 'inline:' + (p.name || 'part'), json: p }));
      }
    } else {
      // 1) 基线数据（必需）
      knowledge = await fetchJson(DATA_URL);
      if (!knowledge || !Array.isArray(knowledge.items)) {
        const err = new Error(`${DATA_URL} 里没有 items 数组（JSON 结构不对）`);
        err.kind = 'shape';
        throw err;
      }
      // 2) 分片数据（可选）
      parts = await loadParts();
      // 3) 目录（可选，缺失则由数据自动聚合）
      try {
        chapters = await fetchJson(TREE_URL, { optional: true });
      } catch (e) { chapters = null; }
    }

    const partItems = [];
    parts.forEach((p) => {
      p.json.items.forEach((raw) => {
        if (!raw || typeof raw !== 'object' || !raw.id) return;
        partItems.push(Object.assign({}, raw, { __fromPart: p.url.replace('data/_parts/', '') }));
      });
    });

    const items = mergeItems(knowledge.items, partItems);

    const autoTree = buildTree(items);
    let tree = autoTree;
    if (chapters && Array.isArray(chapters.chapters) && chapters.chapters.length) {
      const explicit = chapters.chapters
        .map((c) => ({
          chapter: normalize(c.chapter),
          sections: (c.sections || []).map((s) => ({
            section: normalize(s.section),
            topicIds: (s.topics || []).map((t) => normalize(t.id)),
          })),
        }))
        .filter((c) => c.chapter);
      // chapters.json 里漏掉的考点也会被补到自动树的对应章节，保证目录 100% 反映数据
      tree = mergeTrees(explicit, autoTree);
    }

    state.items = items;
    state.byId = new Map(items.map((it) => [it.id, it]));
    state.tree = tree;

    // —— 章节考向与分值（可选）：有就显示徽章，没有就安静地什么都不做 ——
    let examTrend = null;
    try {
      if (inline) {
        examTrend = inline.examTrend || null;
      } else {
        examTrend = await fetchJson(EXAM_TREND_URL, { optional: true });
      }
    } catch (e) {
      // 考向数据坏掉绝不能影响主流程
      console.warn('[408] 考向数据读取失败，已忽略：', e && e.message);
      examTrend = null;
    }
    state.examTrend = (examTrend && Array.isArray(examTrend.chapters)) ? examTrend : null;
    state.trendIndex = indexExamTrend(state.examTrend);

    state.sourceInfo = {
      base: knowledge.items.length,
      parts: parts.map((p) => ({ url: p.url.replace('data/_parts/', ''), n: p.json.items.length })),
      partsTotal: partItems.length,
      merged: items.length,
      tree: chapters && Array.isArray(chapters.chapters)
        ? 'chapters.json + 自动补齐'
        : '自动生成',
      mode: inline ? 'standalone（单文件内联）' : 'fetch（本地服务器）',
      builtAt: inline ? normalize(inline.builtAt) : '',
      trend: state.examTrend ? '已加载' : '无',
      partErrors: parts.filter((p) => p.error).map((p) => p.url),
    };
    if (report) report(state.sourceInfo);

    // 4) 渲染
    el.skeleton.hidden = true;
    el.error.hidden = true;
    // 成功路径必须把错误块彻底藏起来（并且此后不允许它自己冒出来）
    el.error.setAttribute('hidden', '');
    el.error.style.display = 'none';
    renderBrandSub();
    renderChapterSelect();
    // 考点卡数据（可选）：失败不影响主流程，只是「考点卡」页空着
    try {
      await loadCardsData();
      renderCardsDocSelect();
    } catch (e) { /* 忽略 */ }
    renderDrawer();
    applyFilters({ keepCard: false });
    renderFooter();
  }

  /** 合并显式目录与自动目录：显式顺序优先，缺的考点按章节补进去 */
  function mergeTrees(explicit, auto) {
    const listed = new Set();
    explicit.forEach((c) => c.sections.forEach((s) => s.topicIds.forEach((id) => listed.add(id))));

    const out = explicit.map((c) => ({
      chapter: c.chapter,
      sections: c.sections.map((s) => ({ section: s.section, topicIds: s.topicIds.slice() })),
    }));
    const chMap = new Map(out.map((c) => [c.chapter, c]));

    auto.forEach((ac) => {
      ac.sections.forEach((as) => {
        const missing = as.topicIds.filter((id) => !listed.has(id));
        if (!missing.length) return;
        missing.forEach((id) => listed.add(id));
        let target = chMap.get(ac.chapter);
        if (!target) {
          target = { chapter: ac.chapter, sections: [] };
          out.push(target);
          chMap.set(ac.chapter, target);
        }
        const sec = target.sections.find((s) => s.section === as.section);
        if (sec) sec.topicIds = sec.topicIds.concat(missing);
        else target.sections.push({ section: as.section, topicIds: missing.slice() });
      });
    });

    // ⚠️ 显式目录里的顺序不一定符合教材（chapters.json 只覆盖部分章时会乱序），
    //    这里统一按「第N章」的编号重排；编号相同再按名称。节也按「x.y」重排。
    out.forEach((c) => {
      c.sections.sort((a, b) => sectionNumber(a.section) - sectionNumber(b.section)
        || String(a.section).localeCompare(String(b.section), 'zh'));
    });
    out.sort((a, b) => chapterNumber(a.chapter) - chapterNumber(b.chapter)
      || String(a.chapter).localeCompare(String(b.chapter), 'zh'));
    return out;
  }

  /* ---------------- 品牌副标题 / 页脚 ---------------- */
  function renderBrandSub() {
    const total = state.items.length;
    const c = countByLevel();
    el.brandSub.textContent = `${total} 个考点 · 🔴${c.l1} 🔵${c.l2} ⚪${c.l3}`;
  }

  function countByLevel() {
    const c = { l1: 0, l2: 0, l3: 0 };
    state.items.forEach((it) => { c[it.level] = (c[it.level] || 0) + 1; });
    return c;
  }

  function renderFooter() {
    const src = new Set(state.items.map((it) => it.source).filter(Boolean));
    const draft = state.items.filter((it) => it.status === 'draft').length;
    const info = state.sourceInfo || {};
    const partsTxt = info.parts && info.parts.length
      ? ` + 分片 ${info.parts.length} 个（${info.parts.map((p) => p.url + ':' + p.n).join('、')}）`
      : '';
    const modeTxt = info.mode === 'standalone（单文件内联）'
      ? '单文件版（数据已内联，离线可用）'
      : `来源：knowledge.json${partsTxt}`;
    el.footer.textContent =
      `数据 ${state.items.length} 条（${draft} 条草稿）· ${modeTxt} · 目录${info.tree || '自动生成'} · v${APP_VERSION}` +
      (info.builtAt ? ` · 打包于 ${info.builtAt}` : '');
    el.footer.title = [...src].join('\n');
  }

  /* =========================================================
     考点卡视图（data/cards.json）
     ─ 章 → 卡片（一份 md）→ 小节（h2），全部内联渲染，不跳页
     ─ 小节可折叠；默认全部收起，点开才渲染正文（长文档首屏才不卡）
     ========================================================= */

  async function loadCardsData() {
    if (state.cardsData) return state.cardsData;
    try {
      // 单文件版（standalone.html）：数据已内联，走 inline-data.cards
      const inline = readInlineData();
      if (inline && inline.cards) {
        state.cardsData = inline.cards;
        return state.cardsData;
      }
      const json = await fetchJson(CARDS_URL, { optional: true });
      state.cardsData = json && Array.isArray(json.chapters) ? json : { chapters: [] };
    } catch (e) {
      state.cardsData = { chapters: [] };
    }
    return state.cardsData;
  }

  function renderCardsDocSelect() {
    if (!el.cardsDoc) return;
    const data = state.cardsData || { chapters: [] };
    const chName = el.cardsChapter.value || 'all';
    const chapters = chName === 'all' ? data.chapters : data.chapters.filter((c) => c.chapter === chName);
    const frag = document.createDocumentFragment();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部卡片';
    frag.appendChild(all);
    for (const ch of chapters) {
      for (const d of ch.docs || []) {
        const o = document.createElement('option');
        o.value = `${ch.chapter}|${d.title}`;
        o.textContent = `${d.title}（${d.sections.length} 节）`;
        frag.appendChild(o);
      }
    }
    el.cardsDoc.replaceChildren(frag);
    const keep = state.cardsDoc;
    const exists = [...el.cardsDoc.options].some((o) => o.value === keep);
    el.cardsDoc.value = exists ? keep : 'all';
    state.cardsDoc = el.cardsDoc.value;
  }

  function renderCards() {
    if (!el.cardsBody) return;
    const data = state.cardsData;
    if (!data) {
      el.cardsBody.innerHTML = '<p class="empty__hint">考点卡加载中…</p>';
      loadCardsData().then(() => {
        renderCardsDocSelect();
        renderCards();
      });
      return;
    }
    const chapters = data.chapters || [];
    if (!chapters.length) {
      el.cardsBody.innerHTML = '<p class="empty__hint">还没有考点卡数据。跑一下 tools/build-cards-json.mjs 再刷新。</p>';
      if (el.cardsMeta) el.cardsMeta.textContent = '';
      return;
    }

    const chFilter = el.cardsChapter ? (el.cardsChapter.value || 'all') : 'all';
    const docFilter = el.cardsDoc ? (el.cardsDoc.value || 'all') : 'all';

    const frag = document.createDocumentFragment();
    let secCount = 0;
    let docCount = 0;

    for (const ch of chapters) {
      if (chFilter !== 'all' && ch.chapter !== chFilter) continue;
      const docs = (ch.docs || []).filter((d) => docFilter === 'all' || `${ch.chapter}|${d.title}` === docFilter);
      if (!docs.length) continue;

      const panel = document.createElement('section');
      panel.className = 'panel';

      const total = docs.reduce((a, d) => a + d.sections.length, 0);
      const pKey = 'cards:' + ch.chapter;
      // 考点卡是「读」的视图：章默认展开（用户主动收起才记住）
      const expanded = !state.cardsCollapsed.has(pKey);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel__toggle';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML =
        `<span class="panel__caret" aria-hidden="true">▶</span>` +
        `<span class="panel__name"></span>` +
        `<span class="panel__count">${total}</span>`;
      toggle.querySelector('.panel__name').textContent = ch.chapter;

      const itemsBox = document.createElement('div');
      itemsBox.className = 'panel__items';
      itemsBox.hidden = !expanded;

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        itemsBox.hidden = open;
        if (open) state.cardsCollapsed.add(pKey); else state.cardsCollapsed.delete(pKey);
      });

      for (const d of docs) {
        docCount += 1;
        const docHead = document.createElement('div');
        docHead.className = 'carddoc__title';
        docHead.textContent = d.title;
        itemsBox.appendChild(docHead);

        for (const s of d.sections) {
          secCount += 1;
          const sKey = `cards:${ch.chapter}|${d.title}|${s.id}`;
          const sOpen = state.openCardSecs.has(sKey);

          const box = document.createElement('div');
          box.className = 'cardsec';

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cardsec__toggle';
          btn.setAttribute('aria-expanded', String(sOpen));
          btn.innerHTML =
            `<span class="sec__caret" aria-hidden="true">▶</span>` +
            `<span class="cardsec__name"></span>`;
          btn.querySelector('.cardsec__name').textContent = s.section;

          const body = document.createElement('div');
          body.className = 'cardsec__body';
          body.hidden = !sOpen;
          if (sOpen) body.innerHTML = s.html;
          btn.addEventListener('click', () => {
            const open = btn.getAttribute('aria-expanded') === 'true';
            btn.setAttribute('aria-expanded', String(!open));
            body.hidden = open;
            if (open) {
              state.openCardSecs.delete(sKey);
            } else {
              state.openCardSecs.add(sKey);
              // 懒渲染：第一次展开才把 html 塞进去
              if (!body.innerHTML) body.innerHTML = s.html;
            }
          });

          box.appendChild(btn);
          box.appendChild(body);
          itemsBox.appendChild(box);
        }
      }

      panel.appendChild(toggle);
      panel.appendChild(itemsBox);
      frag.appendChild(panel);
    }

    el.cardsBody.replaceChildren(frag);
    if (el.cardsMeta) {
      el.cardsMeta.textContent = docCount
        ? `共 ${docCount} 张卡 · ${secCount} 个小节 · 点小节标题展开`
        : '这个范围里没有考点卡';
    }
  }

  /* =========================================================
     掌握列表视图
     ─ 分章 → 分节统计「已会/模糊/忘了/未测」
     ─ 可按章、按节一键遗忘（二刷）；也可全部遗忘
     ========================================================= */

  const GRADE_LABEL = { known: '✅ 会了', fuzzy: '🤔 模糊', unknown: '❌ 忘了', '': '⚪ 未测' };

  /** 一个 id 集合的掌握统计 */
  function statsOf(ids) {
    let known = 0, fuzzy = 0, unknown = 0, untested = 0;
    for (const id of ids) {
      const g = gradeOf(id);
      if (g === 'known') known += 1;
      else if (g === 'fuzzy') fuzzy += 1;
      else if (g === 'unknown') unknown += 1;
      else untested += 1;
    }
    const total = ids.length;
    return { total, known, fuzzy, unknown, untested, pct: total ? Math.round((known / total) * 100) : 0 };
  }

  /** 遗忘一个 id 集合：清掉它们的自评记录，回到未测 */
  function forgetIds(ids, label) {
    if (!ids.length) return;
    const real = ids.filter((id) => state.progress.cards[id]);
    if (!real.length) {
      announce(`${label}：没有可遗忘的记录`);
      return;
    }
    if (!window.confirm(`确定把「${label}」的 ${real.length} 条自评记录清空吗？\n清空后这些考点会回到「未测」，可以重新二刷。`)) return;
    real.forEach((id) => { delete state.progress.cards[id]; });
    saveProgress();
    // 若当前正在抽卡，本轮已评过的记录也一并失效
    real.forEach((id) => state.round.grades.delete(id));
    refreshMasteryBadges();
    renderDrawerProgress();
    renderMastery();
    applyFilters({ keepCard: true });
    announce(`已遗忘 ${real.length} 条：${label}`);
  }

  function renderMastery() {
    if (!el.masteryBody) return;
    const chFilter = el.masteryChapter ? (el.masteryChapter.value || 'all') : 'all';
    const gradeFilter = el.masteryGrade ? (el.masteryGrade.value || 'all') : 'all';

    // 全书统计
    const allIds = state.items.map((it) => it.id);
    const allStats = statsOf(allIds);
    if (el.masterySummary) {
      el.masterySummary.innerHTML =
        `<div class="msum__head"><span class="msum__pct">${allStats.pct}%</span>` +
        `<span class="msum__label">全书掌握度</span></div>` +
        `<div class="msum__bar"><i style="width:${allStats.pct}%"></i></div>` +
        `<div class="msum__nums">✅ ${allStats.known} · 🤔 ${allStats.fuzzy} · ❌ ${allStats.unknown} · ⚪ ${allStats.untested} · 共 ${allStats.total}</div>`;
    }

    const matchGrade = (id) => {
      if (gradeFilter === 'all') return true;
      const g = gradeOf(id) || '';
      if (gradeFilter === 'untested') return g === '';
      return g === gradeFilter;
    };

    const frag = document.createDocumentFragment();
    let shownSecs = 0;
    let shownIds = 0;

    for (const ch of state.tree) {
      if (chFilter !== 'all' && ch.chapter !== chFilter) continue;

      const chIds = [];
      ch.sections.forEach((sec) => sec.topicIds.forEach((id) => { if (state.byId.has(id)) chIds.push(id); }));
      const chStats = statsOf(chIds);

      // 章下面每节的命中集合
      const secs = ch.sections
        .map((sec) => {
          const ids = sec.topicIds.filter((id) => state.byId.has(id));
          const hit = ids.filter(matchGrade);
          return { section: sec.section, ids, hit };
        })
        .filter((s) => s.hit.length > 0);
      if (!secs.length) continue;

      const panel = document.createElement('section');
      panel.className = 'panel';

      const pKey = 'mastery:' + ch.chapter;
      const expanded = chFilter !== 'all' || state.openPanels.has(pKey);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel__toggle';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML =
        `<span class="panel__caret" aria-hidden="true">▶</span>` +
        `<span class="panel__name"></span>` +
        `<span class="panel__pct">${chStats.pct}%</span>` +
        `<span class="panel__count">${chStats.known}/${chStats.total}</span>`;
      toggle.querySelector('.panel__name').textContent = ch.chapter;

      const itemsBox = document.createElement('div');
      itemsBox.className = 'panel__items';
      itemsBox.hidden = !expanded;

      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        itemsBox.hidden = open;
        if (open) state.openPanels.delete(pKey); else state.openPanels.add(pKey);
      });

      // 章级遗忘按钮
      const chBar = document.createElement('div');
      chBar.className = 'mbar';
      const chForget = document.createElement('button');
      chForget.type = 'button';
      chForget.className = 'btn btn--ghost btn--sm';
      chForget.textContent = '🔁 本章遗忘二刷';
      chForget.addEventListener('click', () => forgetIds(chIds, ch.chapter));
      chBar.appendChild(chForget);
      itemsBox.appendChild(chBar);

      for (const s of secs) {
        shownSecs += 1;
        shownIds += s.hit.length;
        const sKey = secKey(ch.chapter, s.section);
        const sOpen = chFilter !== 'all' || state.openMasterySecs.has(sKey);
        const st = statsOf(s.ids);

        const box = document.createElement('div');
        box.className = 'sec';

        const head = document.createElement('div');
        head.className = 'sec__row';

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'sec__label sec__label--m';
        label.setAttribute('aria-expanded', String(sOpen));
        label.innerHTML =
          `<span class="sec__caret" aria-hidden="true">▶</span>` +
          `<span class="sec__name"></span>` +
          `<span class="sec__count">${st.known}/${st.total}</span>`;
        label.querySelector('.sec__name').textContent = s.section;

        const secForget = document.createElement('button');
        secForget.type = 'button';
        secForget.className = 'sec__forget';
        secForget.title = '遗忘本节，二刷';
        secForget.textContent = '🔁';
        secForget.addEventListener('click', () => forgetIds(s.ids, s.section));

        const secItems = document.createElement('div');
        secItems.className = 'sec__items';
        secItems.hidden = !sOpen;

        label.addEventListener('click', () => {
          const open = label.getAttribute('aria-expanded') === 'true';
          label.setAttribute('aria-expanded', String(!open));
          secItems.hidden = open;
          if (open) state.openMasterySecs.delete(sKey); else state.openMasterySecs.add(sKey);
        });

        s.hit.forEach((id) => {
          const it = state.byId.get(id);
          if (!it) return;
          const row = document.createElement('div');
          row.className = 'mrow';
          const g = gradeOf(id) || '';
          row.innerHTML =
            `<span class="mrow__g" data-grade="${g}">${GRADE_LABEL[g]}</span>` +
            `<span class="mrow__t"></span>` +
            `<button type="button" class="mrow__forget" title="遗忘这一条">🔁</button>`;
          row.querySelector('.mrow__t').textContent = it.title;
          row.querySelector('.mrow__forget').addEventListener('click', () => forgetIds([id], it.title));
          secItems.appendChild(row);
        });

        head.appendChild(label);
        head.appendChild(secForget);
        box.appendChild(head);
        box.appendChild(secItems);
        itemsBox.appendChild(box);
      }

      panel.appendChild(toggle);
      panel.appendChild(itemsBox);
      frag.appendChild(panel);
    }

    el.masteryBody.replaceChildren(frag);
    if (el.masteryMeta) {
      el.masteryMeta.textContent = shownSecs
        ? `列出 ${shownSecs} 节 · ${shownIds} 个考点 · 点小节展开逐条遗忘`
        : '这个范围里没有符合条件的考点';
    }
  }

  /* ---------------- 筛选（搜索 + 分级） ---------------- */
  /**
   * 返回在「搜索词」下命中的条目，以及命中的字段集合。
   * 命中字段：title / topic / section / chapter / keywords / answer
   */
  function searchItems(terms) {
    if (!terms.length) return state.items.map((it) => ({ it, fields: new Set() }));
    const out = [];
    for (const it of state.items) {
      const fields = new Set();
      const hay = {
        title: it.title + ' ' + it.topic,
        section: it.section,
        chapter: it.chapter,
        keywords: it.keywords.join(' '),
        answer: it.answer,
      };
      for (const key of Object.keys(hay)) {
        if (matchesAll(hay[key], terms)) fields.add(key);
      }
      // 关键词可能是分散在不同字段里的（如「死锁」「PV」分别命中 title 与 answer）
      if (fields.size === 0) {
        const joined = Object.values(hay).join(' ');
        if (matchesAll(joined, terms)) fields.add('answer');
      }
      if (fields.size) out.push({ it, fields });
    }
    return out;
  }

  function currentFiltered() {
    const terms = splitQuery(state.query);
    const searched = searchItems(terms);
    const byLevel = state.level === 'all' ? searched : searched.filter((r) => r.it.level === state.level);
    return { terms, searched, filtered: byLevel };
  }

  /** 统一入口：搜索词或标签变化时调用 */
  function applyFilters(opts) {
    const options = opts || {};
    const { terms, filtered } = currentFiltered();
    renderList(terms, filtered);
    buildDeck(deckSource(), options.keepCard);

    const n = filtered.length;
    const total = state.items.length;
    el.listMeta.textContent = terms.length || state.level !== 'all'
      ? `筛选出 ${n} 个考点（共 ${total} 个）`
      : `共 ${n} 个考点 · 点击考点查看答案，点右侧 🎴 直接抽背`;
    announce(`筛选出 ${n} 个考点`);

    // 抽屉高亮态刷新
    syncDrawerSelection();
    // 另外两个视图依赖同一份筛选结果，刷新一下
    if (state.view === 'mastery') renderMastery();
    if (state.view === 'cards') renderCards();
  }

  /* ---------------- 考点列表渲染 ---------------- */
  function panelKey(chapter) { return 'c:' + chapter; }
  function secKey(chapter, section) { return 'c:' + chapter + '|s:' + section; }

  function renderList(terms, filtered) {
    const seq = ++state.seq;
    const root = el.list;
    // 用 DocumentFragment 一次性构建，避免多次触发布局
    const frag = document.createDocumentFragment();

    if (!filtered.length) {
      frag.appendChild(buildEmptyState(terms));
      root.replaceChildren(frag);
      return;
    }

    // 若正在搜索 / 按标签筛选，默认自动展开所有命中分组，方便直接看到结果
    const autoExpand = terms.length > 0 || state.level !== 'all';
    const hitIds = new Set(filtered.map((r) => r.it.id));

    for (const ch of state.tree) {
      // 本章下命中的节
      const secs = ch.sections
        .map((s) => ({
          section: s.section,
          ids: s.topicIds.filter((id) => hitIds.has(id)),
        }))
        .filter((s) => s.ids.length > 0);

      if (!secs.length) continue; // 搜索时整章无命中则不显示（结果更聚焦）

      const count = secs.reduce((a, s) => a + s.ids.length, 0);
      const pKey = panelKey(ch.chapter);
      const expanded = autoExpand || state.openPanels.has(pKey);

      const panel = document.createElement('section');
      panel.className = 'panel';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel__toggle';
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.innerHTML =
        `<span class="panel__caret" aria-hidden="true">▶</span>` +
        `<span class="panel__name"></span>` +
        trendBadge(ch.chapter) +
        `<span class="panel__count">${count}</span>`;
      toggle.querySelector('.panel__name').innerHTML = highlight(ch.chapter, terms);
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!open));
        itemsBox.hidden = open;
        if (open) state.openPanels.delete(pKey); else state.openPanels.add(pKey);
      });

      const itemsBox = document.createElement('div');
      itemsBox.className = 'panel__items';
      itemsBox.hidden = !expanded;

      for (const s of secs) {
        const sKey = secKey(ch.chapter, s.section);
        const sOpen = autoExpand || state.openSections.has(sKey);

        const secBox = document.createElement('div');
        secBox.className = 'sec';

        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'sec__label';
        label.setAttribute('aria-expanded', String(sOpen));
        label.innerHTML =
          `<span class="sec__caret" aria-hidden="true">▶</span>` +
          `<span class="sec__name"></span>` +
          `<span class="sec__count">${s.ids.length}</span>`;
        label.querySelector('.sec__name').innerHTML = highlight(s.section, terms);

        const secItems = document.createElement('div');
        secItems.className = 'sec__items';
        secItems.hidden = !sOpen;

        label.addEventListener('click', () => {
          const open = label.getAttribute('aria-expanded') === 'true';
          label.setAttribute('aria-expanded', String(!open));
          secItems.hidden = open;
          if (open) state.openSections.delete(sKey); else state.openSections.add(sKey);
        });

        for (const id of s.ids) {
          const item = state.byId.get(id);
          if (!item) continue; // 目录里有、数据里缺：跳过（校验脚本会报警）
          secItems.appendChild(buildTopicRow(item, terms));
        }

        secBox.appendChild(label);
        secBox.appendChild(secItems);
        itemsBox.appendChild(secBox);
      }

      panel.appendChild(toggle);
      panel.appendChild(itemsBox);
      frag.appendChild(panel);
    }

    // 数据里有、但目录树没覆盖到的考点，兜底显示在最后一组
    const covered = new Set();
    state.tree.forEach((c) => c.sections.forEach((s) => s.topicIds.forEach((id) => covered.add(id))));
    const orphans = filtered.map((r) => r.it).filter((it) => !covered.has(it.id));
    if (orphans.length) {
      const panel = document.createElement('section');
      panel.className = 'panel';
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'panel__toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.innerHTML =
        `<span class="panel__caret" aria-hidden="true">▶</span>` +
        `<span class="panel__name">未归章考点</span>` +
        `<span class="panel__count">${orphans.length}</span>`;
      const box = document.createElement('div');
      box.className = 'panel__items';
      orphans.forEach((it) => box.appendChild(buildTopicRow(it, terms)));
      panel.appendChild(toggle);
      panel.appendChild(box);
      frag.appendChild(panel);
    }

    if (seq === state.seq) root.replaceChildren(frag);
  }

  /* =========================================================
     背诵记忆系统
     ─ 进度存 localStorage（键 PROGRESS_KEY）：{ cards: { id: {grade, reviews, lastSeen} } }
     ─ 单文件版内联 app.js 时会自动改用「内联专属键」，避免与网页版记录混淆
     ─ 轮次：本轮的每一张待过卡片；逐张自评 known / fuzzy / unknown
       · unknown → 本轮结束后自动追加到「重练队列」，结算时优先再来一轮
       · fuzzy    → 本轮结束时在轻量队列再来一次
       · known    → 计入「会了」，本轮本轮不再出现
     ========================================================= */
  const progressKey = document.documentElement.getAttribute('data-standalone') === 'true'
    ? PROGRESS_KEY + '.standalone'
    : PROGRESS_KEY;

  function loadProgress() {
    try {
      const raw = localStorage.getItem(progressKey);
      if (!raw) return { cards: {} };
      const obj = JSON.parse(raw);
      return obj && typeof obj === 'object' && obj.cards ? obj : { cards: {} };
    } catch (e) { return { cards: {} }; }
  }

  function saveProgress() {
    try { localStorage.setItem(progressKey, JSON.stringify(state.progress)); } catch (e) { /* 隐私模式 */ }
  }

  function gradeOf(id) {
    const c = state.progress.cards[id];
    return c ? c.grade : null;
  }

  function masteryBadge(item) {
    const g = gradeOf(item.id);
    const span = document.createElement('span');
    span.className = 'mastery' + (g === 'known' ? ' mastery--full' : '');
    span.dataset.grade = g || '';
    if (g === 'known') { span.textContent = '已会'; span.title = '已标记会了'; }
    else if (g === 'fuzzy') { span.textContent = '模糊'; span.title = '上次标记模糊，复习优先'; }
    else if (g === 'unknown') { span.textContent = '忘了'; span.title = '上次标记忘了，重点攻克'; }
    else { span.textContent = '未测'; span.title = '还没有自评记录'; }
    return span;
  }

  function startRound() {
    state.round = { no: state.round.no || 1, grades: new Map(), stats: { known: 0, fuzzy: 0, unknown: 0 } };
    state.queue = state.deck.slice();          // 本轮待过队列
    state.cardIndex = 0;
    buildDeck(state.queue, false);
  }

  function currentRoundQueue() { return state.queue || []; }

  function roundTotal() { return currentRoundQueue().length; }

  function roundDone() { return state.round.grades.size; }

  function renderDrillHUD() {
    const done = roundDone();
    const total = roundTotal();
    el.drillRound.textContent = `第 ${state.round.no} 轮 · ${done}/${total}`;
    el.drillStat.textContent = `会了 ${state.round.stats.known} · 模糊 ${state.round.stats.fuzzy} · 忘了 ${state.round.stats.unknown}`;
  }

  /** 卡片翻转后才允许自评：答案都没看，谈不上会了/忘了 */
  function syncRateButtons() {
    const item = currentCard();
    const graded = item && state.round.grades.has(item.id);
    const enabled = !!item && state.flipped && !graded;
    [...el.drillRate.querySelectorAll('button')].forEach((b) => { b.disabled = !enabled; });
    el.drillTip.textContent = !item
      ? '当前没有卡片，先调整筛选条件'
      : (graded ? '已自评，点「下一张」继续'
        : (state.flipped ? '这张会了吗？选一个' : '先点「显示答案」，看完再自评'));
  }

  function gradeCurrent(kind) {
    const item = currentCard();
    if (!item || !state.flipped || state.round.grades.has(item.id)) return;
    state.round.grades.set(item.id, kind);
    state.round.stats[kind] += 1;
    const rec = state.progress.cards[item.id] || { reviews: 0 };
    rec.grade = kind;
    rec.reviews = (rec.reviews || 0) + 1;
    rec.lastSeen = new Date().toISOString().slice(0, 10);
    state.progress.cards[item.id] = rec;
    saveProgress();
    renderDrillHUD();
    renderDrawerProgress();
    refreshMasteryBadges();
    syncRateButtons();
    // 自动前进：省一步点击，移动端更顺手
    if (state.cardIndex < roundTotal() - 1) stepCard(1);
    else finishRound();
  }

  function finishRound() {
    const s = state.round.stats;
    const graded = [...state.round.grades.entries()];
    const weak = graded.filter(([, g]) => g !== 'known');
    el.settleRoundno.textContent = String(state.round.no);
    el.settleLine.textContent =
      `本轮共过 ${graded.length} 张：会了 ${s.known} · 模糊 ${s.fuzzy} · 忘了 ${s.unknown}`;
    el.settleHint.textContent = weak.length
      ? `还有 ${weak.length} 张没拿稳，建议再来一轮专攻它们。`
      : '全部拿稳了，可以换个章节或换个分级小测一下。';
    el.settle.hidden = false;
    el.settle.querySelector('.settle__box').focus?.();
  }

  function refreshMasteryBadges() {
    document.querySelectorAll('.mastery[data-grade]').forEach((b) => {
      const row = b.closest('.topic');
      const id = row && row.dataset.id;
      if (!id) return;
      const g = gradeOf(id);
      b.dataset.grade = g || '';
      b.textContent = g === 'known' ? '已会' : g === 'fuzzy' ? '模糊' : g === 'unknown' ? '忘了' : '未测';
      b.classList.toggle('mastery--full', g === 'known');
      row.classList.toggle('topic--known', g === 'known');
    });
  }

  function renderDrawerProgress() {
    const total = state.items.length;
    const known = state.items.filter((it) => gradeOf(it.id) === 'known').length;
    const fuzzy = state.items.filter((it) => gradeOf(it.id) === 'fuzzy').length;
    const unknown = state.items.filter((it) => gradeOf(it.id) === 'unknown').length;
    el.drawerProgress.textContent =
      `全书掌握：${known}/${total} · 模糊 ${fuzzy} · 忘了 ${unknown}`;
    // 每节掌握度
    state.tree.forEach((ch) => ch.sections.forEach((sec) => {
      const ids = sec.topicIds.filter((id) => state.byId.has(id));
      const k = ids.filter((id) => gradeOf(id) === 'known').length;
      const node = el.drawerBody.querySelector(`[data-sec-progress="${ch.chapter}|${sec.section}"]`);
      if (node) node.textContent = `${k}/${ids.length}`;
    }));
  }

  /* —— 导出 / 导入 —— */
  function exportProgress() {
    const payload = {
      kind: 'os408-progress',
      version: 2,
      exportedAt: new Date().toISOString(),
      scope: document.documentElement.getAttribute('data-standalone') === 'true' ? 'standalone' : 'web',
      cards: state.progress.cards,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `408背诵记录-${payload.scope}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    announce('学习记录已导出');
  }

  function importProgress(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(String(reader.result));
        const cards = obj.cards || obj.progress?.cards;
        if (!cards || typeof cards !== 'object') throw new Error('文件里没有 cards 字段');
        state.progress = { cards };
        saveProgress();
        renderDrawerProgress();
        refreshMasteryBadges();
        applyFilters({ keepCard: true });
        announce('学习记录已导入');
      } catch (err) {
        alert(`导入失败：${err.message}\n请确认这是本工具导出的 JSON 文件。`);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function buildEmptyState(terms) {
    const box = document.createElement('div');
    box.className = 'empty';
    if (!terms.length && state.level !== 'all') {
      // 只按标签筛选，但没有数据
      box.innerHTML =
        `<p class="empty__title">这类考点还没有录入</p>` +
        `<p class="empty__hint">试试切换到「全部」，或等知识点节点补充后刷新。</p>`;
    } else {
      const q = terms.map((t) => `<span class="empty__q">${escapeHtml(t)}</span>`).join(' ');
      box.innerHTML =
        `<p class="empty__title">没有找到相关考点</p>` +
        `<p class="empty__hint">关键词 ${q || ''} 没有命中。<br>换个说法试试，例如「死锁」「PV」「页面置换」；或清空搜索框查看全部。</p>`;
    }
    return box;
  }

  function buildTopicRow(item, terms) {
    const open = state.openTopics.has(item.id);
    const row = document.createElement('article');
    row.className = `topic topic--${item.level}${open ? ' is-open' : ''}`;
    row.id = 'topic-' + item.id;
    row.dataset.id = item.id;

    const head = document.createElement('div');
    head.className = 'topic__head';

    const jump = document.createElement('button');
    jump.type = 'button';
    jump.className = 'topic__jump';
    jump.setAttribute('aria-expanded', String(open));
    jump.innerHTML =
      `<span class="topic__title">${highlight(item.title, terms)}</span>` +
      `<span class="topic__path"></span>`;
    const pathEl = jump.querySelector('.topic__path');
    pathEl.innerHTML = `${highlight(item.section, terms)} · ${levelBadge(item.level)}`;

    jump.addEventListener('click', () => toggleTopic(row, item));

    const drill = document.createElement('button');
    drill.type = 'button';
    drill.className = 'topic__drill';
    drill.setAttribute('aria-label', `抽背：${item.title}`);
    drill.title = '进入抽卡背诵';
    drill.textContent = '🎴';
    drill.addEventListener('click', () => startDrill(item));

    head.appendChild(jump);
    head.appendChild(masteryBadge(item));
    head.appendChild(drill);

    const answer = document.createElement('div');
    answer.className = 'topic__answer';
    answer.hidden = !open;
    const body = document.createElement('div');
    body.innerHTML = highlight(item.answer, terms);
    const src = document.createElement('span');
    src.className = 'topic__source';
    src.textContent = item.source + (item.status === 'draft' ? ' · 草稿' : '');
    answer.appendChild(body);
    answer.appendChild(src);

    row.appendChild(head);
    row.appendChild(answer);
    return row;
  }

  function toggleTopic(row, item) {
    const open = state.openTopics.has(item.id);
    if (open) state.openTopics.delete(item.id); else state.openTopics.add(item.id);
    row.classList.toggle('is-open', !open);
    row.querySelector('.topic__answer').hidden = open;
    row.querySelector('.topic__jump').setAttribute('aria-expanded', String(!open));
  }

  /* ---------------- 抽屉目录（章 → 节 → 考点） ---------------- */
  function renderDrawer() {
    const frag = document.createDocumentFragment();

    for (const ch of state.tree) {
      const group = document.createElement('div');
      group.className = 'tree__group';

      const chBtn = document.createElement('button');
      chBtn.type = 'button';
      chBtn.className = 'tree__chapter';
      chBtn.setAttribute('aria-expanded', 'false');
      chBtn.innerHTML =
        `<span class="tree__caret" aria-hidden="true">▶</span>` +
        `<span class="tree__name"></span>`;
      chBtn.querySelector('.tree__name').textContent = ch.chapter;

      const chKids = document.createElement('div');
      chKids.className = 'tree__children';
      chKids.hidden = true;

      chBtn.addEventListener('click', () => {
        const open = chBtn.getAttribute('aria-expanded') === 'true';
        chBtn.setAttribute('aria-expanded', String(!open));
        chKids.hidden = open;
      });

      for (const sec of ch.sections) {
        const secBtn = document.createElement('button');
        secBtn.type = 'button';
        secBtn.className = 'tree__section';
        secBtn.setAttribute('aria-expanded', 'false');
        secBtn.innerHTML =
          `<span class="tree__caret" aria-hidden="true">▶</span>` +
          `<span class="tree__name"></span>`;
        secBtn.querySelector('.tree__name').textContent = sec.section;
        // 节级考向徽章（只有 exam_trend.json 里有这一节时才显示）
        secBtn.insertAdjacentHTML('beforeend', trendBadge(ch.chapter, sec.section, { compact: true }));
        const secIds = sec.topicIds.filter((id) => state.byId.has(id));
        const k = secIds.filter((id) => gradeOf(id) === 'known').length;
        secBtn.querySelector('.tree__name').insertAdjacentHTML(
          'afterend',
          ` <span class="mastery" data-sec-progress="${escapeHtml(ch.chapter)}|${escapeHtml(sec.section)}">${k}/${secIds.length}</span>`
        );

        const secKids = document.createElement('div');
        secKids.className = 'tree__children';
        secKids.hidden = true;

        const topicWrap = document.createElement('div');
        topicWrap.className = 'tree__topics';

        let firstExisting = null;
        for (const id of sec.topicIds) {
          const item = state.byId.get(id);
          if (!item) continue;
          if (!firstExisting) firstExisting = item;
          const tBtn = document.createElement('button');
          tBtn.type = 'button';
          tBtn.className = 'tree__topic';
          tBtn.dataset.id = item.id;
          tBtn.innerHTML = `${levelBadge(item.level, { short: true })}<span class="tree__topic-name"></span>`;
          tBtn.querySelector('.tree__topic-name').textContent = item.title;
          tBtn.addEventListener('click', () => goToTopic(item));
          topicWrap.appendChild(tBtn);
        }

        secBtn.addEventListener('click', () => {
          const open = secBtn.getAttribute('aria-expanded') === 'true';
          secBtn.setAttribute('aria-expanded', String(!open));
          secKids.hidden = open;
        });

        // 节里没有任何考点数据时，点了也跳不了，直接给个提示
        if (!firstExisting) {
          secBtn.disabled = true;
          secBtn.title = '该节暂无考点';
        }

        secKids.appendChild(topicWrap);
        chKids.appendChild(secBtn);
        chKids.appendChild(secKids);
      }

      group.appendChild(chBtn);
      group.appendChild(chKids);
      frag.appendChild(group);
    }

    el.drawerBody.replaceChildren(frag);
    renderDrawerProgress();
  }

  /** 抽屉点击考点：切回列表、定位、展开该条，并关闭抽屉 */
  function goToTopic(item) {
    // 若当前搜索/标签把它过滤掉了，先重置筛选，保证目标可见
    const visible = currentFiltered().filtered.some((r) => r.it.id === item.id);
    if (!visible) {
      state.query = '';
      state.level = 'all';
      el.search.value = '';
      el.clearBtn.hidden = true;
      syncLevelChips();
      applyFilters({ keepCard: true });
    }
    switchView('list', { silent: true });
    // 展开所在章
    state.openPanels.add(panelKey(item.chapter));
    state.openTopics.add(item.id);
    renderList(splitQuery(state.query), currentFiltered().filtered);

    closeDrawer();

    // 等一帧再滚动，保证 DOM 已更新
    requestAnimationFrame(() => {
      const node = document.getElementById('topic-' + item.id);
      if (!node) return;
      node.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      const jump = node.querySelector('.topic__jump');
      if (jump) jump.focus({ preventScroll: true });
      syncDrawerSelection(item.id);
    });
  }

  function syncDrawerSelection(currentId) {
    el.drawerBody.querySelectorAll('.tree__topic.is-current')
      .forEach((n) => n.classList.remove('is-current'));
    if (!currentId) return;
    const node = el.drawerBody.querySelector(`.tree__topic[data-id="${CSS.escape(currentId)}"]`);
    if (!node) return;
    node.classList.add('is-current');
    // 自动展开它所属的章 / 节
    let p = node.parentElement;
    while (p && p !== el.drawerBody) {
      if (p.classList.contains('tree__children')) {
        p.hidden = false;
        const btn = p.previousElementSibling;
        if (btn && btn.getAttribute) btn.setAttribute('aria-expanded', 'true');
      }
      p = p.parentElement;
    }
  }

  function openDrawer() {
    if (state.drawerOpen) return;
    state.drawerOpen = true;
    el.scrim.hidden = false;
    el.drawer.classList.add('is-open');
    el.drawer.setAttribute('aria-hidden', 'false');
    el.menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    // 先让 scrim 显示再过渡，避免闪烁
    requestAnimationFrame(() => el.scrim.classList.add('is-shown'));
    el.drawerClose.focus({ preventScroll: true });
    lastFocus = el.menuBtn;
  }

  let lastFocus = null;

  function closeDrawer() {
    if (!state.drawerOpen) return;
    state.drawerOpen = false;
    el.scrim.classList.remove('is-shown');
    el.drawer.classList.remove('is-open');
    el.drawer.setAttribute('aria-hidden', 'true');
    el.menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    const t = prefersReducedMotion() ? 0 : 250;
    window.setTimeout(() => { if (!state.drawerOpen) el.scrim.hidden = true; }, t);
    if (lastFocus) lastFocus.focus({ preventScroll: true });
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ---------------- 抽卡背诵 ---------------- */
  function renderChapterSelect() {
    const frag = document.createDocumentFragment();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部章节';
    frag.appendChild(all);
    for (const ch of state.tree) {
      const opt = document.createElement('option');
      opt.value = ch.chapter;
      const n = ch.sections.reduce((a, s) => a + s.topicIds.length, 0);
      opt.textContent = `${ch.chapter}（${n}）`;
      frag.appendChild(opt);
    }
    el.cardChapter.replaceChildren(frag);

    // 考点卡、掌握列表的章节下拉复用同一份章名
    [el.cardsChapter, el.masteryChapter].forEach((sel) => {
      if (!sel) return;
      const f2 = document.createDocumentFragment();
      const a2 = document.createElement('option');
      a2.value = 'all';
      a2.textContent = '全部章节';
      f2.appendChild(a2);
      for (const ch of state.tree) {
        const o = document.createElement('option');
        o.value = ch.chapter;
        const n = ch.sections.reduce((a, s) => a + s.topicIds.length, 0);
        o.textContent = `${ch.chapter}（${n}）`;
        f2.appendChild(o);
      }
      sel.replaceChildren(f2);
    });

    renderSectionSelect();
    renderCardsDocSelect();
  }

  /** 抽卡的小节下拉：跟着章节联动 */
  function renderSectionSelect() {
    if (!el.cardSection) return;
    const chName = el.cardChapter.value || 'all';
    const frag = document.createDocumentFragment();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = '全部小节';
    frag.appendChild(all);
    const chapters = chName === 'all' ? state.tree : state.tree.filter((c) => c.chapter === chName);
    for (const ch of chapters) {
      for (const sec of ch.sections) {
        if (!sec.topicIds.length) continue;
        const opt = document.createElement('option');
        opt.value = `${ch.chapter}|${sec.section}`;
        opt.textContent = chName === 'all' ? `${sec.section}（${sec.topicIds.length}）` : `${sec.section}（${sec.topicIds.length}）`;
        frag.appendChild(opt);
      }
    }
    el.cardSection.replaceChildren(frag);
    // 章节变了，旧的小节选择可能已不存在
    const keep = state.cardSection;
    const exists = [...el.cardSection.options].some((o) => o.value === keep);
    el.cardSection.value = exists ? keep : 'all';
    state.cardSection = el.cardSection.value;
  }

  /** 当前抽卡范围：章节 ∩ 小节 ∩ 搜索结果 ∩ 分级筛选 */
  function deckSource() {
    const { filtered } = currentFiltered();
    const ch = el.cardChapter.value || 'all';
    const sec = (el.cardSection && el.cardSection.value) || 'all';
    let items = filtered.map((r) => r.it);
    if (ch !== 'all') items = items.filter((it) => it.chapter === ch);
    if (sec !== 'all') {
      const [secCh, secName] = sec.split('|');
      items = items.filter((it) => it.chapter === secCh && it.section === secName);
    }
    return items;
  }

  function buildDeck(items, keepCard) {
    const prevId = keepCard && state.deck[state.cardIndex] ? state.deck[state.cardIndex].id : null;
    state.deck = items.slice();
    if (prevId) {
      const idx = state.deck.findIndex((it) => it.id === prevId);
      state.cardIndex = idx >= 0 ? idx : 0;
    } else {
      state.cardIndex = 0;
      setFlipped(false);
    }
    renderCard();
  }

  function currentCard() {
    return state.deck[state.cardIndex] || null;
  }

  function renderCard() {
    const item = currentCard();
    const total = state.deck.length;

    if (!item) {
      el.cardPos.textContent = '0 / 0';
      el.cardScope.textContent = '当前筛选下没有可抽背的考点';
      el.cardTitleFront.textContent = '暂无卡片';
      el.cardBadgesFront.replaceChildren();
      el.cardKwFront.replaceChildren();
      el.cardTitleBack.textContent = '';
      el.cardAnswer.textContent = '请调整搜索或筛选条件。';
      el.cardSource.textContent = '';
      el.cardBadgesBack.replaceChildren();
      [el.prev, el.next, el.flip, el.random].forEach((b) => { b.disabled = true; });
      return;
    }

    [el.prev, el.next, el.flip, el.random].forEach((b) => { b.disabled = false; });
    el.prev.disabled = state.cardIndex <= 0;
    el.next.disabled = state.cardIndex >= total - 1;

    el.cardPos.textContent = `${state.cardIndex + 1} / ${total}`;
    el.cardScope.textContent = `${item.chapter} · ${item.section}`;

    // 正面：分级 → 章名 → 考向（可选）→ 草稿
    el.cardTitleFront.textContent = item.title;
    el.cardBadgesFront.innerHTML =
      levelBadge(item.level) +
      `<span class="flipcard__badge">${escapeHtml(item.chapter)}</span>` +
      trendBadge(item.chapter, item.section, { compact: true }) +
      (item.status === 'draft' ? `<span class="flipcard__badge flipcard__badge--draft">草稿</span>` : '');
    el.cardKwFront.replaceChildren();
    item.keywords.slice(0, 8).forEach((k) => {
      const li = document.createElement('li');
      li.textContent = k;
      el.cardKwFront.appendChild(li);
    });

    // 背面
    el.cardTitleBack.textContent = item.title;
    el.cardAnswer.innerHTML = richText(item.answer);
    el.cardSource.textContent = item.source + (item.status === 'draft' ? ' · 草稿，待正式校对' : '');
    el.cardBadgesBack.innerHTML =
      levelBadge(item.level) +
      `<span class="flipcard__badge">${escapeHtml(item.section)}</span>` +
      trendBadge(item.chapter, item.section, { compact: true });

    // 卡片翻转状态在有卡变化时回到正面
    setFlipped(false);
  }

  function setFlipped(flip) {
    state.flipped = !!flip;
    el.flipcard.classList.toggle('is-flipped', state.flipped);
    el.flipcard.setAttribute('aria-pressed', String(state.flipped));
    el.flip.textContent = state.flipped ? '收起答案' : '显示答案';
    const back = el.flipcard.querySelector('.flipcard__face--back');
    if (back) back.setAttribute('aria-hidden', String(!state.flipped));
    const front = el.flipcard.querySelector('.flipcard__face--front');
    if (front) front.setAttribute('aria-hidden', String(state.flipped));
    syncRateButtons();
  }

  function toggleFlip() {
    if (!currentCard()) return;
    setFlipped(!state.flipped);
  }

  function stepCard(delta) {
    const next = state.cardIndex + delta;
    if (next < 0 || next >= state.deck.length) return;
    state.cardIndex = next;
    renderCard();
    announce(`第 ${state.cardIndex + 1} 张，共 ${state.deck.length} 张`);
    syncRateButtons();
  }

  function randomCard() {
    const total = state.deck.length;
    if (!total) return;
    let idx = Math.floor(Math.random() * total);
    if (total > 1 && idx === state.cardIndex) idx = (idx + 1) % total;
    state.cardIndex = idx;
    renderCard();
    announce('随机抽到一张');
  }

  /** 列表里点 🎴：切到抽卡视图，并按当前筛选范围开始一轮背诵 */
  function startDrill(item) {
    // 保证抽卡池里能看到它：若当前范围把它排除了，重置章节筛选
    if (el.cardChapter.value !== 'all' && item.chapter !== el.cardChapter.value) {
      el.cardChapter.value = 'all';
    }
    startRound();
    if (item) {
      const idx = state.deck.findIndex((it) => it.id === item.id);
      if (idx >= 0) state.cardIndex = idx;
    }
    switchView('card', { silent: true });
    renderCard();
    renderDrillHUD();
    syncRateButtons();
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    el.flip.focus({ preventScroll: true });
  }

  /* ---------------- 视图切换 ---------------- */
  const VIEWS = ['list', 'card', 'cards', 'mastery'];

  function switchView(view, opts) {
    const options = opts || {};
    state.view = VIEWS.indexOf(view) >= 0 ? view : 'list';
    el.viewList.hidden = state.view !== 'list';
    el.viewCard.hidden = state.view !== 'card';
    el.viewCards.hidden = state.view !== 'cards';
    el.viewMastery.hidden = state.view !== 'mastery';
    el.viewTabs.forEach((t) => {
      const on = t.dataset.view === state.view;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });
    // 切到抽卡视图时若还没有本轮队列，补开一轮
    // （否则 HUD 会显示「第 1 轮 · 0/0」，评分后 roundTotal()=0 会被误判成"本轮结束"）
    if (state.view === 'card' && !currentRoundQueue().length) {
      startRound();
      renderDrillHUD();
      syncRateButtons();
    }
    // 切到考点卡 / 掌握列表时按需渲染
    if (state.view === 'cards') renderCards();
    if (state.view === 'mastery') renderMastery();
    try { localStorage.setItem(VIEW_KEY, state.view); } catch (e) { /* 隐私模式忽略 */ }
    if (!options.silent) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  /* ---------------- 主题 ---------------- */
  function applyTheme(theme) {
    const t = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    el.themeIcon.textContent = t === 'dark' ? '☀️' : '🌙';
    el.themeBtn.setAttribute('aria-label', t === 'dark' ? '切换为浅色主题' : '切换为深色主题');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0e141b' : '#f6f8fb');
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 忽略 */ }
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) { /* 忽略 */ }
    if (saved === 'dark' || saved === 'light') return applyTheme(saved);
    // 跟随系统
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(mq.matches ? 'dark' : 'light');
    const onChange = (ev) => {
      let s = null;
      try { s = localStorage.getItem(THEME_KEY); } catch (e) { /* 忽略 */ }
      if (!s) applyTheme(ev.matches ? 'dark' : 'light');
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }

  /* ---------------- 分级 chips ---------------- */
  function syncLevelChips() {
    el.levelChips.querySelectorAll('.chip').forEach((c) => {
      const on = c.dataset.level === state.level;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
  }

  /* ---------------- 顶部栏高度测量（锚点偏移用） ---------------- */
  function measureTopbar() {
    const h = el.topbar.getBoundingClientRect().height;
    document.documentElement.style.setProperty('--topbar-h', h + 'px');
  }

  /* ---------------- 移动端体验：iOS 键盘不顶飞搜索框 ---------------- */
  /**
   * iOS Safari 聚焦输入框时会把整个页面往上推（甚至推出可视区）。
   * 做法：聚焦时记录当前位置，键盘弹出后（visualViewport 变矮）把窗口滚回原处，
   * 让搜索框停在顶部栏里，而不是被顶到屏幕外。
   */
  function bindKeyboardSafeSearch() {
    const input = el.search;
    let scrollBeforeFocus = 0;

    input.addEventListener('focus', () => {
      scrollBeforeFocus = window.scrollY;
    });

    // 目标：顶部栏是 sticky 的第一屏元素，聚焦后页面应停在 scrollY = 0
    const restore = () => {
      if (document.activeElement !== input) return;
      const vv = window.visualViewport;
      const pushedUp = vv ? vv.offsetTop > 8 : false;
      const jumped = Math.abs(window.scrollY - scrollBeforeFocus) > 120;
      if (pushedUp || jumped) window.scrollTo({ top: 0 });
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => window.setTimeout(restore, 60));
      window.visualViewport.addEventListener('scroll', () => window.setTimeout(restore, 60));
    }
  }

  /* ---------------- 移动端体验：低端机卡片翻转降级 ---------------- */
  /**
   * 低端安卓上 3D 翻转可能掉帧。检测到弱设备（内存小 / 核心少 / 曾出现长任务）
   * 时给 <html> 加 .no-flip，CSS 用淡入淡出替代 3D 旋转。
   */
  function detectWeakDevice() {
    const nav = navigator;
    const mem = nav.deviceMemory || 0;
    const cores = nav.hardwareConcurrency || 8;
    const weak = (mem && mem <= 2) || cores <= 2;
    if (weak) document.documentElement.classList.add('no-flip');

    // 运行期补救：出现 > 180ms 的长任务，说明渲染吃紧，降级
    if ('PerformanceObserver' in window) {
      try {
        let degraded = false;
        const po = new PerformanceObserver((list) => {
          if (degraded) return;
          const long = list.getEntries().some((e) => e.duration > 180);
          if (long) {
            degraded = true;
            document.documentElement.classList.add('no-flip');
            po.disconnect();
          }
        });
        po.observe({ entryTypes: ['longtask'] });
        window.setTimeout(() => po.disconnect(), 12000);
      } catch (e) { /* 浏览器不支持就忽略 */ }
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  function bindEvents() {
    // 搜索（带防抖，输入中不至于卡顿）
    let timer = null;
    el.search.addEventListener('input', () => {
      const v = el.search.value;
      el.clearBtn.hidden = v.length === 0;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        state.query = v;
        // 搜索时若不在列表视图，自动切到列表，结果立即可见
        if (v.trim() && state.view !== 'list') switchView('list', { silent: true });
        applyFilters({ keepCard: true });
      }, 60);
    });
    el.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        el.search.value = '';
        el.clearBtn.hidden = true;
        state.query = '';
        applyFilters({ keepCard: true });
        el.search.blur();
      }
      if (e.key === 'Enter') el.search.blur();
    });

    el.clearBtn.addEventListener('click', () => {
      el.search.value = '';
      state.query = '';
      el.clearBtn.hidden = true;
      applyFilters({ keepCard: true });
      el.search.focus();
    });

    // 分级筛选
    el.levelChips.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      state.level = btn.dataset.level || 'all';
      syncLevelChips();
      applyFilters({ keepCard: true });
    });

    // 视图切换
    el.viewTabs.forEach((t) => {
      t.addEventListener('click', () => switchView(t.dataset.view));
    });

    // 抽卡操作
    el.prev.addEventListener('click', () => stepCard(-1));
    el.next.addEventListener('click', () => stepCard(1));
    el.flip.addEventListener('click', toggleFlip);
    el.random.addEventListener('click', randomCard);
    el.cardChapter.addEventListener('change', () => {
      renderSectionSelect();
      startRound();
      announce(`抽背范围已切换，本轮 ${state.deck.length} 张`);
    });
    if (el.cardSection) {
      el.cardSection.addEventListener('change', () => {
        state.cardSection = el.cardSection.value;
        startRound();
        announce(`抽背范围已切换，本轮 ${state.deck.length} 张`);
      });
    }

    // 考点卡：章节 / 卡片筛选
    if (el.cardsChapter) {
      el.cardsChapter.addEventListener('change', () => {
        renderCardsDocSelect();
        renderCards();
      });
    }
    if (el.cardsDoc) {
      el.cardsDoc.addEventListener('change', () => {
        state.cardsDoc = el.cardsDoc.value;
        renderCards();
      });
    }

    // 掌握列表：章节 / 状态筛选 + 全部遗忘
    if (el.masteryChapter) {
      el.masteryChapter.addEventListener('change', () => { renderMastery(); });
    }
    if (el.masteryGrade) {
      el.masteryGrade.addEventListener('change', () => { renderMastery(); });
    }
    if (el.forgetAll) {
      el.forgetAll.addEventListener('click', () => {
        forgetIds(state.items.map((it) => it.id), '全书');
      });
    }

    // 三档自评
    el.drillRate.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-grade]');
      if (!btn || btn.disabled) return;
      gradeCurrent(btn.dataset.grade);
    });

    // 结算面板
    el.settleAgain.addEventListener('click', () => {
      el.settle.hidden = true;
      // 只刷没掌握的：fuzzy + unknown
      const weak = [...state.round.grades.entries()].filter(([, g]) => g !== 'known').map(([id]) => id);
      const pool = weak.map((id) => state.byId.get(id)).filter(Boolean);
      state.round.no += 1;
      state.queue = pool.length ? pool : state.deck.slice();
      state.round.grades = new Map();
      state.round.stats = { known: 0, fuzzy: 0, unknown: 0 };
      state.cardIndex = 0;
      buildDeck(state.queue, false);
      renderDrillHUD();
      syncRateButtons();
    });
    el.settleAll.addEventListener('click', () => {
      el.settle.hidden = true;
      state.round.no += 1;
      state.queue = state.deck.slice();
      state.round.grades = new Map();
      state.round.stats = { known: 0, fuzzy: 0, unknown: 0 };
      state.cardIndex = 0;
      buildDeck(state.queue, false);
      renderDrillHUD();
      syncRateButtons();
    });
    el.settleClose.addEventListener('click', () => { el.settle.hidden = true; });

    // 导入 / 导出学习记录
    el.exportBtn.addEventListener('click', exportProgress);
    el.importBtn.addEventListener('click', () => el.fileImport.click());
    el.fileImport.addEventListener('change', () => {
      const f = el.fileImport.files && el.fileImport.files[0];
      if (f) importProgress(f);
      el.fileImport.value = '';
    });

    // 卡片本体：点击/回车/空格翻转
    el.flipcard.addEventListener('click', toggleFlip);
    el.flipcard.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFlip();
      }
    });

    // 抽卡视图键盘：← → 翻页，空格/回车已在卡片上处理
    document.addEventListener('keydown', (e) => {
      if (state.view !== 'card') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); stepCard(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); stepCard(1); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); randomCard(); }
    });

    // 抽屉
    el.menuBtn.addEventListener('click', openDrawer);
    el.drawerClose.addEventListener('click', closeDrawer);
    el.scrim.addEventListener('click', closeDrawer);
    el.expandAll.addEventListener('click', () => setDrawerExpanded(true));
    el.collapseAll.addEventListener('click', () => setDrawerExpanded(false));

    // 主题
    el.themeBtn.addEventListener('click', () => {
      const now = document.documentElement.getAttribute('data-theme');
      applyTheme(now === 'dark' ? 'light' : 'dark');
    });

    // 重试
    el.retry.addEventListener('click', () => boot());

    // Esc 关闭抽屉 / 退出搜索
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (state.drawerOpen) { closeDrawer(); return; }
    });

    // 抽屉内焦点陷阱（Tab 循环）
    el.drawer.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !state.drawerOpen) return;
      const focusables = el.drawer.querySelectorAll(
        'button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    // 顶部栏高度变化（旋转屏幕 / 地址栏收起）时重新测量
    window.addEventListener('resize', measureTopbar);
    window.addEventListener('orientationchange', () => window.setTimeout(measureTopbar, 150));
    if ('ResizeObserver' in window) new ResizeObserver(measureTopbar).observe(el.topbar);

    // 侧滑关闭抽屉（手机手势）：从左边缘右滑
    bindSwipeToClose();
  }

  function setDrawerExpanded(open) {
    el.drawerBody.querySelectorAll('.tree__chapter, .tree__section').forEach((btn) => {
      btn.setAttribute('aria-expanded', String(open));
    });
    el.drawerBody.querySelectorAll('.tree__children').forEach((box) => { box.hidden = !open; });
  }

  function bindSwipeToClose() {
    let startX = 0, startY = 0, tracking = false;
    el.drawer.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    el.drawer.addEventListener('touchmove', (e) => {
      if (!tracking || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      // 横向右滑超过 60px 且明显偏横向 → 关闭
      if (dx > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        tracking = false;
        closeDrawer();
      }
    }, { passive: true });
    el.drawer.addEventListener('touchend', () => { tracking = false; }, { passive: true });
  }

  /* ---------------- PWA：注册 Service Worker ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    // file:// 下不支持 SW，直接用 http(s) 判断
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('[408] Service Worker 注册失败（不影响页面上使用）：', err);
      });
    });
  }

  /* ---------------- 启动 ---------------- */
  /**
   * 把失败原因翻译成「主人能看懂」的一句话 + 次要说明。
   * 原则：标题给结论，第二行给真实错误（HTTP 状态码 / 环境 / 解析细节），第三行才是建议。
   */
  function describeError(err) {
    const isFile = location.protocol === 'file:';
    const kind = err && err.kind;
    const msg = String(err && err.message ? err.message : err);

    if (isFile) {
      return {
        title: '📂 页面是双击打开的（file:// 环境）',
        real: '当前地址以 file:// 开头，浏览器禁止脚本读取本地 JSON 文件。',
        help: '在 D:\\agent\\os 目录里双击 start.bat（或运行 node tools/serve.js），' +
              '再用 http://localhost:8000 打开即可。',
      };
    }
    if (kind === 'http') {
      const code = err.code;
      const hint = code === 404
        ? '文件不存在：检查 data 目录是否被改名/搬走，或服务是否指向了正确的目录。'
        : code === 403
          ? '服务器拒绝访问该路径（权限问题）。'
          : code >= 500
            ? '服务端出错，重启一下本地服务试试。'
            : '请求被拒绝，请确认本地服务正常运行。';
      return { title: `🌐 取数据失败（HTTP ${code}）`, real: msg, help: hint };
    }
    if (kind === 'json') {
      return {
        title: '🧩 数据文件 JSON 格式有误',
        real: msg,
        help: '常见原因：多写/漏写逗号、中文引号、被截断。可运行 node tools/dev.js check 定位。',
      };
    }
    if (kind === 'shape') {
      return { title: '🧱 数据结构不符合预期', real: msg, help: '需要顶层 { "items": [ … ] } 结构。' };
    }
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return {
        title: '🔌 连不上本地服务',
        real: msg,
        help: '确认命令行窗口里的服务还在运行（窗口被关掉就会停止），再点「重新加载」。',
      };
    }
    return { title: '😵 加载失败', real: msg, help: '可以按 F12 打开控制台查看详细日志，或点「重新加载」重试。' };
  }

  function showError(err) {
    el.skeleton.hidden = true;
    el.error.hidden = false;
    // 内联样式覆盖，确保错误块一定可见（与成功路径的 display:none 对应）
    el.error.style.display = '';
    // 出错时必须把正常内容藏起来，避免「加载失败」和内容同时出现
    el.viewList.hidden = true;
    el.viewCard.hidden = true;
    const d = describeError(err);
    el.errorTitle.textContent = d.title;
    el.errorMsg.textContent = d.real;
    el.errorHelp.textContent = d.help;
    console.error('[408] 数据加载失败：', err);
  }

  async function boot() {
    const startedAt = Date.now();
    try {
      await loadData((info) => {
        console.info('[408] 数据加载完成', info);
      });
      // 读取学习记录（localStorage；单文件版用独立键，与网页版互不干扰）
      state.progress = loadProgress();
      renderDrawerProgress();
      // 恢复上次视图
      let saved = null;
      try { saved = localStorage.getItem(VIEW_KEY); } catch (e) { /* 忽略 */ }
      switchView(VIEWS.indexOf(saved) >= 0 ? saved : 'list', { silent: true });
      measureTopbar();
      scheduleSplash(startedAt);
      // 首次进入抽卡视图时还没有轮次，进入时补开一轮
      if (state.view === 'card' && !currentRoundQueue().length) startRound();
      renderDrillHUD();
      syncRateButtons();
    } catch (err) {
      showError(err);
    }
  }

  /**
   * 开屏骨架屏：首次进入至少显示 2 秒（避免一闪而过），最多 2 秒；
   * 若数据早已就绪则 2 秒后淡出，数据慢则加载完成后立即淡出。
   */
  const SPLASH_MS = 2000;
  function scheduleSplash(startedAt) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.skeleton.classList.add('is-hidden');
      window.setTimeout(() => { el.skeleton.hidden = true; }, prefersReducedMotion() ? 0 : 320);
    };
    const elapsed = Date.now() - startedAt;
    const left = Math.max(0, SPLASH_MS - elapsed);
    window.setTimeout(finish, left);
    // 用户一点屏幕就让它提前结束（不挡操作感）
    const skip = () => finish();
    el.skeleton.addEventListener('pointerdown', skip, { once: true });
  }

  function init() {
    initTheme();
    measureTopbar();
    detectWeakDevice();
    bindEvents();
    bindKeyboardSafeSearch();
    syncLevelChips();
    registerSW();
    boot();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
