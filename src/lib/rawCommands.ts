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

// 10种应用场景的分门别类处理：所有异常最终都会被 runGptBlock 捕获并传递给 handleOpenAIError 函数来处理，那么你只需要在 handleOpenAIError 中分门别类地处理各种异常情况即可。这样可以确保所有的异常处理逻辑集中在一个地方，便于维护和管理。
// 10.26号上午定稿 下午又特意优化了catch处理方式，从固定赋值变成e.message的动态赋值，同时在rawCommands.ts的handleOpenAIError中增加e.name === "DOMException" 和e.message.includes("流超时")两种额外的异常处理方式;
export function handleOpenAIError(e: any) {
  let errorMessage = "";

  // 首先处理最常见的API密钥和额度相关错误
  if (e.message && e.message.includes("API key")) {
    console.error("API key error:", e.message);
    showMessage("API 密钥无效或未设置，请检查您的 API 密钥配置！", "error");
    return { error: "API 密钥无效或未设置，请检查您的 API 密钥配置！" };
  }

  if (e.message && e.message.includes("insufficient_quota")) {
    console.error("API quota exceeded:", e.message);
    showMessage("API 使用额度已耗尽，请检查您的账户余额！", "error");
    return { error: "API 使用额度已耗尽，请检查您的账户余额！" };
  }

  // 网络相关错误
  if (e instanceof TypeError && e.message === "Failed to fetch") {
    console.error(`Network error: ${e.message}`);
    showMessage(
      "网络连接失败或 API 配置有问题，请检查您的网络连接或 API 配置！",
      "error"
    );
    errorMessage =
      "网络连接失败或 API 配置有问题，请检查您的网络连接或 API 配置！";
  } else if (e.name === "AbortError" || e.name === "TimeoutError") {
    console.error(`Request timeout: ${e.message}`);
    showMessage("请求超时，请检查网络连接并稍后重试！", "error");
    errorMessage = "请求超时，请检查网络连接并稍后重试！";
  } else if (
    e.name === "DOMException" &&
    e.message.includes("The user aborted a request")
  ) {
    console.error(`User aborted request: ${e.message}`);
    showMessage("用户取消了请求", "warning");
    errorMessage = "用户取消了请求";
  }

  // API响应错误
  else if (e instanceof Error) {
    if (e.message.includes("Unexpected Content-Type")) {
      console.error(`Content-Type error: ${e.message}`);
      showMessage("API 返回了不正确的内容类型，请检查 API 端点配置！", "error");
      errorMessage = "API 返回了不正确的内容类型，请检查 API 端点配置！";
    } else if (e.message.includes("Unexpected data format")) {
      console.error(`Data parsing error: ${e.message}`);
      showMessage("数据解析错误，请检查 API 返回的数据格式！", "error");
      errorMessage = "数据解析错误，请检查 API 返回的数据格式！";
    } else if (e.message.includes("stream timeout")) {
      console.error(`Stream timeout: ${e.message}`);
      showMessage("流式响应超时，请检查网络连接并稍后重试！", "error");
      errorMessage = "流式响应超时，请检查网络连接并稍后重试！";
    } else if (e.message === "未生成图像") {
      console.error(`Image generation error: ${e.message}`);
      showMessage("图像生成失败，请检查输入或 API 配置！", "error");
      errorMessage = "图像生成失败，请检查输入或 API 配置！";
    } else {
      console.error(`General error: ${e.message}`);
      showMessage(`发生错误：${e.message}，请根据错误信息排查问题！`, "error");
      errorMessage = `发生错误：${e.message}，请根据错误信息排查问题！`;
    }
  }

  // HTTP状态码错误
  else if (e.response?.status) {
    const httpStatus = e.response.status;
    const errorDetail =
      e.response.data?.error?.message || e.response.statusText;

    switch (httpStatus) {
      case 401:
        console.error("Authentication error:", errorDetail);
        showMessage("认证失败，请检查 API 密钥！", "error");
        errorMessage = "认证失败，请检查 API 密钥！";
        break;
      case 429:
        console.warn("Rate limit exceeded:", errorDetail);
        showMessage(
          "请求频率超限或额度不足，请降低请求频率或检查账户额度！",
          "warning"
        );
        errorMessage = "请求频率超限或额度不足，请降低请求频率或检查账户额度！";
        break;
      case 400:
        console.error("Bad request:", errorDetail);
        showMessage(`请求参数错误：${errorDetail}`, "error");
        errorMessage = `请求参数错误：${errorDetail}`;
        break;
      case 500:
      case 502:
      case 503:
        console.error(`Server error (${httpStatus}):`, errorDetail);
        showMessage("OpenAI 服务器暂时不可用，请稍后重试！", "error");
        errorMessage = "OpenAI 服务器暂时不可用，请稍后重试！";
        break;
      default:
        console.error(`HTTP error ${httpStatus}:`, errorDetail);
        showMessage(`请求失败 (HTTP ${httpStatus}): ${errorDetail}`, "error");
        errorMessage = `请求失败 (HTTP ${httpStatus}): ${errorDetail}`;
    }
  }

  // 未知错误
  else {
    console.error("Unknown error:", e);
    showMessage("发生未知错误，请检查控制台日志并稍后重试！", "error");
    errorMessage = "发生未知错误，请检查控制台日志并稍后重试！";
  }

  return { error: errorMessage };
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
  // 在获取设置之前，先打印完整的 logseq.settings 内容
  console.log("完整的设置内容:", logseq.settings);

  const openAISettings = getOpenaiSettings();

  // 印实际使用的配置
  console.log("实际使用的配置:", {
    apiKey: openAISettings.apiKey
      ? `${openAISettings.apiKey.substring(0, 10)}...`
      : "undefined",
    completionEngine: openAISettings.completionEngine,
    chatCompletionEndpoint: openAISettings.chatCompletionEndpoint,
    // 添加其他相关配置...
  });

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
    let result = "";
    // { sibling: false } 表示插入的新块是当前块的子块，而不是同级块。
    const insertBlock = await logseq.Editor.insertBlock(
      currentBlock.uuid,
      result,
      {
        sibling: false,
      }
    );

    if (openAISettings.injectPrefix && result.length == 0) {
      // 确保在后续内容生成之前，前缀已经被加到 result 中，比如 injectPrefix 被设置为：“#Gpt4o”
      result = openAISettings.injectPrefix + result;
    }

    // 定义一个异步回调函数 async (content: string) => {...}：，接收 content 参数，表示从 OpenAI API 获取的内容。
    // 内容回调函数，每当从 OpenAI API 获取到一部分内容时，会调用这个函数。
    // 这个函数负责将获取到的内容拼接到 result 中，并更新插入的新块的内容。
    // =>：箭头函数的语法，用于定义匿名函数；例如：async (content: string) => {...} 表示一个异步箭头函数，接收 content 参数
    // 更新块的内容：将从 OpenAI API 获取的内容逐步拼接到 result 中，更新插入的新块的内容。
    // 确保 result 的值：即使 content 为 null 或 undefined，也不会影响 result 的拼接。
    // await openAIWithStream(currentBlock.content, openAISettings, async (content: string) => {...}, () => {});：
    // 调用 openAIWithStream 函数，传入当前块的内容、设置、内容回调和停止回调。

    // currentBlock.content：这是用户输入的内容，作为请求的一部分传递给 OpenAI API。
    // async (content: string) => {...}：这里的 content 是从 OpenAI API 响应中获取的内容块，是逐步递增动态完善的 content，每读取到一个新的数据块，都会调用这个回调函数，将新的内容块拼接到 result 中。

    //## openAIWithStream 函数：负责与 OpenAI API 交互，处理流式响应，并逐步拼接结果。
    //## openAIWithStream 函数的主要作用是将当前内容 currentBlock.content 传入 OpenAI API，通过 async (content: string) => {...} 响应之后，递归调用返回结果，分步更新块内容。
    //## async (content: string) => {...}：内容回调函数，用于处理从 OpenAI API 获取到的内容。
    // 内容回调：将从 OpenAI API 获取的内容逐步拼接到 result 中，并更新插入的新块。
    // () => {}：停止回调函数，当流读取完成后会调用这个函数。
    await openAIWithStream(
      currentBlock.content,
      openAISettings,
      async (content: string) => {
        // 将 content 拼接到 result 中；如果 content 为 null 或 undefined，则使用空字符串 ""
        // 这是在内容回调函数中使用的 result，用于拼接从 OpenAI API 响应中获取的内容块。
        result += content || "";
        if (null != insertBlock) {
          // 更新插入的新块的内容：result：拼接后的最终内容；await 关键字表示等待 logseq.Editor.updateBlock 完成后再继续执行后续代码。
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
    handleOpenAIError(e); // 所有异常处理逻辑集 handleOpenAIError 函数中
  }
}

export async function runGptPage(b: IHookEvent) {
  const openAISettings = getOpenaiSettings();
  await validateSettings(openAISettings);

  const pageContents = await getPageContentFromBlock(b.uuid);
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
}

export async function runGptsID(
  b: IHookEvent,
  gptsID: string,
  commandName: string
) {
  // 获取用户在设置窗口中自定义的值；此前在main.tsx中已经通过logseq.useSettingsSchema(settingsSchema);进行了插件初始化时的默认设置
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
    let result = "";
    const insertBlock = await logseq.Editor.insertBlock(
      currentBlock.uuid,
      result,
      {
        sibling: false,
      }
    );

    const newPrefix = `OpenAI GPTs：${commandName}\n`; // 新增：构建新的前缀
    if (openAISettings.injectPrefix && result.length === 0) {
      result = openAISettings.injectPrefix + newPrefix; // 修改：将新缀加入到现有前缀之后
    } else {
      result = newPrefix; // 如果没有现有前缀，直接使用新前缀
    }
    // gpts: gptsID 会覆盖 openAISettings 中同名的属性。
    await openAIWithStreamGptsID(
      currentBlock.content,
      { ...openAISettings, gpts: gptsID },
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
  } catch (e: any) {
    console.error("Error in runGptsID:", e);
    handleOpenAIError(e);
  }
}

// 新增函数1 for gpts-toml
function parseImageSizeFromPrompt(prompt: string): string | null {
  const match = prompt.match(/(1024x1024|720x1280|1280x720)/);
  return match ? match[0] : null;
}

// 新增函数2 for gpts-toml
/* export async function createRunGptsTomlCommand(command: Command) {
  return async (b: IHookEvent) => {
    const openAISettings = getOpenaiSettings();
    validateSettings(openAISettings);

    const currentBlock = await logseq.Editor.getBlock(b.uuid);
    if (!currentBlock) {
      console.error("No current block");
      return;
    }

    if (currentBlock.content.trim().length === 0) {
      logseq.App.showMsg("Empty Content", "warning");
      console.warn("Blank page");
      return;
    }

    try {
      let result = "";
      let pendingImagePrompts = new Map<string, string>();

      const insertBlock = await logseq.Editor.insertBlock(
        currentBlock.uuid,
        result,
        {
          sibling: false,
        }
      );

      const newPrefix = `${command.name}\n`;
      if (openAISettings.injectPrefix && result.length === 0) {
        result = openAISettings.injectPrefix + newPrefix;
      } else {
        result = newPrefix;
      }

      const finalPrompt = command.prompt + currentBlock.content;
      const imageSize = parseImageSizeFromPrompt(finalPrompt) || "1024x1024";

      const onContent = async (content: string) => {
        result += content;
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      };

      const onImagePrompt = async (imagePrompt: string) => {
        // console.log(`Image Prompt: ${imagePrompt}`);
        const placeholder = "为该段落绘图中，请稍后...\n";
        pendingImagePrompts.set(imagePrompt, placeholder);

        const imageUrl = await dallE_gptsToml(
          imagePrompt,
          openAISettings,
          imageSize
        );
        if ("url" in imageUrl) {
          // 修改图片输出格式，增加图片显示
          const imageMarkdown = `[](${imageUrl.url})\n![](${imageUrl.url})\n\n`;
          // 替换对应段落的占位符
          result = result.replace(placeholder, imageMarkdown);
          if (insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
          pendingImagePrompts.delete(imagePrompt);
        } else {
          console.error("Failed to generate image:", imageUrl.error);
          // 删除失败的图片生成提示并添加额外换行
          result = result.replace(placeholder, "\n");
          if (insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
          pendingImagePrompts.delete(imagePrompt);
        }
      };

      const onStop = () => {
        console.log("Processing completed.");
      };

      await openAIWithStreamGptsToml(
        finalPrompt,
        openAISettings,
        onContent,
        onImagePrompt,
        onStop
      );

      if (!result) {
        logseq.App.showMsg("No OpenAI content", "warning");
        return;
      }

      if (insertBlock) {
        await logseq.Editor.updateBlock(insertBlock.uuid, result);
      }
    } catch (e: any) {
      console.error("Error in runGptsCommand:", e);
      handleOpenAIError(e);
    }
  };
} */

// 既能处理“图文”间隔的hero1指令，又能处理单独生成大片提示词后再生成图片的hero2指令
/* export async function createRunGptsTomlCommand(command: Command) {
  return async (b: IHookEvent) => {
    const openAISettings = getOpenaiSettings();
    validateSettings(openAISettings);

    const currentBlock = await logseq.Editor.getBlock(b.uuid);
    if (!currentBlock) {
      console.error("No current block");
      return;
    }

    if (currentBlock.content.trim().length === 0) {
      logseq.App.showMsg("Empty Content", "warning");
      console.warn("Blank page");
      return;
    }

    try {
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

      // 判断是否为"提示词2"类型的命令
      const isColoringBookCommand = command.type === "Coloring_Book_Hero2";

      const onImagePrompt = async (imagePrompt: string) => {
        // 如是示词2类型，则跳过常规图片生成流程
        if (isColoringBookCommand) return;

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

        const imageUrl = await dallE_gptsToml(
          truncatedPrompt,
          openAISettings,
          imageSize
        );
        if ("url" in imageUrl) {
          const imageMarkdown = `[](${imageUrl.url})\n![](${imageUrl.url})\n\n`;
          result = result.replace(placeholder, imageMarkdown);
          if (insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
          pendingImagePrompts.delete(imagePrompt);
        } else {
          console.error("Failed to generate image:", imageUrl.error);
          result = result.replace(placeholder, "\n");
          if (insertBlock) {
            await logseq.Editor.updateBlock(insertBlock.uuid, result);
          }
          pendingImagePrompts.delete(imagePrompt);
        }
      };

      const onStop = async () => {
        console.log("Processing completed.");

        try {
          const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch && isColoringBookCommand) {
            let jsonString = jsonMatch[1].trim();

            // 预处理JSON字符串
            jsonString = jsonString
              .replace(/[\b\f\n\r\t]/g, " ")
              .replace(/\\n/g, " ")
              .replace(/\s+/g, " ")
              .replace(/(\w+):/g, '"$1":')
              .replace(/'/g, '"')
              .trim();

            console.log("Processed JSON String:", jsonString);

            try {
              let promptObj = JSON.parse(jsonString);

              if (promptObj && typeof promptObj === "object") {
                const { prompt, size = "1024x1024", n = 1 } = promptObj;

                // 对每个场景分别生成图片
                for (let i = 1; i <= n; i++) {
                  const scenePrompt = {
                    prompt: `${prompt}\n\n**当前绘制**：第${i}幅`,
                    n: 1,
                    size: size,
                    response_format: "url",
                    model: openAISettings.dalleModel,
                  };

                  const placeholder = `正在生成第 ${i} 张图片，请稍后...\n`;
                  result += placeholder;
                  if (insertBlock) {
                    await logseq.Editor.updateBlock(insertBlock.uuid, result);
                  }

                  // 调用绘图函数生成当前场景
                  const imageUrl = await dallE_gptsToml(
                    scenePrompt.prompt,
                    openAISettings,
                    size
                  );
                  if ("url" in imageUrl) {
                    try {
                      const imageFileName = await saveDalleImage(imageUrl.url);
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
                    console.error("Failed to generate image:", imageUrl.error);
                    result = result.replace(placeholder, "图片生成失败\n");
                    if (insertBlock) {
                      await logseq.Editor.updateBlock(insertBlock.uuid, result);
                    }
                  }
                }
              }
            } catch (parseError) {
              console.error("Error parsing JSON:", parseError);
              await handleRegularTextResponse();
            }
          } else {
            await handleRegularTextResponse();
          }
        } catch (error) {
          console.error("Error in onStop:", error);
          logseq.App.showMsg("Error processing response", "error");
        }
      };

      // 处理常规文本响应的辅助函数
      const handleRegularTextResponse = async () => {
        if (!result) {
          logseq.App.showMsg("No OpenAI content", "warning");
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
      console.error("Error in createRunGptsTomlCommand:", error);
      logseq.App.showMsg("Error processing command", "error");
    }
  };
} */

//对toml文件中新增加的isParseJson参数进行处理
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
          const jsonMatch = fullResponse.match(/```json\s*([\s\S]*?)```/);
          if (jsonMatch && isParseJson) {
            let jsonString = jsonMatch[1].trim();
            console.log("原始完整提示词:", jsonString);

            try {
              const promptMatch = jsonString.match(/"prompt"\s*:\s*"([^"]*)"/);
              const sizeMatch = jsonString.match(/"size"\s*:\s*"([^"]*)"/);
              const nMatch = jsonString.match(/"n"\s*:\s*(\d+)/);

              if (!promptMatch || !sizeMatch || !nMatch) {
                throw new Error("无法提取必要的 JSON 属性");
              }

              const promptObj = {
                prompt: promptMatch[1],
                size: sizeMatch[1],
                n: parseInt(nMatch[1]),
              };

              // 在响应块中显示完整的提示词
              result = `提示词：\n\`\`\`json\n${jsonString}\n\`\`\`\n\n`;
              if (insertBlock) {
                await logseq.Editor.updateBlock(insertBlock.uuid, result);
              }

              const { prompt, size = "1024x1024", n = 1 } = promptObj;
              console.log(`计划生成 ${n} 幅图片`);

              let processedImages = [];

              for (let i = 1; i <= n; i++) {
                // 构建当前场景的完整提示词
                const currentPrompt = `${prompt}，本次指令：绘制第${i}幅子场景`;

                // 构建完整的提示词对象
                const currentPromptJson = {
                  prompt: currentPrompt,
                  size: size,
                  n: 1,
                };

                // 记录当前正在处理的完整提示词
                console.log(`\n开始处理第 ${i}/${n} 幅图片`);
                console.log(
                  "当前完整提示词:",
                  JSON.stringify(currentPromptJson, null, 2)
                );

                const placeholder = `正在生成第 ${i} 张图片，请稍后...\n`;
                result += placeholder;

                if (insertBlock) {
                  await logseq.Editor.updateBlock(insertBlock.uuid, result);
                }

                const imageUrl = await dallE_gptsToml(
                  currentPrompt,
                  openAISettings,
                  size
                );

                if ("url" in imageUrl) {
                  try {
                    const imageFileName = await saveDalleImage(imageUrl.url);
                    processedImages.push(imageFileName);
                    console.log(`第 ${i}/${n} 幅图片生成完成`);

                    // 更新结果，保留提示词
                    result = `提示词：\n\`\`\`json\n${jsonString}\n\`\`\`\n\n${processedImages.join(
                      "\n"
                    )}\n`;

                    if (insertBlock) {
                      await logseq.Editor.updateBlock(insertBlock.uuid, result);
                    }
                  } catch (error) {
                    console.error(`第 ${i} 幅图片保存失败:`, error);
                    result = result.replace(placeholder, "图片保存失败\n");
                    if (insertBlock) {
                      await logseq.Editor.updateBlock(insertBlock.uuid, result);
                    }
                  }
                } else {
                  console.error(`第 ${i} 幅图片生成失败:`, imageUrl.error);
                }
              }
            } catch (parseError) {
              console.error("JSON 解析错误:", parseError);
              await handleRegularTextResponse();
            }
          } else {
            await handleRegularTextResponse();
          }
        } catch (error) {
          console.error("onStop 执行错误:", error);
          showMessage("Error processing response", "error");
        }
      };

      // 处理常规文本响应的辅助函数
      const handleRegularTextResponse = async () => {
        if (!result) {
          showMessage("No OpenAI content", "warning");
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
    } catch (error: any) {
      // 将所有错误统一交给 handleOpenAIError 处理
      handleOpenAIError(error);
    }
  };
}

/* const updateBlock = async (uuid: string, content: string) => {
  await logseq.Editor.updateBlock(uuid, content);
  // console.log(`Updated block with UUID: ${uuid}`);
}; */

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

    // 判断是远程图片链接还是本地图片路径
    const isRemoteUrl =
      imageUrl.startsWith("http://") || imageUrl.startsWith("https://");

    try {
      let description: string | null = null;

      if (isRemoteUrl) {
        // 如果是远程图片链接，调用 readImageURL
        description = await readImageURL(imageUrl, openAISettings);
      } else {
        // 如果是本地图片路径调用 readLocalImageURL
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
