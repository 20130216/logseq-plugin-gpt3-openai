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

// 10种应用场景的分门别类处理：所有异常最终都会被 runGptBlock 捕获并传递给 handleOpenAIError 函数来处理，那么你只需要在 handleOpenAIError 中分门别类地处理各种异常情况即可。这样可以确保所有的异常处理逻辑集中在一个地方，便于维护和管理。
// 10.26号上午定稿 下午又特意优化了catch处理方式，从固定赋值变成e.message的动态赋值，同时在rawCommands.ts的handleOpenAIError中增加e.name === "DOMException" 和e.message.includes("流超时")额外的异常处理方式;
export function handleOpenAIError(e: any) {
  // JSON 解析错误处理
  if (e instanceof JSONParseError) {
    const message = '提示词格式错误: ' + (e.message || '请检查命令模板');
    showMessage(message, 'warning');
    console.debug('JSON 解析错误详情:', {
      message: e.message,
      jsonString: e.jsonString,
      stack: e.stack
    });
    return { error: message };
  }

  if (e instanceof SyntaxError && e.message.includes('JSON')) {
    const message = '提示词格式无效: ' + e.message;
    showMessage(message, 'warning');
    console.debug('JSON 语法错误:', e);
    return { error: message };
  }

  // 先处理已知的特定错误类型
  if (e instanceof JSONParseError) {
    const message = '提示词格式错误，请检查命令模板';
    showMessage(message, 'warning');
    console.debug('JSON 解析错误详情:', e.jsonString);
    return { error: message };
  }

  // 图片生成相关错误
  if (e.message?.includes('image generation') || e.message?.includes('DALL-E')) {
    showMessage('图片生成失败，请稍后重试', 'error');
    return { error: '图片生成失败' };
  }

  // 图片保存错误
  if (e.message?.includes('saving image') || e.message?.includes('file system')) {
    showMessage('图片保存失败，请检查权限', 'error');
    return { error: '图片保存失败' };
  }

  // 内容审核错误
  if (e.type && e.message) {
    const severity = e.level === 'extreme' ? 'error' 
                  : e.level === 'mild' ? 'warning' 
                  : 'warning';
    const message = e.message + (e.words ? ` ------"${e.words.join('", "')}"` : '');
    showMessage(message, severity);
    return { error: message };
  }

  // API 错误
  if (e.error?.type && e.error?.message) {
    showMessage(e.error.message, 'error');
    return { error: e.error.message };
  }

  // 未知但有类型和消息的错误
  if (typeof e === 'object' && e !== null && e.type && e.message) {
    showMessage(e.message, 'error');
    return { error: e.message };
  }

  // API 密钥相关错误
  if (e.message?.includes('API key')) {
    showMessage('API 密钥无效或未设置，请检查您的 API 密钥配置！', 'error');
    return { error: 'API 密钥无效或未设置' };
  }

  // 配额错误
  if (e.message?.includes('insufficient_quota')) {
    showMessage('API 使用额度已耗尽，请检查您的账户余额！', 'error');
    return { error: 'API 使用额度已耗尽' };
  }

  // 网络错误
  if (e instanceof TypeError && e.message === 'Failed to fetch') {
    showMessage('网络连接失败，请检查网络连接！', 'error');
    return { error: '网络连接失败' };
  }

  // 超时错误
  if (e.name === 'AbortError' || e.name === 'TimeoutError') {
    showMessage('请求超时，请稍后重试', 'error');
    return { error: '请求超时' };
  }

  // 用户取消
  if (e.name === 'DOMException' && e.message.includes('The user aborted a request')) {
    showMessage('用户取消了请求', 'warning');
    return { error: '用户取消请求' };
  }

  // 流处理错误
  if (e.message?.includes('流超时') || e.message?.includes('stream timeout')) {
    showMessage('响应流处理超时，请重试', 'error');
    return { error: '流处理超时' };
  }

  // 标准 Error 实例
  if (e instanceof Error) {
    showMessage(e.message, 'error');
    return { error: e.message };
  }

  // 有消息的未知错误
  if (e.message) {
    showMessage(e.message, 'error');
    return { error: e.message };
  }

  // 完全未知的错误
  console.error('Unexpected error:', e);
  showMessage('发生未知错误，请稍后重试', 'error');
  return { error: '未知错误' };
}

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

