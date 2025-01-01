import { IHookEvent } from "@logseq/libs/dist/LSPlugin.user";
import {
  getAudioFile,
  getPageContentFromBlock,
  getImageUrlFromBlock,
  saveDalleImage,
  showMessage,
} from "./logseq";
import {
  OpenAIOptions,
  dallE,
  whisper,
  openAIWithStream,
  readImageURL,
  readLocalImageURL,
  openAIWithStreamGptsID,
  openAIWithStreamGptsToml,
  dallE_gptsToml,
} from "./openai";
import { getOpenaiSettings } from "./settings";
import { Command } from "../ui/LogseqAI";
import { validateContent } from "./contentModeration";
import { JSONParseError } from "./types/errors";
import { ResourceOptimizer } from "./resourceOptimizer";
import { handleOpenAIError } from "./types/errors";

async function validateSettings(settings: OpenAIOptions) {
  try {
    if (!settings.apiKey) {
      console.error("Need API key set in settings.");
      showMessage("Need openai API key. Add one in plugin settings.", "error");
      throw new Error("Need API key set in settings.");
    }

    if (
      settings.dalleImageSize !== "256" &&
      settings.dalleImageSize !== "256x256" &&
      settings.dalleImageSize !== "512" &&
      settings.dalleImageSize !== "512x512" &&
      settings.dalleImageSize !== "1024" &&
      settings.dalleImageSize !== "1024x1024" &&
      settings.dalleImageSize !== "1024x1792" &&
      settings.dalleImageSize !== "1792x1024"
    ) {
      console.error("DALL-E image size must be 256, 512, or 1024.");
      showMessage("DALL-E image size must be 256, 512, or 1024.", "error");
      throw new Error(
        "DALL-E image size must be 256, 512, 1024, 1024x1792, or 179x1024"
      );
    }
  } catch (error: unknown) {
    throw handleOpenAIError(error);
  }
}

// 10.24:push24/25 测试25次，24次无bug，详细注释版
// 负责在用户触发快捷键时，获取当前块的内容，调用 openAIWithStream 生成内容，并将结果插入到新块中。
export async function runGptBlock(b: IHookEvent) {
  try {
    const openAISettings = getOpenaiSettings();
    await validateSettings(openAISettings);

    const currentBlock = await logseq.Editor.getBlock(b.uuid);
    if (!currentBlock) {
      throw new Error("No current block");
    }

    if (currentBlock.content.trim().length === 0) {
      showMessage("Empty Content", "warning");
      return;
    }

    // 先进行内容检查，如果检查不通过直接返回
    try {
      await validateContent(currentBlock.content);
    } catch (error: any) {
      if (error.type) {
        let message = error.message;
        if (message.includes("----")) {
          message = message.split("----")[0].trim();
        }
        showMessage(message, error.level === "extreme" ? "error" : "warning");
        return; // 始终中断响应
      }
      throw error;
    }

    // 只有内容检查通过或mild类型词才继续执行
    let result = "";
    const insertBlock = await logseq.Editor.insertBlock(
      currentBlock.uuid,
      result,
      {
        sibling: false,
      }
    );

    if (openAISettings.injectPrefix && result.length == 0) {
      result = openAISettings.injectPrefix + result;
    }

    await openAIWithStream(
      currentBlock.content,
      openAISettings,
      async (content: string) => {
        result += content || "";
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      },
      () => {}
    );

    if (!result) {
      showMessage("No OpenAI content", "warning");
      return;
    }
  } catch (error: any) {
    handleOpenAIError(error);
  }
}

