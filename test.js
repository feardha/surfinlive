var S = require('./tournament.js');

function test(n) {
  var names = [];
  for (var i = 1; i <= n; i++) names.push('P' + i);
  var t = S.generateTournament(names);
  S.simulateTournament(t);

  var ok = true, msgs = [];

  // 1) show sizes valid
  t.rounds.forEach(function (r) {
    r.shows.forEach(function (h) {
      var sz = h.contestants.length;
      if (!r.isFinal && sz !== 4 && sz !== 5) { ok = false; msgs.push(r.name + ' show size ' + sz); }
      if (r.isFinal && sz !== 4) { ok = false; msgs.push('Final show size ' + sz + ' (want 4)'); }
    });
  });

  // 2) per-show advancement rule (count REAL contestants advancing)
  t.rounds.forEach(function (r) {
    r.shows.forEach(function (h) {
      var reals = h.contestants.filter(function (c) { return !c.isBye; });
      var advReals = reals.filter(function (c) {
        return c.status === 'advanced' || c.status === 'champion' || c.status === 'runnerup';
      }).length;
      var elimReals = reals.filter(function (c) { return c.status === 'eliminated'; }).length;
      if (advReals + elimReals !== reals.length) { ok = false; msgs.push(r.name + ' ' + h.label + ' undecided reals'); }
      if (r.isFinal) {
        if (advReals !== 2) { ok = false; msgs.push('Final advReals=' + advReals); }
      } else if (reals.length >= 3 && advReals !== 2) {
        ok = false; msgs.push(r.name + ' ' + h.label + ' advReals=' + advReals + ' (want 2)');
      } else if (reals.length < 2 && advReals !== reals.length) {
        ok = false; msgs.push(r.name + ' ' + h.label + ' small advReals mismatch');
      }
    });
  });

  // 3) cross-round consistency: real names advanced from round r == reals present in round r+1
  for (var r = 0; r + 1 < t.rounds.length; r++) {
    var advSet = {};
    t.rounds[r].shows.forEach(function (h) {
      h.contestants.forEach(function (c) {
        if (!c.isBye && (c.status === 'advanced' || c.status === 'champion' || c.status === 'runnerup')) advSet[c.name] = true;
      });
    });
    var nextSet = {};
    t.rounds[r + 1].shows.forEach(function (h) {
      h.contestants.forEach(function (c) { if (!c.isBye) nextSet[c.name] = true; });
    });
    var advArr = Object.keys(advSet).sort();
    var nextArr = Object.keys(nextSet).sort();
    if (JSON.stringify(advArr) !== JSON.stringify(nextArr)) {
      ok = false; msgs.push('round ' + t.rounds[r].name + ' advances != next round names');
    }
  }

  // 4) exact input set covered, champion/runnerUp valid & distinct, BYE never wins
  var seen = {};
  t.rounds.forEach(function (r) {
    r.shows.forEach(function (h) {
      h.contestants.forEach(function (c) { if (!c.isBye) seen[c.name] = true; });
    });
  });
  var seenArr = Object.keys(seen).sort();
  var inputArr = names.slice().sort();
  if (JSON.stringify(seenArr) !== JSON.stringify(inputArr)) { ok = false; msgs.push('input set mismatch'); }
  if (t.champion === S.BYE || t.runnerUp === S.BYE) { ok = false; msgs.push('BYE in finals'); }
  if (!t.champion || !t.runnerUp || t.champion === t.runnerUp) { ok = false; msgs.push('champ/RU invalid'); }

  console.log('n=' + n + ' (byes=' + t.byes + ') rounds=' + t.rounds.length +
    ' [' + t.rounds.map(function (r) { return r.name + '(' + r.shows.length + 's)'; }).join(' -> ') + ']' +
    ' | champ=' + t.champion + ' RU=' + t.runnerUp +
    ' | OK=' + ok + (msgs.length ? ' ISSUES: ' + msgs.join('; ') : ''));
}

[2,3,4,5,6,7,8,11,12,16,20,22,32,33,40,41,50,64].forEach(test);
