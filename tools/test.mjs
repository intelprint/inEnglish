import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let require=createRequire(import.meta.url);
try{require.resolve('jsdom');}catch{require=createRequire('C:/Users/user/.cache/inenglish-build-tools/package.json');}
const {JSDOM,VirtualConsole}=require('jsdom');
const code=await fs.readFile(path.join(root,'Code.gs'),'utf8'),prompt=await fs.readFile(path.join(root,'PromptEngine.gs'),'utf8'),html=await fs.readFile(process.argv[2]||path.join(root,'gas/index.html'),'utf8');
const results=[];let rows=[],calls=0;const props=new Map([['GEMINI_API_KEY','synthetic-test-key']]),cache=new Map();
const digestCalls=[];
const server=vm.createContext({
  console:{warn(){}},Date,
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
  CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),base64EncodeWebSafe:s=>Buffer.from(s).toString('base64url'),base64DecodeWebSafe:s=>Buffer.from(s,'base64url'),
    newBlob:b=>({getDataAsString:()=>Buffer.from(b).toString('utf8')}),computeHmacSha256Signature:(s,k)=>crypto.createHmac('sha256',k).update(s).digest(),
    // GAS's implicit encoding is reproduced instead of silently using Node's UTF-8 default.
    computeDigest:(_,s,charset)=>{digestCalls.push({text:s,charset});return [...crypto.createHash('sha256').update(charset==='UTF-8'?String(s):String(s).replace(/[^\x00-\x7f]/g,'?'),'utf8').digest()].map(b=>b>127?b-256:b);},
    Charset:{UTF_8:'UTF-8'},DigestAlgorithm:{SHA_256:'SHA256'},formatDate:(_,__,fmt)=>fmt==='yyyy-MM-dd'?'2026-10-28':'2026-10-28 12:00:00'},
  SpreadsheetApp:{openById:()=>({getSheetByName:()=>({getLastRow:()=>1,appendRow:r=>rows.push(r)})})},
  ScriptApp:{getScriptId:()=> 'test-script'},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({text:s,setMimeType(){return this;}})}
});
vm.runInContext(prompt,server);vm.runInContext(code,server);
server.generateTranslation_=(_,grade,value)=>{calls++;return{translation:'Hello!',grade,direction:'ko-to-en',tip:'인사해요.',pronunciation:'/həˈloʊ/',keyWords:[{word:'hello',meaning:'안녕'}],usedModel:'test-model'};};
const translate=p=>server.translateElementary({protocolVersion:2,...p});
function check(name,fn){fn();results.push({name,passed:true});}
const bootstrap=server.getAppBootstrap();
check('older clients must reload instead of using unbound results',()=>assert.equal(server.translateElementary({token:bootstrap.token,text:'hello',grade:3,requestId:crypto.randomUUID()}).success,false));
check('signed bootstrap session',()=>{assert.equal(bootstrap.success,true);assert.ok(bootstrap.token);assert.ok(!JSON.stringify(bootstrap).includes('synthetic-test-key'));});
check('invalid or tampered session blocked',()=>{assert.equal(translate({token:bootstrap.token+'x',text:'hello',grade:3,requestId:crypto.randomUUID()}).success,false);});
check('only Korean and English scripts accepted',()=>{assert.equal(server.validateLanguage_('한글 and English?'),true);for(const s of ['สวัสดี','नमस्ते','γειά','こんにちは'])assert.equal(server.validateLanguage_(s),false);});
check('500-character server maximum enforced',()=>assert.equal(translate({token:bootstrap.token,text:'a'.repeat(501),grade:3,requestId:crypto.randomUUID()}).success,false));
const req={token:bootstrap.token,text:'안녕',grade:3,requestId:crypto.randomUUID()};
check('translation and single history row',()=>{const r=translate(req);assert.equal(r.success,true);assert.equal(rows.length,1);assert.equal(r.recorded,true);});
check('same request replay does not generate or record twice',()=>{const r=translate(req);assert.equal(r.success,true);assert.equal(calls,1);assert.equal(rows.length,1);});
check('request ID cannot be reused for a different input',()=>assert.equal(translate({...req,text:'다른 말'}).success,false));
check('entire input hashed in cache key',()=>{const a='가'.repeat(20)+'하나',b='가'.repeat(20)+'둘';assert.notEqual(server.digest_(a),server.digest_(b));});
check('same-length Korean uses explicit UTF-8 and standard digest values',()=>{
  assert.equal(server.digest_('닌텐도 게임'),'1408f36283289cae02ea220e15acc1bcdefe884a21712fc92de10ca74c35f67d');
  assert.equal(server.digest_('매콤한 김밥'),'737eb35d61f807ac69923eed22164160cc1edc4962d69fec5ccc12ee167be1f7');
  assert.notEqual(server.digest_('육회'),server.digest_('김밥'));
  assert.equal(server.utf8Healthy_(),true);
  assert.ok(digestCalls.every(call=>call.charset==='UTF-8'));
});
check('poisoned legacy translation cache is never read',()=>{
  const legacyHash=crypto.createHash('sha256').update('2026-10-27-v3.1:5:??? ??').digest('hex');
  cache.set('translation_v3_'+legacyHash,JSON.stringify({translation:'Nintendo game',grade:5,direction:'ko-to-en',keyWords:[],usedModel:'poisoned'}));
  const before=calls;
  const r=translate({token:bootstrap.token,text:'매콤한 김밥',grade:5,requestId:crypto.randomUUID()});
  assert.equal(r.success,true);assert.equal(r.data.isCached,false);assert.notEqual(r.data.translation,'Nintendo game');assert.equal(calls,before+1);
  assert.deepEqual(JSON.parse(JSON.stringify(r.request)).text,'매콤한 김밥');
});
check('different requests and students never share a translation response',()=>{
  const before=calls;
  for(const value of ['닌텐도 게임','떡볶이 가게','매콤한 김밥']){
    const b=server.getAppBootstrap();const r=translate({token:b.token,text:value,grade:5,requestId:crypto.randomUUID()});
    assert.equal(r.success,true);assert.equal(r.request.text,value);assert.equal(r.data.isCached,false);
  }
  assert.equal(calls,before+3);
});
check('raw request identity protects against even an artificial digest collision',()=>{
  const original=server.digest_;
  server.digest_=s=>String(s).includes(':')?'forced-key':original(s);
  const b=server.getAppBootstrap(),id=crypto.randomUUID();
  assert.equal(translate({token:b.token,text:'육회',grade:6,requestId:id}).success,true);
  assert.equal(translate({token:b.token,text:'김밥',grade:6,requestId:id}).success,false);
  server.digest_=original;
});
check('formula-like history text neutralized',()=>{for(const s of ['=1+1',' +SUM(A1:A2)','@test'])assert.ok(server.sheetText_(s).startsWith("'"));});
check('teacher PIN fixed and API key never returned',()=>{assert.equal(server.getTeacherStatus({token:bootstrap.token,pin:'0000'}).success,false);const r=server.getTeacherStatus({token:bootstrap.token,pin:'0106'});assert.equal(r.success,true);assert.ok(!JSON.stringify(r).includes('synthetic-test-key'));});
check('HTML or malformed model output blocked',()=>{assert.throws(()=>server.normalizeResult_({direction:'ko-to-en',translation:'<img src=x>',keyWords:[]},3,'test'));assert.throws(()=>server.normalizeResult_({direction:'bad',translation:'hi',keyWords:[]},3,'test'));});
const session=server.getAppBootstrap();let limited=false;
for(let i=0;i<16;i++){const r=translate({token:session.token,text:'같은 표현',grade:4,requestId:crypto.randomUUID()});if(!r.success&&r.error.includes('빠르게'))limited=true;}
check('per-session rate limit enforced',()=>assert.equal(limited,true));
const errors=[],requests=[];let mode='success',pendingSuccess=null;const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://test.googleusercontent.com/userCodeAppPanel',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
  beforeParse(window){
    const realTimer=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===55000?50:ms,...args);
    window.HTMLElement.prototype.scrollIntoView=function(){};
    window.Audio=function(){this.pause=function(){};this.play=function(){return Promise.resolve();};};
    window.speechSynthesis={cancel(){},getVoices:()=>[],speak(){}};
    window.SpeechSynthesisUtterance=function(t){this.text=t;};
    window.document.execCommand=()=>true;
    window.google={script:{run:{
      withSuccessHandler(success){
        const runner={withFailureHandler(failure){runner.failure=failure;return runner;},
          getAppBootstrap(){queueMicrotask(()=>success({success:true,version:'test',token:'test-token'}));},
          getTeacherStatus(p){queueMicrotask(()=>success(p.pin==='0106'?{success:true,keyConfigured:true,dailyUsed:0,dailyLimit:2500,model:'test',version:'test',sheetUrl:'https://docs.google.com/spreadsheets/d/test',projectUrl:'https://script.google.com/home/projects/test/settings'}:{success:false,error:'비밀번호가 일치하지 않습니다.'}));},
          translateElementary(p){requests.push(p);if(mode==='pending'){pendingSuccess=success;return;}
            const binding={requestId:p.requestId,grade:p.grade,text:p.text};
            if(mode==='wrong-text')binding.text='닌텐도 게임';
            if(mode==='wrong-grade')binding.grade=6;
            if(mode==='wrong-id')binding.requestId='other-request-id';
            queueMicrotask(()=>success(mode==='error'?{success:false,error:'시험용 서버 오류'}:{success:true,recorded:true,request:binding,data:{translation:p.text==='hello'?'안녕하세요!':'Hello!',grade:p.grade,direction:p.text==='hello'?'en-to-ko':'ko-to-en',pronunciation:'/həˈloʊ/',tip:'안내',keyWords:[{word:'<img data-test-marker>',meaning:'단어'}]}}));}
        };return runner;
      }
    }}};
  }});
