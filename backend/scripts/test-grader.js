// Grading and scoring tests:  npm test
//
// Every case here is a fault that was in the record. Each trade's outcome is
// decided by these two functions, and everything the system learns — targets,
// stop ceilings, setup quarantines, goals — is computed from those outcomes.
// A grading bug does not crash anything; it just quietly changes the numbers.
// Written 2026-10-02 alongside fixes for: walks past the horizon, expiries
// settled at the grading-day price, invented 0R results, targets credited from
// the part of the fill bar before the fill, single exits paid at TP2, daily
// bars timed from midnight UTC, and trades scored under the wrong exit plan.
const M = await import('../lib/signalMonitor.js');
const R = await import('../lib/realisedR.js');
let pass=0,fail=0; const t=(n,ok,x)=>{ok?pass++:fail++;console.log(`  ${ok?'PASS':'FAIL'} ${n.padEnd(58)} ${x||''}`);};
const H=3600e3, t0=Date.parse('2026-08-03T10:30:00Z');
const L={market:'crypto',direction:'LONG',entry:100,sl:95,tp:105,tp2:106,signaledAt:t0,expiresAt:t0+48*H};
const S={...L,direction:'SHORT',entry:100,sl:105,tp:95,tp2:94};
const b=(h,o,hi,lo,c)=>({date:new Date(t0+h*H).toISOString(),open:o,high:hi,low:lo,close:c});
const d=(date,o,h,l,c)=>({date,open:o,high:h,low:l,close:c});
let r;
console.log('HORIZON');
r=M.determineOutcome(L,[b(1,101,101,99.5,100.5),b(47,101,101.5,100.8,101.2),b(60,101.2,106,101,105.5)]);
t('target after the horizon is not a win', r?.reason==='EXPIRED');
t('expiry settles at the last close inside the horizon', r?.closePrice===101.2);
t('closedAt is the horizon', r?.closedAt===L.expiresAt);
r=M.determineOutcome(L,[b(1,101,101,99.5,100.5),b(70,100,100,90,91)]);
t('stop after the horizon is not a loss', r?.reason==='EXPIRED');
t('no price data -> wait, never an invented 0R', M.determineOutcome(L,[])===null);
console.log('FILLS');
r=M.determineOutcome(L,[b(1,102,103,101,102.5),b(30,103,104,102,103)]);
t('limit never reached -> NEVER_FILLED', r?.reason==='NEVER_FILLED');
r=M.determineOutcome(L,[b(1,102,103,101,102.5),b(55,101,101,99,99.5)]);
t('fill only after the horizon is not a trade', r?.reason==='NEVER_FILLED');
console.log('FILL BAR');
r=M.determineOutcome(L,[b(1,103,106,99.8,101)]);
t('long: target seen only BEFORE the fill is not a win', r?.reason!=='TP1', r?.reason);
r=M.determineOutcome(L,[b(1,103,106,99.8,105.5)]);
t('long: close past target on the fill bar is a win', r?.reason==='TP1');
r=M.determineOutcome(L,[b(1,103,106,94,105.5)]);
t('long: stop on the fill bar beats a later target', r?.reason==='SL');
r=M.determineOutcome(L,[b(1,103,106,99.8,101),b(2,101,105.2,100.5,104)]);
t('long: target on the next bar counts', r?.reason==='TP1');
r=M.determineOutcome(S,[b(1,97,100.3,94,99)]);
t('short: target seen only BEFORE the fill is not a win', r?.reason!=='TP1', r?.reason);
r=M.determineOutcome(S,[b(1,97,100.3,94,94.5)]);
t('short: close past target on the fill bar is a win', r?.reason==='TP1');
r=M.determineOutcome(L,[b(1,103,106,99.8,101),b(40,101,101.5,100.2,100.8)]);
t('fill-bar MFE uses the close, not the earlier high', r && Math.abs(r.mfe-1.5)<1e-9, `mfe=${r?.mfe}`);
console.log('EXIT PLANS');
r=M.determineOutcome({...L,signaledAt:Date.parse('2026-09-10T10:30:00Z'),expiresAt:Date.parse('2026-09-12T10:30:00Z')},
  [{date:'2026-09-10T11:30:00.000Z',open:101,high:101,low:99.5,close:100.5},{date:'2026-09-10T15:30:00.000Z',open:100.5,high:107,low:100.2,close:106.5}]);
