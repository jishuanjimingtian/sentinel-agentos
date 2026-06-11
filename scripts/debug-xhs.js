const puppeteer = require('puppeteer');
const path = require('path');

const USER_DATA = path.join(__dirname, '..', '.browser-data', 'redbook');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 900 },
    args: ['--no-sandbox'],
    userDataDir: USER_DATA,
  });

  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Check what page we're on
  const url = page.url();
  console.log('Current URL:', url);

  if (!url.includes('creator.xiaohongshu.com')) {
    await page.goto('https://creator.xiaohongshu.com/publish/publish', {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });
  }

  await sleep(3000);

  // Take a full screenshot to see the page
  await page.screenshot({ path: path.join(__dirname, '..', 'promo', 'debug-xhs1.png'), fullPage: true });
  console.log('Saved debug-xhs1.png');

  // Dump all iframes
  const iframeInfo = await page.evaluate(() => {
    const iframes = document.querySelectorAll('iframe');
    return Array.from(iframes).map(f => ({
      src: f.src.slice(0, 100),
      className: f.className.slice(0, 50),
    }));
  });
  console.log('Iframes:', JSON.stringify(iframeInfo, null, 2));

  // Dump all input/textarea/contenteditable
  const editorInfo = await page.evaluate(() => {
    const elements = [];
    document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]').forEach(el => {
      elements.push({
        tag: el.tagName,
        type: el.getAttribute('type'),
        class: el.className?.slice(0, 60),
        placeholder: el.getAttribute('placeholder')?.slice(0, 40),
        contentEditable: el.getAttribute('contenteditable'),
        role: el.getAttribute('role'),
        rect: JSON.stringify(el.getBoundingClientRect()),
      });
    });
    return elements;
  });
  console.log('Editor elements:', JSON.stringify(editorInfo, null, 2));

  // Dump button texts
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button, span, div[role="button"]')).filter(el => {
      const t = el.textContent?.trim();
      return t && t.length < 20 && t.length > 0;
    }).slice(0, 20).map(el => ({
      text: el.textContent?.trim(),
      tag: el.tagName,
      class: el.className?.slice(0, 40),
    }));
  });
  console.log('Buttons:', JSON.stringify(buttons, null, 2));

  await browser.close();
  console.log('Done.');
})();
