# YouTube Shorts 자동 생성기

YouTube Shorts용 영상을 자동으로 생성하는 Node.js 기반 도구입니다. 주제를 입력하면 스크립트 생성, 관련 영상 검색, 음성 합성, 자막 추가까지 자동으로 처리합니다.

## 주요 기능

- **스크립트 자동 생성**: Claude API를 활용한 주제별 스크립트 생성
- **영상 자동 검색**: Pexels API를 통한 관련 영상 자동 검색
- **음성 합성**: OpenAI TTS API를 활용한 자연스러운 음성 합성
- **자동 편집**: FFmpeg를 활용한 영상, 음성, 자막 동기화 및 편집
- **병렬 처리**: 여러 클립을 동시에 처리하여 생성 시간 단축
- **로고 삽입**: 시작 또는 끝에 로고 영상 자동 삽입
- **안정성**: 모든 API 요청에 타임아웃 설정으로 안정적인 실행

## 설치 방법

```bash
# 저장소 클론
git clone https://github.com/higgs-jung/video-gen.git
cd video-gen

# 의존성 설치
npm install
```

## 환경 설정

`.env` 파일을 생성하고 다음 API 키를 설정하세요:

```
OPENAI_API_KEY=your_openai_api_key
CLAUDE_API_KEY=your_claude_api_key
PEXELS_API_KEY=your_pexels_api_key
```

## 사용 방법

```bash
# 프로그램 실행
node index.js
```

1. 실행 시 비디오 포맷(세로형/가로형)을 선택합니다.
2. 자동 또는 수동 모드를 선택합니다.
3. 주제를 입력하거나 추천 주제 중 선택합니다.
4. 프로그램이 자동으로 영상을 생성합니다.

## 프로젝트 구조

- **index.js**: 메인 프로그램 및 워크플로우 제어
- **config.js**: 환경 변수 및 설정 관리
- **api_utils.js**: API 연동 (Claude, OpenAI, Pexels)
- **video_utils.js**: 비디오 처리 및 FFmpeg 관련 기능
- **file_utils.js**: 파일 관리 및 임시 파일 처리
- **ui.js**: 사용자 인터페이스 및 입력 처리

## 의존성

- Node.js 14.0 이상
- FFmpeg (ffmpeg-static 패키지로 자동 설치)
- p-queue: 병렬 처리
- listr2: 진행 상황 시각화
- axios, node-fetch: API 요청
- inquirer: 사용자 인터페이스

## 라이선스

MIT
