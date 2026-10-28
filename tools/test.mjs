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
const generateWithModel=server.generateTranslation_;
server.generateTranslation_=(_,grade,value)=>{calls++;return{translation:'Hello!',grade,resultType:'translation',direction:'ko-to-en',tip:'인사해요.',pronunciation:'/həˈloʊ/',keyWords:[{word:'hello',meaning:'안녕'}],usedModel:'test-model'};};
const translate=p=>server.translateElementary({protocolVersion:3,...p});
function check(name,fn){fn();results.push({name,passed:true});}
const bootstrap=server.getAppBootstrap();
check('old clients including the paste-enabled protocol must reload',()=>{
  for(const protocolVersion of [undefined,2])assert.equal(server.translateElementary({protocolVersion,token:bootstrap.token,text:'hello',grade:3,requestId:crypto.randomUUID()}).success,false);
});
check('signed bootstrap session',()=>{assert.equal(bootstrap.success,true);assert.ok(bootstrap.token);assert.ok(!JSON.stringify(bootstrap).includes('synthetic-test-key'));});
check('invalid or tampered session blocked',()=>{assert.equal(translate({token:bootstrap.token+'x',text:'hello',grade:3,requestId:crypto.randomUUID()}).success,false);});
check('Korean and Latin spellings accepted without allowing unrelated scripts',()=>{
  for(const s of ['한글 and English?','hotate maki','Shinjuku','Bottega Veneta','Hermès','São Paulo','cafe\u0301'])assert.equal(server.validateLanguage_(s),true,s);
  for(const s of ['สวัสดี','नमस्ते','γειά','こんにちは','hello こんにちは','\u0301hello','123!?'])assert.equal(server.validateLanguage_(s),false,s);
});
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
check('HTML or malformed model output blocked',()=>{assert.throws(()=>server.normalizeResult_({direction:'ko-to-en',resultType:'translation',translation:'<img src=x>',keyWords:[]},3,'test'));assert.throws(()=>server.normalizeResult_({direction:'bad',translation:'hi',keyWords:[]},3,'test'));});
const transliterationNote='뜻을 번역한 것이 아니라 소리를 한글로 옮긴 한국어 표기예요. 원어·지역에 따라 읽는 법이 다를 수 있어요.';
const transliterationSample={direction:'en-to-ko',resultType:'transliteration',translation:'호타테 마키',pronunciation:'/incorrect/',tip:'지어낸 재료 설명',keyWords:[{word:'hotate',meaning:'확인되지 않은 뜻'}]};
check('transliteration returns Korean spelling with a fixed non-translation notice',()=>{
  const r=server.normalizeResult_(transliterationSample,5,'test');
  assert.equal(r.translation,'호타테 마키');assert.equal(r.resultType,'transliteration');assert.equal(r.curriculumLevel,'한국어 표기');
  assert.equal(r.direction,'en-to-ko');assert.equal(r.tip,transliterationNote);assert.equal(r.pronunciation,'');assert.equal(r.keyWords.length,0);
});
check('nonfood transliterations use the same normalization',()=>{
  for(const name of ['신주쿠','보테가 베네타','루트비히 판 베토벤'])assert.equal(server.normalizeResult_({...transliterationSample,translation:name},6,'test').translation,name);
});
check('malformed transliteration cannot become English or injected markup',()=>{
  for(const changed of [{translation:'<img src=x>'},{translation:'hotate maki'},{translation:'호타테 maki'},{direction:'ko-to-en'},{resultType:'unknown'}])assert.throws(()=>server.normalizeResult_({...transliterationSample,...changed},5,'test'));
});
check('ordinary meaning translations retain tips, vocabulary and English IPA',()=>{
  const r=server.normalizeResult_({direction:'ko-to-en',resultType:'translation',translation:'Spicy gimbap',pronunciation:'/test/',tip:'매운 김밥이에요.',keyWords:[{word:'spicy',meaning:'매운'}]},5,'test');
  assert.equal(r.resultType,'translation');assert.equal(r.pronunciation,'/test/');assert.equal(r.tip,'매운 김밥이에요.');assert.equal(r.keyWords[0].meaning,'매운');
  assert.equal(server.normalizeResult_({direction:'en-to-ko',resultType:'translation',translation:'나는 축구를 좋아해요.',keyWords:[]},3,'test').translation,'나는 축구를 좋아해요.');
});
check('Gemini schema and full prompt agree on general transliteration support',()=>{
  let captured;
  server.UrlFetchApp={fetch:(url,options)=>{captured=JSON.parse(options.payload);return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(transliterationSample)}]}}]})};}};
  const r=generateWithModel('synthetic-test-key',5,'hotate maki');
  assert.equal(r.resultType,'transliteration');assert.ok(captured.generationConfig.responseSchema.required.includes('resultType'));
  assert.ok(captured.systemInstruction.parts[0].text.includes('사람·장소·상품·작품'));
  assert.ok(!captured.systemInstruction.parts[0].text.includes('제3외국어는 거부'));
});
check('history identifies Korean spelling separately from meaning translation',()=>{
  const r=server.normalizeResult_(transliterationSample,5,'test');
  assert.equal(server.logTranslation_(5,'hotate maki',r,crypto.randomUUID()),true);assert.equal(rows.at(-1)[4],'한국어 표기');
});
const session=server.getAppBootstrap();let limited=false;
for(let i=0;i<16;i++){const r=translate({token:session.token,text:'같은 표현',grade:4,requestId:crypto.randomUUID()});if(!r.success&&r.error.includes('빠르게'))limited=true;}
check('per-session rate limit enforced',()=>assert.equal(limited,true));
const errors=[],requests=[],audioUrls=[],copiedTexts=[],popupWindows=[];let popupRecognition=null;let mode='success',pendingSuccess=null;const virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(html,{url:'https://test.googleusercontent.com/userCodeAppPanel',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
  beforeParse(window){
    const realTimer=window.setTimeout.bind(window);
    window.setTimeout=(fn,ms,...args)=>realTimer(fn,ms===55000?50:ms,...args);
    window.HTMLElement.prototype.scrollIntoView=function(){};
    window.Audio=function(url){audioUrls.push(url);this.pause=function(){};this.play=function(){return Promise.resolve();};};
    window.speechSynthesis={cancel(){},getVoices:()=>[],speak(){}};
    window.SpeechSynthesisUtterance=function(t){this.text=t;};
    window.document.execCommand=()=>true;
    window.open=()=>{
      const child=new JSDOM('',{url:'https://test.googleusercontent.com/voice-popup',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole,
        beforeParse(popup){
          Object.defineProperty(popup,'opener',{value:window});
          popup.SpeechRecognition=function(){popupRecognition=this;this.start=()=>this.onstart&&this.onstart();this.abort=()=>{};};
        }});
      popupWindows.push(child);return child.window;
    };
    Object.defineProperty(window.navigator,'clipboard',{value:{writeText:async value=>copiedTexts.push(value)}});
    window.google={script:{run:{
      withSuccessHandler(success){
        const runner={withFailureHandler(failure){runner.failure=failure;return runner;},
          getAppBootstrap(){queueMicrotask(()=>success({success:true,version:'test',token:'test-token'}));},
          getTeacherStatus(p){queueMicrotask(()=>success(p.pin==='0106'?{success:true,keyConfigured:true,dailyUsed:0,dailyLimit:2500,model:'test',version:'test',sheetUrl:'https://docs.google.com/spreadsheets/d/test',projectUrl:'https://script.google.com/home/projects/test/settings'}:{success:false,error:'비밀번호가 일치하지 않습니다.'}));},
          translateElementary(p){requests.push(p);if(mode==='pending'){pendingSuccess=success;return;}
            const binding={requestId:p.requestId,grade:p.grade,text:p.text};
            const transliterated=mode==='transliteration',spelling=p.text==='hotate maki'?'호타테 마키':p.text==='Shinjuku'?'신주쿠':'에르메스';
            if(mode==='wrong-text')binding.text='닌텐도 게임';
            if(mode==='wrong-grade')binding.grade=6;
            if(mode==='wrong-id')binding.requestId='other-request-id';
            queueMicrotask(()=>success(mode==='error'?{success:false,error:'시험용 서버 오류'}:{success:true,recorded:true,request:binding,data:{resultType:transliterated?'transliteration':'translation',translation:transliterated?spelling:p.text==='hello'?'안녕하세요!':'Hello!',grade:p.grade,direction:transliterated||p.text==='hello'?'en-to-ko':'ko-to-en',pronunciation:transliterated?'':'/həˈloʊ/',tip:transliterated?transliterationNote:'안내',keyWords:transliterated?[]:[{word:'<img data-test-marker>',meaning:'단어'}]}}));}
        };return runner;
      }
    }}};
  }});
