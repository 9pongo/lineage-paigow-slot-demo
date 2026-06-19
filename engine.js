/* ============================================================
   天堂推筒子 · 龍虎寶藏 — 數學引擎（單一真相源）
   瀏覽器 (<script src>) 與 Node (require) 共用。
   所有「數值真相」集中在此；index.html 與 sim.mjs 都引用本檔。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api; // Node
  else { for (const k in api) root[k] = api[k]; root.ENGINE = api; }          // 瀏覽器：掛上全域
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ---------- 可調校設定（單一真相源） ---------- */
const CONFIG = {
  REELS: 5, ROWS: 3, LINES: 20,
  startBalance: 10000,
  betLevels: [20, 40, 100, 200, 400, 1000],

  SYM: {
    wild:    {em:"財", nm:"財神", cls:"s-wild"},
    scatter: {em:"💰", nm:"金元寶", cls:"s-scatter"},
    coin:    {em:"🪙", nm:"金幣", cls:"s-coin"},
    bonus:   {em:"🀆", nm:"白板", cls:"s-bonus"},   // Bonus Game 觸發符號
    dragon:  {em:"🐲", nm:"龍"},
    tiger:   {em:"🐯", nm:"虎"},
    d6:      {em:"⚅", nm:"筒六"},
    d5:      {em:"⚄", nm:"筒五"},
    A:       {em:"🅰", nm:"A"},
    K:       {em:"K", nm:"K"},
    Q:       {em:"Q", nm:"Q"},
    J:       {em:"J", nm:"J"},
  },

  // 線賠付（× 線注 = 總注/20），3/4/5 連
  PAY: {
    wild:   {3:10, 4:50, 5:200},
    dragon: {3:5,  4:20, 5:100},
    tiger:  {3:5,  4:15, 5:80},
    d6:     {3:3,  4:8,  5:40},
    d5:     {3:2,  4:6,  5:30},
    A:      {3:1.5,4:4,  5:20},
    K:      {3:1,  4:3,  5:15},
    Q:      {3:0.8,4:2.5,5:12},
    J:      {3:0.5,4:2,  5:10},
  },
  SCAT_PAY: {3:2, 4:10, 5:50},   // × 總注

  // ===== RTP 調校旋鈕（由 sim.cjs 校出，見檔末註解）=====
  BASE_PAY_SCALE: 2.30,   // 基礎遊戲線賠倍率（含免費遊戲底層）
  FS_BONUS_MULT:  7.50,   // 免費遊戲最終放大（FS 為直接觸發特色，全玩家共享）
  HS_BONUS_MULT:  1.19,   // Hold & Spin（一般金幣）最終放大；jackpot 幣全拿不套此倍率
  PICK_BONUS_MULT:1.62,   // 選寶箱最終放大
  CB_BONUS_MULT:  2.09,   // 推筒子比牌（連勝步進）最終放大

  BONUS_TRIGGER: 3,       // 白板 3+ → Bonus Game（選寶箱/推筒子比牌）
  FS_TRIGGER: 3, FS_SPINS: 8,
  FS_MULT_STEPS: [2,3,5,8,12,20],

  HS_TRIGGER: 6, HS_RESPINS: 3,
  HS_NEW_COIN_PROB: 0.048,   // 每空格出新金幣機率（低→集滿 GRAND 超稀有）
  // 金幣翻值機率（jackpot 稀有，其餘為一般倍率）
  HS_COIN_ROLL: { major:0.002, minor:0.012, mini:0.05 },
  HS_VAL_TABLE: [1,1,1,2,2,3,5],

  // 選寶箱（CAP = 最終賠付上限，× 總注）
  PICK: { COUNT:12, NBOMB_MIN:3, NBOMB_MAX:4, CAP:400, MULT_PROB:0.15, MULT_VAL:2,
          COIN_TABLE:[1,1,2,2,3,3,5,8,12] },

  // 推筒子比牌（CAP = 最終賠付上限，× 總注 = 全機最大獎）
  CB: { STEP:[2,4,8,16,32,64,128,256,512,1024,2048], CAP:5000 },

  // Jackpot：mini/minor = 固定 ×總注（隨注放大、永遠全拿）；
  //          major/grand = progressive 絕對池（基底+累積，有上限）。
  //          progressive 須「下滿注」才全拿顯示值，否則 × (bet/MAX_BET) 依比例。
  JACKPOT: {
    mini:  { kind:"mult", mult:10 },
    minor: { kind:"mult", mult:25 },
    major: { kind:"prog", base:20000, cap:60000 },
    grand: { kind:"prog", base:200000, cap:600000 },
  },
  JP_CONTRIB: { major:0.004, grand:0.006 },   // 每注貢獻（×總注）累加入 major/grand 池

  PAYLINES: [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],
    [0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],
    [1,0,0,0,1],[1,2,2,2,1],
    [1,0,1,2,1],[1,2,1,0,1],
    [0,1,1,1,0],[2,1,1,1,2],
    [0,1,0,1,0],[2,1,2,1,2],
    [1,1,0,1,1],[1,1,2,1,1],
    [0,0,1,0,0],[2,2,1,2,2],[0,2,0,2,0],
  ],
};