export async function runGptPage(b: IHookEvent) {
  const openAISettings = getOpenaiSettings();
  await validateSettings(openAISettings);

  const pageContents = await getPageContentFromBlock(b.uuid);

  try {
    // 添加内容检查
    await validateContent(pageContents);

    const currentBlock = await logseq.Editor.getBlock(b.uuid);

    if (pageContents.length === 0) {
      showMessage("Empty Content", "warning");
      console.warn("Blank page");
      return;
    }

    if (!currentBlock) {
      console.error("No current block");
      return;
    }

    const page = await logseq.Editor.getPage(currentBlock.page.id);
    if (!page) {
      return;
    }

    try {
      let result = "";
      const insertBlock = await logseq.Editor.appendBlockInPage(
        page.uuid,
        result
      );

      if (openAISettings.injectPrefix && result.length == 0) {
        result = openAISettings.injectPrefix + result;
      }

      await openAIWithStream(
        pageContents,
        openAISettings,
        async (content: string) => {
          result += content || "";
          if (null != insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
        },
        () => {}
      );
      if (!result) {
        showMessage("No OpenAI content", "warning");
        return;
      }
    } catch (e: any) {
      handleOpenAIError(e);
    }
  } catch (e: any) {
    handleOpenAIError(e);
  }
}

export async function runGptsID(
  b: IHookEvent,
  gptsID: string,
  commandName: string
) {
  try {
    const openAISettings = getOpenaiSettings();
    await validateSettings(openAISettings);

    const currentBlock = await logseq.Editor.getBlock(b.uuid);
    if (!currentBlock) {
      console.error("No current block");
      return;
    }

    if (currentBlock.content.trim().length === 0) {
      showMessage("Empty Content", "warning");
      console.warn("Blank page");
      return;
    }

    try {
      await validateContent(currentBlock.content);
    } catch (error: any) {
      if (error.type) {
        showMessage(
          error.message,
          error.level === "extreme" ? "error" : "warning"
        );
        return;
      }
      throw error;
    }

    let responseText = "";
    const insertBlock = await logseq.Editor.insertBlock(
      currentBlock.uuid,
      responseText,
      {
        sibling: false,
      }
    );

    const newPrefix = `OpenAI GPTs：${commandName}\n`;
    if (openAISettings.injectPrefix && responseText.length === 0) {
      responseText = openAISettings.injectPrefix + newPrefix;
    } else {
      responseText = newPrefix;
    }

    await openAIWithStreamGptsID(
      currentBlock.content,
      { ...openAISettings, gpts: gptsID },
      async (content: string) => {
        responseText += content || "";
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, responseText);
        }
      },
      () => {}
    );

    if (!responseText) {
      showMessage("No OpenAI content", "warning");
      return;
    }
  } catch (error: any) {
    handleOpenAIError(error);
  }
}

