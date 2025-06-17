const ffmpeg = require("fluent-ffmpeg");
const fs = require("fs");
const path = require("path");
const { getTempPath } = require("./file_utils");
const { VIDEO_FORMATS, FFMPEG_PATH, FFPROBE_PATH } = require("./config");
const fsPromises = require("fs/promises");

ffmpeg.setFfmpegPath(FFMPEG_PATH);
ffmpeg.setFfprobePath(FFPROBE_PATH);

const TIMEOUT_SECONDS = 30; // 30초 타임아웃

async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `ffprobe timed out after ${TIMEOUT_SECONDS} seconds for ${path.basename(filePath)}`
        )
      );
    }, TIMEOUT_SECONDS * 1000);

    ffmpeg.ffprobe(filePath, (err, metadata) => {
      clearTimeout(timer);
      if (err) {
        return reject(
          new Error(`ffprobe 오류 (${path.basename(filePath)}): ${err.message}`)
        );
      }
      const duration = metadata.format.duration;
      resolve(duration ? Math.round(duration * 1000) / 1000 : 0);
    });
  });
}

function selectBestVideoFile(videoFiles) {
  // 해상도별 선호도 설정
  const preferredQualities = [
    { height: 1920, width: 1080 },
    { height: 1080, width: 608 },
    { height: 720, width: 406 },
  ];

  for (const quality of preferredQualities) {
    const file = videoFiles.find(
      (file) =>
        file.height >= quality.height &&
        file.width >= quality.width &&
        file.file_type === "video/mp4"
    );

    if (file) return file;
  }

  // 최소 요구사항을 만족하는 파일 찾기
  return (
    videoFiles.find(
      (file) =>
        file.height >= 720 &&
        file.width >= 406 &&
        file.file_type === "video/mp4"
    ) || null
  );
}

async function addSilencePadding(audioPath, duration) {
  const paddedFileName = `padded_${path.basename(audioPath)}`;
  const outputPath = getTempPath(paddedFileName);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(audioPath)
      .audioFilters([
        "asetpts=PTS-STARTPTS",
        "aresample=async=1000",
        `apad=pad_dur=${Math.max(0, duration)}`,
      ])
      .outputOptions(["-c:a", "aac", "-b:a", "192k", "-ar", "48000"])
      .duration(duration)
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) =>
        reject(new Error(`오디오 패딩 추가 오류: ${err.message}`))
      );
  });
}

async function adjustVideo(
  videoPath,
  targetDuration,
  videoFormat = VIDEO_FORMATS.LANDSCAPE
) {
  if (!videoFormat || !videoFormat.width || !videoFormat.height) {
    console.log("비디오 포맷이 지정되지 않아 기본값(가로)을 사용합니다.");
    videoFormat = VIDEO_FORMATS.LANDSCAPE;
  }

  const adjustedFileName = `adjusted_${path.basename(videoPath)}`;
  const outputPath = getTempPath(adjustedFileName);
  const originalDuration = await getVideoDuration(videoPath);
  const speedFactor = originalDuration / targetDuration;

  console.log(`- 비디오 크기 조정: ${videoFormat.width}x${videoFormat.height}`);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .videoFilters([
        `scale=${videoFormat.width}:${videoFormat.height}:force_original_aspect_ratio=increase`,
        `crop=${videoFormat.width}:${videoFormat.height}`,
        `setpts=${1 / speedFactor}*PTS`,
        "fps=30",
      ])
      .outputOptions([
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-profile:v",
        "high",
        "-level",
        "4.1",
      ])
      .duration(targetDuration)
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

async function mergeAudioVideo(videoPath, audioPath) {
  const mergedFileName = `merged_${path.basename(videoPath)}`;
  const outputPath = getTempPath(mergedFileName);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-ar",
        "48000", // 샘플레이트 고정
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-shortest",
        "-max_interleave_delta",
        "0", // 인터리브 지연 최소화
        "-movflags",
        "+faststart",
      ])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", reject);
  });
}

function createSubtitles(
  sentences,
  durations,
  outputPath = getTempPath("subtitles.ass")
) {
  let currentTime = 0;
  let content = `[Script Info]
Title: Subtitles
ScriptType: v4.00+
Collisions: Normal
PlayDepth: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Pretendard Black,10,&H00FFFFFF,&H00000000,&H00000000,&H80000000,1,0,0,0,100,100,0,0,3,3,1,2,20,20,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  sentences.forEach((sentence, index) => {
    const duration = durations[index];
    const start = formatTime(currentTime);
    const end = formatTime(currentTime + duration);
    content += `Dialogue: 0,${start},${end},Default,,0,0,0,,${sentence}\n`;
    currentTime += duration;
  });

  fs.writeFileSync(outputPath, content, "utf8");
  console.log(`자막 파일 생성 완료: ${outputPath}`);
  return outputPath;
}

function formatTime(seconds, format = "ass") {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centisecs = Math.floor((seconds % 1) * 100);

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centisecs).padStart(2, "0")}`;
}