const REEL_WEIGHTS = {
  J:7, Q:7, K:6, A:5, d5:4, d6:4, tiger:3, dragon:3, wild:2, scatter:2, coin:6, bonus:2
};
const MAX_BET = Math.max.apply(null, CONFIG.betLevels);   // progressive 滿注基準

// Bonus Game 僅兩種（FS/HS 已改為正常遊戲直接觸發，不在此選單）
const BONUS_MODES = [
  {key:"pick",  name:"選寶箱",     icon:"🎁", vol:1, volTxt:"低波動", maxTxt:"最高 ~380x", freqTxt:"幾乎必中、穩穩累積"},
  {key:"cards", name:"推筒子比牌", icon:"🀄", vol:4, volTxt:"高波動", maxTxt:"最高 5000x", freqTxt:"連勝爆倍、天王對中 JACKPOT"},
];

/* ---------- 純函式（無 DOM） ---------- */
const RND = () => Math.random();
function shuffle(arr, rng=RND){ for(let i=arr.length-1;i>0;i--){ const j=(rng()*(i+1))|0; [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }

// 固定種子 PRNG（mulberry32）→ 轉軸帶可重現，RTP 不隨 session 漂移
function mulberry32(seed){
  let a=seed>>>0;
  return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; };
}
const STRIP_SEED = 0x5eed42;

function buildStrips(rng){
  // 預設用固定種子 → 全機固定轉軸帶（與真機一致、RTP 可精算）
  const r = rng || mulberry32(STRIP_SEED);
  const strips=[];
  for (let i=0;i<CONFIG.REELS;i++){
    const arr=[];
    for (const [sym,w] of Object.entries(REEL_WEIGHTS)) for (let k=0;k<w;k++) arr.push(sym);
    shuffle(arr,r);
    strips.push(arr);
  }
  return strips;
}
const STRIPS = buildStrips();   // 唯一一組固定轉軸帶
function spinGrid(strips, rng=RND){
  const grid=[];
  for (let r=0;r<CONFIG.REELS;r++){
    const st=strips[r], p=(rng()*st.length)|0;
    grid[r]=[ st[p], st[(p+1)%st.length], st[(p+2)%st.length] ];
  }
  return grid;
}
function positionsOf(grid,sym){
  const out=[];
  for (let r=0;r<CONFIG.REELS;r++) for(let row=0;row<CONFIG.ROWS;row++) if(grid[r][row]===sym) out.push(row*10+r);
  return out;
}
function gridHasWild(grid){
  for(let r=0;r<CONFIG.REELS;r++) for(let row=0;row<CONFIG.ROWS;row++) if(grid[r][row]==="wild") return true;
  return false;
}
// 線賠（含 BASE_PAY_SCALE）。回傳 [{line,sym,count,pay,cells}]
function evaluateLines(grid, lb){
  const wins=[];
  CONFIG.PAYLINES.forEach((line,li)=>{
    const syms = line.map((row,reel)=> grid[reel][row]);
    let base=null;
    for (const s of syms){ if (s!=="wild" && s!=="scatter" && s!=="coin"){ base=s; break; } }
    const target = base || (syms[0]==="wild" ? "wild" : null);
    if (!target || !CONFIG.PAY[target]) return;
    let count=0;
    for (let reel=0; reel<CONFIG.REELS; reel++){
      const s=syms[reel];
      if (s===target || s==="wild") count++; else break;
    }
    if (count>=3){
      const pay = (CONFIG.PAY[target][count]||0) * lb * CONFIG.BASE_PAY_SCALE;
      if (pay>0){
        const c=[]; for (let reel=0;reel<count;reel++) c.push(line[reel]*10+reel);
        wins.push({line:li, sym:target, count, pay, cells:c});
      }
    }
  });
  return wins;
}
function scatterPayout(count, bet){
  const k=Math.min(count,5);
  return count>=3 ? (CONFIG.SCAT_PAY[k]||0)*bet : 0;
}

/* ----- Jackpot ----- */
// 回傳某層 jackpot 的賠付（credits）。
//  mult 型：mult×bet（永遠全拿）。prog 型：顯示池 × (bet/MAX_BET)（滿注全拿、否則比例）。
// jpState 可選，提供 major/grand 即時池；缺省用基底 base。
function jackpotWin(tier, bet, jpState){
  const J=CONFIG.JACKPOT[tier];
  if (J.kind==="mult") return J.mult*bet;
  const pool = (jpState && jpState[tier]!=null) ? jpState[tier] : J.base;
  return pool * (bet/MAX_BET);
}

/* ----- Hold & Spin ----- */
function rollCoin(rng=RND){
  const r=rng(), p=CONFIG.HS_COIN_ROLL;
  if (r<p.major) return {type:"major"};
  if (r<p.major+p.minor) return {type:"minor"};
  if (r<p.major+p.minor+p.mini) return {type:"mini"};
  const t=CONFIG.HS_VAL_TABLE;
  return {type:"val", mult:t[(rng()*t.length)|0]};
}
// 單顆金幣價值（credits）。一般倍率幣套 HS_BONUS_MULT 調校；jackpot 幣全拿真值（不套）。
function coinValue(roll, bet, jpState){
  if (roll.type==="val") return roll.mult*bet*CONFIG.HS_BONUS_MULT;
  return jackpotWin(roll.type, bet, jpState);
}
// 模擬一場 Hold & Spin，回傳贏分（credits）。startCount=起始金幣數
function simHoldAndSpin(bet, startCount, jpState, rng=RND){
  const TOTAL=CONFIG.REELS*CONFIG.ROWS;
  const coins=[]; let locked=0;
  for (let i=0;i<startCount && locked<TOTAL;i++){ coins.push(rollCoin(rng)); locked++; }
  let respins=CONFIG.HS_RESPINS;
  while (respins>0 && locked<TOTAL){
    respins--;
    let newC=0; const empties=TOTAL-locked;
    for (let e=0;e<empties;e++){ if (rng()<CONFIG.HS_NEW_COIN_PROB){ coins.push(rollCoin(rng)); locked++; newC++; } }
    if (newC>0) respins=CONFIG.HS_RESPINS;
  }
  let sum=0;
  for (const c of coins) sum+=coinValue(c,bet,jpState);
  if (locked>=TOTAL) sum += jackpotWin("grand", bet, jpState);   // 集滿 = GRAND（全拿真值）
  return sum;
}

/* ----- 免費遊戲 ----- */
// 回傳贏分（credits）。strips 為轉軸帶
function simFreeSpins(strips, bet, rng=RND){
  const lb=bet/CONFIG.LINES;
  let spins=CONFIG.FS_SPINS, multIdx=-1, total=0;
  while (spins>0){
    spins--;
    const grid=spinGrid(strips,rng);
    const lws=evaluateLines(grid,lb);
    if (lws.length>0 && gridHasWild(grid)) multIdx=Math.min(multIdx+1, CONFIG.FS_MULT_STEPS.length-1);
    const curMult=(multIdx>=0?CONFIG.FS_MULT_STEPS[multIdx]:1) * CONFIG.FS_BONUS_MULT;
    for (const w of lws) total += w.pay*curMult;
    const sp=positionsOf(grid,"scatter");
    if (sp.length>=3) total += scatterPayout(sp.length,bet)*CONFIG.FS_BONUS_MULT;
    if (sp.length>=CONFIG.FS_TRIGGER) spins+=CONFIG.FS_SPINS;   // 再觸發
  }
  return total;
}

/* ----- 選寶箱 ----- */
function makePickReward(rng=RND){
  if (rng()<CONFIG.PICK.MULT_PROB) return {type:"mult", val:CONFIG.PICK.MULT_VAL};
  const t=CONFIG.PICK.COIN_TABLE;
  return {type:"coin", val:t[(rng()*t.length)|0]};
}
function makePickBoxes(rng=RND){
  const {COUNT,NBOMB_MIN,NBOMB_MAX}=CONFIG.PICK;
  const nBomb=NBOMB_MIN+((rng()<0.5)?0:(NBOMB_MAX-NBOMB_MIN));
  const boxes=[]; for(let i=0;i<nBomb;i++) boxes.push({type:"bomb"});
  while(boxes.length<COUNT) boxes.push(makePickReward(rng));
  return shuffle(boxes,rng);
}
// 模擬一場選寶箱（隨機開箱直到炸彈/開完），回傳贏分（credits）
function simPickBonus(bet, rng=RND){
  const boxes=makePickBoxes(rng);
  const order=shuffle([...boxes.keys()],rng);
  let total=0;                       // 原始累積（× 總注，未放大）
  for (const idx of order){
    const p=boxes[idx];
    if (p.type==="bomb") break;
    if (p.type==="mult") total*=p.val;
    else total+=p.val;
  }
  return Math.min(total*CONFIG.PICK_BONUS_MULT, CONFIG.PICK.CAP) * bet;  // 最終放大後封頂
}

/* ----- 推筒子比牌 ----- */
function dealTiles(rng=RND){ const a=1+((rng()*6)|0), b=1+((rng()*6)|0); return {t:[a,b], pt:(a+b)%10, pair:a===b}; }
function compareTiles(p,d){
  if (p.pair&&!d.pair) return 1;
  if (!p.pair&&d.pair) return -1;
  if (p.pair&&d.pair) return p.t[0]>d.t[0] ? 1 : -1;   // 大對勝，同對莊勝
  return p.pt>d.pt ? 1 : -1;                            // 比點，同點莊勝（莊家優勢）
}
// 模擬一場推筒子比牌，回傳贏分（credits）。jpState 提供 major 池
function simCardBattle(bet, jpState, rng=RND){
  const {STEP,CAP}=CONFIG.CB;
  let raw=0, streak=0, jpCredits=0;       // raw = 連勝步進累積（未放大）；jpCredits = 天王對拿到的 jackpot
  while (true){
    const pl=dealTiles(rng), de=dealTiles(rng);
    if (compareTiles(pl,de)>0){
      streak++;
      raw += STEP[Math.min(streak-1,STEP.length-1)];
      if (pl.pair && pl.t[0]===6) jpCredits += jackpotWin("major", bet, jpState);   // 天王對 → MAJOR（真值）
      // 提前封頂：步進放大後 + jackpot 已達上限
      if (raw*CONFIG.CB_BONUS_MULT*bet + jpCredits >= CAP*bet) break;
    } else break;
  }
  return Math.min(raw*CONFIG.CB_BONUS_MULT*bet + jpCredits, CAP*bet);   // 上限 = CAP × 總注
}

return {
  CONFIG, REEL_WEIGHTS, BONUS_MODES, STRIPS, MAX_BET, mulberry32,
  shuffle, buildStrips, spinGrid, positionsOf, gridHasWild,
  evaluateLines, scatterPayout, jackpotWin,
  rollCoin, coinValue, simHoldAndSpin,
  simFreeSpins,
  makePickReward, makePickBoxes, simPickBonus,
  dealTiles, compareTiles, simCardBattle,
};
});
