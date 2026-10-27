/**
 * @fileoverview Code.gs
 * Google Apps Script 백엔드 컨트롤러
 * 
 * - Web App 서빙 (doGet)
 * - 2022 개정 교육과정 기반 초등 영어 번역 RPC (translateElementary)
 * - CacheService 기반 고속 응답 캐싱
 * - Gemini Flash API 연동 및 유효성 검증
 */

/**
 * 웹 앱 진입점
 */
function doGet(e) {
  // 진단 및 모델 목록 확인용 디버그 엔드포인트
  if (e && e.parameter && e.parameter.debug === '1') {
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    var res = {
      hasKey: !!apiKey,
      keyPrefix: apiKey ? apiKey.substring(0, 7) + '...' : 'none',
      keyLength: apiKey ? apiKey.length : 0
    };
    if (apiKey) {
      try {
        var listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey.trim());
        var resp = UrlFetchApp.fetch(listUrl, { muteHttpExceptions: true });
        res.listCode = resp.getResponseCode();
        var data = JSON.parse(resp.getContentText());
        if (data.models) {
          res.availableModels = data.models
            .filter(function(m) { return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1; })
            .map(function(m) { return m.name.replace('models/', ''); });
        } else {
          res.rawResponse = data;
        }
      } catch(err) {
        res.listError = err.toString();
      }
    }
    return ContentService.createTextOutput(JSON.stringify(res, null, 2)).setMimeType(ContentService.MimeType.JSON);
  }

  // GitHub Pages 등 외부 프론트엔드에서 구글 시트 URL 요청 시
  if (e && e.parameter && e.parameter.action === 'getSheetUrl') {
    var sheetRes = getHistorySheetUrl();
    return ContentService.createTextOutput(JSON.stringify(sheetRes))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // GitHub Pages 등 외부 프론트엔드에서 구글 시트 원클릭 열기 요청 시 (새 탭 리다이렉트)
  if (e && e.parameter && e.parameter.action === 'openSheet') {
    var sRes = getHistorySheetUrl();
    if (sRes && sRes.success && sRes.url) {
      return HtmlService.createHtmlOutput('<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=' + sRes.url + '"><script>location.href="' + sRes.url + '";<\/script></head><body><p style="font-family:sans-serif;padding:20px;">구글 시트(inEnglish)로 이동하는 중입니다...</p></body></html>');
    }
    return ContentService.createTextOutput('구글 시트 조회 오류: ' + (sRes.error || '알 수 없음'));
  }

  // GitHub Pages 등 외부 프론트엔드에서 GET 호출 시 번역 지원 (CORS 프리)
  if (e && e.parameter && e.parameter.action === 'translate' && e.parameter.text) {
    var getPayload = {
      grade: parseInt(e.parameter.grade, 10) || 3,
      text: decodeURIComponent(e.parameter.text),
      clientApiKey: e.parameter.clientApiKey || ''
    };
    var getResult = translateElementary(getPayload);
    return ContentService.createTextOutput(JSON.stringify(getResult))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('inEnglish 🎒 초등 3~6학년 교과서 맞춤 AI 번역기')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 외부 웹사이트(GitHub Pages 등)에서 호출 시 REST API POST 엔드포인트 (CORS 지원)
 */
function doPost(e) {
  try {
    var rawText = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var payload = JSON.parse(rawText);
    var result = translateElementary(payload);
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'API 처리 오류: ' + err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * HTML 내 다른 파일 인클루드 헬퍼 (필요 시)
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 초등학생 및 교사를 위한 2022 개정 교육과정 번역 함수 (클라이언트에서 google.script.run으로 호출)
 * 
 * @param {Object} payload
 * @param {number} payload.grade - 학년 (3, 4, 5, 6)
 * @param {string} payload.text - 입력 텍스트
 * @param {string} [payload.clientApiKey] - 클라이언트에서 직접 입력한 API 키 (선택 사항)
 * @return {Object} 번역 결과 JSON
 */
function translateElementary(payload) {
  try {
    if (!payload || !payload.text) {
      return { success: false, error: '번역할 내용을 입력해주세요! 😊' };
    }

    var text = String(payload.text).trim();
    var grade = parseInt(payload.grade, 10) || 3;
    if (grade < 3 || grade > 6) grade = 3;

    // 1. 언어 유효성 검증 (한글, 영어, 기본 문장부호/숫자만 허용)
    var langCheck = validateLanguage(text);
    if (!langCheck.isValid) {
      return {
        success: false,
        error: langCheck.message || '초등 영어 수업을 위해 한글 또는 영어만 입력해주세요! ✏️'
      };
    }

    // 2. 캐시 확인 (자주 묻는 질문은 0ms 응답)
    var cache = CacheService.getScriptCache();
    var cacheKey = 'trans_' + grade + '_' + Utilities.base64EncodeWebSafe(text).substring(0, 80);
    var cached = cache.get(cacheKey);
    if (cached) {
      try {
        var parsedCache = JSON.parse(cached);
        parsedCache.isCached = true;
        // 캐시 응답도 히스토리 시트에 기록
        logTranslationToSheet(grade, text, parsedCache.translation, parsedCache.direction, (parsedCache.usedModel || 'gemini-flash') + ' [캐시]');
        return { success: true, data: parsedCache };
      } catch (e) {
        // 캐시 파싱 에러 시 재호출 진행
      }
    }

    // 3. API 키 획득 (GAS Script Properties 우선, 없을 시 클라이언트 전달 키)
    var apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey && payload.clientApiKey) {
      apiKey = String(payload.clientApiKey).trim();
    }

    if (!apiKey) {
      return {
        success: false,
        needApiKey: true,
        error: 'Gemini API 키 설정이 필요합니다. 우측 상단 ⚙️ 설정에서 API 키를 입력하거나 스크립트 속성에 등록해주세요.'
      };
    }

    // 4. Gemini API 호출
    var systemInstruction = PromptEngine.buildSystemInstruction(grade);
    var geminiResult = callGeminiApi(apiKey, systemInstruction, text);

    if (!geminiResult.success) {
      return geminiResult;
    }

    // 5. 캐시 저장 (최대 6시간: 21600초)
    try {
      cache.put(cacheKey, JSON.stringify(geminiResult.data), 21600);
    } catch (cacheErr) {
      Logger.log('Cache put failed: ' + cacheErr);
    }

    // 6. 구글 스프레드시트 'inEnglish'에 학생 검색 히스토리 누적 기록
    logTranslationToSheet(grade, text, geminiResult.data.translation, geminiResult.data.direction, geminiResult.data.usedModel);

    return {
      success: true,
      data: geminiResult.data
    };

  } catch (err) {
    Logger.log('translateElementary error: ' + err.toString());
    return {
      success: false,
      error: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요: ' + err.message
    };
  }
}

/**
 * 한글/영어 외 제3외국어 차단 검증
 */
function validateLanguage(text) {
  // 특수문자, 공백, 숫자 제거
  var cleaned = text.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!cleaned) {
    return { isValid: false, message: '글자를 입력해주세요!' };
  }

  // 일본어(히라가나/가타카나), 한자(순수 한자), 아랍어, 키릴문자 등 필터링
  var invalidRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u0600-\u06FF\u0400-\u04FF]/;
  if (invalidRegex.test(cleaned)) {
    return {
      isValid: false,
      message: '초등 영어 수업 전용 앱이에요. 한글과 영어만 지원합니다! 🌸'
    };
  }

  return { isValid: true };
}

/**
 * Gemini API 호출 (사용 가능한 모델 동적 자동 감지 및 초고속 실행)
 */
function callGeminiApi(apiKey, systemInstruction, userText) {
  var cleanKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
  
  // 1. Google API에서 현재 API 키로 사용 가능한 모델 목록을 실시간/캐시 조회
  var availableModels = fetchAvailableModels(cleanKey);
  
  // 2. 모델 우선순위 정렬: gemini-3.8-flash, flash 계열 모델 우선
  var modelsToTry = [];
  if (availableModels && availableModels.length > 0) {
    // 3.8-flash 또는 최신 flash 모델을 맨 앞에 배치
    var topPicks = availableModels.filter(function(m) { 
      return m === 'gemini-3.8-flash' || m.indexOf('3.8-flash') !== -1; 
    });
    var otherFlashes = availableModels.filter(function(m) { 
      return m.indexOf('flash') !== -1 && topPicks.indexOf(m) === -1; 
    });
    var rest = availableModels.filter(function(m) {
      return topPicks.indexOf(m) === -1 && otherFlashes.indexOf(m) === -1;
    });
    modelsToTry = topPicks.concat(otherFlashes).concat(rest);
  } else {
    // 조회 실패 시 기본 시도 모델
    modelsToTry = ['gemini-3.8-flash', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  }

  var lastError = '';
  // 3. 사용 가능한 모델과 버전을 순서대로 호출
  for (var i = 0; i < modelsToTry.length; i++) {
    var modelName = modelsToTry[i];
    var versions = ['v1', 'v1beta'];
    for (var v = 0; v < versions.length; v++) {
      var apiVer = versions[v];
      var result = requestGeminiModel(modelName, apiVer, cleanKey, systemInstruction, userText);
      if (result.success) {
        result.data.usedModel = modelName + ' (' + apiVer + ')';
        return result;
      }
      lastError = result.error;
      Logger.log('Model ' + modelName + ' (' + apiVer + ') failed: ' + lastError);
    }
  }

  return { 
    success: false, 
    error: lastError + (availableModels.length ? ' [사용 가능 모델: ' + availableModels.slice(0, 5).join(', ') + ']' : '')
  };
}

/**
 * API 키로 실제 사용 가능한 모델 목록 가져오기
 */
function fetchAvailableModels(apiKey) {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('AVAILABLE_MODELS');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }

  try {
    var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + encodeURIComponent(apiKey);
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (resp.getResponseCode() === 200) {
      var data = JSON.parse(resp.getContentText());
      if (data.models && data.models.length > 0) {
        var supported = data.models
          .filter(function(m) { 
            return m.supportedGenerationMethods && m.supportedGenerationMethods.indexOf('generateContent') !== -1; 
          })
          .map(function(m) { return m.name.replace('models/', ''); });

        if (supported.length > 0) {
          cache.put('AVAILABLE_MODELS', JSON.stringify(supported), 21600);
          return supported;
        }
      }
    } else {
      Logger.log('ListModels HTTP ' + resp.getResponseCode() + ': ' + resp.getContentText());
    }
  } catch(e) {
    Logger.log('fetchAvailableModels exception: ' + e);
  }

  return [];
}

/**
 * 개별 Gemini 모델 호출 헬퍼
 */
function requestGeminiModel(modelName, apiVersion, apiKey, systemInstruction, userText) {
  var ver = apiVersion || 'v1beta';
  var url = 'https://generativelanguage.googleapis.com/' + ver + '/models/' + modelName + ':generateContent?key=' + encodeURIComponent(apiKey);

  var payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: userText }
        ]
      }
    ],
    systemInstruction: {
      parts: [
        { text: systemInstruction }
      ]
    },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 800
    }
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();

    if (statusCode !== 200) {
      var errMsg = 'AI 번역 오류 (' + modelName + ' ' + ver + ' 코드: ' + statusCode + ')';
      try {
        var errJson = JSON.parse(responseText);
        if (errJson.error && errJson.error.message) {
          errMsg += ' - ' + errJson.error.message;
        }
      } catch (e) {}
      return { success: false, error: errMsg };
    }

    var data = JSON.parse(responseText);
    var candidate = data.candidates && data.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts) {
      return { success: false, error: 'AI 번역 결과를 생성하지 못했습니다.' };
    }

    var rawOutput = candidate.content.parts[0].text;
    var cleanJson = rawOutput.replace(/```json/gi, '').replace(/```/g, '').trim();
    var resultObj = JSON.parse(cleanJson);

    return {
      success: true,
      data: resultObj
    };
  } catch (err) {
    return {
      success: false,
      error: '통신 또는 데이터 처리 오류: ' + err.message
    };
  }
}

