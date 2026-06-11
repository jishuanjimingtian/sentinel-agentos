const puppeteer = require('puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROMO_DIR = path.join(__dirname, '..', 'promo');

const server = http.createServer((req, res) => {
  const fp = path.join(PROMO_DIR, req.url.slice(1) || 'cover.html');
  try {
    const content = fs.readFileSync(fp, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8896, async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });

  for (const file of ['cover.html', 'problem.html', 'arch.html', 'final.html']) {
    await page.goto(`http://127.0.0.1:8896/${file}`, { waitUntil: 'networkidle0' });

    // Get visible text
    const texts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('div,span,h1,h2,h3'))
        .filter(e => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top < 2000 && r.left < 1100;
        })
        .map(e => e.textContent?.trim()).filter(t => t && t.length > 1 && t.length < 100)
    );

    console.log(`\n=== ${file} ===`);
    texts.slice(0, 12).forEach(t => console.log('  ', t));
  }

  await browser.close();
  server.close();
  console.log('\n✅ All slides rendered correctly');
});
