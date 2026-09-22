"use strict";
/* ================================================================
   Expected-value engine.
   Default: infinite-deck (6-deck approximation), S17, surrender on.
   Options per engine: {h17: bool, probs: {value: probability}}
   With custom probs, draws use the current shoe's frequencies
   (fixed-fraction approximation: draws don't further deplete it).
   ================================================================ */
const VALS = [2,3,4,5,6,7,8,9,10,11];          // 11 = Ace
const PROB = v => (v === 10 ? 4/13 : 1/13);

function addCard(t, soft, v){
  if (v === 11){
    if (t + 11 <= 21) return {t: t + 11, soft: true};
    return {t: t + 1, soft};
  }
  let nt = t + v;
  if (nt > 21 && soft) return {t: nt - 10, soft: false};
  return {t: nt, soft};
}

function makeEngine(up, opts){
  opts = opts || {};
  const h17 = !!opts.h17;
  const P = opts.probs ? (v => opts.probs[v] || 0) : PROB;

  /* ---- Dealer: distribution of final totals ---- */
  const dMemo = new Map();
  function dPlay(t, soft){
    if (t > 21) return {bust: 1};
    if (t > 17 || (t === 17 && !(soft && h17))){ const o = {}; o[t] = 1; return o; }
    const key = t + (soft ? "s" : "h");
    if (dMemo.has(key)) return dMemo.get(key);
    const out = {};
    for (const v of VALS){
      const s = addCard(t, soft, v);
      const sub = dPlay(s.t, s.soft);
      for (const k in sub) out[k] = (out[k] || 0) + P(v) * sub[k];
    }
    dMemo.set(key, out);
    return out;
  }
  // conditioned on the dealer not holding a natural
  const start = addCard(0, false, up);
  const D = {};
  {
    let holeProbs;
    if (up === 11){
      const mass = Math.max(1 - P(10), 1e-9);
      holeProbs = VALS.filter(v => v !== 10).map(v => [v, P(v) / mass]);
    } else if (up === 10){
      const mass = Math.max(1 - P(11), 1e-9);
      holeProbs = VALS.filter(v => v !== 11).map(v => [v, P(v) / mass]);
    } else {
      holeProbs = VALS.map(v => [v, P(v)]);
    }
    for (const [v, p] of holeProbs){
      const s = addCard(start.t, start.soft, v);
      const sub = dPlay(s.t, s.soft);
      for (const k in sub) D[k] = (D[k] || 0) + p * sub[k];
    }
  }

  /* ---- Player ---- */
  const LOSE = {w:0, p:0, l:1};
  function standRes(t){
    if (t > 21) return LOSE;
    let w = D.bust || 0, p = 0, l = 0;
    for (const k in D){
      if (k === "bust") continue;
      const d = +k;
      if (d < t) w += D[k];
      else if (d === t) p += D[k];
      else l += D[k];
    }
    return {w, p, l};
  }
  const ev1 = r => r.w - r.l;

  const playMemo = new Map();
  function playOut(t, soft){
    const key = t + (soft ? "s" : "h");
    if (playMemo.has(key)) return playMemo.get(key);
    const st = standRes(t);
    let res = {w: st.w, p: st.p, l: st.l, ev: ev1(st)};
    if (t < 21){
      let hw = 0, hp = 0, hl = 0;
      for (const v of VALS){
        const s = addCard(t, soft, v);
        const sub = s.t > 21 ? {w:0,p:0,l:1,ev:-1} : playOut(s.t, s.soft);
        hw += P(v)*sub.w; hp += P(v)*sub.p; hl += P(v)*sub.l;
      }
      const hev = hw - hl;
      if (hev > res.ev) res = {w:hw, p:hp, l:hl, ev:hev};
    }
    playMemo.set(key, res);
    return res;
  }

  function hitRes(t, soft){
    let w=0,p=0,l=0;
    for (const v of VALS){
      const s = addCard(t, soft, v);
      const sub = s.t > 21 ? {w:0,p:0,l:1} : playOut(s.t, s.soft);
      w += P(v)*sub.w; p += P(v)*sub.p; l += P(v)*sub.l;
    }
    return {w, p, l, ev: w - l};
  }

  function doubleRes(t, soft){
    let w=0,p=0,l=0;
    for (const v of VALS){
      const s = addCard(t, soft, v);
      const sub = s.t > 21 ? LOSE : standRes(s.t);
      w += P(v)*sub.w; p += P(v)*sub.p; l += P(v)*sub.l;
    }
    return {w, p, l, ev: 2*(w - l)};
  }

  function splitRes(pv){
    let w=0,p=0,l=0,ev=0;
    const base = addCard(0, false, pv);
    for (const v of VALS){
      const h = addCard(base.t, base.soft, v);
      let sub;
      if (pv === 11){
        const st = standRes(h.t);
        sub = {w:st.w, p:st.p, l:st.l, ev: ev1(st)};
      } else {
        const st = standRes(h.t);
        const cand = [{w:st.w,p:st.p,l:st.l,ev:ev1(st)}, hitRes(h.t, h.soft), doubleRes(h.t, h.soft)];
        sub = cand.reduce((a,b) => b.ev > a.ev ? b : a);
      }
      w += P(v)*sub.w; p += P(v)*sub.p; l += P(v)*sub.l; ev += P(v)*sub.ev;
    }
    return {w, p, l, ev: 2*ev};
  }

  function analyze(t, soft, pairVal, allowSurrender){
    if (allowSurrender === undefined) allowSurrender = true;
    const st = standRes(t);
    const acts = [
      {name:"Stand",  w:st.w, p:st.p, l:st.l, ev: ev1(st)},
      {name:"Hit",    ...hitRes(t, soft)},
      {name:"Double", ...doubleRes(t, soft)},
    ];
    if (pairVal) acts.push({name:"Split", ...splitRes(pairVal)});
    if (allowSurrender) acts.push({name:"Surrender", w:0, p:0, l:1, ev:-0.5, surr:true});
    const best = acts.reduce((a,b) => b.ev > a.ev ? b : a);
    const bestPlayable = acts.filter(a => !a.surr).reduce((a,b) => b.ev > a.ev ? b : a);
    return {acts, best, bestPlayable};
  }
  return {analyze, dealerBust: D.bust || 0, P};
}

