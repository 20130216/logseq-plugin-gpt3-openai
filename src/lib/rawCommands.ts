import { IHookEvent } from "@logseq/libs/dist/LSPlugin.user";
import { getAudioFile, getPageContentFromBlock, getImageUrlFromBlock,saveDalleImage } from "./logseq";
import { OpenAIOptions, dallE, whisper, openAIWithStream, readImageURL, readLocalImageURL, openAIWithStreamGpts } from "./openai";
import { getOpenaiSettings } from "./settings";
import { Command } from "../ui/LogseqAI";

  // 10种应用场景的分门别类处理：所有异常最终都会被 runGptBlock 捕获并传递给 handleOpenAIError 函数来处理，那么你只需要在 handleOpenAIError 中分门别类地处理各种异常情况即可。这样可以确保所有的异常处理逻辑集中在一个地方，便于维护和管理。  
  // 10.26号上午定稿 下午又特意优化了catch处理方式，从固定赋值变成e.message的动态赋值，同时在rawCommands.ts的handleOpenAIError中增加e.name === "DOMException" 和e.message.includes("流超时")两种额外的异常处理方式;
  export function handleOpenAIError(e: any) {
    if (
      !e.response ||
      !e.response.status ||
      !e.response.data ||
      !e.response.data.error
    ) {
      console.error(`未知的 OpenAI 错误: ${e}`);
      logseq.App.showMsg("未知的 OpenAI 错误，一般是网络不畅导致的系统超时，请稍后重试！", "error");
      return;
    }
  
    const httpStatus = e.response.status;
    const errorCode = e.response.data.error.code;
    const errorMessage = e.response.data.error.message;
    const errorType = e.response.data.error.type;
  
    if (httpStatus === 401) {
      console.error("OpenAI API 密钥无效。");
      logseq.App.showMsg("无效的 OpenAI API 密钥！", "error");
    } else if (httpStatus === 429) {
      if (errorType === "insufficient_quota") {
        console.error(
          "超出 OpenAI API 配额。您的试用期可能已结束。您可以在 https://gptgod.cloud/account/中购买更多配额。"
        );
        logseq.App.showMsg("OpenAI 配额已用完！", "error");
      } else {
        console.warn(
          "OpenAI API 请求频率过高。请减缓请求速度。"
        );
        logseq.App.showMsg("OpenAI 请求频率过高！", "warning");
      }
    } else if (httpStatus === 400) {
      console.error(`请求参数错误: ${errorMessage}`);
      logseq.App.showMsg("请求参数错误，请检查输入！", "error");
    } else if (httpStatus === 500) {
      console.error(`OpenAI 服务器错误: ${errorMessage}`);
      logseq.App.showMsg("OpenAI 服务器错误，请稍后重试！", "error");
    } else if (httpStatus === 503) {
      console.error(`OpenAI 服务不可用: ${errorMessage}`);
      logseq.App.showMsg("OpenAI 服务不可用，请稍后重试！", "error");
    } else if (e.name === 'AbortError') {
      console.error("网络请求超时");
      logseq.App.showMsg("网络请求超时，请检查网络连接！", "error");
    } else if (e.message === "输出数据流超时") {
      console.error("输出数据流超时");
      logseq.App.showMsg("输出数据流超时，请检查网络连接！", "error");
    } else if (e.name === "DOMException" && e.message.includes("BodyStreamBuffer was aborted")) {
      console.error("流被中断，请检查网络连接");
      logseq.App.showMsg("输出数据流被中断，请检查网络连接！", "error");
    } else if (e.message.includes("流超时")) {
      console.error("流超时，请检查网络连接");
      logseq.App.showMsg("输出数据流超时，请检查网络连接！", "error");
    } else {
      console.error(`未知的 OpenAI 错误: ${errorType} ${errorCode} ${errorMessage}`);
      logseq.App.showMsg("未知的 OpenAI 错误，请稍后重试！", "error");
    }
  }
  

function validateSettings(settings: OpenAIOptions) {
  if (!settings.apiKey) {
    console.error("Need API key set in settings.");
    logseq.App.showMsg(
      "Need openai API key. Add one in plugin settings.",
      "error"
    );
    throw new Error("Need API key set in settings.");
  }

  if (
    settings.dalleImageSize !== '256' &&
    settings.dalleImageSize !== '256x256' &&
    settings.dalleImageSize !== '512' &&
    settings.dalleImageSize !== '512x512' &&
    settings.dalleImageSize !== '1024' &&
    settings.dalleImageSize !== '1024x1024' &&
    settings.dalleImageSize !== '1024x1792' &&
    settings.dalleImageSize !== '1792x1024'
  ) {
    console.error("DALL-E image size must be 256, 512, or 1024.");
    logseq.App.showMsg("DALL-E image size must be 256, 512, or 1024.", "error");
    throw new Error("DALL-E image size must be 256, 512, 1024, 1024x1792, or 179x1024");
  }
}

