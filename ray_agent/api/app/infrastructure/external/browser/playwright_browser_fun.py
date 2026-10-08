"""有界 DOM 观察。每个文本节点只提取一次，引用不依赖页面列表位置。"""
OBSERVE_PAGE = r"""({mode, scope, target, observation, firstIndex}) => {
    const maxNodes = 30000, maxChars = 1000000, maxElements = 500;
    let nodes = 0, chars = 0, incomplete = false;
    const visible = el => {
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && s.visibility !== 'collapse'
            && s.opacity !== '0' && !el.hidden && el.getAttribute('aria-hidden') !== 'true';
    };
    const inViewport = rect => rect.width > 0 && rect.height > 0 && rect.bottom > 0 &&
        rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    const visibleTree = el => { for (let n=el; n; n=n.parentElement) if (!visible(n)) return false; return true; };
    const root = target ? document.querySelector(`[data-ray-ref="${CSS.escape(target)}"]`)
        : scope === 'document' && mode === 'text'
            ? [...document.querySelectorAll('main, article, [role="main"]')].find(visibleTree) || document.body : document.body;
    if (!root || !visibleTree(root)) throw new Error('观察目标不存在，请重新读取页面');
    const copy = node => {
        if (++nodes > maxNodes || chars >= maxChars) { incomplete = true; return null; }
        if (node.nodeType === Node.TEXT_NODE) {
            if (scope === 'viewport') {
                const range = document.createRange(); range.selectNodeContents(node);
                if (![...range.getClientRects()].some(inViewport)) return null;
            }
            const text = node.textContent.slice(0, maxChars - chars);
            if (text.length < node.textContent.length) incomplete = true;
            chars += text.length;
            return document.createTextNode(text);
        }
        if (node.nodeType !== Node.ELEMENT_NODE ||
            ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','SVG','CANVAS'].includes(node.tagName) || !visible(node)) return null;
        const out = document.createElement(node.tagName);
        for (const attr of ['href','src','alt','colspan','rowspan']) {
            if (node.hasAttribute(attr)) out.setAttribute(attr, node.getAttribute(attr));
        }
        for (const child of node.childNodes) {
            if (nodes >= maxNodes || chars >= maxChars) { incomplete = true; break; }
            const value = copy(child); if (value) out.appendChild(value);
        }
        return out;
    };
    const html = mode === 'interactive' ? '' : (copy(root)?.outerHTML || '');
    const elements = [];
    if (mode !== 'text') {
        window.__rayAgentRefs = new Map();
        const candidates = root.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="checkbox"],[contenteditable="true"],[tabindex]');
        const withRoot = root.matches('input,textarea,select,button,a,[contenteditable="true"]') ? [root, ...candidates] : candidates;
        let scanned = 0;
        for (const el of withRoot) {
            if (++scanned > maxNodes) { incomplete = true; break; }
            if (!el.checkVisibility({checkOpacity:true, checkVisibilityCSS:true}) || !visible(el) ||
                (scope === 'viewport' && !inViewport(el.getBoundingClientRect()))) continue;
            if (elements.length >= maxElements) { incomplete = true; break; }
            const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/)
                .map(id => document.getElementById(id)?.textContent || '').join(' ').trim();
            const name = (el.getAttribute('aria-label') || labelled || [...(el.labels || [])].map(l => l.innerText).join(' ') ||
                el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '').trim().slice(0,240);
            const index = firstIndex + elements.length, ref = `${observation}-${index}`;
            el.setAttribute('data-ray-ref', ref);
            window.__rayAgentRefs.set(ref, {node:el, index, tag:el.tagName.toLowerCase(), href:el.getAttribute('href'), type:el.getAttribute('type'), name});
            elements.push({index, ref, tag:el.tagName.toLowerCase(), role:el.getAttribute('role'), name,
                type:el.getAttribute('type'), href:el.getAttribute('href'),
                value:el.type === 'password' ? '[redacted]' : typeof el.value === 'string' ? el.value.slice(0,500) : null,
                disabled:!!el.disabled, checked:typeof el.checked === 'boolean' ? el.checked : null,
                expanded:el.getAttribute('aria-expanded')});
        }
    }
    return {html, elements, incomplete, extraction_limits:{nodes:maxNodes, chars:maxChars, elements:maxElements}};
}"""
