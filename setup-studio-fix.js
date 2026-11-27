/* TradeDesk Setup Studio — screenshot + Entry only workflow. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let image=null, workerPromise=null, canvas=null, rows={}, ocrReady=false, busy=false;

  function status(message,error=false){
    const el=$('ocrStatus');
    if(el){el.textContent=message;el.style.color=error?'#ff9cab':'';}
  }
  function showDirection(side){
    const hidden=$('direction'),display=$('directionDisplay');
    if(hidden)hidden.value=side||'';
    if(display)display.value=side||'Not confidently detected';
  }
  function price(s){
    let v=String(s||'').replace(/\s/g,'').replace(/[^0-9.,]/g,'');
    if(v.includes(',')&&v.includes('.'))v=v.lastIndexOf(',')>v.lastIndexOf('.')?v.replace(/\./g,'').replace(',','.'):v.replace(/,/g,'');
    else if(v.includes(',')){const n=v.length-v.lastIndexOf(',')-1;v=n<=2?v.replace(',','.'):v.replace(/,/g,'');}
    else if(v.includes('.')){const n=v.length-v.lastIndexOf('.')-1;if(n===3)v=v.replace(/\./g,'');}
    const n=Number(v);return Number.isFinite(n)&&n>0?String(n):'';
  }
  function preview(file){
    if(!file)return;
    if(file.type&&!file.type.startsWith('image/')){status('Please select a chart image.',true);return;}
    const reader=new FileReader();
    reader.onerror=()=>status('Could not read this image. Try a JPG or PNG screenshot.',true);
    reader.onload=()=>{
      const img=new Image();
      img.onload=()=>{
        image=img;window.tdUploadedImage=img;rows={};canvas=null;ocrReady=false;
        const box=$('imagePreview');
        if(box){box.replaceChildren(img);img.style.cssText='display:block;max-width:100%;max-height:360px;width:auto;height:auto;object-fit:contain;margin:auto';}
        $('symbol').value='';showDirection('');
        ['tp1','tp2','tp3','tp4','tp5','sl'].forEach(id=>$(id).value='');
        $('signalText').textContent='Analysing screenshot…';
        $('chartOutput').textContent='Chart image will appear after automatic recognition and Entry.';
        $('downloadImageBtn').disabled=true;
        status('Screenshot loaded. Automatic recognition started…');
        analyse();
      };
      img.onerror=()=>status('This image could not be opened. Try a JPG or PNG screenshot.',true);
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  }
  function loadOCR(){
    if(workerPromise)return workerPromise;
    workerPromise=new Promise((resolve,reject)=>{
      if(window.Tesseract)return resolve(window.Tesseract);
      const s=document.createElement('script');
      s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR engine did not initialize.'));
      s.onerror=()=>reject(new Error('Could not load the free OCR engine. Check your internet connection.'));
      document.head.appendChild(s);
    });
    return workerPromise;
  }
  function fallbackWords(words){
    const found={},labelRows={},tokens=(words||[]).filter(w=>w&&w.bbox&&w.text).map((w,j)=>({
      text:String(w.text).trim().toUpperCase().replace(/[^A-Z0-9.,]/g,''),
      x0:w.bbox.x0,x1:w.bbox.x1,y:(w.bbox.y0+w.bbox.y1)/2,
      h:Math.max(1,w.bbox.y1-w.bbox.y0),confidence:w.confidence||50,j
    })).sort((a,b)=>a.y-b.y||a.x0-b.x0);
    const used=new Set();
    for(let i=0;i<tokens.length;i++){
      const t=tokens[i];let m=t.text.match(/^(?:TP|T[PPI])([1-5])$/),key=m?'tp'+m[1]:/^(?:SL|STOP|STOPLOSS|STOPL)$/.test(t.text)?'sl':null,end=i;
      if(!key&&/^(?:TP|T[PPI])$/.test(t.text)&&tokens[i+1]&&/^[1-5]$/.test(tokens[i+1].text)&&Math.abs(tokens[i+1].y-t.y)<Math.max(t.h,tokens[i+1].h)*1.8){key='tp'+tokens[i+1].text;end=i+1;}
      if(!key)continue;
      const label=tokens[end],tol=Math.max(18,label.h*2.2);
      labelRows[key]={y:label.y,x0:t.x0,x1:label.x1};
      if(found[key])continue;
      const candidates=tokens.map(w=>({w,d:Math.min(Math.abs(w.x0-label.x1),Math.abs(label.x0-w.x1))}))
        .filter(o=>!used.has(o.w.j)&&o.w.j!==t.j&&o.w.j!==label.j&&/^\d[\d.,]*$/.test(o.w.text)&&Math.abs(o.w.y-label.y)<tol&&o.d<Math.max(260,label.h*22))
        .sort((x,y)=>Math.abs(x.w.y-label.y)-Math.abs(y.w.y-label.y)||x.d-y.d||y.w.confidence-x.w.confidence);
      if(candidates.length){const c=candidates[0],v=price(c.w.text);if(v){found[key]=v;used.add(c.w.j);}}
    }
    return Object.assign(found,{_labelRows:labelRows});
  }
  function extract(raw,data,prepared){
    const text=String(raw||''),upper=text.toUpperCase();
    let values={};
    try{if(typeof window.parseOcrPrices==='function')values=window.parseOcrPrices(text)||{};}catch(_){}
    let wordValues={};
    try{if(typeof window.parseOcrWords==='function')wordValues=window.parseOcrWords(data.words,prepared.width)||{};}catch(_){}
    const fallback=fallbackWords(data.words);
    const labelRows=fallback._labelRows||{};delete fallback._labelRows;
    Object.assign(values,wordValues,fallback);
    values._labelRows=labelRows;
    const symbol=upper.match(/\b([A-Z0-9]{2,15})\s*(?:[\/_-]\s*)?USDT(?:\s*\.?\s*P)?\b/)||
      upper.match(/\b(BTC|ETH|XLM|XRP|SOL|ADA|BNB|DOGE|LTC|BCH|SUI|AVAX|LINK|DOT|TRX)\b/);
    if(symbol)values.symbol=symbol[1].toUpperCase()+'USDT';
    const tf=upper.match(/\b(1M|3M|5M|15M|30M|1H|2H|4H|6H|12H|1D|1W)\b/);
    if(tf)values.timeframe=tf[1].toLowerCase();
    try{
      if(typeof window.locateOcrLevelRows==='function')
        rows=window.locateOcrLevelRows(data.words,prepared.width,prepared.height,image.naturalWidth,image.naturalHeight)||{};
    }catch(_){rows={};}
    return values;
  }
  async function analyse(){
    if(!image||busy)return;
    busy=true;
    try{
      const T=await loadOCR();
      const worker=await T.createWorker('eng',1,{logger:m=>{
        if(m.status==='recognizing text')status('Reading chart… '+Math.round((m.progress||0)*100)+'%');
      }});
      try{
        let prepared=typeof window.preprocessOcrImage==='function'?window.preprocessOcrImage(image):image;
        let result=await worker.recognize(prepared);
        let values=extract(result.data.text,result.data,prepared);
        // If full-image OCR misses the labels, run a second pass on the right price-scale region.
        const missing=['tp1','tp2','tp3','tp4','tp5','sl'].some(k=>!values[k]);
        if(missing&&prepared!==image){
          const crop=document.createElement('canvas'),w=prepared.width,h=prepared.height;
          crop.width=Math.max(1,Math.round(w*.48));crop.height=h;
          crop.getContext('2d').drawImage(prepared,Math.round(w*.52),0,crop.width,h,0,0,crop.width,h);
          const second=await worker.recognize(crop);
          const right=extract(second.data.text,second.data,crop);
          for(const k of ['tp1','tp2','tp3','tp4','tp5','sl'])if(!values[k]&&right[k])values[k]=right[k];
          if(!values.symbol&&right.symbol)values.symbol=right.symbol;
        }
        if(values.symbol)$('symbol').value=values.symbol;
        if(values.timeframe){const option=[...$('chartTf').options].find(o=>o.value===values.timeframe);if(option)$('chartTf').value=option.value;}
        for(const k of ['tp1','tp2','tp3','tp4','tp5','sl'])if(values[k])$(k).value=price(values[k]);
        let side=null,reason='';
        const explicitLong=/\bLONG\b/.test(String(result.data.text||'').toUpperCase());
        const explicitShort=/\bSHORT\b/.test(String(result.data.text||'').toUpperCase());
        if(explicitLong!==explicitShort){side=explicitLong?'LONG':'SHORT';reason='direction label';}
        if(!side){
          const tps=[1,2,3,4,5].map(i=>Number($('tp'+i).value)).filter(n=>n>0);
          const up=tps.length>=2&&tps.every((n,i)=>!i||n>tps[i-1]);
          const down=tps.length>=2&&tps.every((n,i)=>!i||n<tps[i-1]);
          if(up!==down){side=up?'LONG':'SHORT';reason='target sequence';}
        }
        if(!side&&$('entry').value&&$('sl').value){
          const e=Number($('entry').value),s=Number($('sl').value);
          if(e>0&&s>0&&e!==s){side=s<e?'LONG':'SHORT';reason='Stop Loss relative to Entry';}
        }
        if(!side){
          const map=values._labelRows||{};
          const slY=map.sl?.y??rows.sl?.y;
          const tpYs=['tp1','tp2','tp3','tp4','tp5'].map(k=>map[k]?.y??rows[k]?.y).filter(Number.isFinite);
          if(Number.isFinite(slY)&&tpYs.length){
            const avg=tpYs.reduce((a,b)=>a+b,0)/tpYs.length;
            if(Math.abs(avg-slY)>4){side=avg<slY?'LONG':'SHORT';reason='TP labels above/below SL on chart';}
          }
        }
        showDirection(side);
        ocrReady=true;
        const missingFields=[...(!$('symbol').value?['symbol']:[]),...(!$('direction').value?['direction']:[]),...['tp1','tp2','tp3','tp4','tp5','sl'].filter(k=>!$(k).value)];
        const detected=['symbol','direction','tp1','tp2','tp3','tp4','tp5','sl'].filter(k=>$(k).value).map(k=>k.toUpperCase()+': '+$(k).value);
        const notice=$('autoLevels');
        if(notice)notice.textContent=(detected.length?'Detected automatically — '+detected.join(' · '):'No reliable trade levels detected.')+(missingFields.length?'\nStill missing: '+missingFields.join(', ').toUpperCase()+'. The app will not invent missing values.':'');
        status(missingFields.length?'Recognition finished, but some chart labels are unreadable. No signal was fabricated.':'Recognition complete. Enter your exact Entry to generate the setup.');
        tryAutoGenerate();
      }finally{try{await worker.terminate();}catch(_){}}
    }catch(e){
      ocrReady=false;status('Recognition error: '+(e.message||'Could not read this screenshot.'),true);
    }finally{busy=false;}
  }
  function makeSignal(){
    const sym=($('symbol').value||'').trim().toUpperCase().replace(/USDT$/,'');
    const side=$('direction').value,entry=Number($('entry').value),sl=Number($('sl').value);
    const tps=[1,2,3,4,5].map(i=>Number($('tp'+i).value));
    if(!sym||!side||!entry||!sl||tps.some(n=>!n))throw new Error('The screenshot did not provide every required field. TRADEDESK will not invent a price.');
    if(![entry,sl,...tps].every(n=>Number.isFinite(n)&&n>0))throw new Error('A detected price is invalid or unreadable.');
    const ordered=side==='LONG'?sl<entry&&entry<tps[0]&&tps.every((v,i)=>!i||tps[i-1]<v):sl>entry&&entry>tps[0]&&tps.every((v,i)=>!i||tps[i-1]>v);
    if(!ordered)throw new Error('Detected prices do not form a valid '+side+' sequence. The screenshot labels need clearer recognition; no values were changed.');
    return [sym+' '+side+' TRADE SETUP','','ENTRY: '+$('entry').value.trim(),'','TP1: '+$('tp1').value,'TP2: '+$('tp2').value,'TP3: '+$('tp3').value,'TP4: '+$('tp4').value,'TP5: '+$('tp5').value,'','SL: '+$('sl').value,'','RISK 1% OR LESS'].join('\n');
  }
  function generate(){
    const err=$('setupError');err.textContent='';
    let text;
    try{text=makeSignal();}catch(e){err.textContent=e.message;return false;}
    $('signalText').textContent=text;
    canvas=document.createElement('canvas');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    const c=canvas.getContext('2d');c.drawImage(image,0,0);
    const w=canvas.width,h=canvas.height;
    for(const [key,row] of Object.entries(rows)){
      const y=Math.max(0,Math.min(h-1,Math.round(row.y)));
      c.save();c.strokeStyle=key==='sl'?'#ff4058':'#21d69a';c.globalAlpha=.92;
      c.lineWidth=Math.max(2,Math.round(w*.0018));c.setLineDash([Math.max(5,w*.006),Math.max(4,w*.004)]);
      c.beginPath();c.moveTo(w*.035,y);c.lineTo(w*.975,y);c.stroke();c.restore();
    }
    const accent=$('direction').value==='LONG'?'#23c98b':'#ff647c';
    c.save();c.strokeStyle=accent;c.lineWidth=Math.max(3,Math.round(w*.005));c.strokeRect(c.lineWidth/2,c.lineWidth/2,w-c.lineWidth,h-c.lineWidth);c.restore();
    const out=new Image();out.onload=()=>{$('chartOutput').replaceChildren(out);out.style.cssText='display:block;width:100%;height:auto;object-fit:contain';};
    out.src=canvas.toDataURL('image/png');
    $('downloadImageBtn').disabled=false;
    status('Setup and chart image generated from the screenshot and your Entry.');
    return true;
  }
  function tryAutoGenerate(){
    if(!ocrReady||!image||!$('entry').value.trim())return;
    if(!$('direction').value&&$('sl').value){
      const e=Number($('entry').value),s=Number($('sl').value);
      if(e>0&&s>0&&e!==s)showDirection(s<e?'LONG':'SHORT');
    }
    if(['symbol','direction','tp1','tp2','tp3','tp4','tp5','sl'].some(k=>!$(k).value.trim()))return;
    generate();
  }
  document.addEventListener('change',e=>{
    if(e.target?.id!=='chartFile')return;
    e.stopImmediatePropagation();preview(e.target.files?.[0]);
  },true);
  document.addEventListener('input',e=>{
    if(e.target?.id==='entry')tryAutoGenerate();
  },true);
  document.addEventListener('click',e=>{
    const id=e.target?.closest?.('#ocrBtn,#generateBtn,#downloadImageBtn')?.id;
    if(!id)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(id==='ocrBtn')analyse();
    if(id==='generateBtn')generate();
    if(id==='downloadImageBtn'&&canvas)canvas.toBlob(blob=>{
      if(!blob)return;const url=URL.createObjectURL(blob),a=document.createElement('a');
      a.href=url;a.download=(($('symbol').value||'trade').toUpperCase())+'_setup.png';a.click();
      setTimeout(()=>URL.revokeObjectURL(url),1500);
    },'image/png');
  },true);
})();