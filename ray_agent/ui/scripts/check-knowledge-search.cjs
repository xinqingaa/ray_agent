/* eslint-disable @typescript-eslint/no-require-imports */
// 知识检索框检查：连续快速输入不丢字、IME 组合态不提前发起检索/覆盖、外部 URL 同步与建议/清除动作。
const assert = require('node:assert/strict');
const React = require('react');
const {create, act} = require('react-test-renderer');
const {createLoader} = require('./workspace-loader.cjs');
global.IS_REACT_ACT_ENVIRONMENT = true;

let currentUrlSearch = '';
const paramCommits = [];
const searchCalls = [];

function notifyRouter(nextSearch) {
  currentUrlSearch = nextSearch;
}

let forceRerender = null;

global.window = {
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
  matchMedia: () => ({matches: false}),
  addEventListener() {},
  removeEventListener() {},
};
global.document = {hidden: false, addEventListener() {}, removeEventListener() {}};
global.ResizeObserver = class {
  observe() {}
  disconnect() {}
};

let delayedAsyncMode = false;
const deferredUrlCommits = [];

const load = createLoader({
  './knowledge-page.css': {},
  '@/components/ui/icons': new Proxy({}, {get: () => () => null}),
  '@/components/ui/button': {Button: props => React.createElement('button', props, props.children)},
  '@/components/ui/dialog': {
    Dialog: ({children}) => React.createElement('div', null, children),
    DialogContent: ({children}) => React.createElement('div', null, children),
    DialogDescription: ({children}) => React.createElement('p', null, children),
    DialogTitle: ({children}) => React.createElement('h2', null, children),
  },
  '@/components/ui/segmented-control': {SegmentedControl: () => null},
  '@/components/run/file-icon': {
    fileExtension: name => (name.includes('.') ? '.' + name.split('.').pop() : ''),
    FileTypeBadge: () => null,
  },
  '@/components/workspace/workspace-switch': {WorkspaceSwitch: () => null},
  '@/components/workspace/knowledge-source': {
    HitText: ({text}) => text,
    KnowledgeSource: () => null,
    SOURCE_ICON: {},
    SOURCE_LABEL: {document_chunk: '文档', memory: '记忆', session_summary: '摘要'},
    sourceCaption: () => '',
    sourceTitle: hit => hit.title || '',
  },
  '@/lib/api/documents': {
    documentsApi: {
      page: async () => ({
        items: [{relative_path: '项目计划.md', status: 'searchable'}],
      }),
    },
  },
  '@/lib/api/components': {componentsApi: {list: async () => []}},
  '@/lib/api/fetch': {ApiError: class extends Error {}},
  '@/lib/api/memory': {
    memoryApi: {
      search: async (_wsId, body) => {
        searchCalls.push(body);
        return {hits: [], execution: {}};
      },
    },
  },
  '@/lib/api/workspace': {operationApi: {}},
  '@/lib/drafts': {
    addDraftReference: () => 'added',
    referenceKey: hit => hit?.id ?? 'k0',
    workspaceDraftScope: id => `ws:${id}`,
  },
  '@/lib/navigation': {Link: props => React.createElement('a', props, props.children)},
  '@/lib/motion': {motionEasing: () => 'ease'},
  '@/lib/utils': {cn: (...v) => v.filter(Boolean).join(' '), formatFileSize: () => '0 B'},
  '@/lib/workspace-route': {workspaceHref: id => `/workspaces/${id}`},
  '@/providers/workspace-live-provider': {useWorkspaceLive: () => ({change: {signal: 0}})},
  'react-router': {
    useLocation: () => ({pathname: '/workspaces/w1/knowledge', search: currentUrlSearch ? `?${currentUrlSearch}` : ''}),
    useNavigate: () => () => {},
    useOutletContext: () => ({}),
    useSearchParams: () => {
      const [, bump] = React.useReducer(x => x + 1, 0);
      forceRerender = bump;
      const params = new URLSearchParams(currentUrlSearch);
      const setParams = (updaterOrInit) => {
        const next = typeof updaterOrInit === 'function'
          ? updaterOrInit(new URLSearchParams(currentUrlSearch))
          : new URLSearchParams(updaterOrInit);
        const encoded = next.toString();
        paramCommits.push(encoded);
        if (delayedAsyncMode) {
          deferredUrlCommits.push(() => {
            notifyRouter(encoded);
            bump();
          });
        } else {
          notifyRouter(encoded);
          bump();
        }
      };
      return [params, setParams];
    },
  },
  sonner: {toast: {success() {}, message() {}}},
});