// 处理 JSON 解析流程的函数
async function handleColoringBookHero2(
  jsonString: string,
  insertBlock: any,
  result: string,
  openAISettings: OpenAIOptions
) {
  try {
    // 修改字符限制为3000
    if (jsonString.length > 3000) {
      throw new Error("prompt_length_exceeded");
    }

    // 清理 JSON 字符串中的特殊字符
    jsonString = jsonString
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\\"/g, '"')
      .replace(/"{2,}/g, '"')
      .replace(/"\\?"([^"]+)\\?""\s*:/g, '"$1":')
      .trim();

    // 处理不完整的 JSON
    if (!jsonString.endsWith("}")) {
      // 尝试找到最后一个完整的属性
      const lastValidProp = jsonString.lastIndexOf('",');
      if (lastValidProp !== -1) {
        jsonString = jsonString.substring(0, lastValidProp + 1) + '"}';
      } else {
        throw new Error("incomplete_json");
      }
    }

    // 确保是有效的 JSON 对象格式
    if (!jsonString.startsWith("{")) {
      jsonString = "{" + jsonString;
    }

    // 尝试解析 JSON
    let jsonData = await parseAndValidateJSON(jsonString);

    // 提取和验证必要的属性
    const promptText =
      jsonData.prompt?.toString().trim() ||
      jsonData.text?.toString().trim() ||
      jsonData.description?.toString().trim();

    if (!promptText) {
      throw new Error("empty_prompt");
    }

    // 构建标准化的对象
    const promptObj = {
      prompt: promptText,
      size: (jsonData.size?.toString() || "1024x1024").trim(),
      n: Math.min(Math.max(1, parseInt(String(jsonData.n || 1), 10)), 10),
    };

    const { prompt: finalPromptText, size, n } = promptObj;
    console.log(`计划生成 ${n} 幅图片`);

    // 显示初始 JSON 文档
    result = `提示词：\n\`\`\`json\n${formatJsonString(
      promptObj
    )}\n\`\`\`\n\n准备生成 ${n} 幅图片...\n`;
    if (insertBlock) {
      await logseq.Editor.updateBlock(insertBlock.uuid, result);
    }

    // 构建所有图片的提示词
    const imagePrompts = buildImagePrompts(finalPromptText, size, n);

    // 处理图片并更新结果
    const processedImages = await processImagesSequentially(
      imagePrompts,
      openAISettings,
      insertBlock,
      result
    );

    result = `提示词：\n\`\`\`json\n${formatJsonString(
      promptObj
    )}\`\`\`\n\n${processedImages.join("\n")}\n`;
    if (insertBlock) {
      await logseq.Editor.updateBlock(insertBlock.uuid, result);
    }

    return result;
  } catch (error: unknown) {
    const errorResult = handleOpenAIError(error);

    // 根据错误类型处理特殊情况
    if (errorResult.type === "incomplete_json") {
      return result;
    }

    // 处理 token 限制错误
    if (errorResult.type === "max_tokens_exceeded") {
      throw new Error(errorResult.error);
    }

    // 其他错误直接抛出
    throw new Error(errorResult.error);
  }
}

// 处理普通图片生成流程的函数 - 优化并行处理
async function handleColoringBookHero(
  finalPrompt: string,
  openAISettings: OpenAIOptions,
  onContent: (content: string) => void,
  onImagePrompt: (content: string) => void,
  onStop: () => void
): Promise<string> {
  console.log("\n=== 开始处理 Coloring Book Hero 请求 ===");
  const contentSegments = new Map<number, string>();
  const paragraphs: Array<{
    text: string;
    imagePrompt: string;
    index: number;
  }> = [];

  let currentParagraph = "";
  let currentIndex = 0;
  const searchText = "为该段落绘图中，请稍后...";

  // 1. 收集段落
  console.log("\n[Phase 1] 开始收集段落...");
  await openAIWithStreamGptsToml(
    finalPrompt,
    openAISettings,
    async (content: string) => {
      currentParagraph += content;
      if (content.includes(searchText)) {
        const result = splitByDrawingPrompt(currentParagraph);
        if (result) {
          const text = result.content.replace(/段落\d+\s+/g, "").trim();
          const imagePrompt = result.prompt.replace(searchText, "").trim();

          paragraphs.push({
            text,
            imagePrompt,
            index: currentIndex,
          });

          const initialContent = `段落${
            currentIndex + 1
          }\n${text}\n【绘图需求】：${imagePrompt}\n为该段落绘图中，请稍后...\n\n`;
          contentSegments.set(currentIndex, initialContent);

          onContent(initialContent);

          currentParagraph = "";
          currentIndex++;
        }
      }
    },
    () => {},
    onStop
  );

  console.log(
    `\n[Phase 2] 开始并行处理 ${paragraphs.length} 个图片生成请求...`
  );

  // 2. 优化并行处理和插入
  const insertPromises = paragraphs.map(async (para) => {
    try {
      console.log(`\n[图片生成开始] 段落 ${para.index + 1}`);
      console.log(`[DALL-E API] 绘图提示词: ${para.imagePrompt}`);

      const startTime = Date.now();
      const imageResponse = await dallE_gptsToml(
        para.imagePrompt,
        openAISettings,
        openAISettings.dalleImageSize || "1024x1024"
      );

      console.log(
        `[图片生成完成] 段落 ${para.index + 1}, 耗时: ${
          Date.now() - startTime
        }ms`
      );

      if ("url" in imageResponse) {
        console.log(`[开始保存图片] 段落 ${para.index + 1}`);
        const imageFileName = await saveDalleImage(imageResponse.url);
        console.log(
          `[图片保存完成] 段落 ${para.index + 1}, 文件名: ${imageFileName}`
        );

        const updatedContent = `段落${para.index + 1}\n${
          para.text
        }\n【绘图需求】：\n${
          // 处理绘图需求中的列表项格式
          para.imagePrompt
            .split("\n")
            .map((line) => {
              const trimmedLine = line.trim();
              // 如果是列表项，保持原有的双破折号格式
              if (trimmedLine.startsWith("--")) {
                return trimmedLine; // 保持原格式不变
              } else if (trimmedLine.startsWith("-")) {
                // 如果是单破折号，转换为双破折号
                return `--${trimmedLine.slice(1).trim()}`;
              }
              return line;
            })
            .join("\n")
        }\n${imageFileName}\n\n`;

        contentSegments.set(para.index, updatedContent);

        const sortedContent = Array.from(contentSegments.entries())
          .sort(([a], [b]) => a - b)
          .map(([_, content]) => content)
          .join("");

        console.log(
          `[内容更新] 段落 ${para.index + 1} 的内容已更新并触发显示更新`
        );

        await Promise.resolve(onImagePrompt(sortedContent));
      } else {
        throw new Error(imageResponse.error);
      }
    } catch (error) {
      console.error(`[错误处理] 段落 ${para.index + 1} 处理失败:`, error);

      const errorResult = handleOpenAIError(error);
      const errorContent = `段落${para.index + 1}\n${
        para.text
      }\n【绘图需求】：\n${para.imagePrompt}\n> Error: ${
        errorResult.error
      }\n\n`;

      contentSegments.set(para.index, errorContent);

      const sortedContent = Array.from(contentSegments.entries())
        .sort(([a], [b]) => a - b)
        .map(([_, content]) => content)
        .join("");

      await Promise.resolve(onImagePrompt(sortedContent));
    }
  });

  console.log("\n[Phase 3] 等待所有并行操作完成...");
  await Promise.all(insertPromises);
  console.log("\n=== Coloring Book Hero 处理完成 ===\n");

  return Array.from(contentSegments.entries())
    .sort(([a], [b]) => a - b)
    .map(([_, content]) => content)
    .join("");
}

// JSON 解析和验证的辅助函数
async function parseAndValidateJSON(jsonString: string): Promise<any> {
  try {
    console.debug("原始输入:", jsonString);

    // 第一步：标准化处理
    let preprocessed = jsonString
      // 移除 BOM 和不可见字符
      .replace(/^\uFEFF/, "")
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      // 标准化空白字符
      .replace(/\s+/g, " ")
      .trim();

    // 第二步：特殊字符预处理
    preprocessed = preprocessed
      // 处理省略号（包括中文、日文和连续的点）
      .replace(/[…．．．...]{1,}/g, "...")
      // 处理引号
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");

    console.debug("基础预处理后:", preprocessed);

    try {
      return JSON.parse(preprocessed);
    } catch (firstError) {
      console.debug("基础预处理解析失败，进行深度修复");

      // 第三步：深度修复
      let fixedJson = preprocessed;

      // 处理 prompt 字段
      if (fixedJson.includes('"prompt"')) {
        const promptRegex = /"prompt"\s*:\s*"([^"]*)"/;
        const match = fixedJson.match(promptRegex);

        if (match) {
          const originalPrompt = match[1];
          const cleanPrompt = originalPrompt
            // 转义特殊字符
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t")
            // 处理省略号
            .replace(/…/g, "...")
            .replace(/．{3,}/g, "...")
            .replace(/\.{3,}/g, "...")
            // 移除可能导致问题的不可见字符
            .replace(/[\u200B-\u200D\uFEFF]/g, "")
            // 处理其他特殊字符
            .replace(/[^\x20-\x7E\u4E00-\u9FFF]/g, "");

          fixedJson = fixedJson.replace(
            promptRegex,
            `"prompt":"${cleanPrompt}"`
          );
        }
      }

      // 修复常见的 JSON 格式问题
      fixedJson = fixedJson
        // 修复数字值
        .replace(/"n"\s*:\s*"(\d+)"/g, '"n":$1')
        // 修复尺寸格式
        .replace(/"size"\s*:\s*"([^"]+)"/g, (_match, size) => {
          const validSizes = [
            "256x256",
            "512x512",
            "1024x1024",
            "1024x1792",
            "1792x1024",
          ];
          size = size.replace(/\s+/g, "");
          return validSizes.includes(size)
            ? `"size":"${size}"`
            : `"size":"1024x1024"`;
        })
        // 清理多余的逗号和空格
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/([{,])\s+/g, "$1")
        .replace(/\s+([}])/g, "$1");

      console.debug("深度修复后:", fixedJson);

      try {
        const parsed = JSON.parse(fixedJson);
        console.debug("成功解析:", parsed);
        return parsed;
      } catch (secondError) {
        // 收集错误信息
        const errorContext = {
          original: jsonString,
          preprocessed,
          fixed: fixedJson,
          firstError,
          secondError,
        };
        console.debug("JSON 解析失败上下文:", errorContext);

        // 使用 JSONParseError 抛出错误
        throw new JSONParseError(
          secondError instanceof Error
            ? secondError.message
            : "未知的 JSON 解析错误",
          fixedJson
        );
      }
    }
  } catch (error) {
    // 统一交给 handleOpenAIError 处理
    throw handleOpenAIError(error);
  }
}

