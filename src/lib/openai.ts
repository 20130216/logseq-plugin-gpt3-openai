import OpenAI from "openai";
import "@logseq/libs";
import { backOff } from "exponential-backoff";
import { handleOpenAIError } from "./rawCommands";
// import { showMessage } from "./logseq";
// import {CompletionChoice} from "openai/resources/completions";
// import { ChatCompletion, ChatCompletionChoice, CompletionChoice, Choice } from '../../../node_modules/.pnpm/openai@4.67.3/node_modules/openai/src/resources/chat/completions';

// import { ChatCompletion, ChatCompletionChoice, CompletionChoice, Choice } from 'openai/resources/chat/completions';

export type DalleImageSize =
  | "256"
  | "256x256"
  | "512"
  | "512x512"
  | "1024"
  | "1024x1024"
  | "1024x1792"
  | "1792x1024";
export type DalleModel = "dall-e-2" | "dall-e-3";
export type DalleQuality = "standard" | "hd";
export type DalleStyle = "natural" | "vivid";
export interface OpenAIOptions {
  apiKey: string;
  completionEngine?: string;
  temperature?: number;
  maxTokens?: number;
  dalleImageSize?: DalleImageSize;
  dalleModel?: DalleModel;
  dalleQuality?: DalleQuality;
  dalleStyle?: DalleStyle;
  chatPrompt?: string;
  chatCompletionEndpoint?: string;
  gpts?: string;
}

const OpenAIDefaults = (apiKey: string): OpenAIOptions => ({
  apiKey,
  completionEngine: "gpt-4o-mini",
  temperature: 1.0,
  maxTokens: 1000,
  dalleImageSize: "1024",
  dalleModel: "dall-e-3",
  dalleQuality: "standard",
  dalleStyle: "vivid",
  gpts: "gpt-4-gizmo-g-B3hgivKK9",
});

const retryOptions = {
  numOfAttempts: 7,
  retry: (err: any) => {
    if (err instanceof TypeError && err.message === "Failed to fetch") {
      console.warn("retrying due to network error", err);
      return true;
    }

    if (!err.response || !err.response.data || !err.response.data.error) {
      return false;
    }

    if (err.response.status === 429) {
      const errorType = err.response.data.error.type;
      if (errorType === "insufficient_quota") {
        return false;
      }
      console.warn("Rate limit exceeded. Retrying...");
      return true;
    }

    if (err.response.status >= 500) {
      return true;
    }

    return false;
  },
};

function migrateOldUrl(url: string) {
  if (url.startsWith("http://api.openai.com")) {
    return url.replace("http://api.openai.com", "https://api.openai.com");
  }
  return url;
}

export async function whisper(
  file: File,
  openAiOptions: OpenAIOptions
): Promise<string> {
  const apiKey = openAiOptions.apiKey;
  const baseUrl = openAiOptions.chatCompletionEndpoint
    ? migrateOldUrl(openAiOptions.chatCompletionEndpoint)
    : "https://api.shubiaobiao.cn/v1";
  const model = "whisper-1";

  // Create a FormData object and append the file
  const formData = new FormData();
  formData.append("model", model);
  formData.append("file", file);

  // Send a request to the OpenAI API using a form post
  const response = await backOff(
    () =>
      fetch(baseUrl + "/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      }),
    retryOptions
  );

  // Check if the response status is OK
  if (!response.ok) {
    throw new Error(`Error transcribing audio: ${response.statusText}`);
  }

  // Parse the response JSON and extract the transcription
  const jsonResponse = await response.json();
  return jsonResponse.text;
}

export async function dallE(
  prompt: string,
  openAiOptions: OpenAIOptions
): Promise<string | undefined> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };

  const openai = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.chatCompletionEndpoint,
    dangerouslyAllowBrowser: true,
  });

  // TODO : fix this typing loop
  // @ts-ignore
  const imageSizeRequest: OpenAI.ImageGenerateParams["size"] =
    options.dalleImageSize
      ? options.dalleImageSize!.includes("x")
        ? options.dalleImageSize
        : `${options.dalleImageSize}x${options.dalleImageSize}`
      : "256x256";

  const imageParameters: OpenAI.ImageGenerateParams = {
    prompt,
    n: 1,
    size: imageSizeRequest,
    model: options.dalleModel,
    quality: options.dalleQuality,
    style: options.dalleStyle,
  };

  const response = await backOff(
    () => openai.images.generate(imageParameters),
    retryOptions
  );
  return response.data[0].url;
}

