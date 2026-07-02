import assert from 'node:assert/strict';
import test from 'node:test';
import { fillMissingRosterDetails } from '../lib/roster-details';

test('roster details fill missing fields without overwriting saved values',()=>{
  const filled=fillMissingRosterDetails({full_name:'Aashish Gautam',location:'',department:'',role:'',wage:0});
  assert.deepEqual(filled,{full_name:'Aashish Gautam',location:'Chiang Mai Danforth',department:'Back of House',role:'Curry',wage:17.6});
  const preserved=fillMissingRosterDetails({full_name:'Aashish Gautam',location:'Custom',department:'Special',role:'Lead',wage:30});
  assert.equal(preserved.location,'Custom');assert.equal(preserved.role,'Lead');assert.equal(preserved.wage,30);
});
