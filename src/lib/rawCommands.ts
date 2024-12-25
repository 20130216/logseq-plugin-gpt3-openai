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

// 新增函数1 for gpts-toml
function parseImageSizeFromPrompt(prompt: string): string | null {
  const match = prompt.match(/(1024x1024|720x1280|1280x720)/);
  return match ? match[0] : null;
}

// 处理 JSON 解析流程的函数
async function handleColoringBookHero2(
  jsonString: string,
  insertBlock: any,
  result: string,
  openAISettings: OpenAIOptions
) {
  try {
    // 清理 JSON 字符串中的特殊字符
    jsonString = jsonString
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
      .replace(/[\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\\"/g, '"')
      .replace(/"{2,}/g, '"')
      .replace(/"\\?"([^"]+)\\?""\s*:/g, '"$1":')
      .trim();

    // 确保是有效的 JSON 对象格式
    if (!jsonString.startsWith("{")) {
      jsonString = "{" + jsonString;
    }
    if (!jsonString.endsWith("}")) {
      jsonString = jsonString + "}";
    }

    // 尝试解析 JSON
    let jsonData = await parseAndValidateJSON(jsonString);

    // 提取和验证必要的属性
    const promptText =
      jsonData.prompt?.toString().trim() ||
      jsonData.text?.toString().trim() ||
      jsonData.description?.toString().trim();

    if (!promptText) {
      throw new JSONParseError("提示词不能为空", jsonString);
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

    // 初始显示 JSON 文档
    result = `提示词：\n\`\`\`json\n${formatJsonString(promptObj)}\n\`\`\`\n`;
    if (insertBlock) {
      await logseq.Editor.updateBlock(insertBlock.uuid, result);
    }

    // 处理图片并更新结果
    const processedImages = await processImagesSequentially(
      imagePrompts,
      openAISettings,
      insertBlock,
      result
    );

    result = `提示词：\n\`\`\`json\n${formatJsonString(
      promptObj
    )}\n\`\`\`\n\n${processedImages.join("\n")}\n`;
    if (insertBlock) {
      await logseq.Editor.updateBlock(insertBlock.uuid, result);
    }

    return result;
  } catch (parseError) {
    console.error("JSON 解析错误:", parseError);
    throw new JSONParseError(
      parseError instanceof Error ? parseError.message : "未知的 JSON 解析错误",
      jsonString
    );
  }
}

// 处理普通图片生成流程的函数
async function handleColoringBookHero(
  finalPrompt: string,
  openAISettings: OpenAIOptions,
  onContent: (content: string) => void,
  onImagePrompt: (imagePrompt: string) => void,
  onStop: () => void
): Promise<string> {
  let paragraphs: { text: string; imagePrompt: string; index: number }[] = [];
  let currentParagraph = "";
  let currentIndex = 0;

  // 收集所有段落
  await openAIWithStreamGptsToml(
    finalPrompt,
    openAISettings,
    async (content: string) => {
      currentParagraph += content;
      if (content.includes("为该段落绘图中，请稍后...")) {
        paragraphs.push({
          text: currentParagraph,
          imagePrompt: currentParagraph
            .replace("为该段落绘图中，请稍后...", "")
            .trim(),
          index: currentIndex++,
        });
        currentParagraph = "";
      }
      await onContent(content);
    },
    () => {},
    onStop
  );

  // 并行生成所有图片
  const imageResults = await Promise.all(
    paragraphs.map(async (para) => {
      console.log(`开始生成第 ${para.index + 1} 个段落的图片`);
      console.log(
        `第 ${para.index + 1} 个段落的绘图提示词:\n`,
        para.imagePrompt
      );

      try {
        const imageResponse = await dallE_gptsToml(
          para.imagePrompt,
          openAISettings,
          "1024x1024"
        );

        if ("url" in imageResponse) {
          const imageFileName = await saveDalleImage(imageResponse.url);
          return {
            index: para.index,
            success: true,
            fileName: imageFileName,
            text: para.text,
          };
        }
        throw new Error("Invalid image response");
      } catch (error) {
        console.error(`第 ${para.index + 1} 个段落的图片生成失败:`, error);
        return {
          index: para.index,
          success: false,
          error,
          text: para.text,
        };
      }
    })
  );

  // 按顺序处理结果
  for (const result of imageResults.sort((a, b) => a.index - b.index)) {
    console.log(`处理第 ${result.index + 1} 个段落的图片结果`);
    if (result.success) {
      await onImagePrompt(
        result.text.replace(
          "\n为该段落绘图中，请稍后...",
          `\n${result.fileName}\n`
        )
      );
    } else {
      const errorResult = handleOpenAIError(result.error);
      await onImagePrompt(
        result.text.replace(
          "\n为该段落绘图中，请稍后...",
          `\n${errorResult.error}\n`
        )
      );
    }
  }

  return currentParagraph;
}

// JSON 解析和验证的辅助函数
async function parseAndValidateJSON(jsonString: string): Promise<any> {
  try {
    return JSON.parse(jsonString);
  } catch (firstError) {
    try {
      // 如果第一次解析失败，尝试进一步修复
      jsonString = jsonString
        .replace(/([{,]\s*)([^"{\s][^:]*?):/g, '$1"$2":')
        .replace(/:\s*([^",{\[\s][^,}\]]*)/g, ':"$1"')
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/"([^"]*)""/g, '"$1"');

      console.debug("修复后的 JSON 字符串:", jsonString);
      return JSON.parse(jsonString);
    } catch (secondError) {
      console.error("JSON 解析详情:", {
        originalString: jsonString,
        firstError,
        secondError,
        cleanedString: jsonString,
      });

      const errorMessage =
        secondError instanceof Error
          ? secondError.message
          : "未知的 JSON 格式错误";

      throw new JSONParseError(`JSON 格式错误: ${errorMessage}`, jsonString);
    }
  }
}

// 构建图片提示词的辅助函数
function buildImagePrompts(finalPromptText: string, size: string, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const sceneIndex = i + 1;
    const fullPrompt = `${finalPromptText}当前指令：绘制第${sceneIndex}幅场景`;

    console.log(
      `\n准备第${sceneIndex}幅场景的提示词：\n`,
      JSON.stringify(
        {
          prompt: fullPrompt,
          size,
          n: 1,
        },
        null,
        2
      )
    );

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
      const imageSize = parseImageSizeFromPrompt(finalPrompt) || "1024x1024";

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
          async (content: string) => {
            result += content;
            if (insertBlock) {
              await logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          },
          async (prompt: string) => {
            if (insertBlock) {
              try {
                const imageResponse = await dallE_gptsToml(
                  prompt,
                  openAISettings,
                  imageSize
                );
                if ("url" in imageResponse) {
                  const imageFileName = await saveDalleImage(imageResponse.url);
                  result = result.replace(
                    "\n为该段落绘图中，请稍后...",
                    `\n${imageFileName}\n`
                  );
                  if (insertBlock) {
                    await logseq.Editor.updateBlock(insertBlock.uuid, result);
                  }
                }
              } catch (error) {
                console.error("图片生成失败:", error);
                const errorResult = handleOpenAIError(error);
                result = result.replace(
                  "\n为该段落绘图中，请稍后...",
                  `\n${errorResult.error}\n`
                );
                if (insertBlock) {
                  await logseq.Editor.updateBlock(insertBlock.uuid, result);
                }
              }
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
        result.error || `第 ${result.index + 1} 张图片生成失败`
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
        // 如果是远程图片链接，调用 readImageURL
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
  // 特殊处理 prompt 字段
  if (jsonObj.prompt) {
    // 添加段落分隔并确保换行符被保留
    const formattedPrompt = jsonObj.prompt
      // 先统一换行符
      .replace(/\r\n/g, "\n")
      // 在主要段落前添加换行
      .replace(
        /(故事背景|场景展示|绘图风格|角色特征|核心场景|背景)：/g,
        "\n$1："
      )
      // 在角色描述前添加换行
      .replace(/( - [^，。：]+)：/g, "\n$1：")
      // 在子场景前添加换行
      .replace(/(第[一二三四五六七八九十]幅)/g, "\n$1")
      // 确保段落之间有足够空行
      .replace(/\n\n+/g, "\n\n")
      // 移除开头的空行
      .replace(/^\n+/, "")
      // 确保每行前面有适当的缩进
      .split("\n")
      .map((line: string) => line.trim())
      .join("\n    "); // 4个空格的缩进

    // 创建格式化的 JSON 字符串
    return `{
  "prompt": "${formattedPrompt}",
  "size": "${jsonObj.size}",
  "n": ${jsonObj.n}
}`;
  }

  // 如果没有 prompt 字段，使用普通格式化
  return JSON.stringify(jsonObj, null, 2);
}
