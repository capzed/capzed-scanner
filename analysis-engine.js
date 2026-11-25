/* TradeDesk technical confluence engine
 * Browser-only, deterministic heuristics. No paid APIs or external libraries.
 * Pattern detections are proxies, not discretionary ICT/Wyckoff certification.
 */
(function () {
  "use strict";
  const n = x => Number(x);
  const clamp = (x, lo=0, hi=100) => Math.max(lo, Math.min(hi, x));
  const mean = a => a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0;
  const ema = (a,p) => {
    if (a.length < p) return null;
    let v=mean(a.slice(0,p)), k=2/(p+1);
    for(let i=p;i<a.length;i++) v=a[i]*k+v*(1-k);
    return v;
  };
  const rsi = (a,p=14) => {
    if(a.length<p+1) return 50;
    let g=0,l=0;
    for(let i=a.length-p;i<a.length;i++){const d=a[i]-a[i-1];if(d>0)g+=d;else l-=d;}
    if(l===0)return 100;
    return 100-100/(1+g/l);
  };
  function unpack(rows){
    return rows.map(x=>({o:n(x[1]),h:n(x[2]),l:n(x[3]),c:n(x[4]),v:n(x[5]),t:n(x[0])}))
      .filter(x=>[x.o,x.h,x.l,x.c,x.v].every(Number.isFinite));
  }
  function stats(rows){
    const a=unpack(rows), c=a.map(x=>x.c), tr=[];
    for(let i=1;i<a.length;i++)tr.push(Math.max(a[i].h-a[i].l,Math.abs(a[i].h-a[i-1].c),Math.abs(a[i].l-a[i-1].c)));
    const atr=mean(tr.slice(-14)), avgVol=mean(a.slice(-21,-1).map(x=>x.v));
    return {a,c,close:c.at(-1),atr,ema20:ema(c,20),ema50:ema(c,50),rsi:rsi(c),volRatio:avgVol?a.at(-1).v/avgVol:1};
  }
  function pivots(a, left=3, right=3){
    const highs=[],lows=[];
    for(let i=left;i<a.length-right;i++){
      let hi=true,lo=true;
      for(let j=i-left;j<=i+right;j++){if(j===i)continue;if(a[j].h>=a[i].h)hi=false;if(a[j].l<=a[i].l)lo=false;}
      if(hi)highs.push({i,p:a[i].h});if(lo)lows.push({i,p:a[i].l});
    }
    return {highs,lows};
  }
  function detectFvg(a, side, level, tolerance){
    const found=[];
    for(let i=Math.max(2,a.length-70);i<a.length;i++){
      const bull=a[i].l>a[i-2].h, bear=a[i].h<a[i-2].l;
      if(side==="LONG"&&bull){const lo=a[i-2].h,hi=a[i].l;if(level>=lo-tolerance&&level<=hi+tolerance)found.push({i,lo,hi,type:"Bullish FVG"});}
      if(side==="SHORT"&&bear){const lo=a[i].h,hi=a[i-2].l;if(level>=lo-tolerance&&level<=hi+tolerance)found.push({i,lo,hi,type:"Bearish FVG"});}
    }
    return found.at(-1)||null;
  }
  function detectOrderBlock(a, side, atr){
    const start=Math.max(5,a.length-35);
    for(let i=a.length-2;i>=start;i--){
      const x=a[i],next=a[i+1],body=Math.abs(next.c-next.o);
      if(body<atr*1.15)continue;
      if(side==="LONG"&&x.c<x.o&&next.c>x.h)return {lo:x.l,hi:x.h,type:"Bullish OB proxy"};
      if(side==="SHORT"&&x.c>x.o&&next.c<x.l)return {lo:x.l,hi:x.h,type:"Bearish OB proxy"};
    }
    return null;
  }
  function detectSweep(a, side){
    if(a.length<25)return false;
    const last=a.at(-1),prior=a.slice(-21,-1);
    if(side==="LONG"){const pool=Math.min(...prior.map(x=>x.l));return last.l<pool&&last.c>pool;}
    const pool=Math.max(...prior.map(x=>x.h));return last.h>pool&&last.c<pool;
  }
  function fibConfluence(a, side, level, tolerance){
    const p=pivots(a,3,3), hs=p.highs.at(-1), ls=p.lows.at(-1);
    if(!hs||!ls||hs.i===ls.i)return null;
    const high=Math.max(hs.p,ls.p),low=Math.min(hs.p,ls.p),range=high-low;
    if(!range)return null;
    const ratios=side==="LONG"?[.382,.5,.618,.786]:[.214,.382,.5,.618];
    for(const r of ratios){const price=side==="LONG"?high-range*r:low+range*r;if(Math.abs(price-level)<=tolerance)return {price,ratio:r};}
    return null;
  }
  function historicalTouchRate(a, level, side, currentDistAtr, currentAtr){
    const sample=[], candles=a.slice(-240);
    for(let i=20;i<candles.length-30;i++){
      const window=candles.slice(Math.max(0,i-13),i+1);
      const tr=[];
      for(let j=1;j<window.length;j++)tr.push(Math.max(window[j].h-window[j].l,Math.abs(window[j].h-window[j-1].c),Math.abs(window[j].l-window[j-1].c)));
      const atr=mean(tr)||currentAtr;
      const close=candles[i].c;
      const onExpectedSide=side==="LONG"?close>level:close<level;
      if(!onExpectedSide)continue;
      const d=Math.abs(close-level)/Math.max(atr,close*.0001);
      if(Math.abs(d-currentDistAtr)>.65)continue;
      const future=candles.slice(i+1,i+31);
      const touched=future.some(x=>x.l<=level&&x.h>=level);
      sample.push(touched?1:0);
    }
    return {hits:sample.reduce((s,x)=>s+x,0),samples:sample.length,rate:sample.length>=8?Math.round(100*mean(sample)):null};
  }
  function scoreLevel(item, frames){
    const s1=stats(frames["1m"]),s5=stats(frames["5m"]),s15=stats(frames["15m"]),s1h=stats(frames["1h"]),s4h=stats(frames["4h"]),s1d=stats(frames["1d"]),s1w=stats(frames["1w"]);
    const price=s1.close, level=item.level, side=item.side||(level<price?"LONG":"SHORT");
    if(![price,level,s1.atr,s5.atr].every(Number.isFinite)||price<=0||level<=0)throw new Error("Invalid candle or level data.");
    const dist=Math.abs(price-level), atr5=Math.max(s5.atr,price*.0001), distAtr=dist/atr5;
    const tolerance=Math.max(s15.atr*.18,level*.00035);
    const p15=pivots(s15.a,3,3), p1h=pivots(s1h.a,3,3);
    const nearbySwings=[...p15.highs,...p15.lows,...p1h.highs,...p1h.lows].filter(x=>Math.abs(x.p-level)<=tolerance);
    const touches=s15.a.slice(-80).filter(x=>x.l<=level+tolerance&&x.h>=level-tolerance).length;
    const fvg=detectFvg(s15.a,side,level,tolerance)||detectFvg(s1h.a,side,level,tolerance);
    const ob=detectOrderBlock(s15.a,side,s15.atr)||detectOrderBlock(s1h.a,side,s1h.atr);
    const sweep=detectSweep(s5.a,side);
    const wyckoffSpring=side==="LONG"&&sweep&&s5.volRatio>=1.15;
    const wyckoffUpthrust=side==="SHORT"&&sweep&&s5.volRatio>=1.15;
    const wyckoff=wyckoffSpring||wyckoffUpthrust;
    const fib=fibConfluence(s1h.a,side,level,Math.max(s1h.atr*.25,level*.0005));
    const trend=(s,dir)=>dir==="LONG"?s.ema20>s.ema50:s.ema20<s.ema50;
    const tfs=[s1w,s1d,s4h,s1h,s15], align=tfs.filter(x=>trend(x,side)).length;
    const trendScore=align/5*100;
    const rsiScore=side==="LONG"?clamp(100-Math.abs(s5.rsi-48)*1.45):clamp(100-Math.abs(s5.rsi-52)*1.45);
    const volumeScore=clamp(s5.volRatio*42);
    const levelScore=clamp(30+touches*7+nearbySwings.length*12-(touches>9?18:0));
    const structureScore=clamp(25+align*9+(sweep?20:0)+(wyckoff?15:0)+(nearbySwings.length?12:0));
    const confluenceScore=clamp((fvg?35:0)+(ob?30:0)+(fib?20:0)+(nearbySwings.length?15:0));
    const momentumVolume=clamp(rsiScore*.55+volumeScore*.45);
    const expectedMove30=Math.max(s1.atr*Math.sqrt(30),price*.0007);
    const historical=historicalTouchRate(s1.a,level,side,distAtr,s1.atr);
    const reachScore=clamp(100*(1-dist/expectedMove30));
    const freshness=clamp(65-touches*3+(nearbySwings.length?15:0)+(sweep?20:0));
    const raw=levelScore*.20+structureScore*.20+momentumVolume*.15+trendScore*.15+confluenceScore*.15+freshness*.05+reachScore*.10;
    const score=Math.round(clamp(raw));
    const reasons=[];
    if(align>=2)reasons.push("Multi-timeframe trend alignment");
    if(fvg)reasons.push(fvg.type+" confluence");
    if(ob)reasons.push(ob.type+" confluence");
    if(sweep)reasons.push(side==="LONG"?"Sell-side liquidity sweep proxy":"Buy-side liquidity sweep proxy");
    if(wyckoff)reasons.push(side==="LONG"?"Wyckoff spring proxy":"Wyckoff upthrust proxy");
    if(fib)reasons.push("Fibonacci "+(fib.ratio*100).toFixed(1)+"% confluence");
    if(nearbySwings.length)reasons.push("Nearby swing liquidity");
    if(s5.volRatio>=1.5)reasons.push("Elevated 5m volume");
    if(!reasons.length)reasons.push("Limited structural confluence detected");
    const activation= Math.round(reachScore);
    const activationLabel=dist<=expectedMove30?"Within recent 30m volatility envelope":"Beyond recent 30m volatility envelope";
    return {...item,side,price,score,activation,activationLabel,historicalTouchRate:historical.rate,historicalSamples:historical.samples,historicalHits:historical.hits,dist,distPct:dist/price*100,distAtr,touches,volumeRatio:s5.volRatio,rsi:s5.rsi,aligned:align>=3,reasons,
      components:{level:Math.round(levelScore),structure:Math.round(structureScore),momentumVolume:Math.round(momentumVolume),timeframes:Math.round(trendScore),methodConfluence:Math.round(confluenceScore),freshness:Math.round(freshness),reach:Math.round(reachScore)},
      patterns:{fvg:!!fvg,orderBlock:!!ob,liquiditySweep:sweep,wyckoffSpring,wyckoffUpthrust,fibonacci:!!fib,swingLiquidity:nearbySwings.length>0}};
  }
  window.TradeDeskAnalysis={scoreLevel};
})();