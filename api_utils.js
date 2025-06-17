const axios = require("axios");
const fetch = require("node-fetch");
const {
  CLAUDE_API_KEY,
  CLAUDE_BASE_URL,
  CLAUDE_MODEL,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OPENAI_CHAT_URL,
  OPENAI_SPEECH_URL,
  PEXELS_API_KEY,
  PEXELS_VIDEO_SEARCH_URL,
} = require("./config");
const { markVideoAsUsed, isVideoUsed, getTempPath } = require("./file_utils");
const { selectBestVideoFile } = require("./video_utils");
const fsPromises = require("fs").promises;
const fs = require("fs");

// 캐시 시스템 추가
const keywordCache = new Map(); // 키워드 번역 캐시
const videoSearchCache = new Map(); // 비디오 검색 캐시

class ApiRateLimiter {
  constructor(maxRetries = 3, delayMs = 1000) {
    this.maxRetries = maxRetries;
    this.delayMs = delayMs;
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async executeWithRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (error.response?.status === 429) {
          const waitTime = Math.min(1000 * Math.pow(2, attempt), 10000);
          console.log(`API 429 에러. ${waitTime / 1000}초 후 재시도...`);
          await this.sleep(waitTime);
        } else {
          // 429가 아닌 다른 오류는 즉시 throw
          throw error;
        }
      }
    }
    console.error(
      `API 요청 실패 (최대 재시도 ${this.maxRetries}회):`,
      lastError.message
    );
    throw lastError;
  }
}

const rateLimiter = new ApiRateLimiter();

async function getTopicSuggestions(keyword) {
  return rateLimiter.executeWithRetry(async () => {
    const response = await axios.post(
      CLAUDE_BASE_URL,
      {
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `당신은 YouTube 전문 기획자입니다. 다음 키워드를 기반으로 사실에 기반한 5개의 흥미로운 주제를 추천해주세요. 번호, 불렛포인트등 특수문자는 사용하지 않습니다.\n\n키워드: ${keyword}\n\n응답은 각 주제를 줄바꿈으로 구분하여 주제만 나열해주세요.`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": CLAUDE_API_KEY,
        },
        timeout: 30000, // 30초 타임아웃
      }
    );
    return response.data.content[0].text.trim().split("\n").filter(Boolean);
  });
}

async function generateScript(topic) {
  return rateLimiter.executeWithRetry(async () => {
    const response = await axios.post(
      CLAUDE_BASE_URL,
      {
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: `당신은 YouTube 스크립트 작가입니다. 다음 주제로 40초의 YouTube 쇼츠 내레이션을 작성해주세요. \n\n주제: ${topic}\n\n제작 포인트:\n'안녕하세요, 다크웹 모니터링 서비스 제로다크웹입니다' 라는 인사말로 시작합니다.\n각 문장은 핵심적이어야 합니다.\n전체 나레이션은 반드시 40초 이내여야 합니다.\n번호, 불렛포인트,따옴표 등 특수문자는 절대 사용하지 않습니다.\n실제 기업의 이름은 언급하지 않습니다.\n\t1.\t문제 제기 (8~10초)\n\t•\t경각심을 줄 수 있는 위협 상황 소개\n\t•\t다크웹 관련 현실적인 위험 사례 암시\n\t2.\t본론 (20초 내외)\n\t•\t다크웹에서 정보가 어떻게 유출되고 유통되는지\n\t•\t실제 기업이 놓치는 보안 맹점 포인트 언급\n\t•\t여기서 중요한 건 "지금 당장 할 수 있는 대응책"을 한두 개\n\t3.\t결론 (10초 이내)\n\t•\t요약과 함께 실천 강조\n\t•\t끝맺음 + 간단한 댓글 유도 (예: "우리 회사는 안전할까요?" 등)\n\n응답은 내레이션 스크립트만 작성해주세요.`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": CLAUDE_API_KEY,
        },
        timeout: 30000, // 30초 타임아웃
      }
    );
    return response.data.content[0].text.trim();
  });
}

