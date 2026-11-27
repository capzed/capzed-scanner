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
    else if(v.includes(','))v=v.includes(',,')?v.replace(/,/g,''):v.replace(',','.');
    else if((v.match(/\./g)||[]).length>1){const last=v.lastIndexOf('.');v=v.slice(0,last).replace(/\./g,'')+v.slice(last);}
    const n=Number(v);return Number.isFinite(n)&&n>0?String(n):'';
  }
  // Reject OCR readings on a wildly different price scale from the trade.
  // Never guess where a missing decimal belongs: an implausible reading stays blank.
  function rejectScaleMismatches(values){
    const entry=Number($('entry')?.value),sl=Number(values.sl||$('sl')?.value);
    const anchor=entry>0?entry:(sl>0?sl:0),rejected=[];
    if(!anchor)return rejected;
    for(const key of ['tp1','tp2','tp3','tp4','tp5']){
      const raw=values[key];if(!raw)continue;
      const n=Number(price(raw));if(!(n>0))continue;
      const ratio=n/anchor;
      if(!Number.isFinite(ratio)||ratio<0.01||ratio>100){
        rejected.push(key.toUpperCase()+': '+raw);
        delete values[key];
      }
    }
    return rejected;
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
    // OCR engines sometimes split a decimal price into separate words:
    // "0" + "." + "12825". Rebuild adjacent numeric fragments before matching.
    const numericGroups=[];
    for(let i=0;i<tokens.length;i++){
      if(!/^[0-9.,]+$/.test(tokens[i].text))continue;
      const parts=[tokens[i]];let last=tokens[i];
      for(let j=i+1;j<tokens.length;j++){
        const q=tokens[j],dy=Math.abs(q.y-last.y),dx=q.x0-last.x1;
        if(dy>Math.max(4,last.h*.45)||dx< -2||dx>Math.max(7,last.h*.85)||!/^[0-9.,]+$/.test(q.text))break;
        parts.push(q);last=q;
      }
      if(parts.length>1){
        const joined=parts.map(p=>p.text).join('');
        if(/[0-9]/.test(joined))numericGroups.push({
          text:joined,x0:parts[0].x0,x1:parts[parts.length-1].x1,
          y:parts.reduce((s,p)=>s+p.y,0)/parts.length,
          h:Math.max(...parts.map(p=>p.h)),
          confidence:Math.min(...parts.map(p=>p.confidence)),
          j:parts[0].j,_parts:parts.map(p=>p.j)
        });
      }
    }
    for(let i=0;i<tokens.length;i++){
      const t=tokens[i];
      const compact=t.text.replace(/0/g,'O').replace(/[|!]/g,'I');
      let m=compact.match(/^(?:TP|T[PPI])([1-5])$/);
      let key=m?'tp'+m[1]:(/^(?:SL|5L|S1|STOP|STOPLOSS|STOPL)$/.test(compact)?'sl':null),end=i;
      if(!key&&/^(?:TP|T[PPI])$/.test(compact)&&tokens[i+1]&&/^[1-5]$/.test(tokens[i+1].text)&&Math.abs(tokens[i+1].y-t.y)<Math.max(t.h,tokens[i+1].h)*1.8){key='tp'+tokens[i+1].text;end=i+1;}
      if(!key&&/^(?:TPS|TPSS|TP5S)$/.test(compact))key='tp5';
      if(!key)continue;
      const label=tokens[end],tol=Math.max(7,label.h*.85);
      labelRows[key]={y:label.y,x0:t.x0,x1:label.x1};
      if(found[key])continue;
      const maxX=Math.max(...tokens.map(q=>q.x1)),maxGap=maxX*.28;
      const pool=[...numericGroups,...tokens.filter(w=>/^[0-9][\d.,]*$/.test(w.text)).map(w=>({...w,_parts:[w.j]}))];
      const candidates=pool.map(w=>({w,d:Math.min(Math.abs(w.x0-label.x1),Math.abs(label.x0-w.x1))}))
        .filter(o=>o.w._parts.every(j=>!used.has(j))&&o.w._parts.every(j=>j!==t.j&&j!==label.j)&&
          /^\d[\d.,]*$/.test(o.w.text)&&Math.abs(o.w.y-label.y)<tol&&o.d<maxGap&&o.w.confidence>=25)
        // A TP value must share the label's visual row and be close to that label.
        // Do not substitute a distant chart-axis tick just because it is on a similar row.
        .sort((x,y)=>Math.abs(x.w.y-label.y)-Math.abs(y.w.y-label.y)||x.d-y.d||y.w.confidence-x.w.confidence);
      for(const c of candidates){
        const v=price(c.w.text);
        if(v){found[key]=v;c.w._parts.forEach(j=>used.add(j));break;}
      }
    }
    // Recover tickers split into adjacent OCR words, e.g. BTC + USDT.
    for(let i=0;i<tokens.length;i++){
      const a=tokens[i],b=tokens[i+1];
      if(b&&Math.abs(a.y-b.y)<Math.max(a.h,b.h)*1.5&&/^[A-Z0-9]{2,10}$/.test(a.text)&&/^USDT(?:P)?$/.test(b.text)){
        found.symbol=a.text+'USDT';break;
      }
      const one=a.text.match(/^([A-Z0-9]{2,15})USDT(?:P)?$/);
      if(one){found.symbol=one[1]+'USDT';break;}
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
    // Keep line-level labelled readings first; use word geometry only to fill
    // missing fields. Targeted colour-row OCR may override these later.
    for(const [key,value] of Object.entries(wordValues))if(!values[key]&&value)values[key]=value;
    for(const [key,value] of Object.entries(fallback))if(!values[key]&&value)values[key]=value;
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
  // Build colour-isolated OCR images: yellow marks TP labels/values, red marks SL.
  function colourMask(source,kind){
    const w=source.naturalWidth||source.width,h=source.naturalHeight||source.height;
    const out=document.createElement('canvas');out.width=w;out.height=h;
    const ctx=out.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);
    const frame=ctx.getImageData(0,0,w,h),p=frame.data,activeRows=new Uint8Array(h);
    // First locate rows containing the coloured TP (yellow) or SL (red) tag.
    // The printed price beside the tag is often white, so a colour-only mask
    // destroys the very number we need to read.
    for(let y=0;y<h;y++){
      let hits=0;
      for(let x=0;x<w;x++){
        const i=(y*w+x)*4,r=p[i]/255,g=p[i+1]/255,b=p[i+2]/255;
        const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
        let hue=0;if(d){if(max===r)hue=60*(((g-b)/d)%6);else if(max===g)hue=60*((b-r)/d+2);else hue=60*((r-g)/d+4);}
        if(hue<0)hue+=360;
        const sat=max===0?0:d/max;
        const match=kind==='yellow'?(hue>=32&&hue<=78&&sat>.22&&max>.28):((hue<=16||hue>=344)&&sat>.25&&max>.25);
        if(match&&++hits>=2)break;
      }
      if(hits>=2)activeRows[y]=1;
    }
    // Expand the detected tag row vertically to include anti-aliased glyphs.
    const band=Math.max(5,Math.round(h*.006));
    const keepRows=new Uint8Array(h);
    for(let y=0;y<h;y++)if(activeRows[y])for(let yy=Math.max(0,y-band);yy<=Math.min(h-1,y+band);yy++)keepRows[yy]=1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=(y*w+x)*4,r=p[i]/255,g=p[i+1]/255,b=p[i+2]/255;
      const max=Math.max(r,g,b),min=Math.min(r,g,b),lum=.299*r+.587*g+.114*b;
      const d=max-min,sat=max===0?0:d/max;
      const coloured=kind==='yellow'?(lum>.28&&r>g*.82&&g>b*1.12&&sat>.16):(lum>.22&&r>g*1.2&&r>b*1.08&&sat>.18);
      // Keep both the coloured tag and neutral bright price digits on the same row.
      const textPixel=keepRows[y]&&lum>.34&&!(sat>.42&&lum<.62);
      const keep=coloured||textPixel;
      const v=keep?0:255;p[i]=p[i+1]=p[i+2]=v;p[i+3]=255;
    }
    ctx.putImageData(frame,0,0);
    const big=document.createElement('canvas');big.width=w*2;big.height=h*2;
    const bctx=big.getContext('2d');bctx.imageSmoothingEnabled=false;bctx.drawImage(out,0,0,big.width,big.height);
    return big;
  }
  // Targeted OCR: detect coloured TP/SL rows on the right side, then OCR
  // a full-width horizontal strip so the adjacent white price is retained.
  async function scanColourRows(worker,source,kind){
    const w=source.naturalWidth||source.width,h=source.naturalHeight||source.height;
    const base=document.createElement('canvas');base.width=w;base.height=h;
    const bctx=base.getContext('2d',{willReadFrequently:true});bctx.drawImage(source,0,0,w,h);
    const pixels=bctx.getImageData(0,0,w,h).data,rowsFound=[];
    const xStart=Math.floor(w*.48);
    for(let y=0;y<h;y++){
      let count=0;
      for(let x=xStart;x<w;x+=2){
        const i=(y*w+x)*4,r=pixels[i]/255,g=pixels[i+1]/255,b=pixels[i+2]/255;
        const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
        let hue=0;
        if(d){if(max===r)hue=60*(((g-b)/d)%6);else if(max===g)hue=60*((b-r)/d+2);else hue=60*((r-g)/d+4);}
        if(hue<0)hue+=360;
        const sat=max===0?0:d/max;
        const match=kind==='yellow'
          ?hue>=25&&hue<=88&&sat>.18&&max>.28
          :(hue<=24||hue>=336)&&sat>.20&&max>.25;
        if(match&&++count>=2)break;
      }
      if(count>=2)rowsFound.push(y);
    }
    if(!rowsFound.length)return {};
    const clusters=[];
    for(const y of rowsFound){
      const last=clusters[clusters.length-1];
      if(last&&y-last.end<=Math.max(6,Math.round(h*.006))){last.end=y;last.center=(last.start+last.end)/2;}
      else clusters.push({start:y,end:y,center:y});
    }
    // Scan more candidate bands: chart candles and horizontal lines can precede
    // the actual TP/SL tags in the right-hand price scale.
    const found={};
    for(const cluster of clusters.slice(0,36)){
      const band=Math.max(44,Math.round(h*.06));
      const y0=Math.max(0,Math.round(cluster.center-band/2)),y1=Math.min(h,y0+band);
      const sx=Math.floor(w*.38),sw=w-sx;
      const crop=document.createElement('canvas');crop.width=sw*4;crop.height=Math.max(1,(y1-y0)*4);
      const cc=crop.getContext('2d');cc.imageSmoothingEnabled=false;
      cc.drawImage(base,sx,y0,sw,y1-y0,0,0,crop.width,crop.height);
      let result;
      try{
        if(worker.setParameters)await worker.setParameters({
          tessedit_pageseg_mode:'11',
          tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,'
        });
        result=await worker.recognize(crop);
      }finally{
        if(worker.setParameters)try{await worker.setParameters({tessedit_pageseg_mode:'3',tessedit_char_whitelist:''});}catch(_){}
      }
      const words=(result.data.words||[])
        .filter(q=>q&&q.bbox&&String(q.text||'').trim()&&(q.confidence===undefined||q.confidence>=20))
        .map((q,index)=>({
          raw:String(q.text).trim(),
          text:String(q.text).toUpperCase().replace(/[^A-Z0-9]/g,''),
          x0:q.bbox.x0,x1:q.bbox.x1,
          y:(q.bbox.y0+q.bbox.y1)/2,
          h:Math.max(1,q.bbox.y1-q.bbox.y0),
          conf:Number(q.confidence)||0,index
        }))
        .sort((a,b)=>a.y-b.y||a.x0-b.x0);
      const labels=[];
      for(let i=0;i<words.length;i++){
        const raw=words[i].text;
        // Recover common OCR confusions in coloured tags: TPZ -> TP2,
        // TPI -> TP1, and TP S -> TP5. Keep the accepted range strictly 1–5.
        const normalized=raw.replace(/O/g,'0').replace(/[IL]/g,'1').replace(/Z/g,'2').replace(/S/g,'5');
        let key=(normalized.match(/^TP([1-5])$/)||[])[1];
        key=key?'tp'+key:(/^(SL|5L|S1|STOPLOSS|STOP)$/.test(raw)?'sl':null);
        const skip=new Set([i]);
        if(!key&&(raw==='TP'||normalized==='TP')&&words[i+1]&&/^[1-5]$/.test(words[i+1].text)&&Math.abs(words[i+1].y-words[i].y)<Math.max(words[i].h,words[i+1].h)*1.5){
          key='tp'+words[i+1].text;skip.add(i+1);
        }
        if(key&&(kind==='yellow'?key.startsWith('tp'):key==='sl'))labels.push({key,word:words[i],skip});
      }
      const numeric=words.filter(q=>/^[0-9.,]+$/.test(q.raw));
      for(const item of labels){
        if(found[item.key])continue;
        const label=item.word,candidates=[];
        // Only consider price tokens to the RIGHT of the label. This avoids
        // mistaking TP's own index (e.g. the "1" in TP 1) or a left-side axis tick.
        const eligible=numeric.filter(q=>!item.skip.has(words.indexOf(q))&&q.x0>=label.x1-5);
        for(let i=0;i<eligible.length;i++){
          const first=eligible[i],parts=[first];let last=first;
          for(let j=i+1;j<eligible.length;j++){
            const next=eligible[j],dy=Math.abs(next.y-last.y),dx=next.x0-last.x1;
            if(dy>Math.max(10,last.h*.8)||dx< -3||dx>Math.max(14,last.h*.7))break;
            parts.push(next);last=next;
          }
          const joined=parts.map(p=>p.raw.replace(/[^0-9.,]/g,'')).join('');
          const variants=[{val:price(first.raw),parts:[first]}];
          if(parts.length>1)variants.push({val:price(joined),parts});
          for(const variant of variants){
            if(!variant.val)continue;
            // A one-digit OCR token is usually the TP index (TP1/TP2), not a
            // market price. Require a decimal price or at least four digits
            // (e.g. 0.12825, 63200); never publish "1" as a TP value.
            const digits=(variant.val.match(/\\d/g)||[]).length;
            const hasDecimal=/[.,]/.test(variant.parts.map(p=>p.raw).join(''));
            if(digits<4&&!(hasDecimal&&digits>=2))continue;
            const cy=variant.parts.reduce((a,p)=>a+p.y,0)/variant.parts.length;
            const x0=variant.parts[0].x0,dy=Math.abs(cy-label.y),dx=x0-label.x1;
            // The printed price can be far to the right of its coloured TP/SL tag.
            // Keep the same-row constraint, but search the entire remaining price-scale width.
            if(dy<Math.max(18,label.h*1.5)&&dx>=-5&&dx<sw*.92){
              candidates.push({val:variant.val,dy,dx,conf:Math.min(...variant.parts.map(p=>p.conf)),parts:variant.parts.length});
            }
          }
        }
        candidates.sort((a,b)=>a.dy-b.dy||a.dx-b.dx||b.conf-a.conf||b.parts-a.parts);
        if(candidates.length)found[item.key]=candidates[0].val;
      }
    }
    return found;
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
        // Read yellow TP annotations and red SL annotations independently of the chart background.
        for(const kind of ['yellow','red']){
          const mask=colourMask(image,kind);
          const colourResult=await worker.recognize(mask);
          const colourValues=extract(colourResult.data.text,colourResult.data,mask);
          const targetedValues=await scanColourRows(worker,image,kind);
          const keys=kind==='yellow'?['tp1','tp2','tp3','tp4','tp5']:['sl'];
          for(const k of keys){
            // Label-row OCR is more specific than full-page OCR. Always prefer it
            // when it successfully reads a value; a broad OCR guess must not block it.
            if(targetedValues[k])values[k]=targetedValues[k];
            else if(!values[k]&&colourValues[k])values[k]=colourValues[k];
          }
          values._labelRows={...(values._labelRows||{}),...(colourValues._labelRows||{})};
        }
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
        // Final safety net across every OCR pass (full image, colour mask and right crop).
        // A bare one-digit integer beside a TP label is almost always the label index,
        // not a market price. Keep decimal prices (e.g. 0.1234 or 1.25) untouched.
        const rejectedIndexDigits=[];
        for(const k of ['tp1','tp2','tp3','tp4','tp5']){
          if(!values[k])continue;
          const normalized=price(values[k]);
          if(normalized&&/^\d$/.test(normalized)){
            rejectedIndexDigits.push(k.toUpperCase()+': '+values[k]);
            delete values[k];
          }
        }
        const rejectedScalePrices=rejectScaleMismatches(values);
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
        const tpCount=['tp1','tp2','tp3','tp4','tp5'].filter(k=>$(k).value.trim()).length;
        const missingFields=[...(!$('symbol').value?['symbol']:[]),...(!$('direction').value?['direction']:[]),...(tpCount<2?['at least 2 TP']:[]),...(!$('sl').value?['SL']:[])];
        const detected=['symbol','direction','tp1','tp2','tp3','tp4','tp5','sl'].filter(k=>$(k).value).map(k=>k.toUpperCase()+': '+$(k).value);
        const notice=$('autoLevels');
        if(notice)notice.textContent=(detected.length?'Detected automatically — '+detected.join(' · '):'No reliable trade levels detected.')+(rejectedScalePrices.length?'\\nRejected implausible OCR price(s): '+rejectedScalePrices.join(', ')+'. Please verify these labels; no decimal was guessed.':'')+(missingFields.length?'\nStill missing: '+missingFields.join(', ').toUpperCase()+'. The app will not invent missing values.':'');
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
    const rawTps=[1,2,3,4,5].map(i=>$('tp'+i).value.trim());
    const count=rawTps.filter(Boolean).length;
    if(!sym||!side||!entry||!sl||count<2)throw new Error('TRADEDESK needs the symbol, direction, your exact Entry, at least 2 detected TPs and the Stop Loss. No price will be invented.');
    if(rawTps.slice(0,count).some(x=>!x)||rawTps.slice(count).some(Boolean))throw new Error('TP levels must be consecutive from TP1, with no gaps between labels.');
    const tps=rawTps.slice(0,count).map(Number);
    if(![entry,sl,...tps].every(n=>Number.isFinite(n)&&n>0))throw new Error('A detected price is invalid or unreadable.');
    const ordered=side==='LONG'?sl<entry&&entry<tps[0]&&tps.every((v,i)=>!i||tps[i-1]<v):sl>entry&&entry>tps[0]&&tps.every((v,i)=>!i||tps[i-1]>v);
    if(!ordered)throw new Error('Detected prices do not form a valid '+side+' sequence. The screenshot labels need clearer recognition; no values were changed.');
    return [sym+' '+side+' TRADE SETUP','','ENTRY: '+$('entry').value.trim(),'',...tps.map((v,i)=>'TP'+(i+1)+': '+rawTps[i]),'','SL: '+$('sl').value,'','RISK 1% OR LESS'].join('\n');
  }
  function generate(){
    const err=$('setupError');err.textContent='';
    if(!image){err.textContent='Upload a chart screenshot first.';return false;}
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
    const tpCount=['tp1','tp2','tp3','tp4','tp5'].filter(k=>$(k).value.trim()).length;
    if(!$('symbol').value.trim()||!$('direction').value||tpCount<2||!$('sl').value.trim())return;
    generate();
  }
  // Public bridge used by the page after this controller loads; replaces the legacy generator.
  window.TradeDeskSetup = { generate, analyse, getState:()=>({symbol:$('symbol')?.value||'',direction:$('direction')?.value||'',entry:$('entry')?.value||'',tp1:$('tp1')?.value||'',tp2:$('tp2')?.value||'',tp3:$('tp3')?.value||'',tp4:$('tp4')?.value||'',tp5:$('tp5')?.value||'',sl:$('sl')?.value||''}) };
  document.addEventListener('change',e=>{
    if(e.target?.id==='direction'){tryAutoGenerate();return;}
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