"use strict";

/* ================================================================
   Expected-value engine (infinite-deck / 6-deck approximation)
   Rules: S17, double any two, DAS, split aces one card, no resplit,
   late surrender, EVs conditioned on dealer having no natural.
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

/* ---- Dealer: distribution of final totals, S17 ---- */
const dealerMemo = new Map();
function dealerPlay(t, soft){            // -> {17:..,18:..,19:..,20:..,21:..,bust:..}
  if (t > 21) return {bust: 1};
  if (t >= 17){ const o = {}; o[t] = 1; return o; }
  const key = t + (soft ? "s" : "h");
  if (dealerMemo.has(key)) return dealerMemo.get(key);
  const out = {};
  for (const v of VALS){
    const s = addCard(t, soft, v);
    const sub = dealerPlay(s.t, s.soft);
    for (const k in sub) out[k] = (out[k] || 0) + PROB(v) * sub[k];
  }
  dealerMemo.set(key, out);
  return out;
}
function dealerDist(up){                 // conditioned: no dealer blackjack
  const start = addCard(0, false, up);
  const out = {};
  let holeProbs;
  if (up === 11)      holeProbs = VALS.filter(v => v !== 10).map(v => [v, PROB(v) / (9/13)]);
  else if (up === 10) holeProbs = VALS.filter(v => v !== 11).map(v => [v, PROB(v) / (12/13)]);
  else                holeProbs = VALS.map(v => [v, PROB(v)]);
  for (const [v, p] of holeProbs){
    const s = addCard(start.t, start.soft, v);
    const sub = dealerPlay(s.t, s.soft);
    for (const k in sub) out[k] = (out[k] || 0) + p * sub[k];
  }
  return out;
}

/* ---- Per-upcard player engine ---- */
function makeEngine(up){
  const D = dealerDist(up);
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
  const ev1 = r => r.w - r.l;            // single-unit EV of an outcome dist

  const playMemo = new Map();
  function playOut(t, soft){             // optimal hit/stand from here (EV-max)
    const key = t + (soft ? "s" : "h");
    if (playMemo.has(key)) return playMemo.get(key);
    const st = standRes(t);
    let res = {w: st.w, p: st.p, l: st.l, ev: ev1(st)};
    if (t < 21){
      let hw = 0, hp = 0, hl = 0;
      for (const v of VALS){
        const s = addCard(t, soft, v);
        const sub = s.t > 21 ? {w:0,p:0,l:1,ev:-1} : playOut(s.t, s.soft);
        hw += PROB(v)*sub.w; hp += PROB(v)*sub.p; hl += PROB(v)*sub.l;
      }
      const hev = hw - hl;
      if (hev > res.ev) res = {w:hw, p:hp, l:hl, ev:hev};
    }
    playMemo.set(key, res);
    return res;
  }

  function hitRes(t, soft){              // hit once, then play optimally
    let w=0,p=0,l=0;
    for (const v of VALS){
      const s = addCard(t, soft, v);
      const sub = s.t > 21 ? {w:0,p:0,l:1} : playOut(s.t, s.soft);
      w += PROB(v)*sub.w; p += PROB(v)*sub.p; l += PROB(v)*sub.l;
    }
    return {w, p, l, ev: w - l};
  }

  function doubleRes(t, soft){           // one card, forced stand, 2x bet
    let w=0,p=0,l=0;
    for (const v of VALS){
      const s = addCard(t, soft, v);
      const sub = s.t > 21 ? LOSE : standRes(s.t);
      w += PROB(v)*sub.w; p += PROB(v)*sub.p; l += PROB(v)*sub.l;
    }
    return {w, p, l, ev: 2*(w - l)};
  }

  function splitRes(pv){                 // per-hand outcome; EV is for both hands
    let w=0,p=0,l=0,ev=0;
    const base = addCard(0, false, pv);
    for (const v of VALS){
      const h = addCard(base.t, base.soft, v);
      let sub;
      if (pv === 11){                    // split aces: one card only
        const st = standRes(h.t);
        sub = {w:st.w, p:st.p, l:st.l, ev: ev1(st)};
      } else {
        const st = standRes(h.t);
        const cand = [{w:st.w,p:st.p,l:st.l,ev:ev1(st)}, hitRes(h.t, h.soft), doubleRes(h.t, h.soft)];
        sub = cand.reduce((a,b) => b.ev > a.ev ? b : a);
      }
      w += PROB(v)*sub.w; p += PROB(v)*sub.p; l += PROB(v)*sub.l; ev += PROB(v)*sub.ev;
    }
    return {w, p, l, ev: 2*ev};          // win/push/loss shown per split hand
  }

  function analyze(t, soft, pairVal){    // all first-decision actions
    const st = standRes(t);
    const acts = [
      {name:"Stand",     ...{w:st.w,p:st.p,l:st.l}, ev: ev1(st)},
      {name:"Hit",       ...hitRes(t, soft)},
      {name:"Double",    ...doubleRes(t, soft)},
    ];
    if (pairVal) acts.push({name:"Split", ...splitRes(pairVal)});
    acts.push({name:"Surrender", w:0, p:0, l:1, ev:-0.5, surr:true});
    const best = acts.reduce((a,b) => b.ev > a.ev ? b : a);
    const bestPlayable = acts.filter(a => !a.surr).reduce((a,b) => b.ev > a.ev ? b : a);
    return {acts, best, bestPlayable};
  }
  return {analyze, dealerBust: D.bust || 0};
}
const engines = new Map();
const engineFor = up => { if(!engines.has(up)) engines.set(up, makeEngine(up)); return engines.get(up); };

/* ================================================================
   Rankings data
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
const fmtEV  = x => (x >= 0 ? "+" : "\u2212") + Math.abs(x).toFixed(3);