await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
const doc=dom.window.document,w=dom.window;
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
check('no external scripts or inline event handlers',()=>{assert.equal(doc.querySelectorAll('script[src]').length,0);assert.equal(doc.querySelectorAll('[onclick],[onload],[oninput],[onkeydown]').length,0);});
check('all startup modals natively hidden',()=>{for(const id of ['teacherPinModal','voiceModal','apiKeyModal'])assert.equal(doc.getElementById(id).hidden,true);assert.ok(doc.getElementById('app-css').textContent.includes('[hidden]'));});
doc.getElementById('gradeBtn-5').click();
check('grade button and dropdown stay synchronized',()=>assert.equal(doc.getElementById('gradeSelectDropdown').value,'5'));
await new Promise(resolve=>setTimeout(resolve,250));
check('selected grade survives initialization',()=>assert.equal(doc.getElementById('gradeSelectDropdown').value,'5'));
doc.getElementById('boardModeBtn').click();
check('board mode button works',()=>assert.ok(doc.body.classList.contains('board-mode-active')));
doc.getElementById('inputText').value='안녕';doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));doc.getElementById('translateBtn').click();await tick();
check('translation rendered and button restored',()=>{assert.equal(doc.getElementById('resultText').textContent,'Hello!');assert.equal(doc.getElementById('translateBtn').disabled,false);assert.equal(requests[0].grade,5);});
check('AI vocabulary always rendered as text',()=>{assert.equal(doc.querySelectorAll('[data-test-marker]').length,0);assert.ok(doc.getElementById('keyWordsList').textContent.includes('<img'));});
doc.getElementById('inputText').value='매콤한 김밥';doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));
check('editing input immediately hides the prior result, badges and recording state',()=>{assert.equal(doc.getElementById('resultSection').hidden,true);assert.equal(doc.getElementById('cacheBadge').hidden,true);assert.equal(doc.getElementById('recordingStatus').textContent,'');});
for(const mismatched of ['wrong-text','wrong-grade','wrong-id']){
  mode=mismatched;doc.getElementById('translateBtn').click();await tick();
  check('reject response with '+mismatched,()=>{assert.equal(doc.getElementById('resultSection').hidden,true);assert.ok(doc.getElementById('errorMessage').textContent.includes('일치'));});
}
mode='success';
const requestsBeforeIme=requests.length;
doc.getElementById('inputText').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true}));
check('IME composition Enter does not translate',()=>assert.equal(requests.length,requestsBeforeIme));
mode='pending';doc.getElementById('translateBtn').click();await tick();doc.getElementById('inputText').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
check('in-flight duplicate requests blocked',()=>assert.equal(requests.length,requestsBeforeIme+1));
doc.getElementById('clearBtn').click();pendingSuccess({success:true,data:{translation:'STALE',grade:5,direction:'ko-to-en',keyWords:[]}});await tick();
check('late response cannot overwrite cleared input',()=>{assert.equal(doc.getElementById('resultSection').hidden,true);assert.equal(doc.getElementById('translateBtn').disabled,false);});
mode='error';doc.getElementById('inputText').value='hello';doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));doc.getElementById('translateBtn').click();await tick();
check('server error visible and retry enabled',()=>{assert.equal(doc.getElementById('errorCard').hidden,false);assert.equal(doc.getElementById('translateBtn').disabled,false);});
doc.getElementById('settingsBtn').click();doc.getElementById('pinCodeInput').value='0106';doc.getElementById('teacherPinForm').dispatchEvent(new w.Event('submit',{cancelable:true,bubbles:true}));await tick();
check('fixed PIN opens safe teacher settings',()=>{assert.equal(doc.getElementById('apiKeyModal').hidden,false);assert.equal(doc.querySelectorAll('#apiKeyInput,#teacherPinInput').length,0);});
doc.querySelector('[data-action=closeApiKeyModal]').click();doc.getElementById('micBtn').click();
check('voice modal opens when recognition is unavailable',()=>{assert.equal(doc.getElementById('voiceModal').hidden,false);assert.ok(doc.getElementById('modalStatusMsg').textContent.includes('지원'));});
doc.querySelector('[data-action=closeVoiceModal]').click();
check('voice modal closes independently of speech support',()=>assert.equal(doc.getElementById('voiceModal').hidden,true));
mode='pending';doc.getElementById('translateBtn').click();await new Promise(resolve=>setTimeout(resolve,80));
check('RPC timeout restores the translate button',()=>{assert.equal(doc.getElementById('translateBtn').disabled,false);assert.ok(doc.getElementById('errorMessage').textContent.includes('오래'));});
pendingSuccess({success:true,data:{translation:'AFTER TIMEOUT',grade:5,direction:'ko-to-en',keyWords:[]}});await tick();
check('response after timeout is ignored',()=>assert.notEqual(doc.getElementById('resultText').textContent,'AFTER TIMEOUT'));
check('no uncaught DOM or JavaScript errors',()=>assert.deepEqual(errors,[]));
dom.window.close();
await fs.mkdir(path.join(root,'audit/2026-10-28-cache-fix'),{recursive:true});
await fs.writeFile(path.join(root,'audit/2026-10-28-cache-fix/test-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({passed:results.length}));