async function translateToKeywords(sentence) {
  // 캐시 확인
  const cacheKey = sentence.trim();
  if (keywordCache.has(cacheKey)) {
    console.log(`키워드 캐시 히트: ${cacheKey}`);
    return keywordCache.get(cacheKey);
  }

  const result = await rateLimiter.executeWithRetry(async () => {
    const response = await axios.post(
      OPENAI_CHAT_URL,
      {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "한국어 문장을 Pexels 비디오 검색에 적합한 3-5개의 긍정적인 영어 키워드로 변환하세요. 자극적이고 위험한 키워드는 순화하세요.",
          },
          { role: "user", content: sentence },
        ],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 30000 } // 30초 타임아웃
    );
    return response.data.choices[0].message.content
      .split(",")
      .map((k) => k.trim());
  });

  // 캐시에 저장
  keywordCache.set(cacheKey, result);
  return result;
}

// 비디오 사용 가능 여부 확인
async function isVideoUsable(video) {
  // 이미 사용된 비디오 체크
  if (await isVideoUsed(video.id)) {
    return false;
  }

  // 적절한 비디오 파일 존재 여부 확인
  const videoFile = selectBestVideoFile(video.video_files);
  if (!videoFile) {
    return false;
  }

  // 비디오 길이 체크
  if (video.duration < 3 || video.duration > 15) {
    return false;
  }

  return true;
}