t('single exit: a bar through TP2 still exits at TP1', r?.reason==='TP1'&&r.closePrice===105);
r=M.determineOutcome({...L,tp0:101.5},[b(1,101,101,99.5,100.5),b(5,100.5,107,100.2,106.5)]);
t('thirds: the runner can still reach TP2', r?.reason==='TP2');
const cvx={market:'stocks',direction:'SHORT',entry:184.53,sl:187.98,tp:179.6,tp2:178.6,tp0:183.05,
  signaledAt:Date.parse('2026-05-27T12:19:00Z'),expiresAt:Date.parse('2026-06-01T12:19:00Z')};
const bars=[d('2026-05-28',183.71,185.26,182.09,181.45),d('2026-05-29',182.72,182.97,180.40,180.88),d('2026-06-01',184.38,187.94,184.02,184.22)];
r=M.determineOutcome(cvx,bars);
t('daily: a session opening after expiry is excluded', r?.reason==='EXPIRED'&&r.closePrice===180.88, `${r?.reason} @ ${r?.closePrice}`);
r=M.determineOutcome({...cvx,expiresAt:Date.parse('2026-06-01T20:30:00Z')},bars);
t('daily: a session opening before expiry counts', r?.reason==='SCALED_BE', r?.reason);
console.log('TIME STOP (crypto cards since 2026-10-05)');
const TS={...L,timeStop:{afterHours:10,minProgress:0.2}};
// fills at hour 1, drifts sideways under 20% of the way for 10+ hours
r=M.determineOutcome(TS,[b(1,100.4,100.6,99.8,100.2),...Array.from({length:12},(_,i)=>b(2+i,100.2,100.6,99.9,100.3))]);
t('not working after 10h -> closed at market', r?.reason==='TIME_STOP' && r.closePrice===100.3, `${r?.reason} @ ${r?.closePrice}`);
r=M.determineOutcome(TS,[b(1,100.4,100.6,99.8,100.2),b(3,100.2,101.5,100.1,101.2),...Array.from({length:12},(_,i)=>b(4+i,101.2,101.4,100.9,101.1))]);
t('went 30% of the way early -> time stop does not fire', r?.reason!=='TIME_STOP', r?.reason);
r=M.determineOutcome(L,[b(1,100.4,100.6,99.8,100.2),...Array.from({length:12},(_,i)=>b(2+i,100.2,100.6,99.9,100.3))]);
t('no time stop on the card -> none applied', r?.reason!=='TIME_STOP', r?.reason);
r=M.determineOutcome(TS,[b(1,100.4,100.6,99.8,100.2),b(5,100.2,100.4,94,94.5)]);
t('stop inside the 10h still a stop', r?.reason==='SL');
t('TIME_STOP scored at its close', Math.abs(R.realisedR({...TS,signaledAt:Date.parse('2026-10-06T00:00:00Z'),exitPlan:'single',closeReason:'TIME_STOP',closePrice:100.3})-0.06)<1e-9);
console.log('MARKET ENTRY (stock cards since 2026-10-05)');
const MK={...L,entryType:'market',entry:100,sl:97,tp:104,expiresAt:t0+48*H};
// Card says 100; first price after it is 101 — filled there, printed levels kept.
r=M.determineOutcome(MK,[b(1,101,101.5,100.5,101.2),b(3,101.2,104.5,101,104.2)]);
t('fills at the first price after the card', r?.fillPrice===101 && r?.reason==='TP1', `${r?.reason} fill ${r?.fillPrice}`);
t('scored from the fill, printed levels: (104-101)/(101-97)',
  Math.abs(R.realisedR({...MK,signaledAt:Date.parse('2026-10-06T00:00:00Z'),exitPlan:'single',closeReason:'TP1',fillPrice:101})-0.75)<1e-9);
