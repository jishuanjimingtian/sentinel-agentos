const puppeteer = require('puppeteer');

const TEXT = `我给我的 AI Agent 装了个操作系统

不是套壳！不是换皮！是真正从零写的 Agent 内核。

做 Agent 的都知道这几个痛点：
幻觉——AI 一不留神就 rm -rf /
越权——全放不安全，全禁没法用
失忆——上一轮说的偏好，下一轮全忘
没法评估——AI 到底好不好？心里没数

所以我写了一个开源项目

Sentinel AgentOS（哨兵）

不是 Agent，是 Agent 的操作系统。

三层架构：
Guard 守卫层——零 LLM 确定性代码，自动拦截危险操作
Memory 记忆层——人脑式三层记忆，越用越懂你
Evaluator 评估层——不看赞踩看行为自动评估

危险操作自动拦截：
npm install sentinel-agentos
sentinel-agentos validate exec rm -rf /
直接给你拦下来

一行安装，五行接入，任何框架都能用
TypeScript · MIT 开源 · 99 测试通过

GitHub: github.com/jishuanjimingtian/sentinel-agentos
npm: sentinel-agentos

#AI #开源 #Agent #TypeScript #程序员 #AI安全`;

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: null,
  });

  const page = (await browser.pages()).find(p => p.url().includes('xiaohongshu'));
  if (!page) { console.log('Page not found'); return; }

  // Method: inject text directly into React/Vue component via innerText + trigger input event
  const result = await page.evaluate((text) => {
    // Find the contenteditable div
    const ce = document.querySelector('[contenteditable="true"]');
    if (!ce) return 'no contenteditable';

    // Clear it
    ce.innerHTML = '';

    // Split text by newlines and create elements
    const lines = text.split('\n');
    for (const line of lines) {
      if (line === '') {
        ce.appendChild(document.createElement('br'));
      } else {
        const span = document.createElement('span');
        span.textContent = line;
        ce.appendChild(span);
      }
      ce.appendChild(document.createElement('br'));
    }

    // Dispatch input event to tell React/Vue about the change
    ce.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
    ce.dispatchEvent(new Event('change', { bubbles: true }));

    // Also try to trigger the framework's synthetic event
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;
    if (nativeInputValueSetter) {
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => {
        nativeInputValueSetter.call(ta, text);
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }

    return 'ok: ' + ce.innerText.slice(0, 80);
  }, TEXT);

  console.log('Inject result:', result);

  if (result?.includes('ok')) {
    console.log('Text injected into editor!');
  }

  await new Promise(r => setTimeout(r, 1000));
  await browser.disconnect();
  console.log('Done. Check the browser window!');
})();
