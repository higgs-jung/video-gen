const path = require("path");
const fs = require("fs");
const PQueue = require("p-queue").default;
const { Listr } = require("listr2");

const {
  VIDEO_FORMATS,
  OPENAI_API_KEY,
  PEXELS_API_KEY,
  CLAUDE_API_KEY,
  LOGO_VIDEO_PATH,
} = require("./config");
const { initTempDir, cleanup, sanitizeFileName } = require("./file_utils");
const api = require("./api_utils");
const video = require("./video_utils");
const ui = require("./ui");

async function checkEnvironment() {
  console.log("환경 체크 중...");

  // API 키 체크
  if (!OPENAI_API_KEY || !PEXELS_API_KEY || !CLAUDE_API_KEY) {
    throw new Error("API 키가 설정되지 않았습니다. .env 파일을 확인해주세요.");
  }

  // 로고 파일 체크
  if (!fs.existsSync(LOGO_VIDEO_PATH)) {
    console.warn(
      `경고: 로고 비디오 파일(${LOGO_VIDEO_PATH})을 찾을 수 없습니다.`
    );
  } else {
    console.log(`- 로고 비디오 확인됨: ${LOGO_VIDEO_PATH}`);
  }

  console.log("- FFmpeg 정상 작동 확인"); // ffmpeg-static이 경로를 보장
  console.log("환경 체크 완료\n");
}

async function generateContentPlan(topic, videoFormat) {
  const script = await api.generateScript(topic);
  const sentences = script.split(/(?<=\.)\s+/).filter((s) => s.trim());

  const contentPlan = [];
  for (const sentence of sentences) {
    console.log(`\n문장 처리 중: "${sentence.trim()}"`);
    let keywords = await api.translateToKeywords(sentence);
    console.log(`  - 키워드: ${keywords.join(", ")}`);

    let videoPreview = null;
    try {
      videoPreview = await api.searchVideoPreview(keywords, 1, videoFormat);
    } catch (e) {
      console.warn(`  - 비디오 검색 실패: ${e.message}`);
      // 한 번만 대체 키워드로 재시도
      try {
        console.log(`  - 대체 키워드로 재시도...`);
        const altKeywords = await api.getAlternativeKeywords(sentence);
        console.log(`  - 대체 키워드: ${altKeywords.join(", ")}`);
        videoPreview = await api.searchVideoPreview(
          altKeywords,
          1,
          videoFormat
        );
      } catch (e2) {
        console.warn(`  - 대체 키워드 검색도 실패: ${e2.message}`);
      }
    }

    if (videoPreview) {
      console.log(`  - 비디오 찾음: ID ${videoPreview.videoId}`);
      contentPlan.push({ sentence, keywords, videoPreview });
    } else {
      console.warn(`"${sentence}"에 대한 비디오를 찾지 못해 건너뜁니다.`);
    }
  }
  return contentPlan;
}

async function autoReviewContent(contentPlan) {
  console.log("\n=== 자동 콘텐츠 검토 중 ===\n");
  const reviewedPlan = contentPlan.filter(
    (c) => c.videoPreview && c.videoPreview.videoUrl
  );
  console.log(
    `총 ${contentPlan.length}개 중 ${reviewedPlan.length}개 자동 승인됨.\n`
  );
  if (reviewedPlan.length === 0) {
    throw new Error("자동 검토 후 승인된 콘텐츠가 없습니다.");
  }
  return reviewedPlan;
}