/**
 * ========================================================
 * 교사용 구글 스프레드시트 ('inEnglish') 검색 히스토리 누적 기록
 * ========================================================
 */
function logTranslationToSheet(grade, text, translation, direction, modelName) {
  try {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('HISTORY_SHEET_ID');
    var ss = null;

    if (sheetId) {
      try {
        ss = SpreadsheetApp.openById(sheetId);
      } catch (e) {
        ss = null;
      }
    }

    // 시트가 없으면 'inEnglish' 이름으로 신규 생성
    if (!ss) {
      ss = SpreadsheetApp.create('inEnglish');
      sheetId = ss.getId();
      props.setProperty('HISTORY_SHEET_ID', sheetId);

      var sheet = ss.getActiveSheet();
      sheet.setName('번역기록');
      sheet.appendRow(['일시 (날짜 및 시간)', '학년', '입력 내용 (한글/영어)', '번역 결과', '번역 방향', '사용 AI 모델']);
      sheet.getRange(1, 1, 1, 6)
        .setBackground('#4338ca')
        .setFontColor('#ffffff')
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    var logSheet = ss.getSheetByName('번역기록') || ss.getActiveSheet();
    var nowStr = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    logSheet.appendRow([
      nowStr,
      grade + '학년',
      text,
      translation,
      direction || 'ko-to-en',
      modelName || 'gemini-3.8-flash'
    ]);
  } catch (err) {
    Logger.log('logTranslationToSheet notice: ' + err.toString());
  }
}

/**
 * 교사용 'inEnglish' 구글 시트 URL 조회 함수 (설정 창에서 원클릭 확인)
 */
function getHistorySheetUrl() {
  try {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('HISTORY_SHEET_ID');
    if (sheetId) {
      return { success: true, url: 'https://docs.google.com/spreadsheets/d/' + sheetId + '/edit' };
    }
    // 시트가 아직 생성 전이면 생성 후 반환
    var ss = SpreadsheetApp.create('inEnglish');
    sheetId = ss.getId();
    props.setProperty('HISTORY_SHEET_ID', sheetId);
    var sheet = ss.getActiveSheet();
    sheet.setName('번역기록');
    sheet.appendRow(['일시 (날짜 및 시간)', '학년', '입력 내용 (한글/영어)', '번역 결과', '번역 방향', '사용 AI 모델']);
    sheet.getRange(1, 1, 1, 6).setBackground('#4338ca').setFontColor('#ffffff').setFontWeight('bold');
    sheet.setFrozenRows(1);
    return { success: true, url: ss.getUrl() };
  } catch(err) {
    return { success: false, error: err.toString() };
  }
}