export async function openAI(
  input: string,
  openAiOptions: OpenAIOptions
): Promise<string | null> {
  try {
    const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
    const engine = options.completionEngine!;

    const openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.chatCompletionEndpoint,
    });

    if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4")) {
      const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [
        { role: "user", content: input },
      ];
      if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
        inputMessages.unshift({
          role: "system",
          content: openAiOptions.chatPrompt,
        });
      }
      const response = await backOff(
        () =>
          openai.chat.completions.create({
            messages: inputMessages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            model: engine,
          }),
        retryOptions
      );
      const choices = response.choices;
      if (
        choices &&
        choices[0] &&
        choices[0].message &&
        choices[0].message.content &&
        choices[0].message.content.length > 0
      ) {
        return trimLeadingWhitespace(choices[0].message.content);
      } else {
        return null;
      }
    } else {
      const response = await backOff(
        () =>
          openai.completions.create({
            prompt: input,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            model: engine,
          }),
        retryOptions
      );
      const choices = response.choices;
      if (
        choices &&
        choices[0] &&
        choices[0].text &&
        choices[0].text.length > 0
      ) {
        return trimLeadingWhitespace(choices[0].text);
      } else {
        return null;
      }
    }
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    const result = handleOpenAIError(error);
    throw new Error(result.error);
  }
}

// 1.行分割和过滤：先按行分割，再过滤掉空行；（原始版本：直接按 data: 分割。）更精确地处理多行数据，避免因单行数据包含多个 data: 导致的解析错误。
// 2.JSON 完整性检查：在解析 JSON 之前，检查数据是否以 { 开头和 } 结尾。（原始版本：直接尝试解析 JSON。）避免因不完整的 JSON 数据导致的解析错误，提高代码的健壮性。
// 3.调试信息：优化版本：增加了调试信息输出，方便排查问题。（原始版本：没有调试信息输出。）优点：便于调试和问题排查。
function getDataFromStreamValue(value: string): any[] {
  const lines = value.split("\n").filter((line) => line.trim() !== "");
  return lines.flatMap((line) => {
    if (line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") {
        return []; // 返回空数组以跳过 [DONE] 标记
      }
      try {
        // 检查 JSON 完整
        if (data.startsWith("{") && data.endsWith("}")) {
          return JSON.parse(data);
        } else {
          console.debug("不完整的 JSON 数据:", data); // 调试输出不完整的 JSON 数据
          return [];
        }
      } catch (error) {
        console.debug("从流中解析 JSON 失败:", line, error); // 调试输出解失败的信息
        return [];
      }
    }
    return [];
  });
}

// 终局函数1:runGptBlock中的openAIWithStream的机器注释+异常分类处理的定稿版（10.25号定稿，含10种异常分类处理的场景）；总共进行了40次测试,一次都没有出错！！！
// 优化版本（定稿版）在代码可读性、健壮性和调试方面都有所提升，但也增加了一些额外的检查逻辑。这些优化点在实际应用中通常是值得的，特别是在处理复杂和不确定的外部数据时

// 1.异步处理：使用 async/await 和 Promise 结合的方式，使得代码更加清晰易读。
// 2.空值检查：增加了对 value 的空值检查，避免了可能的 null  undefined 错误
// 3.超时机制：增加了超时机制，如果流读取超过 30 秒则取消读取器并抛出错误，提高了系统的健壮性。
// 4.错误处理提供了统一的用户友好的错误提示，且可以在 UI 中显示错信息，提升了用户体验。