async function generateMediaFiles(contentPlan) {
  console.log("\n미디어 파일 병렬 생성 중...");

  const tasks = new Listr(
    contentPlan.map((content, index) => ({
      title: `[${index + 1}/${contentPlan.length}] 미디어 생성`,
      task: async (ctx, task) => {
        try {
          task.output = "비디오 다운로드 중...";
          const videoPath = await api.downloadVideo(
            content.videoPreview.videoUrl,
            index
          );

          task.output = "오디오 생성 중...";
          const audioPath = await api.generateAudio(content.sentence, index);

          content.videoPath = videoPath;
          content.audioPath = audioPath;
          task.output = "완료";
          return content;
        } catch (error) {
          throw new Error(`미디어 생성 실패: ${error.message}`);
        }
      },
      retry: 2, // 실패 시 2번 재시도
    })),
    {
      concurrent: 4,
      exitOnError: false,
      rendererOptions: {
        collapseErrors: false,
      },
    }
  );

  try {
    await tasks.run();
    // listr2 작업 완료 후, 성공한 태스크의 결과만 필터링합니다.
    return contentPlan.filter((content, index) => {
      const task = tasks.tasks[index];
      return (
        task.state === "COMPLETED" && content.videoPath && content.audioPath
      );
    });
  } catch (e) {
    console.error("\n미디어 생성 중 오류가 발생했습니다.");
    tasks.tasks.forEach((task) => {
      if (task.state === "FAILED") {
        console.error(`- ${task.title}: ${task.errors[0].message}`);
      }
    });
    return [];
  }
}

async function syncAndEditMedia(reviewedPlan, videoFormat) {
  console.log("\n미디어 동기화 및 편집 중...");

  const results = [];

  const tasks = new Listr(
    reviewedPlan.map((content, index) => ({
      title: `[${index + 1}/${reviewedPlan.length}] 클립 편집`,
      task: async (ctx, task) => {
        try {
          task.output = "클립 생성 중...";
          const result = await video.createClip(
            content.videoPath,
            content.audioPath,
            content.sentence,
            videoFormat,
            content.videoPreview.attribution
          );
          task.output = "완료";

          // 결과를 results 배열에 직접 저장
          results[index] = result;

          return result;
        } catch (error) {
          throw new Error(`클립 편집 실패: ${error.message}`);
        }
      },
      retry: 2,
    })),
    {
      concurrent: 4,
      exitOnError: false,
      rendererOptions: {
        collapseErrors: false,
      },
    }
  );

  try {
    await tasks.run();

    // results 배열에서 성공한 결과만 필터링
    const validResults = results.filter((result) => result && result.clip);

    console.log(`\n성공적으로 편집된 클립 수: ${validResults.length}`);

    return {
      clips: validResults.map((r) => r.clip),
      durations: validResults.map((r) => r.duration),
      sentences: validResults.map((r) => r.sentence),
    };
  } catch (e) {
    console.error("\n미디어 편집 중 오류가 발생했습니다.");
    tasks.tasks.forEach((task) => {
      if (task.state === "FAILED") {
        console.error(`- ${task.title}: ${task.errors[0].message}`);
      }
    });
    return { clips: [], durations: [], sentences: [] };
  }
}

async function createVideo(topic, clips, durations, sentences, videoFormat) {
  const tempFiles = []; // 임시 파일 추적을 위한 배열

  try {
    console.log("\n최종 영상 조립 중...");

    // 임시 파일들의 경로 생성 및 추적
    const preparedLogoPath = path.join(
      process.cwd(),
      "temp",
      "prepared_logo.mp4"
    );
    const mergedPath = path.join(process.cwd(), "temp", "merged_with_logo.mp4");
    const subtitlePath = path.join(process.cwd(), "temp", "subtitles.ass");

    tempFiles.push(preparedLogoPath, mergedPath, subtitlePath);

    // 로고 비디오 전처리
    const preparedLogo = await video.prepareLogoVideo(
      LOGO_VIDEO_PATH,
      preparedLogoPath
    );

    // 클립 병합
    if (!preparedLogo) {
      console.log("로고 없이 영상을 생성합니다.");
      const mergedClipsPath = await video.mergeClips(clips);
      // 로고 없을 때는 mergedClipsPath를 mergedPath로 복사
      fs.renameSync(mergedClipsPath, mergedPath);
    } else {
      console.log("로고와 함께 영상을 생성합니다.");
      await video.mergeClipsWithLogo(clips, preparedLogoPath, mergedPath);
    }

    // 자막 생성
    const subtitleFile = video.createSubtitles(
      sentences,
      durations,
      subtitlePath
    );

    // 최종 파일명 생성
    const sanitizedTopic = sanitizeFileName(topic);
    const finalPath = path.join(process.cwd(), `${sanitizedTopic}.mp4`);

    // 자막 렌더링
    await video.renderSubtitles(mergedPath, subtitlePath, finalPath);

    // 임시 파일들 정리
    await cleanup(tempFiles);

    return finalPath;
  } catch (error) {
    // 에러 발생시에도 임시 파일 정리 시도
    try {
      await cleanup(tempFiles);
    } catch (cleanupError) {
      console.error("임시 파일 정리 중 오류:", cleanupError);
    }
    throw error;
  }
}

