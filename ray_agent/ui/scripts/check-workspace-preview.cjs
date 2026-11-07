/* eslint-disable @typescript-eslint/no-require-imports */
// 预览来源地址：附件按文件 ID，文件夹文件按 root_id 加相对路径；票据按路径签发并缓存，文件夹文件不提供下载。
const assert = require('node:assert/strict');
const {createLoader} = require('./workspace-loader.cjs');

const posts = [];
globalThis.fetch = async (url, init) => {
  posts.push({url: String(url), method: init?.method ?? 'GET'});
  return new Response(JSON.stringify({data: {ticket: `T${posts.length}`, expires_at: Date.now() + 10 * 60_000}}), {headers: {'content-type': 'application/json'}});
};
const load = createLoader({'@/lib/platform': {openExternal: async () => {}, saveBytes: async () => {}, saveResource: async () => {}}});
load('src/lib/core-client.ts').setCoreConnection({baseUrl: 'http://core/api', token: 'secret'});
const preview = load('src/lib/api/preview.ts');

const attachment = {kind: 'attachment', id: 'f/1', filename: 'a.txt'};
const tricky = {kind: 'root', rootId: 'root 1', path: '报告/第 1 章?#.md', filename: '第 1 章?#.md'};
const plain = {kind: 'root', rootId: 'root 1', path: 'readme.md', filename: 'readme.md'};

(async () => {
  assert.equal(preview.previewEndpoint(attachment), '/files/f%2F1/preview');
  // 根内路径放在查询串里，特殊字符被编码；同一路径地址稳定，不同路径地址不同
  const endpoint = preview.previewEndpoint(tricky);
  assert.equal(endpoint.split('?')[0], '/roots/root%201/preview');
  assert.equal(new URLSearchParams(endpoint.split('?')[1]).get('path'), tricky.path);
  assert.equal(preview.previewEndpoint(tricky), endpoint);
  assert.notEqual(preview.previewEndpoint(plain), endpoint);

  // 内容地址逐段编码：路径分隔符保留，`?` `#` 不会截断路径
  assert.equal(preview.rootContentPath('root 1', tricky.path), '/roots/root%201/preview/content/%E6%8A%A5%E5%91%8A/%E7%AC%AC%201%20%E7%AB%A0%3F%23.md');

  // 票据：按路径签发，命中缓存不重复签发，换路径重新签发；令牌不出现在 URL
  const first = new URL(await preview.previewContentUrl(tricky));
  assert.equal(first.origin + first.pathname, `http://core/api${preview.rootContentPath('root 1', tricky.path)}`);
  assert.equal(first.searchParams.get('ticket'), 'T1');
  assert.ok(!first.href.includes('secret'));
  assert.match(posts[0].url, /\/roots\/root%201\/preview\/ticket\?path=/);
  assert.equal(posts[0].method, 'POST');
  await preview.previewContentUrl(tricky);
  assert.equal(posts.length, 1, '同一路径复用票据');
  const second = new URL(await preview.previewContentUrl(plain, 'rev-2'));
  assert.equal(posts.length, 2, '另一路径单独签发');
  assert.equal(second.searchParams.get('ticket'), 'T2');
  assert.equal(second.searchParams.get('revision'), 'rev-2');
  const viaAttachment = new URL(await preview.previewContentUrl(attachment));
  assert.equal(viaAttachment.pathname, '/api/files/f%2F1/preview/content');
  assert.equal(posts.length, 3);

  // 下载：附件可以，文件夹文件不提供
  assert.equal(preview.canDownload(attachment), true);
  assert.equal(preview.canDownload(tricky), false);
  await assert.rejects(preview.downloadPreviewSource(tricky), /不提供下载/);
  await preview.downloadPreviewSource(attachment);

  console.log('workspace preview source checks passed');
})().catch((error) => { console.error(error); process.exit(1); });
