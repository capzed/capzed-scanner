/* TradeDesk Setup Studio recovery module.
   Runs independently of the main app script so image preview and OCR remain usable
   even if an unrelated scanner script has a JavaScript error. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  let selectedImage = null;
  let objectUrl = null;
  let workerPromise = null;

  function setStatus(message, error) {
    const el = byId('ocrStatus');
    if (el) {
      el.textContent = message;
      el.style.color = error ? '#ff9cab' : '';
    }
  }

  function showPreview(file) {
    const preview = byId('imagePreview');
    if (!preview) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function () {
      selectedImage = img;
      window.tdUploadedImage = img;
      preview.replaceChildren(img);
      img.style.display = 'block';
      img.style.maxWidth = '100%';
      img.style.maxHeight = '360px';
      img.style.width = 'auto';
      img.style.height = 'auto';
      img.style.objectFit = 'contain';
      setStatus('Screenshot loaded. Tap READ to detect the symbol and printed TP/SL prices.');
      const candidates = byId('ocrCandidates');
      if (candidates) candidates.textContent = '';
    };
    img.onerror = function () {
      selectedImage = null;
      window.tdUploadedImage = null;
      setStatus('The selected image could not be opened. Try a JPG or PNG screenshot.', true);
    };
    img.src = objectUrl;
  }

  function getWorker() {
    if (workerPromise) return workerPromise;
    workerPromise = new Promise((resolve, reject) => {
      if (window.Tesseract) return resolve(window.Tesseract);
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR engine did not initialize.'));
      script.onerror = () => reject(new Error('Could not load the free OCR engine. Check your internet connection.'));
      document.head.appendChild(script);
    }).then(T => T.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') setStatus('READ is working… ' + Math.round((m.progress || 0) * 100) + '%');
      }
    }));
    return workerPromise;
  }

  function cleanPrice(value) {
    let s = String(value || '').replace(/\s/g, '').replace(/[^0-9.,]/g, '');
    if (!s) return '';
    if (s.includes(',') && s.includes('.')) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const tail = s.length - s.lastIndexOf(',') - 1;
      s = tail > 0 && tail <= 8 ? s.replace(',', '.') : s.replace(/,/g, '');
    }
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? String(n) : '';
  }

  function extract(text, words) {
    const result = {};
    const lines = String(text || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const labels = [
      ['tp1', /\bTP\s*1\b/i], ['tp2', /\bTP\s*2\b/i],
      ['tp3', /\bTP\s*3\b/i], ['tp4', /\bTP\s*4\b/i],
      ['tp5', /\bTP\s*5\b/i], ['sl', /\b(?:SL|STOP\s*LOSS|STOPLOSS)\b/i]
    ];
    const number = line => {
      const cleaned = line.replace(/\b(?:TP\s*[1-5]|SL|STOP\s*LOSS|STOPLOSS|ENTRY)\b/ig, ' ');
      const matches = cleaned.match(/\d[\d.,]*/g) || [];
      for (const token of matches) {
        const v = cleanPrice(token);
        if (v) return v;
      }
      return '';
    };
    for (let i = 0; i < lines.length; i++) {
      for (const [key, re] of labels) {
        if (result[key] || !re.test(lines[i])) continue;
        let v = number(lines[i]);
        if (!v) {
          for (let j = i + 1; j < Math.min(lines.length, i + 3); j++) {
            if (labels.some(([, other]) => other.test(lines[j]))) break;
            v = number(lines[j]);
            if (v) break;
          }
        }
        if (v) result[key] = v;
      }
    }
    const upper = String(text || '').toUpperCase();
    const sym = upper.match(/\b([A-Z0-9]{2,15})\s*(?:\.P)?\s*USDT\b/);
    if (sym) result.symbol = sym[1] + 'USDT';
    else {
      const bare = upper.match(/\b(BTC|ETH|XLM|XRP|SOL|ADA|BNB|DOGE|LTC|BCH|SUI|AVAX|LINK|DOT|TRX)\s*(?:USDT)?\b/);
      if (bare) result.symbol = bare[1] + 'USDT';
    }
    const tf = upper.match(/\b(1M|3M|5M|15M|30M|1H|2H|4H|6H|12H|1D|1W)\b/);
    if (tf) result.timeframe = tf[1].toLowerCase();
    if (/\bLONG\b/.test(upper) !== /\bSHORT\b/.test(upper)) result.direction = /\bLONG\b/.test(upper) ? 'LONG' : 'SHORT';

    // Use OCR word positions only to associate a printed label with a nearby price.
    // This is a fallback when line-based OCR split the label and number apart.
    if (Array.isArray(words)) {
      for (let i = 0; i < words.length; i++) {
        const label = String(words[i].text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const key = /^TP[1-5]$/.test(label) ? label.toLowerCase() : (label === 'SL' || label === 'STOPLOSS' ? 'sl' : '');
        if (!key || result[key] || !words[i].bbox) continue;
        const a = words[i].bbox;
        const cy = (a.y0 + a.y1) / 2;
        const candidates = words.filter(w => w !== words[i] && w.bbox && /^[0-9][0-9.,]*$/.test(String(w.text || '').trim()))
          .map(w => ({ w, dy: Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - cy), dx: w.bbox.x0 - a.x1 }))
          .filter(x => x.dy < Math.max(24, (a.y1 - a.y0) * 1.8) && x.dx > -10 && x.dx < 500)
          .sort((x, y) => x.dy - y.dy || x.dx - y.dx);
        if (candidates.length) result[key] = cleanPrice(candidates[0].w.text);
      }
    }
    return result;
  }

  async function readScreenshot() {
    const btn = byId('ocrBtn');
    if (!selectedImage) {
      setStatus('Please select a chart screenshot first.', true);
      return;
    }
    btn.disabled = true;
    btn.textContent = 'READ is working…';
    const candidates = byId('ocrCandidates');
    if (candidates) candidates.textContent = '';
    let worker;
    try {
      worker = await getWorker();
      setStatus('Reading printed labels and prices…');
      const result = await worker.recognize(selectedImage);
      const raw = result.data && result.data.text || '';
      const found = extract(raw, result.data && result.data.words);
      const applied = [];
      for (const key of ['symbol', 'timeframe', 'direction', 'tp1', 'tp2', 'tp3', 'tp4', 'tp5', 'sl']) {
        if (!found[key]) continue;
        const el = byId(key === 'timeframe' ? 'chartTf' : key);
        if (el && (key === 'symbol' || key === 'timeframe' || key === 'direction' || !el.value.trim())) {
          el.value = found[key];
          applied.push(key.toUpperCase() + ': ' + found[key]);
        }
      }
      const confidence = Number(result.data && result.data.confidence);
      setStatus('READ completed. ' + (Number.isFinite(confidence) ? 'OCR confidence: ' + Math.round(confidence) + '%. ' : '') + 'Verify all extracted values before generating the setup.');
      if (candidates) candidates.textContent = (applied.length ? 'Detected: ' + applied.join(' · ') : 'No reliable labeled prices detected.') + (raw ? '\n\nRecognized text:\n' + raw.slice(0, 1600) : '\nNo readable text found.');
    } catch (error) {
      setStatus('READ error: ' + (error && error.message ? error.message : 'Unable to read this screenshot. Retry with a clear image and internet connection.'), true);
      workerPromise = null;
    } finally {
      btn.disabled = false;
      btn.textContent = 'READ · Detect symbol, direction & prices';
    }
  }

  function bind() {
    const file = byId('chartFile');
    const read = byId('ocrBtn');
    if (file) file.addEventListener('change', event => {
      const selected = event.target.files && event.target.files[0];
      if (!selected) return;
      if (!selected.type || !selected.type.startsWith('image/')) {
        setStatus('Please select an image file.', true);
        return;
      }
      showPreview(selected);
    });
    if (read) read.onclick = readScreenshot;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
