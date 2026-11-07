var S = require('./tournament.js');
function manualPlay(n) {
  var names = []; for (var i = 1; i <= n; i++) names.push('P' + i);
  var t = S.generateTournament(names);
  var roundIdx = 0;
  while (roundIdx < t.rounds.length) {
    var round = t.rounds[roundIdx];
    round.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye && c.status !== 'tbd'; });
      reals.forEach(function (c) { c.picked = false; });
      // deterministic: pick the two with the smallest numeric id (prefer lower seeds)
      reals.sort(function (a, b) { return parseInt(a.name.slice(1), 10) - parseInt(b.name.slice(1), 10); });
      for (var k = 0; k < Math.min(2, reals.length); k++) reals[k].picked = true;
    });
    var res = S.scoreRound(t, roundIdx);
    if (!res.ok) { console.log('  manual FAIL at round', roundIdx, res.errors); return; }
    roundIdx++;
  }
  console.log('n=' + n + ' manual-play complete: champ=' + t.champion + ' RU=' + t.runnerUp +
    ' rounds=' + t.rounds.length + ' OK=' + (t.champion && t.champion !== S.BYE && t.runnerUp && t.champion !== t.runnerUp));

  // test clearFromRound resets downstream
  S.clearFromRound(t, 0);
  var stillTBD = t.rounds[t.rounds.length - 1].shows[0].contestants.every(function (c) { return c.status === 'tbd'; });
  console.log('   after clearFromRound(0): champion null=' + (t.champion === null) + ' finalIsTBD=' + stillTBD);
}
[4, 8, 20, 32, 50].forEach(manualPlay);