async function mergeClips(clipPaths) {
  const outputPath = getTempPath("merged.mp4");
  const fileListPath = getTempPath("filelist.txt");

  try {
    // 파일 목록 생성
    const fileList = clipPaths
      .map((clip) => `file '${clip.replace(/\\/g, "/")}'`)
      .join("\n");
    await fsPromises.writeFile(fileListPath, fileList);

    return new Promise((resolve, reject) => {
      const command = ffmpeg()
        .input(fileListPath)
        .inputOptions("-f", "concat", "-safe", "0")
        .outputOptions([
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
        ]);

      // 스트림 파이프 설정
      const outputStream = fs.createWriteStream(outputPath);
      command.pipe(outputStream, { end: true });

      // 진행률 모니터링
      command.on("progress", (progress) => {
        if (progress.percent) {
          process.stdout.write(
            `\r병합 진행률: ${Math.round(progress.percent)}%`
          );
        }
      });

      command.on("end", () => {
        process.stdout.write("\n");
        resolve(outputPath);
      });

      command.on("error", (err) => {
        outputStream.end();
        reject(err);
      });

      // 메모리 정리
      outputStream.on("finish", () => {
        fsPromises.unlink(fileListPath).catch(() => {});
      });
    });
  } catch (error) {
    await fsPromises.unlink(fileListPath).catch(() => {});
    throw error;
  }
}

async function renderSubtitles(videoPath, subtitlePath, outputPath) {
  return new Promise((resolve, reject) => {
    // 입력 파일 존재 확인
    if (!fs.existsSync(videoPath)) {
      reject(new Error(`비디오 파일을 찾을 수 없음: ${videoPath}`));
      return;
    }
    if (!fs.existsSync(subtitlePath)) {
      reject(new Error(`자막 파일을 찾을 수 없음: ${subtitlePath}`));
      return;
    }

    // 절대 경로로 변환
    const absoluteSubtitlePath = path.resolve(subtitlePath).replace(/\\/g, "/");

    ffmpeg(videoPath)
      .input(subtitlePath)
      .complexFilter([
        {
          filter: "subtitles",
          options: {
            filename: absoluteSubtitlePath,
            force_style: [
              "Fontname=Pretendard Black",
              "FontSize=10",
              "PrimaryColour=&HFFFFFF",
              "OutlineColour=&H000000",
              "BackColour=&H80000000",
              "BorderStyle=3",
              "Outline=3",
              "Shadow=1",
              "Bold=1",
              "Alignment=2",
              "MarginV=60",
              "MarginL=20",
              "MarginR=20",
            ].join(","),
          },
        },
      ])
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        "-max_muxing_queue_size",
        "9999",
      ])
      .on("start", (commandLine) => {
        console.log("자막 렌더링 시작:", commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          process.stdout.write(
            `\r자막 렌더링 진행률: ${Math.round(progress.percent)}%`
          );
        }
      })
      .on("end", () => {
        console.log("\n자막 렌더링 완료");
        resolve(outputPath);
      })
      .on("error", (err, stdout, stderr) => {
        console.error("자막 렌더링 오류:", err.message);
        console.error("FFmpeg stderr:", stderr);
        reject(new Error(`자막 렌더링 실패: ${err.message}`));
      })
      .save(outputPath);
  });
}

async function addLogo(mainVideoPath, logoPath, videoFormat) {
  if (!fs.existsSync(logoPath)) {
    console.warn("로고 파일이 없어 로고를 추가하지 않습니다.");
    return mainVideoPath;
  }
  const outputPath = getTempPath(`with_logo_${path.basename(mainVideoPath)}`);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(mainVideoPath)
      .input(logoPath)
      .complexFilter([
        "[0:v]setsar=1[main];[1:v]scale=iw/4:-1[logo];[main][logo]overlay=W-w-10:H-h-10",
      ])
      .outputOptions(["-c:a", "copy"])
      .save(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) =>
        reject(new Error(`로고 추가 오류: ${err.message}`))
      );
  });
}

async function addAttribution(videoPath, attribution, videoFormat) {
  const outputPath = getTempPath(
    `with_attribution_${path.basename(videoPath)}`
  );

  return new Promise((resolve, reject) => {
    // 안전한 텍스트 변환 (특수문자 이스케이프)
    const safeText = attribution.replace(/'/g, "\\'").replace(/"/g, '\\"');

    ffmpeg(videoPath)
      .complexFilter([
        `drawtext=text='${safeText}':fontsize=20:fontcolor=white:x=w-tw-20:y=h-th-20`,
      ])
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "copy",
      ])
      .on("start", (commandLine) => {
        console.log(`저작권 정보 추가 중: ${attribution}`);
      })
      .on("end", () => {
        console.log("저작권 정보 추가 완료");
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.warn(
          `저작권 정보 추가 실패 (${err.message}), 원본 비디오 반환`
        );
        resolve(videoPath); // 실패시 원본 비디오 반환
      })
      .save(outputPath);
  });
}

