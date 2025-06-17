const fs = require("fs");
const fsPromises = fs.promises;
const path = require("path");
const { TEMP_DIR, USED_VIDEOS_FILE } = require("./config");

// activeFiles Set 초기화
const activeFiles = new Set();

async function initTempDir() {
  console.log("\n임시 폴더 초기화 중...");
  try {
    if (fs.existsSync(TEMP_DIR)) {
      // fs.rmSync(TEMP_DIR, { recursive: true, force: true }); // 더 강력한 삭제
      const files = await fsPromises.readdir(TEMP_DIR);
      for (const file of files) {
        const filePath = path.join(TEMP_DIR, file);
        try {
          await fsPromises.unlink(filePath);
        } catch (err) {
          console.warn(`파일 삭제 실패 (${file}):`, err.message);
        }
      }
      await fsPromises.rmdir(TEMP_DIR);
    }
    await fsPromises.mkdir(TEMP_DIR, { recursive: true });
    console.log(`임시 폴더 생성됨: ${TEMP_DIR}`);
    activeFiles.clear();
    console.log("임시 폴더 초기화 완료");
  } catch (error) {
    console.error("임시 폴더 초기화 중 오류:", error.message);
    throw new Error(`임시 폴더 초기화 실패: ${error.message}`);
  }
}

function getTempPath(filename) {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  const filePath = path.join(TEMP_DIR, filename);
  activeFiles.add(filePath);
  return filePath;
}

async function loadUsedVideos() {
  try {
    const data = await fsPromises.readFile(USED_VIDEOS_FILE, "utf8");
    console.log("기존 used_videos.json 파일 로드됨");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      console.log("used_videos.json 파일이 없어 새로 생성합니다");
      return {};
    }
    throw error;
  }
}

async function saveUsedVideos(usedVideos) {
  await fsPromises.writeFile(
    USED_VIDEOS_FILE,
    JSON.stringify(usedVideos, null, 2)
  );
}

async function markVideoAsUsed(videoId, topic) {
  console.log(`비디오 ID ${videoId}를 주제 "${topic}"에 대해 사용 표시`);
  const usedVideos = await loadUsedVideos();
  if (!usedVideos[videoId]) {
    usedVideos[videoId] = [];
  }
  usedVideos[videoId].push(topic);
  await saveUsedVideos(usedVideos);
  console.log("used_videos.json 업데이트 완료");
}

async function isVideoUsed(videoId) {
  const usedVideos = await loadUsedVideos();
  return !!usedVideos[videoId];
}

function sanitizeFileName(name) {
  return name
    .replace(/[^a-zA-Z0-9가-힣]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
}

async function cleanup() {
  console.log("\n임시 파일 정리 중...");
  try {
    const cleanupPromises = [];
    for (const filePath of activeFiles) {
      if (fs.existsSync(filePath)) {
        cleanupPromises.push(
          fsPromises
            .unlink(filePath)
            .then(() => console.log(`삭제됨: ${path.basename(filePath)}`))
            .catch((err) =>
              console.error(
                `파일 삭제 실패 (${path.basename(filePath)}):`,
                err.message
              )
            )
        );
      }
    }
    await Promise.allSettled(cleanupPromises);
    activeFiles.clear();

    if (fs.existsSync(TEMP_DIR)) {
      const remainingFiles = await fsPromises.readdir(TEMP_DIR);
      if (remainingFiles.length === 0) {
        try {
          await fsPromises.rmdir(TEMP_DIR);
          console.log("임시 디렉토리 제거 완료");
        } catch (error) {
          console.error("임시 디렉토리 제거 실패:", error.message);
        }
      } else {
        console.log(`정리 후 남은 임시 파일: ${remainingFiles.length}개`);
      }
    }

    if (global.gc) {
      global.gc();
      console.log("가비지 컬렉션 요청됨");
    }
  } catch (error) {
    console.error("cleanup 중 오류 발생:", error);
  }
}

module.exports = {
  initTempDir,
  getTempPath,
  loadUsedVideos,
  saveUsedVideos,
  markVideoAsUsed,
  isVideoUsed,
  sanitizeFileName,
  cleanup,
};
