/* TradeDesk Setup Studio: single, isolated event controller. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let image = null, workerPromise = null, canvas = null;

  function status(message, error=false) {
    const el=$('ocrStatus'); if(el){el.textContent=message;el.style.color=error?'#ff9cab':'';}
  }
  function preview(file) {
    if(!file) return;
    if(file.type && !file.type.startsWith('image/')) { status('Please select an image file.',true); return; }
    const reader=new FileReader();
    reader.onerror=()=>status('Could not read this image. Please choose a JPG or PNG screenshot.',true);
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        image=img; window.tdUploadedImage=img;
        const box=$('imagePreview');
        if(box){box.replaceChildren(img);img.style.cssText='display:block;max-width:100%;max-height:360px;width:auto;height:auto;object-fit:contain;margin:auto';}
        status('Screenshot loaded and preview ready. Tap READ to extract the printed prices.');
        if($('ocrCandidates')) $('ocrCandidates').textContent='';
      };
      img.onerror=()=>status('The selected image could not be opened. Try a JPG or PNG screenshot.',true);
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  }
  function loadOCR(){
    if(workerPromise) return workerPromise;
    workerPromise=new Promise((resolve,reject)=>{
      if(window.Tesseract) return resolve(window.Tesseract);
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR engine did not initialize.'));
      s.onerror=()=>reject(new Error('Could not load OCR. Check your internet connection and retry.'));
      document.head.appendChild(s);
    }).then(T=>T.createWorker('eng',1,{logger:m=>{
      if(m.status==='recognizing text')status('READ is working… '+Math.round((m.progress||0)*100)+'%');
    }}));
    return workerPromise;
  }
  function cleanPrice(s){
    let v=String(s||'').replace(/\s/g,'').replace(/[^0-9.,]/g,'');
    if(v.includes(',')&&v.includes('.')) v=v.lastIndexOf(',')>v.lastIndexOf('.')?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,'');
    else if(v.includes(',')){const n=v.length-v.lastIndexOf(',')-1;v=n<=2?v.replace(',','.'):v.replace(/,/g,'');}
    const n=Number(v);return Number.isFinite(n)&&n>0?String(n):'';
  }
  function read(){
    const btn=$('ocrBtn');
    if(!image){status('Select a chart screenshot first.',true);return;}
    btn.disabled=true;btn.textContent='READ is working…';
    (async()=>{
      try{
        const worker=await loadOCR(), result=await worker.recognize(image), raw=result.data?.text||'';
        const upper=raw.toUpperCase(), found={};
        const labels=[['tp1',/TP\s*1/],['tp2',/TP\s*2/],['tp3',/TP\s*3/],['tp4',/TP\s*4/],['tp5',/TP\s*5/],['sl',/(?:STOP\s*LOSS|STOPLOSS|\bSL\b)/]];
        const lines=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
        const number=line=>{const m=line.match(/\d[\d.,]*/g)||[];for(const x of m){const v=cleanPrice(x);if(v)return v;}return '';};
        for(let i=0;i<lines.length;i++)for(const [key,re] of labels){
          if(found[key]||!re.test(lines[i]))continue;
          let v=number(lines[i].replace(re,' '));
          if(!v)for(let j=i+1;j<Math.min(lines.length,i+3);j++){if(labels.some(([,r])=>r.test(lines[j])))break;v=number(lines[j]);if(v)break;}
          if(v)found[key]=v;
        }
        const sym=upper.match(/\b([A-Z0-9]{2,15})\s*(?:\.P)?\s*USDT\b/)||upper.match(/\b(BTC|ETH|XLM|XRP|SOL|ADA|BNB|DOGE|LTC|BCH|SUI|AVAX|LINK|DOT|TRX)\b/);
        if(sym)$('symbol').value=sym[1].toUpperCase()+'USDT';
        const tf=upper.match(/\b(1M|3M|5M|15M|30M|1H|2H|4H|6H|12H|1D|1W)\b/);
        if(tf){const o=[...$('chartTf').options].find(x=>x.value===tf[1].toLowerCase());if(o)$('chartTf').value=o.value;}
        if(/\bLONG\b/.test(upper)!==/\bSHORT\b/.test(upper))$('direction').value=/\bLONG\b/.test(upper)?'LONG':'SHORT';
        for(const k of ['tp1','tp2','tp3','tp4','tp5','sl'])if(found[k]&&!$(k).value.trim())$(k).value=found[k];
        const applied=Object.entries(found).map(([k,v])=>k.toUpperCase()+': '+v);
        status('READ completed. Verify every extracted price and confirm the direction before generating.');
        $('ocrCandidates').textContent=(applied.length?'Detected: '+applied.join(' · '):'No reliable labeled prices detected.')+(raw?'\n\nRecognized text:\n'+raw.slice(0,1600):'\nNo readable text found.');
      }catch(e){workerPromise=null;status('READ error: '+(e.message||'Unable to read screenshot.'),true);}
      finally{btn.disabled=false;btn.textContent='READ · Detect symbol, direction & prices';}
    })();
  }
  function generate(){
    const get=id=>($(id)?.value||'').trim();
    const symbol=get('symbol').toUpperCase().replace(/USDT$/,'');
    const side=get('direction').toUpperCase(), entry=Number(get('entry')), sl=Number(get('sl'));
    const tps=[1,2,3,4,5].map(i=>Number(get('tp'+i)));
    const err=$('setupError');err.textContent='';
    if(!symbol||!get('entry')||!get('sl')||[1,2,3,4,5].some(i=>!get('tp'+i))){err.textContent='Complete Symbol, Entry, TP1–TP5 and Stop Loss.';return;}
    if(!['LONG','SHORT'].includes(side)){err.textContent='Confirm LONG or SHORT direction.';return;}
    if(![entry,sl,...tps].every(n=>Number.isFinite(n)&&n>0)){err.textContent='All prices must be valid positive numbers.';return;}
    const ordered=side==='LONG'?sl<entry&&entry<tps[0]&&tps.every((v,i)=>!i||tps[i-1]<v):sl>entry&&entry>tps[0]&&tps.every((v,i)=>!i||tps[i-1]>v);
    if(!ordered){err.textContent=side==='LONG'?'LONG order: SL < ENTRY < TP1 < TP2 < TP3 < TP4 < TP5.':'SHORT order: SL > ENTRY > TP1 > TP2 > TP3 > TP4 > TP5.';return;}
    const lines=[symbol+' '+side+' TRADE SETUP','','ENTRY: '+get('entry'),'','TP1: '+get('tp1'),'TP2: '+get('tp2'),'TP3: '+get('tp3'),'TP4: '+get('tp4'),'TP5: '+get('tp5'),'','SL: '+get('sl'),'','RISK 1% OR LESS'];
    if(get('invalid'))lines.push('',get('invalid').toUpperCase());
    $('signalText').textContent=lines.join('\n');
    canvas=document.createElement('canvas');
    if(image){canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;const c=canvas.getContext('2d');c.drawImage(image,0,0);c.strokeStyle=side==='LONG'?'#23c98b':'#ff647c';c.lineWidth=Math.max(3,Math.round(canvas.width*.006));c.strokeRect(c.lineWidth/2,c.lineWidth/2,canvas.width-c.lineWidth,canvas.height-c.lineWidth);}
    else{canvas.width=1600;canvas.height=900;const c=canvas.getContext('2d');c.fillStyle='#080e18';c.fillRect(0,0,1600,900);c.fillStyle=side==='LONG'?'#23c98b':'#ff647c';c.font='bold 42px Arial';c.fillText(symbol+' '+side+' TRADE SETUP',70,95);c.fillStyle='#eaf2ff';c.font='bold 30px Arial';lines.slice(2).filter(Boolean).forEach((s,i)=>c.fillText(s,80,180+i*65));}
    const out=new Image();out.onload=()=>{const box=$('chartOutput');box.replaceChildren(out);out.style.cssText='display:block;width:100%;height:auto';};out.src=canvas.toDataURL('image/png');
    $('downloadImageBtn').disabled=false;
    status('Setup generated. Check the signal text and image before publishing.');
    try{const h=JSON.parse(localStorage.getItem('td_history')||'[]');h.unshift({type:'Trade setup',summary:symbol+' '+side+' · Entry '+get('entry'),time:new Date().toLocaleString()});localStorage.setItem('td_history',JSON.stringify(h.slice(0,30)));}catch(_){}
  }

  // Capture-phase delegation prevents the legacy handlers in index.html from racing this controller.
  document.addEventListener('change',e=>{
    if(e.target?.id!=='chartFile')return;
    e.stopImmediatePropagation();preview(e.target.files?.[0]);
  },true);
  document.addEventListener('click',e=>{
    const id=e.target?.closest?.('#ocrBtn,#generateBtn,#downloadImageBtn')?.id;
    if(!id)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(id==='ocrBtn')read();
    if(id==='generateBtn')generate();
    if(id==='downloadImageBtn'&&canvas)canvas.toBlob(blob=>{if(!blob)return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=(($('symbol').value||'trade').toUpperCase())+'_setup.png';a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);},'image/png');
  },true);
})();
