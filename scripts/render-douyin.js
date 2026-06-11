// Create WebM video by serving frames and recording via MediaRecorder
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROMO_DIR = path.join(__dirname, '..', 'promo');
const FRAMES_DIR = path.join(PROMO_DIR, 'frames');
const FPS = 30;
const DURATION = 6;
const TOTAL = FPS * DURATION;

// Serve frames directory
const server = http.createServer((req, res) => {
  const file = path.join(FRAMES_DIR, req.url.slice(1));
  if (fs.existsSync(file) && file.endsWith('.png')) {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    fs.createReadStream(file).pipe(res);
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(9876);
console.log('Server on :9876');

(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;background:black">
<canvas id="c" width="1080" height="1920"></canvas>
<script>
const ctx = document.getElementById('c').getContext('2d');
const FPS = ${FPS};
const TOTAL = ${TOTAL};

const stream = document.getElementById('c').captureStream(FPS);
const recorder = new MediaRecorder(stream, {
  mimeType: 'video/webm;codecs=vp9',
  videoBitsPerSecond: 6000000
});
const chunks = [];
recorder.ondataavailable = e => chunks.push(e.data);
recorder.onstop = () => {
  const blob = new Blob(chunks, {type: 'video/webm'});
  const reader = new FileReader();
  reader.onload = () => { window.__result = reader.result; window.__done = true; };
  reader.readAsDataURL(blob);
};

let idx = 0;
const pad = (n) => String(n).padStart(5, '0');
const img = new Image();
img.onload = () => {
  ctx.drawImage(img, 0, 0, 1080, 1920);
  idx++;
  if (idx === 1) recorder.start();
  if (idx < TOTAL) {
    img.src = 'http://127.0.0.1:9876/frame-' + pad(idx) + '.png';
  } else {
    setTimeout(() => recorder.stop(), 100);
  }
};
img.onerror = (e) => { console.error('Load error frame ' + idx, e); };
img.src = 'http://127.0.0.1:9876/frame-' + pad(0) + '.png';
</script>
</body></html>`;

  await page.setContent(html, { waitUntil: 'load' });

  console.log(`Replaying ${TOTAL} frames...`);
  await page.waitForFunction(() => window.__done === true, { timeout: 60000 });

  const result = await page.evaluate(() => window.__result);
  const base64 = result.split(',')[1];
  const mp4Path = path.join(PROMO_DIR, 'douyin.webm');
  fs.writeFileSync(mp4Path, Buffer.from(base64, 'base64'));

  await browser.close();
  server.close();

  const sizeMB = (fs.statSync(mp4Path).size / 1024 / 1024).toFixed(1);
  console.log(`Done! Video: ${mp4Path} (${sizeMB} MB)`);
  
  // Also copy to desktop
  const desktopPath = path.join(process.env.USERPROFILE, 'Desktop', 'douyin-sentinel-agentos.mp4');
  fs.copyFileSync(mp4Path, desktopPath);
  console.log(`Copied to desktop: ${desktopPath}`);
})();