await new Promise(resolve=>dom.window.addEventListener('load',resolve,{once:true}));
const doc=dom.window.document,w=dom.window;
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
check('no external scripts or inline event handlers',()=>{assert.equal(doc.querySelectorAll('script[src]').length,0);assert.equal(doc.querySelectorAll('[onclick],[onload],[oninput],[onkeydown]').length,0);});
check('all startup modals natively hidden',()=>{for(const id of ['teacherPinModal','voiceModal','apiKeyModal'])assert.equal(doc.getElementById(id).hidden,true);assert.ok(doc.getElementById('app-css').textContent.includes('[hidden]'));});
function tryPastedInsertion(win,input,type){
  const before=input.value;
  const e=type.startsWith('insertFrom')?new win.InputEvent('beforeinput',{inputType:type,data:'다른 곳에서 가져온 긴 글',bubbles:true,cancelable:true}):new win.Event(type,{bubbles:true,cancelable:true});
  input.dispatchEvent(e);
  if(!e.defaultPrevented)input.value+='다른 곳에서 가져온 긴 글';
  assert.equal(e.defaultPrevented,true,type);assert.equal(input.value,before,type);
}
const pastedInputTypes=['paste','drop','insertFromPaste','insertFromPasteAsQuotation','insertFromDrop','insertFromYank'];
for(const [inputId,messageId] of [['inputText','errorMessage'],['modalVoiceInput','modalStatusMsg']]){
  check('clipboard and drop insertion blocked without an API call in '+inputId,()=>{
    const input=doc.getElementById(inputId),before=requests.length;input.value='직접 쓴 글';
    for(const type of pastedInputTypes)tryPastedInsertion(w,input,type);
    assert.ok(doc.getElementById(messageId).textContent.includes('붙여넣기'));assert.equal(requests.length,before);
  });
}
check('typing, Korean IME and editing remain allowed in student inputs',()=>{
  for(const id of ['inputText','modalVoiceInput'])for(const inputType of ['insertText','insertCompositionText','deleteContentBackward']){
    const e=new w.InputEvent('beforeinput',{inputType,data:'한',bubbles:true,cancelable:true});doc.getElementById(id).dispatchEvent(e);assert.equal(e.defaultPrevented,false,inputType);
  }
});
check('teacher PIN clipboard behavior is unaffected',()=>{
  const e=new w.Event('paste',{bubbles:true,cancelable:true});doc.getElementById('pinCodeInput').dispatchEvent(e);assert.equal(e.defaultPrevented,false);
});
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
mode='transliteration';
for(const [value,expected] of [['hotate maki','호타테 마키'],['Shinjuku','신주쿠'],['Hermès','에르메스']]){
  const before=requests.length;
  doc.getElementById('inputText').value=value;doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));doc.getElementById('translateBtn').click();await tick();
  check('Korean spelling result labeled for '+value,()=>{
    assert.equal(requests.length,before+1);assert.equal(doc.getElementById('resultText').textContent,expected);assert.equal(doc.getElementById('resultGradeBadge').textContent,'한국어 표기');
    assert.equal(doc.getElementById('tipText').textContent,transliterationNote);assert.equal(doc.getElementById('pronunciationGuide').hidden,true);assert.equal(doc.getElementById('keyWordsContainer').hidden,true);
  });
}
doc.querySelector('[data-action=speakResult]').click();doc.querySelector('[data-action=copyResult]').click();await tick();
check('Korean spelling audio and copying use the Korean answer',()=>{
  assert.equal(new URL(audioUrls.at(-1)).searchParams.get('tl'),'ko');assert.equal(new URL(audioUrls.at(-1)).searchParams.get('q'),'에르메스');assert.equal(copiedTexts.at(-1),'에르메스');
});
const beforeUnsupported=requests.length;
doc.getElementById('inputText').value='こんにちは';doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));doc.getElementById('translateBtn').click();await tick();
check('client still rejects non-Latin third-language scripts before sending',()=>assert.equal(requests.length,beforeUnsupported));
mode='success';doc.getElementById('inputText').value='안녕';doc.getElementById('inputText').dispatchEvent(new w.Event('input',{bubbles:true}));doc.getElementById('translateBtn').click();await tick();
check('ordinary English translation restores grade badge, IPA and vocabulary',()=>{
  assert.equal(doc.getElementById('resultText').textContent,'Hello!');assert.equal(doc.getElementById('resultGradeBadge').textContent,'5학년 맞춤 표현 ✨');assert.equal(doc.getElementById('pronunciationGuide').hidden,false);assert.equal(doc.getElementById('keyWordsContainer').hidden,false);
});
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
doc.querySelector('[data-action=openVoicePopup]').click();
const popupDom=popupWindows.at(-1),popup=popupDom.window,popupDoc=popup.document;
check('standalone voice popup also blocks paste and drop',()=>{
  const input=popupDoc.getElementById('voiceText');input.value='직접 입력';
  for(const type of pastedInputTypes)tryPastedInsertion(popup,input,type);
  assert.ok(popupDoc.getElementById('status').textContent.includes('붙여넣기'));
});
check('speech recognition still writes into the standalone voice input',()=>{
  popupRecognition.onresult({results:[[{transcript:'hello'}]]});assert.equal(popupDoc.getElementById('voiceText').value,'hello');
});
popupDom.window.close();
doc.querySelector('[data-action=closeVoiceModal]').click();
check('voice modal closes independently of speech support',()=>assert.equal(doc.getElementById('voiceModal').hidden,true));
mode='pending';doc.getElementById('translateBtn').click();await new Promise(resolve=>setTimeout(resolve,80));
check('RPC timeout restores the translate button',()=>{assert.equal(doc.getElementById('translateBtn').disabled,false);assert.ok(doc.getElementById('errorMessage').textContent.includes('오래'));});
pendingSuccess({success:true,data:{translation:'AFTER TIMEOUT',grade:5,direction:'ko-to-en',keyWords:[]}});await tick();
check('response after timeout is ignored',()=>assert.notEqual(doc.getElementById('resultText').textContent,'AFTER TIMEOUT'));
check('no uncaught DOM or JavaScript errors',()=>assert.deepEqual(errors,[]));
dom.window.close();
await fs.mkdir(path.join(root,'audit/2026-10-28-block-paste'),{recursive:true});
await fs.writeFile(path.join(root,'audit/2026-10-28-block-paste/test-results.json'),JSON.stringify(results,null,2));
console.log(JSON.stringify({passed:results.length}));

