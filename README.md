# inEnglish

초등학교 3~6학년 영어 수업용 한·영 번역 앱입니다.

**[inEnglish 열기](https://script.google.com/macros/s/AKfycbwDCEniHKnDOtzfWSqe-A_yzLGIcwL75emoHsjHXLToCYCfb0t0LNPCTdsOXY4nBMIujg/exec)**

현재 운영: GAS v3.0.3 / Apps Script 버전 28. 학생은 API 키나 Google 로그인 없이 사용합니다. GitHub Pages는 위 GAS 앱으로 이동합니다.

- 학년별 쉬운 번역, 한·영 혼합 문장 완성, 영어 표현 뜻 질문
- 로마자로 쓴 외국어 이름·용어의 한국어 표기 (음식·사람·장소·상품·작품·일반 표현)
- 음성 입력·직접 수정, IPA, 발음 듣기·속도 조절, 복사, 칠판 모드
- 서버 API 키 보관, 요청 제한, 원문·학년·요청 번호 대조, 단일 검색 기록

GAS의 `index`에 넣을 파일은 **[gas/index.html](gas/index.html)** 입니다. 저장소 루트의 `index.html`은 Pages 이동 안내입니다.
서버 소스는 `Code.gs`, `PromptEngine.gs`, `appsscript.json`, 화면 동작 원본은 `Client.js`입니다.

배포·운영 방법은 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)를 참고하세요.

2026-10-28 수정: 한글 캐시 키의 UTF-8 처리를 고치고 공유 번역 캐시를 비활성화했습니다. 이전에 열린 화면은 새로고침해야 합니다.

2026-10-28 한국어 표기 추가: `hotate maki → 호타테 마키`, `Shinjuku → 신주쿠`처럼 외국어 이름·표현을 한글로 안내합니다. 결과에 **한국어 표기**와 뜻 번역이 아니라는 안내를 표시합니다. 로마자 발음에는 모호함이 있을 수 있으며, 음식 재료·어원 등의 뜻풀이는 생성하지 않습니다. `Hermès` 같은 악센트 포함 로마자도 입력할 수 있습니다.
