# Smart Vocab (안드로이드 웹앱)

PC 버전 v4.9와 같은 학습 규칙으로 동작하는 웹앱입니다. 폰 브라우저에서 실행되고, 홈 화면에 설치하면 오프라인에서도 쓸 수 있어요.

## 파일 구성
- index.html — 화면 구조와 디자인
- app.js — 화면 동작, 저장(IndexedDB), 백업/가져오기
- core.js — 학습 알고리즘 (PC vocapro_v48.py와 같은 계산)
- sw.js — 오프라인 동작 (앱을 고쳐서 다시 올릴 때 VERSION 값을 올려주세요)
- manifest.webmanifest, icons/ — 홈 화면 설치용 정보와 아이콘

## GitHub Pages에 올리기
1. github.com에 로그인 → 오른쪽 위 + → New repository
2. Repository name: smart-vocab / Public 선택 → Create repository
3. "uploading an existing file" 클릭 → 이 폴더 안의 파일과 icons 폴더를 모두 끌어다 놓기 → Commit changes
4. Settings → Pages → Branch: main, 폴더: / (root) → Save
5. 1~2분 뒤 https://(내 아이디).github.io/smart-vocab/ 로 접속

## 폰에 설치
안드로이드 Chrome으로 위 주소 접속 → 오른쪽 위 ⋮ → "홈 화면에 추가"(또는 "앱 설치")

## PC 단어장 옮기기
PC의 vocab_data.json을 폰으로 보냄(카톡 나와의 채팅, 구글 드라이브 등) → 앱에서 백업·가져오기 → JSON 불러오기