async function createClip(
  videoPath,
  audioPath,
  sentence,
  videoFormat,
  attribution = null
) {
  try {
    const audioDuration = await getVideoDuration(audioPath);
    const targetDuration = Math.ceil((audioDuration + 0.5) * 100) / 100;

    const [adjustedVideo, paddedAudio] = await Promise.all([
      adjustVideo(videoPath, targetDuration, videoFormat),
      addSilencePadding(audioPath, targetDuration),
    ]);

    const mergedClip = await mergeAudioVideo(adjustedVideo, paddedAudio);

    // 저작권 정보가 있으면 추가
    let finalClip = mergedClip;
    if (attribution) {
      finalClip = await addAttribution(mergedClip, attribution, videoFormat);
    }

    const finalDuration = await getVideoDuration(finalClip);

    return {
      clip: finalClip,
      duration: finalDuration,
      sentence: sentence,
    };
  } catch (error) {
    throw new Error(`클립 생성 실패: ${error.message}`);
  }
}

async function mergeClipsWithLogo(clipPaths, logoPath, outputPath) {
  return new Promise(async (resolve, reject) => {
    try {
      // 전체 길이 계산
      let totalDuration = 0;
      for (const clip of clipPaths) {
        const duration = await getVideoDuration(clip);
        totalDuration += duration;
        console.log(`- 클립 길이 (${clip}): ${duration}초`);
      }

      const logoDuration = await getVideoDuration(logoPath);
      const expectedTotalDuration = totalDuration + logoDuration;
      console.log(`- 로고 길이: ${logoDuration}초`);
      console.log(`- 예상 총 길이: ${expectedTotalDuration}초`);

      // 파일 목록 생성
      const fileListContent = clipPaths
        .map((clip) => `file '${path.resolve(clip)}'`)
        .join("\n");

      const finalFileList = `${fileListContent}\nfile '${path.resolve(logoPath)}'`;
      const fileListPath = path.join(path.dirname(outputPath), "filelist.txt");
      fs.writeFileSync(fileListPath, finalFileList);

      ffmpeg()
        .input(fileListPath)
        .inputOptions(["-f", "concat", "-safe", "0"])
        .outputOptions([
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "192k",
          "-movflags",
          "+faststart",
          "-t",
          expectedTotalDuration.toString(),
        ])
        .on("start", (commandLine) => {
          console.log("- FFmpeg 명령어:", commandLine);
        })
        .on("progress", (progress) => {
          if (progress.percent) {
            const normalizedProgress = Math.min(
              Math.round(progress.percent),
              100
            );
            process.stdout.write(`\r- 처리 중: ${normalizedProgress}% 완료`);
          }
        })
        .on("end", async () => {
          console.log("\n- 처리 완료");
          // 결과 영상 길이 확인
          const finalDuration = await getVideoDuration(outputPath);
          console.log(`- 최종 영상 길이: ${finalDuration}초`);
          if (Math.abs(finalDuration - expectedTotalDuration) > 1) {
            console.warn(
              `- 경고: 예상 길이(${expectedTotalDuration})와 실제 길이(${finalDuration}초)가 다릅니다`
            );
          }
          fs.unlink(fileListPath, () => {});
          resolve(outputPath);
        })
        .on("error", (err, stdout, stderr) => {
          console.error("- FFmpeg 오류:", err.message);
          console.error("- FFmpeg stderr:", stderr);
          fs.unlink(fileListPath, () => {});
          reject(new Error(`병합 오류: ${err.message}`));
        })
        .save(outputPath);
    } catch (error) {
      reject(error);
    }
  });
}

async function prepareLogoVideo(logoPath, outputPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(logoPath)) {
      console.warn("경고: 로고 파일을 찾을 수 없습니다:", logoPath);
      resolve(null);
      return;
    }

    ffmpeg(logoPath)
      .outputOptions([
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
      ])
      .on("start", (commandLine) => {
        console.log("로고 전처리 명령어:", commandLine);
      })
      .on("progress", (progress) => {
        if (progress.percent) {
          console.log(`로고 전처리 중: ${Math.round(progress.percent)}% 완료`);
        }
      })
      .on("end", () => {
        console.log("로고 비디오 전처리 완료");
        resolve(outputPath);
      })
      .on("error", (err) => {
        console.error("로고 비디오 전처리 오류:", err);
        reject(err);
      })
      .save(outputPath);
  });
}

module.exports = {
  getVideoDuration,
  selectBestVideoFile,
  addSilencePadding,
  adjustVideo,
  mergeAudioVideo,
  createSubtitles,
  mergeClips,
  renderSubtitles,
  addLogo,
  addAttribution,
  createClip,
  formatTime,
  mergeClipsWithLogo,
  prepareLogoVideo,
};
