// 用量与估算费用：价格表、按请求的示例记录、按范围聚合。全部为原型示例数据。
// 价格来自官方定价页（美元 / 百万 Token），服务端方案见 docs/plan/usage-models-voice.md。
const USAGE = (() => {
  const NOW = new Date(2026, 10, 20, 15, 40);
  const PRICING_UPDATED = '2026-11-20';
  const SOURCES = [
    ['DeepSeek 定价', 'https://api-docs.deepseek.com/quick_start/pricing'],
    ['OpenAI 定价', 'https://developers.openai.com/api/docs/pricing'],
  ];
  // in: 未命中缓存的输入，cached: 命中缓存的输入，out: 输出；offpeak: 低谷时段倍率
  const PRICES = {
    'deepseek-flash': {in: 0.30, cached: 0.006, out: 1.20, offpeak: 0.5},
    'deepseek-v4-pro': {in: 1.32, cached: 0.044, out: 3.96, offpeak: 0.5},
    'gpt-6.1-sol': {in: 2.00, cached: 0.10, out: 10.00},
    'gpt-6-luna': {in: 0.10, cached: 0.01, out: 0.50},
    'gateway-qwen': null, // 自定义模型未填写单价：只统计 Token
  };
  const TRANSCRIBE_PER_MIN = 0.0045; // 云端可选：gpt-transcribe，按音频分钟计费；默认的本机转写不产生费用

  const PROVIDERS = [
    {key: 'deepseek', label: 'DeepSeek', color: 'var(--series-1)', models: ['deepseek-flash', 'deepseek-v4-pro']},
    {key: 'openai', label: 'OpenAI', color: 'var(--series-2)', models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-transcribe']},
    {key: 'gateway', label: '本地网关', color: 'var(--series-3)', models: ['gateway-qwen']},
    // 本机转写组件：不产生费用，只出现在明细与用途中，不参与配色与筛选
    {key: 'local', label: '本机', color: 'var(--ink-3)', models: ['whisper-local'], free: true},
  ];
  const BILLED = PROVIDERS.filter(p => !p.free);
  const providerOf = model => PROVIDERS.find(p => p.models.includes(model));
  const PURPOSES = {main: '主任务', compact: '上下文压缩', title: '会话标题', memory: '记忆提炼', transcribe: '语音转写'};

  /** DeepSeek 高峰：工作日 UTC 01–04、06–10 点；节假日低谷无法可靠判断，按高峰估算。 */
  const isPeak = d => { const h = d.getUTCHours(), w = d.getUTCDay(); return w >= 1 && w <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10)); };

  function costOf(r) {
    if (r.model === 'whisper-local') return 0;
    if (r.model === 'gpt-transcribe') return r.audioSec / 60 * TRANSCRIBE_PER_MIN;
    const p = PRICES[r.model];
    if (!p) return null;
    const k = p.offpeak && !isPeak(r.at) ? p.offpeak : 1;
    return ((r.input - r.cached) * p.in + r.cached * p.cached + r.output * p.out) / 1e6 * k;
  }

  // 可复现的伪随机：同一页面每次刷新得到相同示例
  let seed = 20261120;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function generate() {
    const out = [];
    const start = new Date(NOW); start.setDate(start.getDate() - 89); start.setHours(0, 0, 0, 0);
    for (let t = new Date(start); t <= NOW; t = new Date(t.getTime() + 3600e3)) {
      const h = t.getHours(), dow = t.getDay(), weekend = dow === 0 || dow === 6;
      const daysAgo = (NOW - t) / 864e5;
      // 工作时段活跃，晚间少量；近期用得更多；偶有空白日
      let activity = h >= 9 && h <= 12 ? 1 : h >= 14 && h <= 18 ? 1.15 : h >= 20 && h <= 23 ? 0.35 : 0.04;
      activity *= weekend ? 0.28 : 1;
      activity *= 0.55 + 0.45 * (1 - daysAgo / 90);
      if (Math.floor(daysAgo) % 17 === 5) activity *= 0.05;
      const n = Math.floor(activity * (2 + rand() * 6));
      for (let i = 0; i < n; i++) {
        const roll = rand();
        const model = roll < 0.46 ? 'deepseek-flash' : roll < 0.62 ? 'deepseek-v4-pro' : roll < 0.8 ? 'gpt-6.1-sol'
          : roll < 0.93 ? 'gpt-6-luna' : 'gateway-qwen';
        const purposeRoll = rand();
        const purpose = purposeRoll < 0.86 ? 'main' : purposeRoll < 0.92 ? 'compact' : purposeRoll < 0.96 ? 'memory' : 'title';
        const at = new Date(t.getTime() + rand() * 3600e3);
        if (at > NOW) continue;
        const input = Math.round(purpose === 'title' ? 400 + rand() * 600 : 6000 + rand() * 42000);
        const cached = Math.round(input * (purpose === 'main' ? 0.35 + rand() * 0.5 : 0.1));
        const output = Math.round(purpose === 'title' ? 12 + rand() * 20 : 300 + rand() * 2600);
        out.push({at, model, purpose, input, cached, output, requests: 1});
      }
      if (activity > 0.5 && rand() < 0.18) {
        const at = new Date(t.getTime() + rand() * 3600e3);
        if (at <= NOW) out.push({at, model: 'whisper-local', purpose: 'transcribe', input: 0, cached: 0, output: 0, audioSec: Math.round(8 + rand() * 50), requests: 1});
      }
    }
    for (const r of out) { r.cost = costOf(r); r.provider = providerOf(r.model).key; }
    return out;
  }
  const RECORDS = generate();

  // 时间范围：桶大小与起点。today 从当天零点起，其余为滚动窗口
  const RANGES = [
    ['today', '今天'], ['24h', '24 小时'], ['3d', '近 3 天'], ['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天'],
  ];
  const DATA_START = (() => { const d = new Date(NOW); d.setDate(d.getDate() - 89); d.setHours(0, 0, 0, 0); return d; })();
  /** 自定义时段的桶：两天内按小时，八天内每 3 小时，更长按天。 */
  function customWindow({start, end}) {
    const span = end - start, hour = 3600e3;
    const unit = span <= 48 * hour ? 'hour' : span <= 8 * 24 * hour ? '3h' : 'day';
    const bucket = {hour: hour, '3h': 3 * hour, day: 24 * hour}[unit];
    const s = new Date(start);
    if (unit === 'day') s.setHours(0, 0, 0, 0); else { s.setMinutes(0, 0, 0); if (unit === '3h') s.setHours(s.getHours() - s.getHours() % 3); }
    return {start: s, end: new Date(end), bucket, unit, prevLabel: '前一等长时段', custom: true};
  }
  function window_(range) {
    if (typeof range === 'object') return customWindow(range);
    const end = new Date(NOW);
    const hour = 3600e3, day = 864e5;
    const floorHour = d => { const x = new Date(d); x.setMinutes(0, 0, 0); return x; };
    const floorDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    switch (range) {
      case 'today': return {start: floorDay(end), end, bucket: hour, unit: 'hour', prevLabel: '昨天同时段'};
      case '24h': return {start: new Date(floorHour(end) - 23 * hour), end, bucket: hour, unit: 'hour', prevLabel: '前 24 小时'};
      case '3d': return {start: new Date(floorHour(end) - (floorHour(end).getHours() % 3) * hour - 23 * 3 * hour), end, bucket: 3 * hour, unit: '3h', prevLabel: '前 3 天'};
      case '7d': return {start: new Date(floorDay(end) - 6 * day), end, bucket: day, unit: 'day', prevLabel: '前 7 天'};
      case '30d': return {start: new Date(floorDay(end) - 29 * day), end, bucket: day, unit: 'day', prevLabel: '前 30 天'};
      default: return {start: new Date(floorDay(end) - 89 * day), end, bucket: day, unit: 'day', prevLabel: '前 90 天'};
    }
  }
  const pad2 = n => String(n).padStart(2, '0');
  const md = d => `${d.getMonth() + 1}月${d.getDate()}日`;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function sum(records) {
    const s = {cost: 0, priced: true, input: 0, cached: 0, output: 0, requests: 0, audioSec: 0};
    for (const r of records) {
      if (r.cost == null) s.priced = false; else s.cost += r.cost;
      s.input += r.input; s.cached += r.cached; s.output += r.output; s.requests += r.requests; s.audioSec += r.audioSec || 0;
    }
    return s;
  }

  const heatTotals = () => ({value: 0, requests: 0, input: 0, output: 0, models: {}});
  function addHeatRecord(cell, r) {
    cell.value += r.cost || 0;
    cell.requests += r.requests;
    cell.input += r.input;
    cell.output += r.output;
    cell.models[r.model] = (cell.models[r.model] || 0) + r.requests;
  }

  /** 按范围与提供商筛选后的完整视图：总计、对比、时间桶、明细、用途与时段矩阵。 */
  function view(range, provider = 'all') {
    const w = window_(range);
    const pick = r => provider === 'all' || r.provider === provider;
    const inWin = RECORDS.filter(r => r.at >= w.start && r.at < w.end && pick(r));
    const span = w.end - w.start;
    const prev = RECORDS.filter(r => r.at >= new Date(w.start - span) && r.at < w.start && pick(r));
    const buckets = [];
    for (let t = w.start.getTime(); t < w.end.getTime(); t += w.bucket) {
      const d = new Date(t);
      const label = w.unit === 'day' ? `${md(d)} 周${WEEK[d.getDay()]}` : `${md(d)} ${pad2(d.getHours())}:00–${pad2(d.getHours() + (w.unit === '3h' ? 3 : 1))}:00`;
      const short = w.unit === 'day' ? `${d.getMonth() + 1}/${d.getDate()}` : w.unit === '3h' && d.getHours() === 0 ? `${d.getMonth() + 1}/${d.getDate()}` : `${pad2(d.getHours())}时`;
      buckets.push({key: t, start: d, label, short, values: {}, records: []});
    }
    for (const r of inWin) {
      const b = buckets[Math.min(buckets.length - 1, Math.floor((r.at - w.start) / w.bucket))];
      b.records.push(r);
      b.values[r.provider] = (b.values[r.provider] || 0) + (r.cost || 0);
    }
    // 行集合只随提供商筛选变化，不随时间范围增减，切换范围时表格高度不变；没有请求的行显示为空
    const used = new Set(RECORDS.map(r => r.model));
    const byProvider = PROVIDERS.filter(p => provider === 'all' || p.key === provider).map(p => {
      const rs = inWin.filter(r => r.provider === p.key);
      const models = p.models.filter(m => used.has(m)).map(m => ({model: m, ...sum(rs.filter(r => r.model === m))}));
      return {...p, ...sum(rs), modelsUsed: models};
    }).filter(p => p.modelsUsed.length);
    const purposes = Object.entries(PURPOSES).map(([k, label]) => ({key: k, label, ...sum(inWin.filter(r => r.purpose === k))}));
    // 星期 × 小时：行为周一到周日
    const hours = Array.from({length: 7 * 24}, (_, i) => ({row: Math.floor(i / 24), col: i % 24, ...heatTotals()}));
    for (const r of inWin) {
      const c = hours[((r.at.getDay() + 6) % 7) * 24 + r.at.getHours()];
      addHeatRecord(c, r);
    }
    return {window: w, total: sum(inWin), prev: sum(prev), buckets, byProvider, purposes, hours};
  }

  /** 近 13 周的逐日费用与用量，用于日历热力图。 */
  function calendar(provider = 'all') {
    const days = [];
    const end = new Date(NOW); end.setHours(0, 0, 0, 0);
    for (let i = 90; i >= 0; i--) {
      const d = new Date(end); d.setDate(d.getDate() - i);
      days.push({date: d, ...heatTotals()});
    }
    const byDay = new Map(days.map(day => [+day.date, day]));
    for (const r of RECORDS) {
      if (provider !== 'all' && r.provider !== provider) continue;
      const day = byDay.get(+new Date(r.at.getFullYear(), r.at.getMonth(), r.at.getDate()));
      if (day) addHeatRecord(day, r);
    }
    return days;
  }

  // ---------------------------------------------------------------- 格式化
  const money = (v, {approx = true} = {}) => {
    if (v == null) return '—';
    const s = v === 0 ? '0.00' : v < 0.01 ? v.toFixed(4) : v < 0.1 ? v.toFixed(3) : v < 100 ? v.toFixed(2) : v.toFixed(0);
    return `${approx ? '≈ ' : ''}$${s}`;
  };
  const tokens = n => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
  const delta = (now, before) => {
    if (!before) return null;
    const pct = Math.round((now - before) / before * 100);
    return pct === 0 ? '与上期持平' : `${pct > 0 ? '↑' : '↓'} ${Math.abs(pct)}%`;
  };

  // 示例会话「整理竞品表」的本次运行与会话累计，用于对话内的费用显示
  const SESSION = {
    model: 'deepseek-v4-pro', peak: false,
    run: {input: 148200, cached: 96400, output: 6900, cost: costOf({model: 'deepseek-v4-pro', at: new Date(2026, 10, 20, 14, 30), input: 148200, cached: 96400, output: 6900})},
    sessionCost: 0.214,
  };

  /** 某星期（0=周一）某小时（本机时间）是否落在 DeepSeek 高峰：取最近一周的对应时刻换算。 */
  function peakAt(row, hour) {
    const d = new Date(NOW); d.setHours(hour, 30, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + row);
    return isPeak(d);
  }

  return {NOW, DATA_START, BILLED, windowOf: window_, peakAt, PRICING_UPDATED, SOURCES, PRICES, PROVIDERS, PURPOSES, RANGES, RECORDS, view, calendar, money, tokens, delta, costOf, isPeak, SESSION, TRANSCRIBE_PER_MIN};
})();