// 10.24:push24/25 测试25次，24次无bug，详细注释版
// 负责在用户触发快捷键时，获取当前块的内容，调用 openAIWithStream 生成内容，并将结果插入到新块中。
export async function runGptBlock(b: IHookEvent) {
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
    // { sibling: false } 表示插入的新块是当前块的子块，而不是同级块。
    const insertBlock = await logseq.Editor.insertBlock(currentBlock.uuid, result, {
      sibling: false,
    });

    if (openAISettings.injectPrefix && result.length == 0) {
      // 确保在后续内容生成之前，前缀已经被添加到 result 中，比如 injectPrefix 被设置为：“#Gpt4o”
      result = openAISettings.injectPrefix + result;
    }

    // 定义一个异步回调函数 async (content: string) => {...}：，接收 content 参数，表示从 OpenAI API 获取的内容。
    // 内容回调函数，每当从 OpenAI API 获取到一部分内容时，会调用这个函数。
    // 这个函数负责将获取到的内容拼接到 result 中，并更新插入的新块的内容。
    // =>：箭头函数的语法，用于定义匿名函数；例如：async (content: string) => {...} 表示一个异步箭头函数，接收 content 参数
    // 更新块的内容：将从 OpenAI API 获取的内容逐步拼接到 result 中，并更新插入的新块的内容。
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
    await openAIWithStream(currentBlock.content, openAISettings, async (content: string) => {
      // 将 content 拼接到 result 中；如果 content 为 null 或 undefined，则使用空字符串 ""
      // 这是在内容回调函数中使用的 result，用于拼接从 OpenAI API 响应中获取的内容块。
      result += content || "";
      if (null != insertBlock) {
        // 更新插入的新块的内容：result：拼接后的最终内容；await 关键字表示等待 logseq.Editor.updateBlock 完成后再继续执行后续代码。
        await logseq.Editor.updateBlock(insertBlock.uuid, result);
      }
    }, () => {});

    if (!result) {
      logseq.App.showMsg("No OpenAI content", "warning");
      return;
    }
  } catch (e: any) {
    handleOpenAIError(e);  // 所有异常处理逻辑集中在 handleOpenAIError 函数中
  }
}


// 升级1-1-1-1-1-push7/9-1-push12/12-1-10.24:push24/25 测试25次，24次无bug，去除注释版（和上述注释版代码相同，仅仅是无注释的简洁版）
/* export async function runGptBlock(b: IHookEvent) {
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
    const insertBlock = await logseq.Editor.insertBlock(currentBlock.uuid, result, {
      sibling: false,
    });

    if (openAISettings.injectPrefix && result.length === 0) {
      result = openAISettings.injectPrefix + result;
    }

    await openAIWithStream(currentBlock.content, openAISettings, async (content: string) => {
      result += content || "";
      if (insertBlock) {
        await logseq.Editor.updateBlock(insertBlock.uuid, result);
      }
    }, () => {});

    if (!result) {
      logseq.App.showMsg("No OpenAI content", "warning");
      return;
    }
  } catch (e: any) {
    handleOpenAIError(e);
  }
} */


  
  
export async function runGptPage(b: IHookEvent) {
  const openAISettings = getOpenaiSettings();
  validateSettings(openAISettings);

  const pageContents = await getPageContentFromBlock(b.uuid);
  const currentBlock = await logseq.Editor.getBlock(b.uuid);

  if (pageContents.length === 0) {
    logseq.App.showMsg("Empty Content", "warning");
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
    const insertBlock = await logseq.Editor.appendBlockInPage(page.uuid, result);

    if (openAISettings.injectPrefix && result.length == 0) {
      result = openAISettings.injectPrefix + result;
    }

    await openAIWithStream(pageContents, openAISettings,  async (content: string) => {
      result += content || "";
      if(null != insertBlock) {
        await logseq.Editor.updateBlock(insertBlock.uuid, result);
      }
    }, () => {});
    if (!result) {
      logseq.App.showMsg("No OpenAI content" , "warning");
      return;
    }

  } catch (e: any) {
    handleOpenAIError(e);
  }
}



