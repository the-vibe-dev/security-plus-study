import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { parsePracticalPackage, writePracticalPackage } from '../practical-import.mjs';

test('draft snapshots save every recovered answer atomically and reject stale saves and finalization', {timeout: 20000}, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'secplus-draft-test-'));
  const bundle = parsePracticalPackage(fs.readFileSync(new URL('../security_plus_sy0_701_practical_site_upgrade.zip',import.meta.url)));
  writePracticalPackage(dir,bundle);
  const ids = ['SEC-Q001','SEC-Q002'];
  const listener=net.createServer();await new Promise((r)=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise((r)=>listener.close(r));
  const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),STUDY_DATA_DIR:dir,NODE_ENV:'',STUDY_USERNAME:'',STUDY_PASSWORD:'',STUDY_ORIGIN:`http://127.0.0.1:${port}`},stdio:'ignore'});
  const request=async(route,method='GET',body)=>{const r=await fetch(`http://127.0.0.1:${port}`+route,{method,headers:{'x-study-request':'1','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,...await r.json()};};
  try {
    let ready=false;
    for(let i=0;i<80;i++){try{if((await request('/api/health')).ok){ready=true;break;}}catch{}await new Promise((r)=>setTimeout(r,30));}
    assert.ok(ready);
    const {attempt}=await request('/api/practical/attempts','POST',{mode:'learning',ids});
    const base=`/api/practical/attempts/${attempt.id}`;
    const snapshot={baseRevision:0,responses:Object.fromEntries(ids.map((id)=>[id,bundle.answerKeys[id].answer])),flags:{[ids[0]]:true},cursor:1,timeByItem:{[ids[0]]:0}};
    const invalid={...snapshot,responses:{...snapshot.responses,[ids[1]]:'not-an-option'}};
    assert.equal((await request(base+'/draft','PUT',invalid)).status,400);
    assert.deepEqual((await request(base)).attempt.responses,{});
    const saved=await request(base+'/draft','PUT',snapshot);
    assert.equal(saved.status,200);assert.equal(saved.answeredCount,2);
    assert.equal((await request(base+'/draft','PUT',{...snapshot,responses:{}})).status,409);
    assert.equal((await request(base+'/submit','POST',{baseRevision:0})).status,409);
    const stored=(await request(base)).attempt;
    assert.deepEqual(stored.responses,snapshot.responses);assert.equal(stored.flags[ids[0]],true);assert.equal(stored.cursor,1);
    const submitted=await request(base+'/submit','POST',{baseRevision:saved.revision});
    assert.equal(submitted.status,200);assert.equal(submitted.attempt.score.percent,100);
    assert.equal((await request(base+'/draft','PUT',{...snapshot,baseRevision:saved.revision})).status,409);
  } finally {child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