const {KnowledgeSearch} = load('src/components/workspace/knowledge-page.tsx');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const workspace = {id: 'w1', name: '验收工作区', status: 'active', folder: {status: 'available'}};
  let tree;
  await act(async () => {
    tree = create(React.createElement(KnowledgeSearch, {
      workspace,
      visible: true,
      revision: '0:0',
      semantic: {state: 'empty'},
    }));
    await sleep(20);
  });

  const input = () => tree.root.findByProps({'aria-label': '检索工作区知识'});

  // 1. 延迟异步路由提交下的连续快速输入不丢字
  delayedAsyncMode = true;
  await act(async () => {
    input().props.onChange({target: {value: 'a'}, nativeEvent: {isComposing: false}});
  });
  await sleep(170); // 第一次 URL sync 发出，尚未被路由提交
  assert.equal(deferredUrlCommits.length, 1);

  await act(async () => {
    input().props.onChange({target: {value: 'ab'}, nativeEvent: {isComposing: false}});
    input().props.onChange({target: {value: 'abc'}, nativeEvent: {isComposing: false}});
  });
  // 此时路由器迟到提交了旧的 'a'，输入框必须保持 'abc' 而不能回退到 'a'
  await act(async () => {
    deferredUrlCommits.shift()();
  });
  assert.equal(input().props.value, 'abc');

  await sleep(200);
  while (deferredUrlCommits.length) {
    await act(async () => {
      deferredUrlCommits.shift()();
    });
  }
  assert.equal(input().props.value, 'abc');
  assert.equal(new URLSearchParams(currentUrlSearch).get('q'), 'abc');
  delayedAsyncMode = false;

  // 2. IME 组合态期间保留中间文本，不提前请求检索也不写 URL；compositionend 后立即恢复提交
  const callsBeforeIme = searchCalls.length;
  const commitsBeforeIme = paramCommits.length;
  await act(async () => {
    input().props.onCompositionStart();
    input().props.onChange({target: {value: 'ni'}, nativeEvent: {isComposing: true}});
    input().props.onChange({target: {value: 'nihao'}, nativeEvent: {isComposing: true}});
  });
  assert.equal(input().props.value, 'nihao');
  await sleep(220);
  assert.equal(searchCalls.length, callsBeforeIme, '组合态中不得触发检索请求');
  assert.equal(paramCommits.length, commitsBeforeIme, '组合态中不得提交 URL');

  await act(async () => {
    input().props.onCompositionEnd({currentTarget: {value: '你好'}});
  });
  assert.equal(input().props.value, '你好');
  await sleep(250);
  assert.ok(searchCalls.length > callsBeforeIme);
  assert.equal(searchCalls.at(-1).query, '你好');
  assert.equal(new URLSearchParams(currentUrlSearch).get('q'), '你好');

  // 3. 清除按钮立即清空输入与 URL
  await act(async () => {
    tree.root.findByProps({'aria-label': '清除检索词'}).props.onClick();
  });
  assert.equal(input().props.value, '');
  assert.equal(new URLSearchParams(currentUrlSearch).get('q'), null);

  // 4. 点击推荐词立即更新输入与 URL；随后外部 URL 导航变化时同步回输入框
  await sleep(20);
  await act(async () => {
    tree.root.findByProps({title: '项目计划'}).props.onClick();
  });
  assert.equal(input().props.value, '项目计划');
  assert.equal(new URLSearchParams(currentUrlSearch).get('q'), '项目计划');

  await act(async () => {
    notifyRouter('q=外部回退');
    forceRerender();
  });
  assert.equal(input().props.value, '外部回退');

  await act(async () => {
    tree.unmount();
  });
  console.log('PASS: 知识检索框连续输入不丢字、IME 组合态保护、清除与外部 URL 同步正常');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
