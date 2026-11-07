/* Render the simulated 200-contestant SurfinLive bracket as an SVG.
 * Rounds run left->right; each show is a block of 4-5 contestant rows.
 * The champion's winning path through every round is outlined in gold,
 * and the Final crowns champion + runner-up. Deterministic (seeded RNG).
 *
 * Usage: node bracket_svg.js [count]   (default 100) -> bracket_<count>.svg/.png */

var S = require('./tournament.js');
var fs = require('fs');

var COUNT = parseInt(process.argv[2] || '100', 10);
var SEED = COUNT;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var ADJ = ['Reef','Tidal','Sunny','Coral','Storm','Azure','Salty','Wave','Coastal','Drift'];
var NAM = ['Slater','Beachley','Medina','Moore','Florence','Gilmore','Ferreira','Gabeira','Parko','Fanning','Wright','Buchan','Curren','Ho','Moniz','Laurie','Andino','Colapinto','Robinson','Marks'];
var names = [];
for (var i = 1; i <= COUNT; i++) names.push(ADJ[i % ADJ.length] + ' ' + NAM[i % NAM.length] + ' #' + i);

var RNG = mulberry32(SEED);
var t = S.generateTournament(names, RNG);
S.simulateTournament(t, mulberry32(SEED));

var R = t.rounds.length;
var H_TOTAL = 5600;            // vertical space shared by all rounds (centers align)
var COL_W = 210, BLOCK_W = 196, ROW_H = 21, PAD = 6;
var MARGIN_X = 30, MARGIN_Y = 40;

// vertical center of show k in round r (H shows): constant H_TOTAL => perfect alignment
var centers = t.rounds.map(function (round) {
  var H = round.shows.length;
  var arr = [];
  for (var k = 0; k < H; k++) arr.push(MARGIN_Y + (k + 0.5) / H * H_TOTAL);
  return arr;
});

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

var parts = [];
parts.push('<?xml version="1.0" encoding="UTF-8"?>');
var W = MARGIN_X * 2 + R * COL_W;
var Hpx = MARGIN_Y * 2 + H_TOTAL;
parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + Hpx +
  '" viewBox="0 0 ' + W + ' ' + Hpx + '" font-family="Helvetica, Arial, sans-serif">');
parts.push('<rect width="' + W + '" height="' + Hpx + '" fill="#0b1f2a"/>');

// title + legend
parts.push('<text x="' + MARGIN_X + '" y="24" fill="#e8f4f8" font-size="18" font-weight="bold">SurfinLive — ' + COUNT + ' Surfers · Simulated Bracket</text>');
parts.push('<text x="' + MARGIN_X + '" y="H_TOTAL_PLACEHOLDER" fill="#7fb0c0" font-size="12">Champion: ' + esc(t.champion) + '   ·   Runner-up: ' + esc(t.runnerUp) + '   ·   BYEs added: ' + t.byes + '</text>');

// connectors first (behind blocks)
for (var r = 0; r + 1 < R; r++) {
  var cur = t.rounds[r], nxt = t.rounds[r + 1];
  for (var j = 0; j < nxt.shows.length; j++) {
    var yNext = centers[r + 1][j];
    var x1 = MARGIN_X + r * COL_W + BLOCK_W, x2 = MARGIN_X + (r + 1) * COL_W;
    var midx = (x1 + x2) / 2;
    [2 * j, 2 * j + 1].forEach(function (ki) {
      if (ki >= cur.shows.length) return;
      var yA = centers[r][ki];
      parts.push('<path d="M ' + x1 + ' ' + yA + ' C ' + midx + ' ' + yA + ' ' + midx + ' ' + yNext + ' ' + x2 + ' ' + yNext +
        '" stroke="#2c4a59" stroke-width="1.2" fill="none"/>');
    });
  }
}

// champion path set: for each round, the show index containing the champion, and its row
var champShowIdx = [], champRow = [];
t.rounds.forEach(function (round, ri) {
  for (var hi = 0; hi < round.shows.length; hi++) {
    var idx = round.shows[hi].contestants.findIndex(function (c) { return c.name === t.champion; });
    if (idx >= 0) { champShowIdx[ri] = hi; champRow[ri] = idx; }
  }
});

// round headers
t.rounds.forEach(function (round, r) {
  var x = MARGIN_X + r * COL_W;
  var label = round.name + (round.isFinal ? ' (4)' : ' (' + round.shows.length + 's)');
  parts.push('<text x="' + x + '" y="' + (MARGIN_Y - 14) + '" fill="#9fd0e0" font-size="13" font-weight="bold">' + esc(label) + '</text>');
});

// show blocks
t.rounds.forEach(function (round, r) {
  var x = MARGIN_X + r * COL_W;
  round.shows.forEach(function (show, hi) {
    var cy = centers[r][hi];
    var n = show.contestants.length;
    var blockH = n * ROW_H + PAD * 2;
    var yTop = cy - blockH / 2;
    var onChampPath = (champShowIdx[r] === hi);
    var stroke = onChampPath ? '#f5c518' : '#1d3a49';
    var strokeW = onChampPath ? 2.4 : 1;
    parts.push('<rect x="' + x + '" y="' + yTop + '" width="' + BLOCK_W + '" height="' + blockH +
      '" rx="5" fill="' + (onChampPath ? '#13343f' : '#102733') + '" stroke="' + stroke + '" stroke-width="' + strokeW + '"/>');
    show.contestants.forEach(function (c, ci) {
      var ty = yTop + PAD + ROW_H * (ci + 0.7);
      var fill, weight = 'normal';
      if (c.isBye) fill = '#3a4f59';
      else if (c.status === 'champion') { fill = '#f5c518'; weight = 'bold'; }
      else if (c.status === 'runnerup') fill = '#d9e6ec';
      else if (c.status === 'advanced') fill = '#7fd6a0';
      else fill = '#6f8a96';
      var tag = c.status === 'champion' ? ' ★' : c.status === 'runnerup' ? ' ◆' : '';
      parts.push('<text x="' + (x + 8) + '" y="' + ty + '" fill="' + fill + '" font-size="10.5" font-weight="' + weight + '">' +
        esc(c.name) + (c.isBye ? ' (bye)' : tag) + '</text>');
    });
  });
});

parts.push('</svg>');
var svg = parts.join('\n').replace('H_TOTAL_PLACEHOLDER', String(Hpx - 14));
fs.writeFileSync('bracket_' + COUNT + '.svg', svg);
console.log('Wrote bracket_' + COUNT + '.svg  (' + W + ' x ' + Hpx + ', ' + R + ' rounds, ' + t.champion + ' def. ' + t.runnerUp + ')');
