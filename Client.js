(function () {
'use strict';
var state={grade:3,board:false,slow:false,result:null,token:'',bootstrap:null,busy:false,sequence:0,rec:null,listening:false,lang:'ko-KR',popup:null,channel:'',teacher:null,audio:null};
var QUICK_PHRASES={
3:['화장실 다녀와도 돼요?','선생님 도와주세요!','이거 뭐예요?','내 차례야!','만나서 반가워!','I like soccer.'],
4:['지금 몇 시예요?','제 공책이 어디에 있나요?','오늘 날씨가 정말 좋아요.','숙제 다 끝냈어요!','What are you doing?'],
5:['어제 숙제를 다 못했어요.','이번 주말에 할머니 댁에 갈 거예요.','제 차례가 언제인가요?','질문이 하나 있어요.','What did you do yesterday?'],
6:['제가 먼저 발표해도 될까요?','왜냐하면 머리가 아팠기 때문이에요.','우리 같이 점심 먹으러 갈래?','제 키가 더 커요.',"Why don't you join us?"]};
var $=function(id){return document.getElementById(id);};
function show(id,visible){var el=typeof id==='string'?$(id):id;if(!el)return;el.hidden=!visible;el.classList.toggle('hidden',!visible);}
function text(id,value){var el=$(id);if(el)el.textContent=value;}
function uid(){if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();return Date.now().toString(36)+'_'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
function rpc(name,payload,timeout){
  return new Promise(function(resolve,reject){
    var ended=false,timer=setTimeout(function(){if(ended)return;ended=true;reject(new Error('연결이 오래 걸리고 있어요. 잠시 후 다시 시도해주세요.'));},timeout||45000);
    function complete(fn,value){if(ended)return;ended=true;clearTimeout(timer);fn(value);}
    try{
      if(!window.google||!google.script||!google.script.run)throw new Error('GAS 앱 주소에서 다시 열어주세요.');
      var runner=google.script.run.withSuccessHandler(function(v){complete(resolve,v);}).withFailureHandler(function(){complete(reject,new Error('서버에 연결하지 못했습니다. 다시 시도해주세요.'));});
      if(name==='getAppBootstrap')runner.getAppBootstrap();
      else if(name==='translateElementary')runner.translateElementary(payload);
      else if(name==='getTeacherStatus')runner.getTeacherStatus(payload);
      else throw new Error('지원하지 않는 요청입니다.');
    }catch(e){complete(reject,e);}
  });
}
function ensureSession(){
  if(state.token)return Promise.resolve(state.token);
  if(!state.bootstrap)state.bootstrap=rpc('getAppBootstrap',null,20000).then(function(v){
    if(!v||!v.success)throw new Error(v&&v.error||'서버에 연결하지 못했습니다.');
    state.token=v.token;text('connectionStatus','GAS 연결됨 · v'+v.version);return state.token;
  }).catch(function(e){text('connectionStatus','연결 재시도 가능');throw e;}).finally(function(){state.bootstrap=null;});
  return state.bootstrap;
}
function showError(message){text('errorMessage',message);show('errorCard',true);}
function hideError(){show('errorCard',false);}
function setLoading(loading){state.busy=loading;$('translateBtn').disabled=loading;show('btnSpinner',loading);show('btnIcon',!loading);text('btnText',loading?'번역 중...':'번역하기');}
function selectGrade(grade){
  grade=Number(grade);if([3,4,5,6].indexOf(grade)<0)return;
  state.grade=grade;state.sequence++;if(state.busy)setLoading(false);
  $('gradeSelectDropdown').value=String(grade);
  for(var g=3;g<=6;g++){
    var el=$('gradeBtn-'+g);if(!el)continue;
    el.className='grade-pill flex flex-col items-center justify-center py-2 px-1 rounded-xl border-2 transition-all duration-150 btn-bounce font-bold '+(g===grade?'border-brand-600 bg-brand-50 text-brand-700 shadow-sm':'border-slate-200 bg-white text-slate-700 hover:bg-slate-50');
    el.setAttribute('aria-pressed',String(g===grade));
  }
  var container=$('quickPhrasesContainer');container.replaceChildren();
  QUICK_PHRASES[grade].forEach(function(phrase){
    var chip=document.createElement('button');chip.type='button';chip.textContent=phrase;
    chip.className='px-2 py-1 rounded-lg bg-slate-50 hover:bg-indigo-50 text-slate-600 hover:text-brand-700 text-[11px] border border-slate-200 btn-bounce';
    chip.addEventListener('click',function(){$('inputText').value=phrase;handleInputTextChange();requestTranslation();});container.appendChild(chip);
  });
  if(state.result&&state.result.grade!==grade)invalidateResult();
}
function invalidateResult(){state.result=null;show('resultSection',false);show('idlePlaceholder',true);show('cacheBadge',false);text('recordingStatus','');stopAudio();}
function validateInputLanguage(value){
  var rest=value.replace(/\p{Script=Latin}\p{M}*/gu,'');
  return /[\p{Script=Latin}\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3]/u.test(value)&&
    !/[^\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A30-9\s.,?!'"“”‘’():;\-–—…/%&+*=~@#$\[\]{}]/.test(rest);
}
function handleInputTextChange(){
  var input=$('inputText'),value=input.value.trim();state.sequence++;if(state.busy)setLoading(false);
  invalidateResult();
  show('clearBtn',!!value);$('clearBtn').classList.toggle('inline-flex',!!value);
  var ko=/[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(value),en=/\p{Script=Latin}/u.test(value);
  text('langIndicatorText',!value?'한글 또는 영어를 입력해주세요':ko&&en?'🔄 한·영 혼합 스마트 완성 모드':ko?'🇰🇷 한글 → 🇺🇸 영어 번역 모드':en?'🇺🇸 영어 → 🇰🇷 한글 번역 모드':'한글 또는 영어로 입력해주세요');
  text('characterCount',input.value.length+' / 500');
}
function clearInput(){
  state.sequence++;$('inputText').value='';handleInputTextChange();hideError();show('resultSection',false);show('idlePlaceholder',true);state.result=null;stopAudio();$('inputText').focus();
}
function blockPastedInput(input,onBlocked){
  function block(e){
    e.preventDefault();
    onBlocked('붙여넣기는 사용할 수 없어요. 직접 입력하거나 마이크로 말해주세요.');
  }
  input.addEventListener('paste',block);
  input.addEventListener('drop',block);
  input.addEventListener('beforeinput',function(e){
    if(/^insertFrom(?:Paste|Drop|Yank)/.test(e.inputType||''))block(e);
  });
}
function handleKeyDown(e){if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();requestTranslation();}}
async function requestTranslation(){
  if(state.busy)return;
  var value=$('inputText').value.normalize('NFC').trim();if(!value){showError('번역할 내용을 입력하거나 마이크로 말씀해주세요! 😊');return;}
  if(value.length>500){showError('500자 이내로 입력해주세요.');return;}
  if(!validateInputLanguage(value)){showError('한글·영어 또는 로마자로 쓴 이름·표현을 입력해주세요.');return;}
  hideError();invalidateResult();setLoading(true);var sequence=++state.sequence,grade=state.grade,requestId=uid();
  try{
    var token=await ensureSession();if(sequence!==state.sequence)return;
    var response=await rpc('translateElementary',{protocolVersion:3,token:token,requestId:requestId,text:value,grade:grade},55000);
    if(sequence!==state.sequence)return;
    if(!response||!response.success){if(response&&/인증|새로고침/.test(response.error))state.token='';throw new Error(response&&response.error||'번역 결과를 받지 못했습니다.');}
    if(!response.request||response.request.requestId!==requestId||response.request.grade!==grade||response.request.text!==value||
      !response.data||response.data.grade!==grade||state.grade!==grade||$('inputText').value.normalize('NFC').trim()!==value){
      invalidateResult();throw new Error('입력과 일치하지 않는 응답을 차단했습니다. 다시 번역해주세요.');
    }
    renderResult(response.data);text('recordingStatus',response.recorded?'검색 기록 저장됨':'번역 완료 · 검색 기록 저장 지연');
  }catch(e){if(sequence===state.sequence)showError(e.message||'다시 시도해주세요.');}
  finally{if(sequence===state.sequence)setLoading(false);}
}
function renderResult(data){
  if(!data||typeof data.translation!=='string'||!Array.isArray(data.keyWords))throw new Error('번역 결과를 읽지 못했습니다.');
  state.result=data;show('idlePlaceholder',false);show('resultSection',true);
  text('resultGradeBadge',data.resultType==='transliteration'?'한국어 표기':data.grade+'학년 '+(data.direction==='mixed-to-en'?'스마트 완성 ✨':'맞춤 표현 ✨'));
  text('resultText',data.translation);text('ipaSymbolText',data.pronunciation||'');
  show('pronunciationGuide',!!data.pronunciation&&data.direction!=='en-to-ko');show('cacheBadge',false);
  text('tipText',data.tip||'');show('tipBox',!!data.tip);
  var list=$('keyWordsList');list.replaceChildren();
  data.keyWords.slice(0,4).forEach(function(item){
    var chip=document.createElement('span'),word=document.createElement('span'),meaning=document.createElement('span');
    chip.className='px-3 py-1 rounded-xl bg-slate-100 text-slate-800 text-xs font-bold border border-slate-200/80';
    word.className='text-brand-600 font-en font-extrabold';word.textContent=String(item.word||'');
    meaning.className='text-slate-500 font-normal';meaning.textContent=' ('+String(item.meaning||'')+')';
    chip.append(word,meaning);list.appendChild(chip);
  });
  show('keyWordsContainer',data.keyWords.length>0);$('resultScrollBody').scrollTop=0;
  if(window.innerWidth<768)$('resultSection').scrollIntoView({behavior:'smooth',block:'start'});
}
function toggleBoardMode(){state.board=!state.board;document.body.classList.toggle('board-mode-active',state.board);text('boardModeText',state.board?'칠판 모드 ON':'칠판 모드');$('boardModeBtn').setAttribute('aria-pressed',String(state.board));}
function stopAudio(){if(state.audio){state.audio.pause();state.audio=null;}try{if(window.speechSynthesis)speechSynthesis.cancel();}catch(ignore){}}
function speakWithSpeechSynthesis(){
  if(!state.result||!window.speechSynthesis){showError('이 브라우저에서 발음을 재생할 수 없습니다.');return;}
  try{
    speechSynthesis.cancel();var utterance=new SpeechSynthesisUtterance(state.result.translation),english=state.result.direction!=='en-to-ko';
    utterance.lang=english?'en-US':'ko-KR';utterance.rate=state.slow?0.65:0.9;
    var voices=speechSynthesis.getVoices(),voice=voices.find(function(v){return v.lang.indexOf(english?'en':'ko')===0&&/Google|Natural|Jenny|Aria|SunHi/.test(v.name);});
    if(voice)utterance.voice=voice;speechSynthesis.speak(utterance);
  }catch(e){showError('발음을 재생하지 못했습니다. 한 번 더 눌러주세요.');}
}
function speakResult(){
  if(!state.result)return;stopAudio();
  try{
    var english=state.result.direction!=='en-to-ko',audio=new Audio('https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl='+(english?'en':'ko')+'&q='+encodeURIComponent(state.result.translation));
    state.audio=audio;audio.playbackRate=state.slow?0.7:1;audio.onerror=speakWithSpeechSynthesis;
    var promise=audio.play();if(promise&&promise.catch)promise.catch(speakWithSpeechSynthesis);
  }catch(e){speakWithSpeechSynthesis();}
}
function toggleTtsSpeed(){state.slow=!state.slow;text('ttsSpeedBtn',state.slow?'🐢 천천히':'⚡ 보통');if(state.result)speakResult();}
async function copyResult(){
  if(!state.result)return;
  try{
    if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error('fallback');
    await navigator.clipboard.writeText(state.result.translation);
  }catch(e){
    var area=document.createElement('textarea');area.value=state.result.translation;area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();
    var copied=false;try{copied=document.execCommand('copy');}catch(ignore){}area.remove();
    if(!copied){showError('번역 문장을 길게 눌러 복사해주세요.');return;}
  }
  text('copyText','완료!');text('copyIcon','✅');setTimeout(function(){text('copyText','복사');text('copyIcon','📋');},1600);
}
function requestTeacherSettings(){hideError();$('pinCodeInput').value='';show('teacherPinModal',true);$('pinCodeInput').focus();}
function closePinModal(){show('teacherPinModal',false);}
async function submitTeacherPin(){
  if($('pinSubmitBtn').disabled)return;
  $('pinSubmitBtn').disabled=true;
  try{
    var token=await ensureSession(),result=await rpc('getTeacherStatus',{token:token,pin:$('pinCodeInput').value.trim()},20000);
    if(!result||!result.success)throw new Error(result&&result.error||'인증하지 못했습니다.');
    state.teacher=result;closePinModal();show('apiKeyModal',true);
    text('teacherKeyStatus',result.keyConfigured?'서버 API 키가 설정되어 있습니다.':'서버 API 키 설정이 필요합니다.');
    text('teacherUsage','오늘 AI 번역 '+result.dailyUsed+' / '+result.dailyLimit+'회 · '+result.model+' · v'+result.version);
    $('serverSettingsLink').href=result.projectUrl;$('historySheetLink').href=result.sheetUrl;
  }catch(e){showError(e.message);$('pinCodeInput').value='';$('pinCodeInput').focus();}
  finally{$('pinSubmitBtn').disabled=false;}
}
function closeApiKeyModal(){show('apiKeyModal',false);state.teacher=null;}
function setSpeechLanguage(lang){state.lang=lang==='en-US'?'en-US':'ko-KR';text('speechLanguageStatus',state.lang==='en-US'?'영어':'한국어');['speechLangKo','modalLangKo'].forEach(function(id){$(id).setAttribute('aria-pressed',String(state.lang==='ko-KR'));});['speechLangEn','modalLangEn'].forEach(function(id){$(id).setAttribute('aria-pressed',String(state.lang==='en-US'));});}
function setModalSpeechLang(lang){stopModalListening();setSpeechLanguage(lang);startModalListening();}
function parseSpeechResults(results){
  var parts=[];
  for(var i=0;i<results.length;i++){var value=results[i][0].transcript.trim();if(!value)continue;
    if(parts.length&&value.startsWith(parts[parts.length-1]))parts[parts.length-1]=value;else if(!parts.length||parts[parts.length-1]!==value)parts.push(value);}
  return parts.join(' ');
}
function toggleSpeechRecognition(){hideError();show('voiceModal',true);$('modalVoiceInput').value=$('inputText').value;startModalListening();}
function closeVoiceModal(){stopModalListening();show('voiceModal',false);}
function startModalListening(){
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){text('modalStatusMsg','음성 인식을 지원하지 않아요. 아래에 직접 입력하거나 독립 음성창을 사용해주세요.');return;}
  stopModalListening();
  try{
    var rec=new SR();state.rec=rec;rec.lang=state.lang;rec.continuous=!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);rec.interimResults=true;
    rec.onstart=function(){state.listening=true;show('modalPulseRing',true);text('modalStatusMsg','🎙️ 듣고 있어요! 편하게 말씀하세요.');};
    rec.onresult=function(e){$('modalVoiceInput').value=parseSpeechResults(e.results);};
    rec.onerror=function(e){text('modalStatusMsg',e.error==='not-allowed'||e.error==='service-not-allowed'?'마이크 권한이 필요해요. 독립 음성창을 열거나 직접 입력해주세요.':'음성 연결을 확인하고 다시 말해주세요.');};
    rec.onend=function(){state.listening=false;show('modalPulseRing',false);if($('modalVoiceInput').value.trim())text('modalStatusMsg','✅ 내용을 확인·수정한 뒤 완료 및 번역을 눌러주세요.');};
    rec.start();
  }catch(e){text('modalStatusMsg','독립 음성창을 열거나 아래에 직접 입력해주세요.');}
}
function stopModalListening(){if(state.rec){var old=state.rec;state.rec=null;old.onend=null;old.onerror=null;old.onresult=null;try{old.abort();}catch(ignore){}}state.listening=false;show('modalPulseRing',false);}
function toggleModalListening(){if(state.listening)stopModalListening();else startModalListening();}
function restartModalListening(){$('modalVoiceInput').value='';startModalListening();}
function clearModalVoiceInput(){$('modalVoiceInput').value='';$('modalVoiceInput').focus();}
function submitModalVoiceResult(){var value=$('modalVoiceInput').value.trim();if(!value){text('modalStatusMsg','말하거나 글자를 입력해주세요.');return;}closeVoiceModal();$('inputText').value=value.slice(0,500);handleInputTextChange();requestTranslation();}
function voicePopupApp(config,blockPastedInput){
  var doc=document,rec=null,listening=false,lang=config.lang;
  function status(value){doc.getElementById('status').textContent=value;}
  blockPastedInput(doc.getElementById('voiceText'),status);
  function stop(){if(rec){try{rec.abort();}catch(ignore){}}listening=false;}
  function start(){
    var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SR){status('음성 인식을 지원하지 않습니다. 아래에 직접 입력해주세요.');return;}
    stop();rec=new SR();rec.lang=lang;rec.continuous=!/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);rec.interimResults=true;
    rec.onstart=function(){listening=true;status('🎙️ 듣고 있어요!');};
    rec.onresult=function(e){var parts=[];for(var i=0;i<e.results.length;i++){var t=e.results[i][0].transcript.trim();if(parts.length&&t.startsWith(parts[parts.length-1]))parts[parts.length-1]=t;else if(t&&parts[parts.length-1]!==t)parts.push(t);}doc.getElementById('voiceText').value=parts.join(' ');};
    rec.onerror=function(e){status(e.error==='not-allowed'?'주소창의 마이크 권한을 확인하거나 아래에 직접 입력해주세요.':'음성 인식을 다시 시도해주세요.');};
    rec.onend=function(){listening=false;if(doc.getElementById('voiceText').value.trim())status('✅ 확인·수정하고 완료를 눌러주세요.');};
    try{rec.start();}catch(e){status('마이크를 다시 눌러주세요.');}
  }
  doc.getElementById('mic').onclick=function(){if(listening)stop();else start();};
  doc.getElementById('ko').onclick=function(){lang='ko-KR';start();};doc.getElementById('en').onclick=function(){lang='en-US';start();};
  doc.getElementById('restart').onclick=function(){doc.getElementById('voiceText').value='';start();};
  doc.getElementById('clear').onclick=function(){doc.getElementById('voiceText').value='';};
  doc.getElementById('cancel').onclick=function(){stop();window.close();};
  doc.getElementById('done').onclick=function(){var value=doc.getElementById('voiceText').value.trim();if(!value){status('말하거나 글자를 입력해주세요.');return;}stop();if(window.opener)window.opener.postMessage({type:'IN_ENGLISH_VOICE_RESULT',channel:config.channel,text:value},config.origin);window.close();};
  window.addEventListener('beforeunload',stop);start();
}
function openVoicePopup(){
  stopModalListening();state.channel=uid();var popup=window.open('','inEnglishVoice','width=480,height=570,resizable=yes,scrollbars=yes');
  if(!popup){text('modalStatusMsg','팝업이 차단되었습니다. 팝업을 허용하거나 직접 입력해주세요.');return;}state.popup=popup;
  var markup='<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>inEnglish 음성 입력</title><style>body{margin:0;padding:24px;font:15px system-ui,sans-serif;background:#f8fafc;color:#1e293b}h1{font-size:20px}button{border:0;border-radius:12px;padding:12px;margin:3px;background:#e0e7ff;color:#3730a3;font-weight:bold;cursor:pointer}textarea{box-sizing:border-box;width:100%;height:145px;margin:15px 0;padding:14px;border:2px solid #c7d2fe;border-radius:16px;font:18px system-ui,sans-serif}#mic{font-size:30px;background:#ffe4e6}#done{background:#4f46e5;color:white}#status{min-height:42px;line-height:1.5}</style></head><body><h1>🎙️ inEnglish 음성 입력</h1><div><button id="ko">한국어</button><button id="en">영어</button></div><p id="status">마이크에 연결하고 있어요.</p><button id="mic">🎙️</button><textarea id="voiceText" maxlength="500" placeholder="인식된 내용을 직접 고칠 수 있어요."></textarea><div><button id="clear">지우기</button><button id="restart">다시 말하기</button></div><p><button id="cancel">취소</button><button id="done">완료 및 번역</button></p></body></html>';
  popup.document.open();popup.document.write(markup);popup.document.close();
  var script=popup.document.createElement('script');script.textContent='('+voicePopupApp.toString()+')('+JSON.stringify({lang:state.lang,origin:window.location.origin,channel:state.channel})+','+blockPastedInput.toString()+');';popup.document.body.appendChild(script);
}
var actions={selectGrade:selectGrade,toggleBoardMode:toggleBoardMode,requestTeacherSettings:requestTeacherSettings,closePinModal:closePinModal,submitTeacherPin:submitTeacherPin,
  requestTranslation:requestTranslation,clearInput:clearInput,toggleSpeechRecognition:toggleSpeechRecognition,setSpeechLanguage:setSpeechLanguage,
  speakResult:speakResult,toggleTtsSpeed:toggleTtsSpeed,copyResult:copyResult,closeApiKeyModal:closeApiKeyModal,closeVoiceModal:closeVoiceModal,
  setModalSpeechLang:setModalSpeechLang,toggleModalListening:toggleModalListening,restartModalListening:restartModalListening,clearModalVoiceInput:clearModalVoiceInput,
  submitModalVoiceResult:submitModalVoiceResult,openVoicePopup:openVoicePopup};
