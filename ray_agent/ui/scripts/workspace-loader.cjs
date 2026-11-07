/* eslint-disable @typescript-eslint/no-require-imports */
// 工作区检查脚本共用：把真实的 TS 模块转译后载入，`stubs` 按模块路径替换边界依赖（平台、网络）。
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');

const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');

function createLoader(stubs = {}) {
  const cache = new Map();
  function load(relative) {
    const filename = path.join(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const loaded = {exports: {}};
    cache.set(filename, loaded);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    new Function('require', 'module', 'exports', compiled)((name) => {
      if (name in stubs) return stubs[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name);
        const file = ['.ts', '.tsx'].map((ext) => base + ext).find((candidate) => fs.existsSync(candidate));
        if (!file) throw new Error(`找不到模块 ${name}`);
        return load(path.relative(root, file));
      }
      return localRequire(name);
    }, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}

module.exports = {createLoader, localRequire};