/* default engines (S17, full shoe) used by rankings + chart pages */
const engines = new Map();
const engineFor = up => { if(!engines.has(up)) engines.set(up, makeEngine(up)); return engines.get(up); };

/* ================================================================
   Rankings data (default rules)
   ================================================================ */
const UPCARDS = [2,3,4,5,6,7,8,9,10,11];
const upLabel = v => v === 11 ? "A" : String(v);
const HANDS = [];
for (let t = 5; t <= 20; t++) HANDS.push({label:"Hard " + t, type:"hard", t, soft:false, pair:0, order:t});
for (let k = 2; k <= 9; k++)  HANDS.push({label:"A," + k + " (soft " + (11+k) + ")", type:"soft", t:11+k, soft:true, pair:0, order:100+k});
for (const v of [2,3,4,5,6,7,8,9,10,11]){
  const lbl = v === 11 ? "A,A" : (v + "," + v);
  const st = v === 11 ? {t:12, soft:true} : {t:2*v, soft:false};
  HANDS.push({label:lbl, type:"pair", t:st.t, soft:st.soft, pair:v, order:200+v});
}
const ROWS = [];
for (const h of HANDS){
  for (const up of UPCARDS){
    const r = engineFor(up).analyze(h.t, h.soft, h.pair);
    ROWS.push({
      hand: h.label, type: h.type, order: h.order, up,
      best: r.best.name,
      win: r.bestPlayable.w, push: r.bestPlayable.p,
      ev: r.best.ev
    });
  }
}
const fmtPct = x => (100*x).toFixed(1) + "%";
const fmtEV  = x => (x >= 0 ? "+" : "-") + Math.abs(x).toFixed(3);
