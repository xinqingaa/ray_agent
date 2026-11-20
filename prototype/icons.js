// 线描图标（Lucide 风格，24 栅格，1.75 线宽）。原型内自绘，不依赖网络。
const ICON_PATHS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M7.5 18.5 4 20l1-3.6A7.5 7.5 0 1 1 7.5 18.5Z"/>',
  chats: '<path d="M14 9.5a5.5 5.5 0 0 1-8.2 4.8L3 15l.8-2.6A5.5 5.5 0 1 1 14 9.5Z"/><path d="M10.6 17.6A5.5 5.5 0 0 0 18.2 19L21 20l-.8-2.6a5.5 5.5 0 0 0-3.4-8.2"/>',
  folder: '<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3.6l2 2.2h7.4a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>',
  folderOpen: '<path d="M3.5 17V7.5a2 2 0 0 1 2-2h3.6l2 2.2h6.4a2 2 0 0 1 2 2V11"/><path d="M3.5 17.5 6 11.8a1.6 1.6 0 0 1 1.5-1h12a1 1 0 0 1 .9 1.4l-2.3 5.4a1.6 1.6 0 0 1-1.5 1H5a1.5 1.5 0 0 1-1.5-1.1Z"/>',
  spark: '<path d="M12 3.5 13.7 9a2 2 0 0 0 1.3 1.3l5.5 1.7-5.5 1.7a2 2 0 0 0-1.3 1.3L12 20.5 10.3 15A2 2 0 0 0 9 13.7L3.5 12 9 10.3A2 2 0 0 0 10.3 9Z"/>',
  box: '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sun: '<circle cx="12" cy="12" r="3.6"/><path d="M12 3v1.6M12 19.4V21M3 12h1.6M19.4 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M5.6 18.4l1.1-1.1M17.3 6.7l1.1-1.1"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10Z"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M9.5 4.5v15"/>',
  panelRight: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M14.5 4.5v15"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".55"/>',
  library: '<path d="M5 4.5v15M9 4.5v15"/><path d="m13.2 5.2 3.6-.9 3.4 14.4-3.6.9Z"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5Z"/>',
  clip: '<path d="m19 11.5-7 7a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.3 4.3l-7.3 7.3a1.5 1.5 0 0 1-2.1-2.1l6.6-6.6"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5"/>',
  chevronRight: '<path d="m9.5 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9.5 6 6 6-6"/>',
  pin: '<path d="M9 4.5h6l-1 5 3.5 3v1.5h-11V12.5l3.5-3Z"/><path d="M12 14.5V20"/>',
  undo: '<path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5H14a5.5 5.5 0 0 1 0 11h-2"/>',
  pencil: '<path d="M14.5 5.5 18.5 9.5 9 19H5v-4Z"/><path d="m12.5 7.5 4 4"/>',
  history: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/><path d="M12 8v4.2l2.8 1.8"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5s-1.1 5.9-3.6 8.5c-2.5-2.6-3.6-5.5-3.6-8.5S9.5 6.1 12 3.5Z"/>',
  file: '<path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12Z"/><path d="M13.5 3.5V8.5h5"/>',
  fileText: '<path d="M6.5 3.5h7.5l4.5 4.5v12.5h-12Z"/><path d="M13.5 3.5V8.5h5M9 12.5h6M9 16h6"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  repeat: '<path d="M4.5 11V9.5a3 3 0 0 1 3-3h11l-3-3M19.5 13v1.5a3 3 0 0 1-3 3h-11l3 3"/>',
  chart: '<path d="M4.5 19.5h15"/><path d="M7 16v-4.5M11 16V7.5M15 16v-6M19 16V5"/>',
  mic: '<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
  key: '<circle cx="8" cy="15" r="3.8"/><path d="m10.8 12.3 7.7-7.7M15.5 7.5l2.2 2.2M13.4 9.6l1.6 1.6"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.3c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2 0 2.8 5.4 1.4 5.4 4.2 0 1.2-1.2 2-2.8 2-1.2 0-2.3-.6-2.7-1.5M12 6.3v1.6M12 16.1v1.6"/>',
  gauge: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="m12 13 3.5-4"/>',
  list: '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9"/><circle cx="4.8" cy="12" r=".9"/><circle cx="4.8" cy="17" r=".9"/>',
  listChecks: '<path d="m3.5 7 1.6 1.6L8 5.7M3.5 15l1.6 1.6L8 13.7M11.5 7H20M11.5 15H20"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.3-3 7.6-7 9-4-1.4-7-4.7-7-9V6Z"/>',
  grip: '<circle cx="9" cy="6.5" r="1.1"/><circle cx="15" cy="6.5" r="1.1"/><circle cx="9" cy="12" r="1.1"/><circle cx="15" cy="12" r="1.1"/><circle cx="9" cy="17.5" r="1.1"/><circle cx="15" cy="17.5" r="1.1"/>',
  quote: '<path d="M5 17.5c1.8-.5 3-2 3-4.5V8.5H4.5V13H8M14 17.5c1.8-.5 3-2 3-4.5V8.5h-3.5V13H17"/>',
  bookmark: '<path d="M7 4.5h10v15l-5-3.5-5 3.5Z"/>',
  wand: '<path d="m4.5 19.5 10-10M13 6l1-2.5L15 6l2.5 1L15 8l-1 2.5L13 8l-2.5-1ZM18.5 13l.6-1.5.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6Z"/>',
  inbox: '<path d="M3.5 13.5 6 5.5h12l2.5 8V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18Z"/><path d="M3.5 13.5h5l1.2 2.2h4.6l1.2-2.2h5"/>',
  maximize: '<path d="M14.5 4.5h5v5M9.5 19.5h-5v-5M19.5 4.5 13.5 10.5M4.5 19.5l6-6"/>',
  finder: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><path d="M12 4.5c-1.4 3.5-1.8 7-.8 10.5M8.5 9.5v1M15.5 9.5v1M8 15.5c2.4 1.4 5.6 1.4 8 0"/>',
  alert: '<path d="M12 4 21 19.5H3Z"/><path d="M12 10v4M12 17v.01"/>',
  dot: '<circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>',
  hex: '<path d="M12 3.5 19.5 7.8v8.4L12 20.5 4.5 16.2V7.8Z"/><path d="M12 8.5v7M8.8 10.2l6.4 3.6M15.2 10.2l-6.4 3.6"/>',
  wave: '<path d="M3.5 13c2.2 0 2.2-4 4.3-4s2.1 6 4.2 6 2.1-6 4.2-6 2.1 4 4.3 4"/>',
  ring: '<circle cx="12" cy="12" r="7.5"/>',
  brand: '<path d="M7 20V5h6a4.2 4.2 0 0 1 0 8.4H7"/><path d="m12.5 13.4 4.5 6.6"/>',
};

function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`;
}

// 文件类型字标：浅色底 + 类型缩写，颜色只区分类型，不传达状态
const FILE_KINDS = {
  pdf: {label: 'PDF', hue: 'rose'},
  xlsx: {label: 'XLS', hue: 'green'},
  csv: {label: 'CSV', hue: 'green'},
  docx: {label: 'DOC', hue: 'blue'},
  md: {label: 'MD', hue: 'slate'},
  txt: {label: 'TXT', hue: 'slate'},
  png: {label: 'IMG', hue: 'violet'},
  json: {label: '{ }', hue: 'amber'},
};

function fileGlyph(name, size = '') {
  const ext = name.split('.').pop().toLowerCase();
  const kind = FILE_KINDS[ext] || {label: ext.slice(0, 3).toUpperCase(), hue: 'slate'};
  return `<span class="glyph glyph-${kind.hue} ${size}" aria-hidden="true">${kind.label}</span>`;
}
