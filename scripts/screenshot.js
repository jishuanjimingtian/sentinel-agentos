const puppeteer = require('puppeteer');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PROMO_DIR = path.join(__dirname, '..', 'promo');

const SLIDES = [
  { file: 'cover.html', output: 'cover.png' },
  { file: 'problem.html', output: 'problem.png' },
  { file: 'arch.html', output: 'arch.png' },
  { file: 'final.html', output: 'final.png' },
];

// Simple HTTP server to serve promo files
const server = http.createServer((req, res) => {
  const filePath = path.join(PROMO_DIR, req.url.slice(1) || 'cover.html');
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

server.listen(8899, async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  for (const slide of SLIDES) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 2 });

    const url = `http://127.0.0.1:8899/${slide.file}`;
    console.log(`Rendering: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 10000 });

    const outputPath = path.join(PROMO_DIR, slide.output);
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`Saved: ${slide.output} (${fs.statSync(outputPath).size} bytes)`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log('Done!');
});