// 该版拼接正确，但不断有浮窗产生  
  /* export async function runGptsID(b: IHookEvent, gptsID: string) {
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
      const insertBlock = await logseq.Editor.insertBlock(currentBlock.uuid, result, {
        sibling: false,
      });
  
      if (openAISettings.injectPrefix && result.length === 0) {
        result = openAISettings.injectPrefix + result;
      }
  
      // 将 gptsID 作为参数传递给 openAIWithStreamGpts
      await openAIWithStreamGpts(currentBlock.content, { ...openAISettings, gpts: gptsID }, async (content: string) => {
        result += content || "";
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      }, () => {});
  
      if (!result) {
        logseq.App.showMsg("No OpenAI content", "warning");
        return;
      }
    } catch (e: any) {
      handleOpenAIError(e);
    }
  } */


export async function runGptsID(b: IHookEvent, gptsID: string, commandName: string) {
  // 获取用户在设置窗口中自定义的值；此前在main.tsx中已经通过logseq.useSettingsSchema(settingsSchema);进行了插件初始化时的默认设置
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
    const insertBlock = await logseq.Editor.insertBlock(currentBlock.uuid, result, {
      sibling: false,
    });

    const newPrefix = `OpenAI GPTs：${commandName}\n`; // 新增：构建新的前缀
    if (openAISettings.injectPrefix && result.length === 0) {
      result = openAISettings.injectPrefix + newPrefix; // 修改：将新前缀加入到现有前缀之后
    } else {
      result = newPrefix; // 如果没有现有前缀，直接使用新前缀
    }
    // gpts: gptsID 会覆盖 openAISettings 中同名的属性。
    await openAIWithStreamGpts(currentBlock.content, { ...openAISettings, gpts: gptsID }, async (content: string) => {
      result += content || "";
      if (insertBlock) {
        await logseq.Editor.updateBlock(insertBlock.uuid, result);
      }
    }, () => {});

    if (!result) {
      logseq.App.showMsg("No OpenAI content", "warning");
      return;
    }
  } catch (e: any) {
    console.error("Error in runGptsID:", e);
    handleOpenAIError(e);
  }
}


// 新增：创建运行 prompts-gpts.toml 命令的处理函数
export async function createRunGptsTomlCommand(command: Command) {
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
      const insertBlock = await logseq.Editor.insertBlock(currentBlock.uuid, result, {
        sibling: false,
      });

      const newPrefix = `${command.name}\n`; // 构建新的前缀
      if (openAISettings.injectPrefix && result.length === 0) {
        result = openAISettings.injectPrefix + newPrefix; // 将新前缀加入到现有前缀之后
      } else {
        result = newPrefix; // 如果没有现有前缀，直接使用新前缀
      }

      // 调用 openAIWithStream 进行处理
      const finalPrompt = command.prompt + currentBlock.content;
      const streamResult = await openAIWithStream(finalPrompt, openAISettings, async (content: string) => {
        result += content || "";
        if (insertBlock) {
          await logseq.Editor.updateBlock(insertBlock.uuid, result);
        }
      }, () => {});

      if (streamResult) {
        result += streamResult;
      }

      if (!result) {
        logseq.App.showMsg("No OpenAI content", "warning");
        return;
      }
    } catch (e: any) {
      console.error("Error in runGptsCommand:", e);
      handleOpenAIError(e);
    }
  };
}


export async function runDalleBlock(b: IHookEvent) {
  const openAISettings = getOpenaiSettings();
  validateSettings(openAISettings);

  const currentBlock = await logseq.Editor.getBlock(b.uuid);
  if (!currentBlock) {
    console.error("No current block");
    return;
  }

  if (currentBlock.content.trim().length === 0) {
    logseq.App.showMsg("Empty Content", "warning");
    console.warn("Blank block");
    return;
  }

  try {
    const imageURL = await dallE(currentBlock.content, openAISettings);
    if (!imageURL) {
      logseq.App.showMsg("No Dalle results.", "warning");
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
      logseq.App.showMsg("No supported audio file found in block.", "warning");
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
      logseq.App.showMsg("No valid image URL found in block.", "warning");
      return;
    }

    const openAISettings = getOpenaiSettings();

    // 判断是远程图片链接还是本地图片路径
    const isRemoteUrl = imageUrl.startsWith("http://") || imageUrl.startsWith("https://");

    try {
      let description: string | null = null;

      if (isRemoteUrl) {
        // 如果是远程图片链接，调用 readImageURL
        description = await readImageURL(imageUrl, openAISettings);
      } else {
        // 如果是本地图片路径，调用 readLocalImageURL
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



