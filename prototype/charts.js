// RayChart：与框架无关的 SVG 图表。
// layout* 只做几何计算并返回纯数据，可在 React 中直接映射为 <rect>/<path>/<text>；
// render* 把布局转成 SVG 字符串，供原型使用。颜色全部经 CSS 变量传入，深浅主题由样式切换，组件不读主题。
// 约定：不依赖 DOM，不持有状态；悬停说明由调用方经 tip 回调给出，挂在比图形更大的透明命中区上。
const RayChart = (() => {
  const r1 = v => Math.round(v * 10) / 10;
  const escText = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));

  /** 取 0 起点的整齐刻度：返回上限与步长，刻度数约为 count。 */
  function niceScale(maxValue, count = 4) {
    if (!(maxValue > 0)) return {max: 1, step: 0.25};
    const raw = maxValue / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw - 1e-12);
    return {max: step * Math.ceil(maxValue / step - 1e-9), step};
  }

  /** 顶部两角圆、底部贴基线的柱形路径。 */
  function roundTopPath(x, y, w, h, radius) {
    const r = Math.max(0, Math.min(radius, w / 2, h));
    return `M${r1(x)},${r1(y + h)}V${r1(y + r)}Q${r1(x)},${r1(y)} ${r1(x + r)},${r1(y)}H${r1(x + w - r)}Q${r1(x + w)},${r1(y)} ${r1(x + w)},${r1(y + r)}V${r1(y + h)}Z`;
  }

  /**
   * 堆叠柱状图布局。
   * buckets: [{key, label, short?, values: {seriesKey: number}}]，series: [{key}]（顺序即自下而上的堆叠顺序）。
   * 返回 bars[{key,label,total,slotX,slotW,segments[{series,value,x,y,w,h,top}]}]、ticks、xLabels、baseline。
   */
  function stackedBars({buckets, series, width, height, pad = {t: 10, r: 6, b: 24, l: 44}, gap = 2, maxBar = 26,
                        barRatio = 0.62, minLabelGap = 46, format = String}) {
    const iw = Math.max(1, width - pad.l - pad.r), ih = Math.max(1, height - pad.t - pad.b);
    const totals = buckets.map(b => series.reduce((sum, s) => sum + (b.values[s.key] || 0), 0));
    const {max, step} = niceScale(Math.max(0, ...totals));
    const slot = iw / Math.max(1, buckets.length);
    const bw = Math.max(2, Math.min(maxBar, slot * barRatio));
    const y = v => pad.t + ih - (v / max) * ih;
    const bars = buckets.map((b, i) => {
      const x = pad.l + slot * i + (slot - bw) / 2;
      const segments = [];
      let acc = 0;
      for (const s of series) {
        const value = b.values[s.key] || 0;
        if (value <= 0) continue;
        const top = y(acc + value), bottom = y(acc);
        // 段间留 gap 像素的底色缝：上层段整体上移，不压缩最底一段
        const h = Math.max(0, bottom - top - (segments.length ? gap : 0));
        segments.push({series: s.key, value, x, y: top, w: bw, h, top: false});
        acc += value;
      }
      if (segments.length) segments[segments.length - 1].top = true;
      return {key: b.key, label: b.label, total: totals[i], slotX: pad.l + slot * i, slotW: slot, segments};
    });
    const ticks = [];
    for (let i = 0; i * step <= max + step / 1000; i++) { const v = +(i * step).toPrecision(12); ticks.push({value: v, y: y(v), label: format(v)}); }
    const every = Math.max(1, Math.ceil(minLabelGap / slot));
    const xLabels = buckets.map((b, i) => ({x: pad.l + slot * i + slot / 2, label: b.short ?? b.label, index: i}))
      .filter(l => l.index % every === 0);
    return {width, height, pad, bars, ticks, xLabels, baseline: y(0), max};
  }

  /**
   * 矩阵热力图布局（日历与「星期 × 小时」共用）。
   * cells: [{row, col, value, key?, label?}]；levels 为色阶数（含 0 级“无用量”）。
   * 色阶按非零值的分位数切分，少数高峰不会把其余格子压成同一档。
   */
  function matrix({cells, rows, cols, cell = 12, gap = 3, levels = 5, pad = {t: 18, r: 2, b: 2, l: 28},
                   rowLabels = [], colLabels = []}) {
    const nonzero = cells.map(c => c.value).filter(v => v > 0).sort((a, b) => a - b);
    const cuts = [];
    for (let k = 1; k < levels - 1; k++) cuts.push(nonzero[Math.floor((k / (levels - 1)) * nonzero.length)] ?? Infinity);
    const level = v => (v > 0 ? 1 + cuts.filter(c => v > c).length : 0);
    const pitch = cell + gap;
    return {
      width: pad.l + cols * pitch - gap + pad.r,
      height: pad.t + rows * pitch - gap + pad.b,
      cell, levels,
      cells: cells.map(c => ({...c, x: pad.l + c.col * pitch, y: pad.t + c.row * pitch, size: cell, level: level(c.value)})),
      rowLabels: rowLabels.map(l => ({...l, x: pad.l - 6, y: pad.t + l.row * pitch + cell / 2})),
      colLabels: colLabels.map(l => ({...l, x: pad.l + l.col * pitch, y: pad.t - 6})),
      thresholds: cuts,
    };
  }

  /** 日历适配：days [{date: Date, value, ...}] 按周一为首的列排开，返回 matrix 所需的 cells 与月份列标签。 */
  function calendarCells(days, monthLabel = d => `${d.getMonth() + 1}月`) {
    if (!days.length) return {cells: [], cols: 0, colLabels: []};
    const first = days[0].date;
    const offset = (first.getDay() + 6) % 7;
    const cells = days.map((d, i) => ({...d, row: (offset + i) % 7, col: Math.floor((offset + i) / 7)}));
    const colLabels = [];
    // 月份标在该月第一个完整周所在列；与上一个标签相邻时让位，避免文字重叠
    let lastMonth = cells[0].date.getMonth(), pending = null; // 首个不完整的月份不标
    for (const c of cells) {
      if (c.date.getMonth() !== lastMonth) { lastMonth = c.date.getMonth(); pending = c; }
      if (pending && c.row === 0 || pending && c.row <= 3 && c === pending) {
        const col = c.col;
        if (!colLabels.length || col - colLabels[colLabels.length - 1].col >= 3) colLabels.push({col, label: monthLabel(pending.date)});
        pending = null;
      }
    }
    return {cells, cols: cells[cells.length - 1].col + 1, colLabels};
  }

  // ---------------------------------------------------------------- 字符串渲染（原型用）

  /** 宽度由调用方按容器实测传入布局，SVG 按 1:1 像素绘制，文字不随缩放变形。
   * colorOf(seriesKey) → CSS 颜色；classOf(bar, i) → 额外类名；tip(bar) 可选，给出时挂在命中区的 data-tip 上。
   * 每根柱子的各段包在 <g class="rc-bar" data-i> 中，命中区带同样的 data-i，调用方据此做悬停高亮、点击下钻与键盘导航。
   * focusable 为真时整张图只占一个 Tab 位，由调用方用方向键移动当前柱。 */
  function renderStackedBars(L, {colorOf, tip = null, ariaLabel, className = '', classOf = () => '', focusable = false}) {
    const grid = L.ticks.map(t => `<line class="rc-grid" x1="${L.pad.l}" x2="${L.width - L.pad.r}" y1="${r1(t.y)}" y2="${r1(t.y)}"/>
      <text class="rc-axis" x="${L.pad.l - 8}" y="${r1(t.y)}" text-anchor="end" dominant-baseline="middle">${escText(t.label)}</text>`).join('');
    const marks = L.bars.map((b, i) => `<g class="rc-bar ${classOf(b, i)}" data-i="${i}">${b.segments.map(s => s.top
      ? `<path d="${roundTopPath(s.x, s.y, s.w, s.h, 4)}" fill="${colorOf(s.series)}"/>`
      : `<rect x="${r1(s.x)}" y="${r1(s.y)}" width="${r1(s.w)}" height="${r1(s.h)}" fill="${colorOf(s.series)}"/>`).join('')}</g>`).join('');
    const hits = L.bars.map((b, i) => `<rect class="rc-hit" data-i="${i}" x="${r1(b.slotX)}" y="${L.pad.t}" width="${r1(b.slotW)}" height="${r1(L.baseline - L.pad.t)}"${tip ? ` data-tip="${escText(tip(b))}"` : ''}/>`).join('');
    const xl = L.xLabels.map(l => `<text class="rc-axis" data-i="${l.index}" x="${r1(l.x)}" y="${L.height - 6}" text-anchor="middle">${escText(l.label)}</text>`).join('');
    return `<svg class="rc rc-bars ${className}" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="img" aria-label="${escText(ariaLabel)}"${focusable ? ' tabindex="0"' : ''}>
      ${grid}<line class="rc-base" x1="${L.pad.l}" x2="${L.width - L.pad.r}" y1="${r1(L.baseline)}" y2="${r1(L.baseline)}"/>
      <g class="rc-marks">${marks}</g>${xl}<g class="rc-hits">${hits}</g></svg>`;
  }

  /** fillOf(level) → CSS 颜色；tip(cell) 可选，给出时挂 data-tip；classOf(cell) → 额外类名（选中、淡出、标注等状态）。
   * 每格带 data-i（cells 下标）与 data-row/data-col，行列标签带同名属性，调用方据此做悬停联动与键盘导航。
   * focusable 为真时整张图只占一个 Tab 位，由调用方用方向键移动当前格（roving focus）。 */
  function renderMatrix(L, {fillOf, tip = null, ariaLabel, className = '', classOf = () => '', focusable = false}) {
    const cells = L.cells.map((c, i) => `<rect class="rc-cell ${classOf(c, i)}" x="${c.x}" y="${c.y}" width="${c.size}" height="${c.size}" rx="3"
      fill="${fillOf(c.level)}" data-i="${i}" data-row="${c.row}" data-col="${c.col}" data-level="${c.level}"${tip ? ` data-tip="${escText(tip(c))}"` : ''}/>`).join('');
    const rl = L.rowLabels.map(l => `<text class="rc-axis" data-row="${l.row}" x="${l.x}" y="${l.y}" text-anchor="end" dominant-baseline="middle">${escText(l.label)}</text>`).join('');
    const cl = L.colLabels.map(l => `<text class="rc-axis" data-col="${l.col}" x="${l.x}" y="${l.y}">${escText(l.label)}</text>`).join('');
    return `<svg class="rc rc-matrix ${className}" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="img" aria-label="${escText(ariaLabel)}"${focusable ? ' tabindex="0"' : ''}>${rl}${cl}${cells}</svg>`;
  }

  /** 色阶图例：从“少”到“多”；每档带 data-level，调用方可在悬停时突出该档的格子。 */
  function renderLegendScale(levels, fillOf, {low = '少', high = '多', interactive = false} = {}) {
    const sw = Array.from({length: levels}, (_, i) => `<rect class="rc-swatch" data-level="${i}" x="${i * 14}" y="0" width="11" height="11" rx="3" fill="${fillOf(i)}"/>`).join('');
    return `<span class="rc-scale ${interactive ? 'interactive' : ''}"><span>${low}</span><svg viewBox="0 0 ${levels * 14 - 3} 11" width="${levels * 14 - 3}" height="11" aria-hidden="true">${sw}</svg><span>${high}</span></span>`;
  }

  return {niceScale, roundTopPath, stackedBars, matrix, calendarCells, renderStackedBars, renderMatrix, renderLegendScale};
})();
if (typeof module !== 'undefined') module.exports = RayChart;