async function main() {
  try {
    console.log("=== YouTube Shorts 자동 생성기 v2.0 ===\n");
    await checkEnvironment();
    await initTempDir();

    const selectedFormat = ui.selectVideoFormat(VIDEO_FORMATS);
    const { isAuto, isFullAuto } = ui.selectMode();
    let allTopics = await ui.getTopics(api.getTopicSuggestions);

    if (!isFullAuto && allTopics.length > 1) {
      allTopics = ui.selectTopic(allTopics);
    }

    for (const topic of allTopics) {
      console.log(`\n=== 주제: "${topic}" 처리 시작 ===\n`);
      try {
        let contentPlan = await generateContentPlan(topic, selectedFormat);
        if (contentPlan.length === 0) {
          console.log("영상으로 만들 콘텐츠가 없습니다.");
          continue;
        }

        let reviewedPlan = isAuto
          ? await autoReviewContent(contentPlan)
          : await ui.reviewContent(contentPlan, api, selectedFormat);

        if (reviewedPlan.length === 0) {
          console.log("검토 후 영상으로 만들 콘텐츠가 없습니다.");
          continue;
        }

        const planWithMedia = await generateMediaFiles(reviewedPlan);
        const { clips, durations, sentences } = await syncAndEditMedia(
          planWithMedia,
          selectedFormat
        );

        if (clips.length === 0) {
          console.log("편집 가능한 미디어 파일이 없습니다.");
          continue;
        }

        const finalVideoPath = await createVideo(
          topic,
          clips,
          durations,
          sentences,
          selectedFormat
        );

        console.log(`\n✅ "${topic}" 영상 생성 완료: ${finalVideoPath}`);
        const totalDuration = durations.reduce((a, b) => a + b, 0);
        console.log(
          `   - 총 클립 수: ${clips.length}, 총 길이: ${totalDuration.toFixed(2)}초`
        );
      } catch (error) {
        console.error(`\n❌ "${topic}" 처리 중 오류 발생:`, error.message);
        if (!isFullAuto) throw error;
      }
    }
  } catch (error) {
    if (error.message.includes("취소")) {
      console.log(`\n작업이 사용자에 의해 취소되었습니다.`);
    } else {
      console.error(
        "\n\n프로세스 실행 중 심각한 오류가 발생했습니다.",
        error.stack
      );
    }
  } finally {
    await cleanup();
    console.log("\n프로그램을 종료합니다.");
  }
}

// Graceful Shutdown
const cleanupAndExit = async () => {
  console.log("\n\n프로그램을 종료합니다. 임시 파일을 정리합니다...");
  await cleanup();
  process.exit(0);
};

process.on("SIGINT", cleanupAndExit);
process.on("SIGTERM", cleanupAndExit);

process.on("unhandledRejection", async (reason, promise) => {
  console.error("처리되지 않은 Promise 거부:", reason);
  await cleanup();
  process.exit(1);
});

process.on("uncaughtException", async (error) => {
  console.error("예상치 못한 오류 발생:", error);
  await cleanup();
  process.exit(1);
});

main();
