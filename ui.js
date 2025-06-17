const readlineSync = require("readline-sync");

function selectVideoFormat(videoFormats) {
  const formatOptions = ["세로 영상 (Shorts)", "가로 영상"];
  const formatIndex = readlineSync.keyInSelect(
    formatOptions,
    "영상 포맷을 선택하세요"
  );
  if (formatIndex === -1) {
    console.log("\n프로그램을 종료합니다.");
    process.exit(0);
  }
  const selectedFormatKey = formatIndex === 0 ? "SHORTS" : "LANDSCAPE";
  console.log(`\n${formatOptions[formatIndex]}으로 생성합니다.\n`);
  return videoFormats[selectedFormatKey];
}

function selectMode() {
  const modes = ["수동 모드", "자동 모드", "전체 자동 모드"];
  const modeIndex = readlineSync.keyInSelect(modes, "실행 모드를 선택하세요");
  if (modeIndex === -1) {
    console.log("\n프로그램을 종료합니다.");
    process.exit(0);
  }
  console.log(`\n${modes[modeIndex]}로 실행합니다.\n`);
  return {
    isAuto: modeIndex >= 1,
    isFullAuto: modeIndex === 2,
  };
}

async function getTopics(getTopicSuggestionsFn) {
  const topicOptions = ["주제 추천 받기", "주제 직접 입력"];
  const topicModeIndex = readlineSync.keyInSelect(
    topicOptions,
    "주제 입력 방식을 선택하세요"
  );
  if (topicModeIndex === -1) {
    console.log("\n프로그램을 종료합니다.");
    process.exit(0);
  }

  let topics = [];
  if (topicModeIndex === 0) {
    const keyword = readlineSync.question("키워드를 입력하세요: ");
    if (!keyword.trim()) {
      console.log("\n키워드가 입력되지 않아 프로그램을 종료합니다.");
      process.exit(0);
    }
    topics = await getTopicSuggestionsFn(keyword);
    console.log("\n추천 주제:");
    topics.forEach((topic, i) => console.log(`${i + 1}. ${topic}`));
  } else {
    const topic = readlineSync.question("생성할 영상의 주제를 입력하세요: ");
    if (!topic.trim()) {
      console.log("\n주제가 입력되지 않아 프로그램을 종료합니다.");
      process.exit(0);
    }
    topics = [topic];
  }
  return topics;
}

function selectTopic(topics) {
  if (topics.length > 1) {
    const selectedIndex = readlineSync.keyInSelect(topics, "주제를 선택하세요");
    if (selectedIndex === -1) {
      console.log("\n프로그램을 종료합니다.");
      process.exit(0);
    }
    return [topics[selectedIndex]];
  }
  return topics;
}

async function reviewContent(contentPlan, apiUtils, videoFormat) {
  console.log("\n=== 콘텐츠 검토 ===\n");
  const reviewedPlan = [];
  for (let i = 0; i < contentPlan.length; i++) {
    const content = contentPlan[i];
    console.log(`\n[문장 ${i + 1}/${contentPlan.length}]`);
    console.log(`  내레이션: ${content.sentence}`);
    console.log(`  키워드: ${content.keywords.join(", ")}`);
    console.log(`  비디오 URL: ${content.videoPreview.videoUrl}`);

    const options = [
      "승인",
      "문장 수정",
      "키워드 수정",
      "새로운 영상 검색",
      "이 부분 건너뛰기",
      "취소",
    ];
    const choice = readlineSync.keyInSelect(
      options,
      "어떤 작업을 수행하시겠습니까?"
    );

    try {
      switch (choice) {
        case 0: // 승인
          reviewedPlan.push(content);
          console.log("-> 승인됨");
          break;
        case 1: // 문장 수정
          content.sentence =
            readlineSync.question("새로운 문장을 입력하세요: ");
          content.keywords = await apiUtils.translateToKeywords(
            content.sentence
          );
          content.videoPreview = await apiUtils.searchVideoPreview(
            content.keywords,
            1,
            videoFormat
          );
          i--; // 수정된 내용 다시 검토
          break;
        case 2: // 키워드 수정
          const newKeywords = readlineSync.question(
            "새로운 키워드들을 입력하세요 (쉼표로 구분): "
          );
          content.keywords = newKeywords.split(",").map((k) => k.trim());
          content.videoPreview = await apiUtils.searchVideoPreview(
            content.keywords,
            1,
            videoFormat
          );
          i--;
          break;
        case 3: // 새로운 영상 검색
          content.videoPreview = await apiUtils.searchVideoPreview(
            content.keywords,
            (content.videoPreview.currentPage || 0) + 1,
            videoFormat
          );
          i--;
          break;
        case 4: // 건너뛰기
          console.log("-> 건너뜁니다.");
          break;
        default: // 취소
          throw new Error("사용자가 검토를 취소했습니다.");
      }
    } catch (error) {
      console.error(`처리 중 오류 발생: ${error.message}`);
      if (!readlineSync.keyInYN("계속 진행하시겠습니까?")) {
        throw new Error("사용자가 검토를 중단했습니다.");
      }
    }
  }

  if (reviewedPlan.length === 0) {
    throw new Error("승인된 콘텐츠가 없습니다.");
  }

  console.log("\n=== 최종 콘텐츠 요약 ===");
  reviewedPlan.forEach((c, index) => {
    console.log(`[${index + 1}] ${c.sentence}`);
  });

  if (!readlineSync.keyInYN("\n이대로 영상 제작을 진행하시겠습니까?")) {
    throw new Error("최종 검토에서 취소되었습니다.");
  }
  return reviewedPlan;
}

module.exports = {
  selectVideoFormat,
  selectMode,
  getTopics,
  selectTopic,
  reviewContent,
};