function init(){
  if(document.body.dataset.initialized)return;document.body.dataset.initialized='true';
  try{localStorage.removeItem('IN_ENGLISH_API_KEY');localStorage.removeItem('IN_ENGLISH_TEACHER_PIN');}catch(ignore){}
  document.addEventListener('click',function(e){var button=e.target.closest('[data-action]');if(!button||button.disabled)return;var fn=actions[button.dataset.action];if(fn){e.preventDefault();fn(button.dataset.grade||button.dataset.lang);}});
  blockPastedInput($('inputText'),showError);
  blockPastedInput($('modalVoiceInput'),function(message){text('modalStatusMsg',message);});
  $('inputText').addEventListener('input',handleInputTextChange);$('inputText').addEventListener('keydown',handleKeyDown);
  $('gradeSelectDropdown').addEventListener('change',function(e){selectGrade(e.target.value);});
  $('teacherPinForm').addEventListener('submit',function(e){e.preventDefault();submitTeacherPin();});
  $('pinCodeInput').addEventListener('keydown',function(e){if(e.isComposing&&e.key==='Enter')e.preventDefault();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){closePinModal();closeApiKeyModal();closeVoiceModal();}});
  window.addEventListener('message',function(e){
    if(e.source!==state.popup||e.origin!==window.location.origin||!e.data||e.data.type!=='IN_ENGLISH_VOICE_RESULT'||e.data.channel!==state.channel||typeof e.data.text!=='string')return;
    closeVoiceModal();$('inputText').value=e.data.text.slice(0,500);handleInputTextChange();requestTranslation();state.popup=null;state.channel='';
  });
  selectGrade(3);setSpeechLanguage('ko-KR');handleInputTextChange();
  ensureSession().catch(function(e){showError(e.message);});
}
window.addEventListener('error',function(){showError('화면 처리 중 문제가 생겼습니다. 새로고침 후 다시 시도해주세요.');setLoading(false);});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