// 增函数2 for gpts-toml
export async function createRunGptsTomlCommand(command: Command) {
  return async (b: IHookEvent) => {
    try {
      const openAISettings = getOpenaiSettings();
      await validateSettings(openAISettings);

      const currentBlock = await logseq.Editor.getBlock(b.uuid);
      if (!currentBlock) {
        throw new Error("No current block");
      }

      if (currentBlock.content.trim().length === 0) {
        showMessage("Empty Content", "warning");
        console.warn("Blank page");
        return;
      }

      // 修改内容检查的处理方式
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

      // 只有内容检查通过才继续执行
      let result = "";
      let pendingImagePrompts = new Map<string, string>();

      const insertBlock = await logseq.Editor.insertBlock(
        currentBlock.uuid,
        result,
        {
          sibling: false,
        }
      );

      const finalPrompt = command.prompt + currentBlock.content;
      const imageSize = parseImageSizeFromPrompt(finalPrompt) || "1024x1024";

      // 收集完整响应
      let fullResponse = "";

      const onContent = async (content: string) => {
        result += content;
        fullResponse += content;
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      };

      // 新增判断：是否需要解析 JSON 文本
      const isParseJson = command.isParseJson;

      const onImagePrompt = async (imagePrompt: string) => {
        if (isParseJson) return;

        const placeholder = "为该段落绘图中，请稍后...\n";
        pendingImagePrompts.set(imagePrompt, placeholder);

        const maxPromptLength = 1000;
        let truncatedPrompt = imagePrompt;
        if (imagePrompt.length > maxPromptLength) {
          truncatedPrompt = imagePrompt.substring(0, maxPromptLength);
          console.warn(
            `Prompt length truncated to ${maxPromptLength} characters.`
          );
        }

        const imageResponse = await dallE_gptsToml(
          truncatedPrompt,
          openAISettings,
          imageSize
        );

        if ("url" in imageResponse) {
          try {
            const imageFileName = await saveDalleImage(imageResponse.url);
            result = result.replace(placeholder, `${imageFileName}\n`);
            if (insertBlock) {
              await logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          } catch (error) {
            console.error("Failed to save image:", error);
            result = result.replace(placeholder, "图片保存失败\n");
            if (insertBlock) {
              await logseq.Editor.updateBlock(insertBlock.uuid, result);
            }
          }
        } else {
          console.error("Failed to generate image:", imageResponse.error);
          result = result.replace(placeholder, "图片生成失败\n");
          if (insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
        }
        pendingImagePrompts.delete(imagePrompt);
      };

      const onStop = async () => {
        console.log("Processing completed.");
        try {
          if (!result) {
            await openAIWithStreamGptsToml(
              finalPrompt,
              openAISettings,
              onContent,
              onImagePrompt,
              onStop
            );
            return;
          }

          const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch && isParseJson) {
            let jsonString = jsonMatch[1].trim();
            console.log("原始完整提示词:", jsonString);

            try {
              // 清理 JSON 字符串中的特殊字符
              jsonString = jsonString
                // 移除不可见字符
                .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
                // 处理换行符和制表符
                .replace(/[\r\n\t]/g, ' ')
                // 处理多余的空格
                .replace(/\s+/g, ' ')
                // 处理错误的转义引号
                .replace(/\\"/g, '"')
                // 处理多余的引号
                .replace(/"{2,}/g, '"')
                // 处理属性名中多余的引号
                .replace(/"\\?"([^"]+)\\?""\s*:/g, '"$1":')
                // 移除开头和结尾的空格
                .trim();

              // 确保是有效的 JSON 对象格式
              if (!jsonString.startsWith('{')) {
                jsonString = '{' + jsonString;
              }
              if (!jsonString.endsWith('}')) {
                jsonString = jsonString + '}';
              }

              // 尝试解析 JSON
              let jsonData;
              try {
                jsonData = JSON.parse(jsonString);
              } catch (firstError) {
                try {
                  // 如果第一次解析失败，尝试进一步修复
                  jsonString = jsonString
                    // 修复属性名格式
                    .replace(/([{,]\s*)([^"{\s][^:]*?):/g, '$1"$2":')
                    // 修复属性值格式
                    .replace(/:\s*([^",{\[\s][^,}\]]*)/g, ':"$1"')
                    // 修复多余的逗号
                    .replace(/,\s*([}\]])/g, '$1')
                    // 修复错误的引号嵌套
                    .replace(/"([^"]*)""/g, '"$1"');

                  console.debug('修复后的 JSON 字符串:', jsonString);
                  jsonData = JSON.parse(jsonString);
                } catch (secondError) {
                  console.error('JSON 解析详情:', {
                    originalString: jsonString,
                    firstError,
                    secondError,
                    cleanedString: jsonString
                  });
                  
                  const errorMessage = secondError instanceof Error 
                    ? secondError.message 
                    : '未知的 JSON 格式错误';
                    
                  throw new JSONParseError(
                    `JSON 格式错误: ${errorMessage}`,
                    jsonString
                  );
                }
              }

              // 验证和处理解析后的数据
              if (!jsonData || typeof jsonData !== 'object') {
                throw new JSONParseError('解析结果不是有效的 JSON 对象', jsonString);
              }

              // 提取和验证必要的属性
              const promptText = jsonData.prompt?.toString().trim() || 
                                jsonData.text?.toString().trim() || 
                                jsonData.description?.toString().trim();

              if (!promptText) {
                throw new JSONParseError('提示词不能为空', jsonString);
              }

              // 构建标准化的对象并显示
              const promptObj = {
                prompt: promptText,
                size: (jsonData.size?.toString() || '1024x1024').trim(),
                n: Math.min(Math.max(1, parseInt(String(jsonData.n || 1), 10)), 10)
              };

              // 先解构获取 n
              const { prompt: finalPromptText, size, n } = promptObj;
              console.log(`计划生成 ${n} 幅图片`);

              // 然后再使用 n 显示进度
              result = `提示词：\n\`\`\`json\n${formatJsonString(promptObj)}\n\`\`\`\n\n准备生成 ${n} 幅图片...\n`;
              if (insertBlock) {
                await logseq.Editor.updateBlock(insertBlock.uuid, result);
              }

              // 构建所有图片的提示词
              const imagePrompts = Array.from({ length: n }, (_, i) => ({
                prompt: `${finalPromptText}，本指令：绘制第${i + 1}幅子场景`,
                size
              }));

              // 并行处理
              const processedResults = await Promise.allSettled(
                imagePrompts.map(async ({prompt, size}) => {
                  const imageUrl = await dallE_gptsToml(prompt, openAISettings, size);
                  if ("url" in imageUrl) {
                    const imageFileName = await saveDalleImage(imageUrl.url);
                    return { success: true, fileName: imageFileName };
                  }
                  return { success: false, error: imageUrl.error };
                })
              );

              // 处理结果时保持 JSON 文档
              const processedImages = processedResults.map((result, index) => {
                if (result.status === 'fulfilled' && result.value.success) {
                  console.log(`第 ${index + 1}/${n} 幅图片生成完成`);
                  return result.value.fileName;
                } else {
                  const error = result.status === 'fulfilled' ? result.value.error : result.reason;
                  console.error(`第 ${index + 1} 幅图片生成失败:`, error);
                  handleOpenAIError(new Error(error));
                  return `第 ${index + 1} 张图片生成失败`;
                }
              }).filter(Boolean);

              // 更新最终结果，保持 JSON 文档在最上方
              result = `提示词：\n\`\`\`json\n${formatJsonString(promptObj)}\n\`\`\`\n\n${processedImages.join("\n")}\n`;
              if (insertBlock) {
                await logseq.Editor.updateBlock(insertBlock.uuid, result);
              }
            } catch (parseError) {
              console.error("JSON 解析错误:", parseError);
              handleOpenAIError(new JSONParseError(
                parseError instanceof Error ? parseError.message : "未知的 JSON 解析错误",
                jsonString
              ));
            }
          } else {
            await handleRegularTextResponse();
          }
        } catch (error) {
          console.error("onStop 执行错误:", error);
          handleOpenAIError(error);
        }
      };

      // 处理常规文本响应的辅助函数
      const handleRegularTextResponse = async () => {
        if (!result) {
          // 如果没有结果，尝试重新发送请求
          await openAIWithStreamGptsToml(
            finalPrompt,
            openAISettings,
            onContent,
            onImagePrompt,
            onStop
          );
          return;
        }
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      };

      await openAIWithStreamGptsToml(
        finalPrompt,
        openAISettings,
        onContent,
        onImagePrompt,
        onStop
      );
    } catch (error) {
      console.error("执行错误:", error);
      handleOpenAIError(error);
    }
  };
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
      .replace(/\r\n/g, '\n')
      // 在主要段落前添加换行
      .replace(/(故事背景|场景展示|绘图风格|角色特征|核心场景|背景)：/g, '\n$1：')
      // 在角色描述前添加换行
      .replace(/( - [^，。：]+)：/g, '\n$1：')
      // 在子场景前添加换行
      .replace(/(第[一二三四五六七八九十]幅)/g, '\n$1')
      // 确保段落之间有足够空行
      .replace(/\n\n+/g, '\n\n')
      // 移除开头的空行
      .replace(/^\n+/, '')
      // 确保每行前面有适当的缩进
      .split('\n')
      .map((line: string) => line.trim())
      .join('\n    ');  // 4个空格的缩进

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