async function searchPexelsVideo(query, page, videoFormat) {
  const orientation =
    videoFormat.width < videoFormat.height ? "portrait" : "landscape";
  const params = new URLSearchParams({
    query: query,
    per_page: 15,
    page: page,
    orientation: orientation,
    size: "large",
  });

  const url = `${PEXELS_VIDEO_SEARCH_URL}?${params.toString()}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃

  try {
    const response = await fetch(url, {
      headers: { Authorization: PEXELS_API_KEY },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Pexels API 오류: ${response.status}`);
    const data = await response.json();
    if (!data.videos || data.videos.length === 0) return null;

    for (const video of data.videos) {
      if (await isVideoUsable(video)) {
        return video;
      }
    }
    return null;
  } catch (error) {
    if (error.name === "AbortError") {
      console.error(`Pexels API 검색 시간 초과: ${query}`);
    } else {
      console.error("Pexels API 검색 오류:", error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function searchVideoPreview(keywords, page, videoFormat) {
  // 캐시 키 생성
  const cacheKey = `${keywords.join("|")}:${page}:${videoFormat.width}x${videoFormat.height}`;
  if (videoSearchCache.has(cacheKey)) {
    console.log(`비디오 검색 캐시 히트: ${keywords.join(", ")}`);
    return videoSearchCache.get(cacheKey);
  }

  const result = await rateLimiter.executeWithRetry(async () => {
    // 1. 각 키워드별로 개별 검색 시도 (처음 2개만)
    const primaryKeywords = keywords.slice(0, 2);
    for (const keyword of primaryKeywords) {
      console.log(`키워드 '${keyword}' 로 검색 시도...`);
      let video = await searchPexelsVideo(keyword, page, videoFormat);
      if (video) {
        console.log(`키워드 '${keyword}'로 비디오 찾음`);
        await markVideoAsUsed(video.id, keywords.join(", "));
        return {
          thumbnailUrl: video.image,
          videoUrl: selectBestVideoFile(video.video_files).link,
          videoId: video.id,
          currentPage: page,
          attribution: video.user
            ? `Video by ${video.user.name} from Pexels`
            : null,
        };
      }
    }

    // 2. 키워드 조합으로 검색 시도 (3글자 이상만)
    const longKeywords = keywords.filter((k) => k.length > 3);
    if (longKeywords.length > 0) {
      console.log("개별 키워드 검색 실패, 키워드 조합으로 시도...");
      let searchKeywords = longKeywords.slice(0, 3).join(" OR ");
      let video = await searchPexelsVideo(searchKeywords, page, videoFormat);
      if (video) {
        console.log("키워드 조합으로 비디오 찾음");
        await markVideoAsUsed(video.id, keywords.join(", "));
        return {
          thumbnailUrl: video.image,
          videoUrl: selectBestVideoFile(video.video_files).link,
          videoId: video.id,
          currentPage: page,
          attribution: video.user
            ? `Video by ${video.user.name} from Pexels`
            : null,
        };
      }
    }

    // 3. 일반적인 키워드로 마지막 시도 (2개만)
    console.log("키워드 조합 검색 실패, 일반적인 키워드로 재시도...");
    const generalKeywords = ["technology", "business"];

    for (const keyword of generalKeywords) {
      console.log(`일반 키워드 '${keyword}' 시도...`);
      video = await searchPexelsVideo(
        keyword,
        Math.floor(Math.random() * 5) + 1,
        videoFormat
      );
      if (video) {
        console.log(`일반 키워드 '${keyword}'로 비디오 찾음`);
        await markVideoAsUsed(video.id, keywords.join(", "));
        return {
          thumbnailUrl: video.image,
          videoUrl: selectBestVideoFile(video.video_files).link,
          videoId: video.id,
          currentPage: page,
          attribution: video.user
            ? `Video by ${video.user.name} from Pexels`
            : null,
        };
      }
    }

    throw new Error("사용 가능한 비디오를 찾을 수 없습니다.");
  });

  // 성공한 결과만 캐시에 저장
  if (result) {
    videoSearchCache.set(cacheKey, result);
  }
  return result;
}

async function getAlternativeKeywords(sentence) {
  return rateLimiter.executeWithRetry(async () => {
    const response = await axios.post(
      OPENAI_CHAT_URL,
      {
        model: OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content:
              "다음 문장을 시각적으로 표현할 수 있는 대체 영어 키워드 3-5개를 제안해줘. 더 일반적이고 추상적인 개념도 좋아.",
          },
          { role: "user", content: sentence },
        ],
      },
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` }, timeout: 30000 } // 30초 타임아웃
    );
    return response.data.choices[0].message.content
      .split(",")
      .map((k) => k.trim());
  });
}

async function generateAudio(text, index) {
  return rateLimiter.executeWithRetry(async () => {
    const audioPath = getTempPath(`audio_${index}.aac`);
    const response = await axios({
      method: "post",
      url: OPENAI_SPEECH_URL,
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      data: {
        model: "tts-1",
        input: text.substring(0, 4000), // 최대 길이 제한
        voice: "nova",
        response_format: "aac",
      },
      responseType: "arraybuffer",
      timeout: 30000, // 30초 타임아웃 설정
    });
    await fsPromises.writeFile(audioPath, response.data);
    console.log(`[${index}] 음성 파일 생성 완료: ${audioPath}`);
    return audioPath;
  });
}

async function downloadVideo(url, index) {
  const videoPath = getTempPath(`video_${index}.mp4`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error(`[${index}] 비디오 다운로드 시간 초과(60초).`);
    controller.abort();
  }, 60000);

  try {
    console.log(`[${index}] 비디오 다운로드 시작: ${url}`);
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      signal: controller.signal,
    });

    const writer = fs.createWriteStream(videoPath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on("finish", () => {
        console.log(`[${index}] 비디오 다운로드 완료`);
        resolve(videoPath);
      });
      writer.on("error", (err) => {
        console.error(`[${index}] 다운로드 쓰기 오류:`, err.message);
        reject(new Error(`비디오 ${index} 다운로드 실패: ${err.message}`));
      });
    });
  } catch (error) {
    console.error(`[${index}] 다운로드 오류:`, error.message);
    if (fs.existsSync(videoPath)) {
      await fsPromises.unlink(videoPath).catch(() => {});
    }
    if (error.name === "AbortError" || error.code === "ERR_CANCELED") {
      throw new Error(`비디오 ${index} 다운로드 시간 초과`);
    }
    throw new Error(`비디오 ${index} 다운로드 실패: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  getTopicSuggestions,
  generateScript,
  translateToKeywords,
  searchVideoPreview,
  getAlternativeKeywords,
  generateAudio,
  downloadVideo,
};
