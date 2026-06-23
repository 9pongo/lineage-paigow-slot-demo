/* ============================================================
   推筒子（牌九式）引擎 — 單一真相源（瀏覽器 + Node 共用）
   40 張牌：一~九筒各 4 張（36）＋ 白板 4 張。白板 = 0.5 點。
   莊家 vs 初門/川門/尾門，三門各自與莊比牌；每局重洗。
   牌型：天王(雙白板) ＞ 對子 ＞ 點數 ＞ 鱉十(0點)
   勝負：比牌型 → 比點數 → 比最大單張；任何平手莊家勝。
   用途：① FS 加成(K局，門勝×2/天王×4/輸×1，連乘) ② 購買(單局，門勝×W/天王×Wtw)
   所有隨機走注入 rng（伺服器權威可稽核）。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else { for (const k in api) root[k] = api[k]; root.PAIGOW = api; }
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

const CONFIG = {
  GATES: ["chu", "chuan", "wei"],          // 初門 / 川門 / 尾門
  GATE_NAMES: { chu: "初門", chuan: "川門", wei: "尾門" },
  FS_MULT: { rounds: 3, win: 2, tenwang: 4, lose: 1 },   // FS 加成：連乘，輸保本×1
  BUY: { cost: 2000, win: 10, tenwang: 100, mode: "social" }, // social=照標竿×10/×100；真金流需重算(見 reprice)
};

const RND = () => Math.random();
function shuffle(arr, rng = RND) { for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

// 一副 40 張
function makeDeck() {
  const d = [];
  for (let n = 1; n <= 9; n++) for (let k = 0; k < 4; k++) d.push({ n, white: false, v: n });
  for (let k = 0; k < 4; k++) d.push({ n: 0, white: true, v: 0.5 });
  return d;
}
function drawTile(deck, rng = RND) { return deck.splice((rng() * deck.length) | 0, 1)[0]; }

// 評牌：回 { rank, pts, maxS, pairN, type }
//   rank: 天王4 > 對子3 > 點數2 > 鱉十1
function evalHand(hand) {
  const [a, b] = hand;
  const tenwang = a.white && b.white;
  const pair = !a.white && !b.white && a.n === b.n;
  const pts = (a.v + b.v) % 10;                       // 個位；白0.5
  const bieshi = !tenwang && !pair && Math.abs(pts) < 1e-9;
  let rank, type;
  if (tenwang) { rank = 4; type = "天王"; }
  else if (pair) { rank = 3; type = "對子"; }
  else if (bieshi) { rank = 1; type = "鱉十"; }
  else { rank = 2; type = "點數"; }
  return { rank, pts, maxS: Math.max(a.v, b.v), pairN: pair ? a.n : 0, type, tenwang };
}

// 門 g 對 莊 b：回 1=門勝、0=莊勝(含平手)
function compare(g, b) {
  if (g.rank !== b.rank) return g.rank > b.rank ? 1 : 0;
  if (g.rank === 3) return g.pairN > b.pairN ? 1 : 0;          // 對子比大小
  if (g.rank === 2) { if (Math.abs(g.pts - b.pts) > 1e-9) return g.pts > b.pts ? 1 : 0; return g.maxS > b.maxS ? 1 : 0; }
  return g.maxS > b.maxS ? 1 : 0;                               // 天王both / 鱉十both：比最大單張，同→莊
}

// 開一局：擲兩骰決定發牌起門；發莊+三門共 8 張（面朝下→開放下注→揭牌）
function dealRound(rng = RND) {
  const deck = shuffle(makeDeck(), rng);
  const dice = [1 + ((rng() * 6) | 0), 1 + ((rng() * 6) | 0)];
  const startIdx = (dice[0] + dice[1]) % 3;                    // 由莊起算決定哪門先發（純表演）
  const banker = [drawTile(deck, rng), drawTile(deck, rng)];
  const gates = {};
  for (const g of CONFIG.GATES) gates[g] = [drawTile(deck, rng), drawTile(deck, rng)];
  const bankerEval = evalHand(banker);
  const result = {};
  for (const g of CONFIG.GATES) result[g] = outcome(gates[g], banker);
  return { dice, startIdx, startGate: CONFIG.GATES[startIdx], banker, bankerEval, gates,
           gateEvals: Object.fromEntries(CONFIG.GATES.map(g => [g, evalHand(gates[g])])), result };
}

// 單門對莊結果：'tenwang' | 'win' | 'lose'
function outcome(gateHand, bankerHand) {
  const ge = evalHand(gateHand);
  if (compare(ge, evalHand(bankerHand)) === 1) return ge.tenwang ? "tenwang" : "win";
  return "lose";
}

/* ----- FS 加成（K 局連乘，輸保本×1）。回 { multiplier, rounds:[{round, pickedGate, outcome, factor}] } ----- */
function simFSMult(rng = RND, rounds = CONFIG.FS_MULT.rounds, pickGate = null) {
  const M = CONFIG.FS_MULT;
  let mult = 1; const log = [];
  for (let i = 0; i < rounds; i++) {
    const r = dealRound(rng);
    const g = pickGate || CONFIG.GATES[(rng() * 3) | 0];        // 玩家選門；sim 隨機（各門等機率）
    const oc = r.result[g];
    const factor = oc === "tenwang" ? M.tenwang : oc === "win" ? M.win : M.lose;
    mult *= factor;
    log.push({ round: i + 1, dice: r.dice, pickedGate: g, outcome: oc, factor, banker: r.banker, gates: r.gates });
  }
  return { multiplier: mult, rounds: log };
}

/* ----- 購買（單局，門勝×win、天王×tenwang）。回 { outcome, payoutMult, ... } ----- */
function simBuy(rng = RND, pickGate = null) {
  const r = dealRound(rng);
  const g = pickGate || CONFIG.GATES[(rng() * 3) | 0];
  const oc = r.result[g];
  const payoutMult = oc === "tenwang" ? CONFIG.BUY.tenwang : oc === "win" ? CONFIG.BUY.win : 0;
  return { outcome: oc, pickedGate: g, payoutMult, dice: r.dice, banker: r.banker, gates: r.gates };
}

// 真金流重算購買賠率：給定門勝/天王勝機率與目標 RTP，維持 win:tenwang = 1:ratio
function reprice(pWin, pTenwang, targetRTP = 0.95, ratio = 10) {
  // pWin*W + pTenwang*(ratio*W) = targetRTP → W = targetRTP/(pWin + ratio*pTenwang)
  const W = targetRTP / (pWin + ratio * pTenwang);
  return { win: +W.toFixed(2), tenwang: +(ratio * W).toFixed(2) };
}

return { CONFIG, makeDeck, drawTile, evalHand, compare, dealRound, outcome, simFSMult, simBuy, reprice, shuffle };
});
