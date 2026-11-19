import test from 'node:test';
import assert from 'node:assert/strict';
import {collectDailyPages,daysBetween,rangeProblem,resource} from './model.mjs';

test('long comparisons include leap days and both endpoints',()=>{
  assert.equal(daysBetween('2024-01-01','2024-12-31').length,366);
  assert.equal(rangeProblem('1991-01-01','2020-12-31'),'');
  assert.match(rangeProblem('1991-01-01','2021-01-01'),/30 years/);
  assert.match(rangeProblem('2024-02-30','2024-03-01'),/valid/);
  assert.match(rangeProblem('2024-03-02','2024-03-01'),/end date/);
});
const first=resource('climate-daily',{datetime:'2024-01-01/2025-12-31',limit:500});
test('follows ECCC continuation URLs in JSON and preserves progress',async()=>{
  const progress=[];
  const rows=await collectDailyPages(first,async url=>url.searchParams.has('offset')
    ? (assert.equal(url.searchParams.get('f'),'json'),{features:['second'],numberMatched:2})
    : {features:['first'],numberMatched:2,links:[{rel:'next',href:'?offset=1'}]},n=>progress.push(n));
  assert.deepEqual(rows,['first','second']);
  assert.deepEqual(progress,[1,2]);
});
test('does not misreport an incomplete or failed page as missing weather',async()=>{
  await assert.rejects(collectDailyPages(first,async()=>({features:[],numberMatched:2})),/before all/);
  await assert.rejects(collectDailyPages(first,async()=>({features:[],links:[{rel:'next',href:first.href}]})),/repeated/);
  await assert.rejects(collectDailyPages(first,async()=>{throw new Error('HTTP 503')}),/503/);
});