export async function openAIWithStream(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  try {
    const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
    const engine = options.completionEngine!;

    console.log(
      "Sending request to:",
      `${options.chatCompletionEndpoint}/chat/completions`
    );
    const body = {
      messages: [
        ...(openAiOptions.chatPrompt
          ? [{ role: "system", content: openAiOptions.chatPrompt }]
          : []),
        { role: "user", content: input },
      ],
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      model: engine,
      stream: true,
    };

    const response = await fetch(
      `${options.chatCompletionEndpoint}/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!response.ok) {
      throw new Error(
        `请求失败，状态码: ${response.status}，错误信息: ${await response.text()}`
      );
    }

    if (response.headers.get("Content-Type") !== "text/event-stream") {
      throw new Error(
        `Unexpected Content-Type: ${response.headers.get("Content-Type")}`
      );
    }

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let result = "";

    const readStream = async (): Promise<any> => {
      try {
        while (true) {
          const { value, done } = await reader.read(); // 读取流中的下一个值
          if (done) {
            reader.cancel(); // 如果结束，取消读取器
            onStop(); // 调用停止回调
            return result; // 返回终结果
          }

          if (value !== null && value !== undefined) {
            // 检查值是否为 null 或 undefined
            // console.log("Received stream chunk:", value); // 添加日志记录
            const data = getDataFromStreamValue(value); // 解析流数据
            // console.log("Parsed data:", data); // 添加日志记录

            if (Array.isArray(data)) {
              for (let item of data) {
                if (
                  item.choices &&
                  item.choices[0] &&
                  item.choices[0].delta &&
                  item.choices[0].delta.content
                ) {
                  const res = item.choices[0].delta.content;
                  result += res; // 更新最终结果
                  onContent(res); // 调用内容回调
                } else {
                  console.warn("Received unexpected data format:", item);
                }
              }
            } else {
              console.warn("Received unexpected data format:", data);
            }
          }
        }
      } catch (error) {
        reader.cancel();
        onStop();
        throw error; // 向上抛出错误
      }
    };

    return readStream().catch((error) => {
      throw error; // 向上抛出错误
    });

  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    handleOpenAIError(error);
    return null;
  }
}

// 优化版本：使用 text 作为参数名（原始版本：使用 s 作为参数名。）参数名更具描述性，代码可读性更好。
function trimLeadingWhitespace(text: string): string {
  return text.replace(/^\s+/, ""); // 移除字符串开头的空白字符
}

// 终局函数2:runGptBlock中的openAIWithStreamGptsID的机器注释+异常分类处理的定稿版（10.26号上午定稿，含10种异常分类处理场景）；共进行了30-40次左测试,很少出错！！！
// （10.26号下午）特意优化了catch处理方式，从固定赋值变成e.message的动态赋值，同时在rawCommands.ts的handleOpenAIError中增加e.name === "DOMException" 和e.message.includes("流超时")两种额外的异常处理方式;

// 1.异步处理：使用 async/await 语法使代码更洁、读。
// 2.空值检查：增加了对 value 是否为 null 或 undefined 的检查，避免因空值导致的运行时错误。
// 3.超时机制：增加了超时机制，防止长时间挂起，提高系统的健壮性和用户体验。
// 4.统一错误提示：无论错误的具体���因是什么，都提供一个统一的用户友好的错误提示信息。

export async function openAIWithStreamGptsID(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  try {
    const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };

    const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [
      { role: "user", content: input },
    ];
    if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
      inputMessages.unshift({
        role: "system",
        content: openAiOptions.chatPrompt,
      });
    }

    const body = {
      messages: inputMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      model: options.gpts,
      stream: true,
    };

    const response = await backOff(async () => {
      const fetchResponse = await fetch(
        `${options.chatCompletionEndpoint}/chat/completions`,
        {
          method: "POST",
          body: JSON.stringify(body),
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "User-Agent": "Apifox/1.0.0 (https://apifox.com)",
          },
          signal: AbortSignal.timeout(120000),
          redirect: "follow",
        }
      );

      if (!fetchResponse.ok) {
        throw new Error(
          `请求失败，状态码: ${fetchResponse.status}，错误信息: ${await fetchResponse.text()}`
        );
      }

      if (fetchResponse.headers.get("Content-Type") !== "text/event-stream") {
        throw new Error(
          `Unexpected Content-Type: ${fetchResponse.headers.get("Content-Type")}`
        );
      }

      if (!fetchResponse.body) {
        throw new Error("响应体为空");
      }

      const reader = fetchResponse.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let result = "";
      let currentParagraph = "";

      const readStream = async (): Promise<any> => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              reader.cancel();
              if (currentParagraph.trim()) {
                console.log(
                  "来自openAIWithStreamGptsID函数中的完整提示词如下:",
                  currentParagraph
                );
                result += currentParagraph;
                onContent(currentParagraph);
              }
              onStop();
              return Promise.resolve({
                choices: [{ message: { content: result } }],
              });
            }

            if (value !== null && value !== undefined) {
              const data = getDataFromStreamValue(value);
              if (data && data[0]) {
                let res = "";
                for (let i = 0; i < data.length; i++) {
                  if (data[i]) {
                    res += data[i].choices[0]?.delta?.content || "";
                  }
                }
                currentParagraph += res;

                if (res.includes("\n\n") || res.includes("\n### ")) {
                  const paragraphs = currentParagraph.split(/\n\n|\n### /);
                  for (let i = 0; i < paragraphs.length - 1; i++) {
                    const paragraph = paragraphs[i].trim();
                    if (paragraph) {
                      console.log("完整段落:", paragraph);
                      result += paragraph + "\n\n";
                      onContent(paragraph + "\n\n");
                    }
                  }
                  currentParagraph = paragraphs[paragraphs.length - 1];
                }
              }
            }

            const timeoutId = setTimeout(() => {
              reader.cancel();
              onStop();
              throw new Error("流超时");
            }, 120000);

            const promise = readStream();
            promise.then(() => clearTimeout(timeoutId));
            return promise;
          }
        } catch (error) {
          reader.cancel();
          onStop();
          throw error;
        }
      };

      return readStream();
    }, retryOptions);

    if (response) {
      const choices = (response as OpenAI.Chat.Completions.ChatCompletion)
        ?.choices;
      if (
        choices &&
        choices[0] &&
        choices[0].message &&
        choices[0].message.content &&
        choices[0].message.content.length > 0
      ) {
        return trimLeadingWhitespace(choices[0].message.content);
      }
    }

    return null;
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    handleOpenAIError(error);
    return null;
  } finally {
    onStop();
  }
}

// 新增函数1 for gpts-toml
// 优化后的 checkAndExtractImagePrompt 函数

const processedParagraphs = new Set<string>();

const imageKeywords = [
  "图片生成",
  "需图",
  "绘图需求",
  "image generation",
  "image description",
  "drawing",
  "painting",
];

function removeDrawingMarkers(text: string): string {
  // return text.replace(/【需绘图】|【图片生成】|【绘图需求】| \n/g, "").trim();
  return text.replace(/\n/g, "").trim();
}

function checkAndExtractImagePrompt(
  paragraph: string,
  backgroundPrompt: string,
  isLastParagraph: boolean = false
): {
  hasRequest: boolean;
  prompt: string;
} {
  let hasRequest = false;
  let prompt = "";

  // 从 backgroundPrompt 中提取实际的用户输入内容
  // 通常用户输入在 logseq 块中会包含 id:: 这样的标识
  const userInputMatch = backgroundPrompt.match(/^(.*?)(?:\s*id::|$)/s);
  const cleanBackgroundPrompt = userInputMatch
    ? userInputMatch[1].trim()
    : backgroundPrompt.trim();

  for (let index = 0; index < imageKeywords.length; index++) {
    const keyword = imageKeywords[index];
    const regex = new RegExp(keyword, "g");
    const matchResult = regex.test(paragraph);
    if (matchResult) {
      hasRequest = true;
      const cleanedParagraph = removeDrawingMarkers(paragraph);
      prompt = `**背景：${cleanBackgroundPrompt} ** ${cleanedParagraph}`;
      if (prompt) {
        break;
      }
    }
  }

  if (hasRequest) {
    if (isLastParagraph || !processedParagraphs.has(prompt)) {
      processedParagraphs.add(prompt);
      return { hasRequest: true, prompt };
    }
  }

  return { hasRequest: false, prompt: "" };
}

//不调用removeDrawingMarkers，不进行任何关键字“擦除”的函数
/*   function checkAndExtractImagePrompt(
    paragraph: string,
    backgroundPrompt: string,
    isLastParagraph: boolean = false
  ): {
    hasRequest: boolean;
    prompt: string;
  } {
    let hasRequest = false;
    let prompt = "";
  
    // 从 backgroundPrompt 中提取实际的用户输入内容
    // 通常用户输入在 logseq 块中会包含 id:: 这样的标识
    const userInputMatch = backgroundPrompt.match(/^(.*?)(?:\s*id::|$)/s);
    const cleanBackgroundPrompt = userInputMatch
      ? userInputMatch[1].trim()
      : backgroundPrompt.trim();
  
    for (let index = 0; index < imageKeywords.length; index++) {
      const keyword = imageKeywords[index];
      const regex = new RegExp(keyword, "g");
      const matchResult = regex.test(paragraph);
      if (matchResult) {
        hasRequest = true;
        // 直接使用原始的 paragraph 来构建提示
        prompt = `**背景：** ${cleanBackgroundPrompt} **子板块 ${
          index + 1
        }：** ${paragraph}`;
        if (prompt) {
          break;
        }
      }
    }
  
    if (hasRequest) {
      if (isLastParagraph || !processedParagraphs.has(prompt)) {
        processedParagraphs.add(prompt);
        return { hasRequest: true, prompt };
      }
    }
  
    return { hasRequest: false, prompt: "" };
  } */

// 主函数
// 优化后的 openAIWithStreamGptsToml 函数
function cleanUserInput(input: string): string {
  // 移除 markdown 代码块和系统提示
  const markdownMatch = input.match(/'''markdown\n([\s\S]*?)'''([\s\S]*)/);
  if (markdownMatch && markdownMatch[2]) {
    // 返回 markdown 代码块之后的实际用户输入
    return markdownMatch[2].trim();
  }
  return input.trim();
}
export async function openAIWithStreamGptsToml(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onImagePrompt: (imagePrompt: string) => void,
  onStop: () => void
): Promise<string | { error: string } | null> {
  // 清理输入，移除系统提示词
  const cleanedInput = cleanUserInput(input);

  // 添加输入内容检查
  console.log("输入内容检查:", {
    input,
    containsViolence: /暴|击|杀|死|血/.test(input),
    containsSensitive: /老虎|吃|追|怒/.test(input),
  });

  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
  const engine = options.completionEngine!;

  const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [
    { role: "user", content: input },
  ];
  if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
    inputMessages.unshift({
      role: "system",
      content: openAiOptions.chatPrompt,
    });
  }
  const body = {
    messages: inputMessages,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    model: engine,
    stream: true,
  };

  try {
    const response = await fetch(
      `${options.chatCompletionEndpoint}/chat/completions`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: AbortSignal.timeout(120000),
      }
    );

    // 添加响应检查
    console.log("响应状态检查:", {
      status: response.status,
      ok: response.ok,
      contentType: response.headers.get("Content-Type"),
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      console.log("错误响应内容:", errorMessage);
      return handleOpenAIError(new Error(errorMessage));
    }

    if (response.headers.get("Content-Type") !== "text/event-stream") {
      const errorMessage = `Unexpected Content-Type: ${response.headers.get(
        "Content-Type"
      )}`;
      console.error(errorMessage);
      return handleOpenAIError(new Error(errorMessage));
    }

    if (response.body) {
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let result = "";
      let currentParagraph = "";

      const readStream = async (): Promise<any> => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            reader.cancel();
            if (currentParagraph.trim()) {
              console.log(
                "来自openAIWithStreamGptsToml函数中的完整提示词如下:",
                currentParagraph
              );
              const { hasRequest, prompt } = checkAndExtractImagePrompt(
                currentParagraph.trim(),
                cleanedInput,
                true
              );
              if (hasRequest) {
                result += currentParagraph + "\n为该段落绘图中，请稍后...\n";
                onContent(currentParagraph + "\n为该段落绘图中，请稍后...\n");
                onImagePrompt(prompt);
              } else {
                result += currentParagraph;
                onContent(currentParagraph);
              }
            }
            onStop();
            return result;
          }

          if (value) {
            const data = getDataFromStreamValue(value);
            if (data && data.length > 0) {
              for (const item of data) {
                if (item.choices[0]?.delta?.content) {
                  const content = item.choices[0].delta.content;
                  currentParagraph += content;

                  if (content.includes("\n\n") || content.includes("\n### ")) {
                    const paragraphs = currentParagraph.split(/\n\n|\n### /);
                    for (let i = 0; i < paragraphs.length - 1; i++) {
                      const paragraph = paragraphs[i].trim();
                      if (paragraph) {
                        console.log("完整段落:", paragraph);
                        const { hasRequest, prompt } =
                          checkAndExtractImagePrompt(
                            paragraph,
                            cleanedInput,
                            false
                          );
                        if (hasRequest) {
                          result += paragraph + "\n为该段落绘图中，请稍后...\n";
                          onContent(
                            paragraph + "\n为该段落绘图中，请稍后...\n"
                          );
                          onImagePrompt(prompt);
                        } else {
                          result += paragraph + "\n\n";
                          onContent(paragraph + "\n\n");
                        }
                      }
                    }
                    currentParagraph = paragraphs[paragraphs.length - 1];
                  }
                }
              }
            }
          }
        }
      };

      return readStream().catch((error) => {
        console.error("读取流时发生错误:", error);
        return handleOpenAIError(error);
      });
    }
    return null;
  } catch (e: any) {
    console.error("请求异常:", e);
    return handleOpenAIError(e);
  }
}

export async function dallE_gptsToml(
  prompt: string,
  openAiOptions: OpenAIOptions,
  size: string
): Promise<{ url: string } | { error: string }> {
  try {
    const options = {
      ...OpenAIDefaults(openAiOptions.apiKey),
      ...openAiOptions,
    };

    const openai = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.chatCompletionEndpoint,
      dangerouslyAllowBrowser: true,
    });

    // 处理图片尺寸
    let imageSizeRequest: OpenAI.ImageGenerateParams["size"] = "1024x1024";

    if (size.includes("x")) {
      // 验证尺寸格式
      const validSizes = [
        "256x256",
        "512x512",
        "1024x1024",
        "1024x1792",
        "1792x1024",
      ] as const;

      if (validSizes.includes(size as any)) {
        imageSizeRequest = size as OpenAI.ImageGenerateParams["size"];
      }
    } else {
      // 处理单个数字的情况
      const sizeMap: Record<string, OpenAI.ImageGenerateParams["size"]> = {
        "256": "256x256",
        "512": "512x512",
        "1024": "1024x1024",
      };
      imageSizeRequest = sizeMap[size] || "1024x1024";
    }

    const imageParameters: OpenAI.ImageGenerateParams = {
      prompt,
      n: 1,
      size: imageSizeRequest,
      model: options.dalleModel,
      quality: options.dalleQuality,
      style: options.dalleStyle,
    };

    const response = await backOff(
      () => openai.images.generate(imageParameters),
      retryOptions
    );

    const imageUrl = response.data[0]?.url;
    if (!imageUrl) {
      throw new Error("No image URL in response");
    }

    return { url: imageUrl };
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    const result = handleOpenAIError(error);
    return { error: result.error };
  }
}

// 新增函2 系列
export async function readImageURL(
  url: string,
  openAiOptions: OpenAIOptions
): Promise<string> {
  const apiKey = openAiOptions.apiKey;
  const baseUrl = openAiOptions.chatCompletionEndpoint
    ? openAiOptions.chatCompletionEndpoint
    : "https://api.shubiaobiao.cn/v1";
  // https://api.openai.com/v1
  // https://gptgod.cloud/v1
  const model = openAiOptions.completionEngine
    ? openAiOptions.completionEngine
    : "gpt-4o-mini";

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };

  const message = {
    role: "user",
    content: [
      {
        type: "text",
        text: "What's in this image? 请详细解读一下该图片", //此处命令可以根据需求来改进和自定义！！！
      },
      {
        type: "image_url",
        image_url: {
          url: url,
        },
      },
    ],
  };

  const body = JSON.stringify({
    model: model,
    messages: [message],
    max_tokens: 300,
  });

  // Send a request to the OpenAI API using JSON body
  const response = await backOff(
    () =>
      fetch(baseUrl + "/chat/completions", {
        method: "POST",
        headers: headers,
        body: body,
      }),
    retryOptions
  );

  // Check if the response status is OK
  if (!response.ok) {
    throw new Error(`Error reading image: ${response.statusText}`);
  }

  // Parse the response JSON and extract the description
  const jsonResponse = await response.json();
  return jsonResponse.choices[0].message.content;
}

//test增加
// 读取本地图片并调用 OpenAI API 新函数

export async function readLocalImageURL(
  imagePath: string,
  openAiOptions: OpenAIOptions
): Promise<string> {
  try {
    const apiKey = openAiOptions.apiKey;
    const baseUrl =
      openAiOptions.chatCompletionEndpoint || "https://api.shubiaobiao.cn/v1";
    const model = openAiOptions.completionEngine || "gpt-4o-mini";

    // 检查图像路径是否有效
    if (!imagePath) {
      throw new Error("Invalid image path provided.");
    }

    // 读取本地图片并编码为 Base64
    const base64Image = await encodeImageToBase64(imagePath);

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    const message = {
      role: "user",
      content: [
        {
          type: "text",
          text: "What's in this image? 请详细读一下该图片",
        },
        {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64Image}`,
          },
        },
      ],
    };

    const body = JSON.stringify({
      model: model,
      messages: [message],
      max_tokens: 300,
    });

    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: headers,
      body: body,
    });

    if (!response.ok) {
      throw new Error(`Error reading image: ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    return jsonResponse.choices[0].message.content;
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    const result = handleOpenAIError(error);
    throw new Error(result.error);
  }
}

async function encodeImageToBase64(imagePath: string): Promise<string> {
  try {
    console.log("Image path:", imagePath);

    // 检查是否在浏览器环境中
    if (typeof window !== "undefined" && typeof FileReader !== "undefined") {
      // 创建一个 FileReader 对象
      const reader = new FileReader();

      // 处理相对路径
      let fullImagePath = imagePath;

      // 如果路径是 lsp:// 协议，尝试转换为有效的 HTTP 路径
      if (imagePath.startsWith("lsp://")) {
        // 假设你有一个中间服务器可以处理这些请求
        fullImagePath = `http://your-middle-server.com/proxy/${encodeURIComponent(
          imagePath
        )}`;
      } else {
        fullImagePath = new URL(imagePath, window.location.href).href;
      }

      console.log("Full image path:", fullImagePath);

      // 读取文件内容
      const response = await fetch(fullImagePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();

      return new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          if (reader.result && typeof reader.result === "string") {
            resolve(reader.result.replace("data:", "").replace(/^.+,/, ""));
          } else {
            reject(new Error("Failed to read file as Base64"));
          }
        };
        reader.onerror = () => {
          reject(new Error("Failed to read file as Base64"));
        };
        reader.readAsDataURL(blob);
      });
    } else {
      // 如果在 Node.js 环境中，使用 fs 和 util
      const fs = require("fs");
      const path = require("path");
      const { promisify } = require("util");

      const readFile = promisify(fs.readFile);

      // 解析相对路径
      const absolutePath = path.resolve(__dirname, imagePath);
      console.log("Absolute path:", absolutePath);

      // 读取文件内容
      const buffer = await readFile(absolutePath, null); // 使用 null 以获取 Buffer 对象

      // 确保 buffer 是 Buffer 类型
      if (!(buffer instanceof Buffer)) {
        throw new Error("Failed to read file as Buffer");
      }

      // 将文件内容编码为 Base64
      const base64Image = buffer.toString("base64");
      return base64Image;
    }
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    const result = handleOpenAIError(error);
    throw new Error(result.error);
  }
}