// 构建图片提示词的辅助函数
function buildImagePrompts(finalPromptText: string, size: string, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const sceneIndex = i + 1;

    const extractSceneContent = (text: string, index: number): string => {
      // 提取通用内容（故事背景和角色特征）
      const commonContent = text.split(/第[一二三四五六七八九十]幅/)[0].trim();

      // 提取当前场景内容
      const sceneMarker = `第${
        ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"][index - 1]
      }幅`;
      const sceneRegex = new RegExp(
        `${sceneMarker}([^]*?)(?=第[一二三四五六七八九十]幅|$)`
      );
      const match = text.match(sceneRegex);
      const currentScene = match ? match[1].trim() : "";

      // 组合最终内容
      return `${commonContent}\n\n核心绘图内容：\n${sceneMarker}\n${currentScene}`;
    };

    const sceneContent = extractSceneContent(finalPromptText, sceneIndex);
    const fullPrompt = `${sceneContent}\n\n绘图要求：
    • 仅绘制当前子场景中提到的角色
    • 其他角色特征仅供参考，未提及则忽略
    
    当前指令：聚焦绘制第${sceneIndex}幅子场景`;

    return {
      prompt: fullPrompt,
      size,
    };
  });
}

// 主函数重构后的版本
export async function createRunGptsTomlCommand(command: Command) {
  return async (b: IHookEvent) => {
    try {
      // 获取和验证设置
      const openAISettings = await ResourceOptimizer.getResource(
        "openai-settings"
      );
      await validateSettings(openAISettings);

      // 获取和验证当前块
      const currentBlock = await logseq.Editor.getBlock(b.uuid);
      if (!currentBlock) {
        throw new Error("No current block");
      }

      if (currentBlock.content.trim().length === 0) {
        showMessage("Empty Content", "warning");
        console.warn("Blank page");
        return;
      }

      // 内容验证
      try {
        await validateContent(currentBlock.content);
      } catch (error: any) {
        if (error.type) {
          let message = error.message;
          if (message.includes("----")) {
            message = message.split("----")[0].trim();
          }
          showMessage(message, error.level === "extreme" ? "error" : "warning");
          return;
        }
        throw error;
      }

      // 初始化结果
      let result = "";
      const insertBlock = await logseq.Editor.insertBlock(
        currentBlock.uuid,
        result,
        {
          sibling: false,
        }
      );

      const finalPrompt = command.prompt + currentBlock.content;

      // 根据命令类型选择处理流程
      if (command.isParseJson) {
        // 处理 JSON 解析流程
        let fullResponse = "";
        await openAIWithStreamGptsToml(
          finalPrompt,
          openAISettings,
          async (content: string) => {
            result += content;
            fullResponse += content;
            if (insertBlock) {
              await logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          },
          () => {},
          async () => {
            const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
            if (jsonMatch) {
              result = await handleColoringBookHero2(
                jsonMatch[1].trim(),
                insertBlock,
                result,
                openAISettings
              );
            }
          }
        );
      } else {
        // 处理普通图片生成流程
        result = await handleColoringBookHero(
          finalPrompt,
          openAISettings,
          (content: string) => {
            result += content;
            if (insertBlock) {
              logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          },
          (content: string) => {
            result = content;
            if (insertBlock) {
              logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          },
          () => {}
        );
      }

      if (!result) {
        showMessage("No OpenAI content", "warning");
        return;
      }
    } catch (error: any) {
      console.error("执行错误:", error);
      handleOpenAIError(error);
    }
  };
}

// 修改并行处理部分
async function processImagesSequentially(
  imagePrompts: Array<{ prompt: string; size: string }>,
  openAISettings: OpenAIOptions,
  insertBlock: any,
  currentResult: string
) {
  // 定义结果类型
  interface ImageResult {
    success: boolean;
    index: number;
    fileName?: string;
    error?: string;
  }

  // 并行生成所有图片
  const imagePromises = imagePrompts.map(async (prompt, index) => {
    try {
      console.log(
        `\n准备第${index + 1}幅场景的提示词：\n`,
        JSON.stringify(
          {
            prompt: prompt.prompt,
            size: prompt.size,
            n: 1,
          },
          null,
          2
        )
      );

      const imageUrl = await dallE_gptsToml(
        prompt.prompt,
        openAISettings,
        prompt.size
      );

      if ("url" in imageUrl) {
        const imageFileName = await saveDalleImage(imageUrl.url);
        return {
          success: true,
          index,
          fileName: imageFileName,
        } as ImageResult;
      } else {
        return {
          success: false,
          index,
          error: imageUrl.error,
        } as ImageResult;
      }
    } catch (error) {
      console.error(`第 ${index + 1} 幅图片处理错误:`, error);
      return {
        success: false,
        index,
        error: error instanceof Error ? error.message : "未知错误",
      } as ImageResult;
    }
  });

  // 等待所有图片生成完成
  const results = await Promise.all(imagePromises);
  const processedImages: Array<string | null> = new Array(
    imagePrompts.length
  ).fill(null);

  // 按顺序处理结果
  for (const result of results.sort((a, b) => a.index - b.index)) {
    if (result.success && result.fileName) {
      processedImages[result.index] = `${result.fileName}`;
      // 按顺序更新显示
      const validImages = processedImages.filter(
        (img): img is string => img !== null
      );
      const updatedResult = `${currentResult}\n${validImages.join("")}`;
      if (insertBlock) {
        await logseq.Editor.updateBlock(insertBlock.uuid, updatedResult);
      }
      console.log(
        `第 ${result.index + 1}/${imagePrompts.length} 幅图片插入完成\n`
      );
    } else {
      console.error(
        `第 ${result.index + 1} 幅图片生成失败，详细错误：`,
        result.error
      );
      const error = new Error(
        result.error?.includes("safety system")
          ? "由于安全系统的限制，您的请求被拒绝。提示词中可能包含不被允许的内容。请修改后重试。"
          : result.error || `第 ${result.index + 1} 张图片生成失败`
      );
      const errorResult = handleOpenAIError(error);
      processedImages[result.index] = `\n${errorResult.error}\n`;
    }
  }

  return processedImages.filter((img): img is string => img !== null);
}

export async function runDalleBlock(b: IHookEvent) {
  const openAISettings = getOpenaiSettings();
  await validateSettings(openAISettings);

  const currentBlock = await logseq.Editor.getBlock(b.uuid);
  if (!currentBlock) {
    console.error("No current block");
    return;
  }

  if (currentBlock.content.trim().length === 0) {
    showMessage("Empty Content", "warning");
    console.warn("Blank block");
    return;
  }

  try {
    // 添加内容检查
    await validateContent(currentBlock.content);

    const imageURL = await dallE(currentBlock.content, openAISettings);
    if (!imageURL) {
      showMessage("No Dalle results.", "warning");
      return;
    }
    const imageFileName = await saveDalleImage(imageURL);
    await logseq.Editor.insertBlock(currentBlock.uuid, imageFileName, {
      sibling: false,
    });
  } catch (e: any) {
    handleOpenAIError(e);
  }
}

export async function runWhisper(b: IHookEvent) {
  const currentBlock = await logseq.Editor.getBlock(b.uuid);
  if (currentBlock) {
    const audioFile = await getAudioFile(currentBlock.content);
    if (!audioFile) {
      showMessage("No supported audio file found in block.", "warning");
      return;
    }
    const openAISettings = getOpenaiSettings();
    try {
      const transcribe = await whisper(audioFile, openAISettings);
      if (transcribe) {
        await logseq.Editor.insertBlock(currentBlock.uuid, transcribe);
      }
    } catch (e: any) {
      handleOpenAIError(e);
    }
  }
}

//test增加

export async function runReadImageURL(b: IHookEvent) {
  const currentBlock = await logseq.Editor.getBlock(b.uuid);
  if (currentBlock) {
    const imageUrl = await getImageUrlFromBlock(currentBlock.content);
    if (!imageUrl) {
      showMessage("No valid image URL found in block.", "warning");
      return;
    }

    const openAISettings = getOpenaiSettings();

    // 判断是远程图片链接还是本图片径
    const isRemoteUrl =
      imageUrl.startsWith("http://") || imageUrl.startsWith("https://");

    try {
      let description: string | null = null;

      if (isRemoteUrl) {
        // 如果远程图片链接，调用 readImageURL
        description = await readImageURL(imageUrl, openAISettings);
      } else {
        // 如果是本图片路径调用 readLocalImageURL
        description = await readLocalImageURL(imageUrl, openAISettings);
      }

      if (description) {
        await logseq.Editor.insertBlock(currentBlock.uuid, description);
      }
    } catch (e: any) {
      handleOpenAIError(e);
    }
  }
}

// 添加格式化 JSON 的函数
function formatJsonString(jsonObj: any): string {
  if (jsonObj.prompt) {
    const formattedPrompt = jsonObj.prompt
      .replace(/\r\n/g, "\n")
      // 确保"角色特征："前有换行，并处理角色描述格式
      .replace(
        /(.*?)(角色特征：)([^]*?)(子场景)/g,
        (
          _: string,
          prefix: string,
          start: string,
          content: string,
          end: string
        ): string => {
          // 1. 移除内容开头的空白
          const trimmedContent = content.trim();
          // 2. 处理角色描述，确保每行正确缩进
          const formattedContent = trimmedContent
            .split("--")
            .map((item: string): string =>
              item.trim() ? `    --${item.trim()}` : ""
            )
            .filter(Boolean)
            .join("\n");
          // 3. 确保前缀内容后有换行，移除子场景前的多余换行
          return `${prefix}\n${start}\n${formattedContent}\n${end}`;
        }
      )
      // 其他格式化保持不变
      .replace(/(故事背景|场景展示|绘图风格|核心场景|背景)：/g, "\n$1：")
      .replace(/(第[一二三四五六七八九十]幅)/g, "\n$1")
      .replace(/\n\n+/g, "\n\n")
      .replace(/^\n+/, "")
      .split("\n")
      .map((line: string) => line.trim())
      .join("\n    ");

    // 使用 <pre> 标签包装 JSON 输出
    return `<pre>{
  "prompt": "${formattedPrompt}",
  "size": "${jsonObj.size}",
  "n": ${jsonObj.n}
}</pre>`;
  }
  return JSON.stringify(jsonObj, null, 2);
}

// 主要的绘图需求标记
const PRIMARY_MARKER = "【绘图需求】：";

// 常见完整变体列表
const COMMON_VARIANTS = [
  "【绘需求】：",
  "【绘需求】:",
  "【画图需求】：",
  "【图需求】：",
  "【绘图要求】：",
  "【绘制需求】：",
];

// 处理缺字的正则模式
const FUZZY_PATTERNS = [
  // 处理缺少【】的情况
  /绘[图画]需求[：:]/,
  /画图需求[：:]/,

  // 处理缺少冒号的情况
  /【绘[图画]需求】/,
  /【画图需求】/,

  // 处理缺少部分字的情况
  /【绘[图画]?需求?】[：:]?/,
  /【[绘画图]需求】[：:]?/,
  /【绘制需?求?】[：:]?/,

  // 添加新的模式来处理格式不完整的情况
  /【绘图需求[^】]*】/, // 处理需求后直接跟内容的情况
  /【绘图需求.*?(?=\n|$)/, // 处理缺少结束符的情况

  // 处理更宽松的格式
  /【[绘画图][图需求要求].*?】/,
  /【.*?需求.*?】/,
];

function splitByDrawingPrompt(
  text: string
): { content: string; prompt: string } | null {
  // 1. 检查主要标记
  let parts = text.split(PRIMARY_MARKER);
  if (parts.length >= 2) {
    return {
      content: parts[0].trim(),
      prompt: parts[1].trim(),
    };
  }

  // 2. 检查常见完整变体
  for (const variant of COMMON_VARIANTS) {
    parts = text.split(variant);
    if (parts.length >= 2) {
      return {
        content: parts[0].trim(),
        prompt: parts[1].trim(),
      };
    }
  }

  // 3. 使用模糊匹配处理缺字情况
  for (const pattern of FUZZY_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const marker = match[0];
      // 提取实际的提示词，移除多余的字符并使用清理后的标记进行分割
      const cleanMarker = marker.replace(
        /【绘图需求([^】]*)】/,
        "【绘图需求】：$1"
      );
      const parts = text.split(cleanMarker); // 使用 cleanMarker 替代 marker
      if (parts.length >= 2) {
        return {
          content: parts[0].trim(),
          prompt: parts[1].trim(),
        };
      }
    }
  }

  // 4. 最后的通用模糊匹配
  const generalPattern = /【[绘画图].{0,2}需求】[：:]/;
  const match = text.match(generalPattern);
  if (match) {
    const marker = match[0];
    parts = text.split(marker);
    if (parts.length >= 2) {
      return {
        content: parts[0].trim(),
        prompt: parts[1].trim(),
      };
    }
  }

  return null;
}