r=M.determineOutcome(MK,[b(1,96.5,98,96,97.5)]);
t('opens past the printed stop -> not taken', r?.reason==='NEVER_FILLED', r?.reason);
r=M.determineOutcome(MK,[b(1,104.5,105,104.2,104.8)]);
t('opens past the printed target -> not taken', r?.reason==='NEVER_FILLED', r?.reason);
r=M.determineOutcome(MK,[b(1,100,100.5,96.5,97.2)]);
t('stop on the fill bar is a stop', r?.reason==='SL');
t('limit cards are untouched by this', M.determineOutcome(L,[b(1,102,103,101,102.5),b(30,103,104,102,103)])?.reason==='NEVER_FILLED');
console.log('NEXT-CLOSE ENTRY (stock cards raised after the close, from 2026-10-08)');
// Raised Monday evening; Tuesday's session is the wait, entry at its close.
const ev=Date.parse('2026-10-05T21:00:00Z');
const NC={market:'stocks',direction:'LONG',entryType:'sessionClose',entry:100,sl:97,tp:104,signaledAt:ev,expiresAt:ev+96*H};
const hb=(iso,o,hi,lo,c)=>({date:iso,open:o,high:hi,low:lo,close:c});
const tue=[hb('2026-10-06T13:30:00Z',100,100.5,98.5,99),hb('2026-10-06T19:30:00Z',99,99.5,98,98.4)];
r=M.determineOutcome(NC,[...tue,hb('2026-10-07T13:30:00Z',98.6,101,98.5,100.8),hb('2026-10-07T15:30:00Z',100.8,104.3,100.5,104)]);
t('fills at the close of the first session', r?.fillPrice===98.4 && r?.reason==='TP1', `${r?.reason} fill ${r?.fillPrice}`);
t('scored from that fill: (104-98.4)/(98.4-97)',
  Math.abs(R.realisedR({...NC,exitPlan:'single',closeReason:'TP1',fillPrice:98.4})-(5.6/1.4))<1e-9);
r=M.determineOutcome(NC,[hb('2026-10-06T13:30:00Z',100,100.5,96.8,97.5),hb('2026-10-07T13:30:00Z',97.5,104.5,97.4,104)]);
t('stop touched in the waiting session -> never taken', r?.reason==='NEVER_FILLED', r?.reason);
r=M.determineOutcome(NC,[hb('2026-10-06T13:30:00Z',100,104.2,99.8,103)]);
t('target touched in the waiting session -> never taken', r?.reason==='NEVER_FILLED', r?.reason);
r=M.determineOutcome({...NC,expiresAt:Date.now()+96*H},[hb(new Date(Date.now()-H).toISOString(),100,100.5,99,99.5)]);
t('waiting session not over yet -> still open', r===null);
r=M.determineOutcome(NC,[...tue,hb('2026-10-07T13:30:00Z',100.5,101,100.2,100.8),hb('2026-10-07T14:30:00Z',100.8,101,96.5,97)]);
t('a gap away from the fill is still a held position', r?.reason==='SL', `${r?.reason} fill ${r?.fillPrice}`);
r=M.determineOutcome(NC,[d('2026-10-06',100,100.5,98.5,98.4),d('2026-10-07',98.6,104.3,98.5,104)]);
t('daily bars: same rule', r?.fillPrice===98.4 && r?.reason==='TP1', `${r?.reason} fill ${r?.fillPrice}`);
console.log('SCORING');
const card=(iso,cr,extra={})=>({signaledAt:Date.parse(iso),rrRatio:1.3,rrRatio2:1.56,closeReason:cr,...extra});
t('May card (single): TP1 pays 1.30R', Math.abs(R.realisedR(card('2026-05-26T22:00:00Z','TP1'))-1.3)<1e-9);
t('Aug 25 card (thirds): TP1 pays 0.563R', Math.abs(R.realisedR(card('2026-08-25T22:00:00Z','TP1'))-0.5633333)<1e-6);
t('Sep card (single): TP1 pays 1.30R', Math.abs(R.realisedR(card('2026-09-10T22:00:00Z','TP1'))-1.3)<1e-9);
t('single-exit TP2 record pays TP1', R.realisedR(card('2026-09-10T22:00:00Z','TP2'))===1.3);
t('explicit exitPlan always wins', R.exitPlanOf(card('2026-05-26T22:00:00Z','TP1',{exitPlan:'thirds'}))==='thirds');
t('a grade that scaled is scored as thirds', R.exitPlanOf(card('2026-05-26T22:00:00Z','SCALED_BE'))==='thirds');
t('never filled is not a trade', R.realisedR(card('2026-09-10T22:00:00Z','NEVER_FILLED'))===null);
t('wins pay the exact distance, not the rounded ratio',
  Math.abs(R.realisedR({signaledAt:Date.parse('2026-09-10T22:00:00Z'),exitPlan:'single',closeReason:'TP1',rrRatio:1.6,entry:100,sl:97.5,tp:104.05})-1.62)<1e-9);
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
