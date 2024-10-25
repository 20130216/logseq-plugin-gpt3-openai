import OpenAI from "openai";
import "@logseq/libs";
import { backOff } from "exponential-backoff";
// import {CompletionChoice} from "openai/resources/completions";
// import { ChatCompletion, ChatCompletionChoice, CompletionChoice, Choice } from '../../../node_modules/.pnpm/openai@4.67.3/node_modules/openai/src/resources/chat/completions';

// import { ChatCompletion, ChatCompletionChoice, CompletionChoice, Choice } from 'openai/resources/chat/completions';

export type DalleImageSize = '256' | '256x256' | '512' | '512x512' | '1024' | '1024x1024' | '1024x1792' | '1792x1024';
export type DalleModel = 'dall-e-2' | 'dall-e-3';
export type DalleQuality = 'standard' | 'hd';
export type DalleStyle = 'natural' | 'vivid';
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
  completionEndpoint?: string;
  gpts?: string; //代码新增
}

const OpenAIDefaults = (apiKey: string): OpenAIOptions => ({
  apiKey,
  completionEngine: "gpt-3.5-turbo",
  temperature: 1.0,
  maxTokens: 1000,
  dalleImageSize: '1024',
  dalleModel: 'dall-e-3',
  dalleQuality: 'standard',
  dalleStyle: 'vivid',
  gpts: "gpt-4-gizmo-g-B3hgivKK9",//代码新增
});

const retryOptions = {
  // numOfAttempts: 7：最多尝试 7 次。
  numOfAttempts: 7,
  retry: (err: any) => {
    // 网络错误，重试
    if (err instanceof TypeError && err.message === 'Failed to fetch') {
      // Handle the TypeError: Failed to fetch error
      console.warn('retrying due to network error', err);
      return true;
    }

    if (!err.response || !err.response.data || !err.response.data.error) {
      return false;
    }
    // err.response.status === 429：速率限制错误，检查错误类型，如果是 insufficient_quota 则不重试，否则重试。
    if (err.response.status === 429) {
      const errorType = err.response.data.error.type;
      if (errorType === "insufficient_quota") {
        return false;
      }
      console.warn("Rate limit exceeded. Retrying...");
      return true;
    }
    // err.response.status >= 500：服务器内部错误，重试。
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

export async function whisper(file: File,openAiOptions:OpenAIOptions): Promise<string> {
    const apiKey = openAiOptions.apiKey;
    const baseUrl = openAiOptions.completionEndpoint ? migrateOldUrl(openAiOptions.completionEndpoint)  : "https://api.openai.com/v1";
    const model = 'whisper-1';
  
    // Create a FormData object and append the file
    const formData = new FormData();
    formData.append('model', model);
    formData.append('file', file);
  
    // Send a request to the OpenAI API using a form post
    const response = await backOff(

    () => fetch(baseUrl + '/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
    }), retryOptions);

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
    baseURL: options.completionEndpoint,
    dangerouslyAllowBrowser: true
  });

  // TODO : fix this typing loop
  // @ts-ignore  
  const imageSizeRequest: OpenAI.ImageGenerateParams["size"] = options.dalleImageSize ?
  options.dalleImageSize!.includes('x') 
    ? options.dalleImageSize 
    : `${options.dalleImageSize}x${options.dalleImageSize}` : '256x256';  

  const imageParameters: OpenAI.ImageGenerateParams = {
    prompt,
    n: 1,
    size: imageSizeRequest,
    model: options.dalleModel,
    quality: options.dalleQuality,
    style: options.dalleStyle
  };

  const response = await backOff(
    () =>
      openai.images.generate(imageParameters),
    retryOptions
  );
  return response.data[0].url;
}

export async function openAI(
  input: string,
  openAiOptions: OpenAIOptions
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
  const engine = options.completionEngine!;

  const openai = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.completionEndpoint
  });
  try {
    if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4")) {
      const inputMessages:OpenAI.Chat.CreateChatCompletionRequestMessage[] =  [{ role: "user", content: input }];
      if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
        inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });

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
      const response = await backOff(() =>
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
  } catch (e: any) {
    if (e?.response?.data?.error) {
      console.error(e?.response?.data?.error);
      throw new Error(e?.response?.data?.error?.message);
    } else {
      throw e;
    }
  }
}
// 10.24:push24/25 测试25次，24次无bug，详细注释版 
// openAIWithStream 函数 解释版：负责与 OpenAI API 交互，处理流式响应，并逐步拼接结果。
/* export async function openAIWithStream(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
  const engine = options.completionEngine!;

  try {
      // 如果模型是 gpt-3.5、gpt-4 或 gpt-4o，则使用聊天完成接口 (/chat/completions)
    if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4") || engine.startsWith("gpt-4o")) {
      // 这些调试信息可能会暴露敏感信息（如 API 地址），因此需要谨慎使用，并在部署前移除或禁用
      // console.log("engine is: ", engine); // 添加日志输出
      // console.log("\nchatCompletionEndpoint is: ", options.completionEndpoint); // 添加日志输出

      // inputMessages：这是一个数组，包含一个或多个消息对象，每个消息对象表示一个对话中的消息
      // { role: "user", content: input }：这是一个消息对象，表示用户发送的消息；input 是传入函数的参数，表示用户输入的内容。
      const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: "user", content: input }];
      if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
        // unshift 方法：在数组的开头添加一个或多个元素
        // { role: "system", content: openAiOptions.chatPrompt }：这是一个消息对象，表示系统发送的消息；
        // openAiOptions.chatPrompt 是用户提供的系统提示
        // 这里表示：在 inputMessages 数组的开头添加一个系统消息，内容为 openAiOptions.chatPrompt
        inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
      }
      // body：这是一个对象，包含发送给 OpenAI API 的请求体数据。
      const body = {
        messages: inputMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: engine,
        stream: true,
        // 如果单独增加该代码 只是为了当前健壮性和未来扩展性以及请求体的灵活性；
        // 本函数因为只处理 gpt-3.5、gpt-4 或 gpt-4o，因此用不上这个设置
        // 为了强调这个函数不用来处理 gpts 的调用（下面有单独处理 gpts 赋值的函数 openAIWithStreamGpts），此处特意不对其进行赋值 以防引起误解
        // ...(options.gpts ? { gpts: options.gpts } : {}),
      };
      const response = await backOff(
        () =>
          fetch(`${options.completionEndpoint}/chat/completions`, {
            method: "POST",
            // 将 JavaScript 对象 body 转换为 JSON 字符串。
            // body: JSON.stringify(body)：将转换后的 JSON 字符串作为请求体的一部分，发送给 OpenAI API。
            body: JSON.stringify(body),
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            }
          }).then((response) => {
            if (response.ok && response.body) {
              // response.body：这是一个 ReadableStream 对象，表示从服务器返回的响应体。
              // pipeThrough(new TextDecoderStream())：将 ReadableStream 转换为文本流。TextDecoderStream 用于解码二进制数据为文本。
              //## getReader()：获取一个读取器，用于逐块读取流中的数据
              //## 这一行代码是关键，它创建了一个读取器，可以逐步读取从 OpenAI API 返回的响应内容。这使得每次读取到一个内容块时，都会触发内容回调函数 async (content: string) => {...}，从而实现分段更新。
              
              //## 正是由于这种读取器和循环机制，使得内容可以分段读取和处理，从而实现了分段更新
              const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
              let result = "";
              // 定义一个递归函数 const readStream = (): any => {...}，用于逐块读取流中的数据。
              const readStream = (): any =>
                // 读取流中的下一个数据块
                reader.read().then(({ value, done }) => {
                  // 如果 done 为 true，表示已读取完所有数据
                  if (done) {
                    reader.cancel();
                    onStop();
                    // 返回一个包含最终结果的 Promise。
                    return Promise.resolve({ choices: [{ message: { content: result } }] });
                  }
                  //## 将读取的数据块解析为实际的数据；getDataFromStreamValue 是一个辅助函数，用于从流值中提取数据。
                  const data = getDataFromStreamValue(value);
                  // 检查数据是否存在且有效。
                  if (!data || !data[0]) {
                    return readStream();
                  }

                  let res = "";
                  for (let i = 0; i < data.length; i++) {
                    // 将每个数据项的内容拼接到 res 中。
                    res += data[i].choices[0]?.delta?.content || "";
                  }
                  result += res;
                  //## 每次循环：调用 onContent 内容回调函数，将内容块拼接到 result 中，传递当前数据块的内容
                  onContent(res);
                  // 递归调用 readStream，继续读取下一数据块
                  return readStream();
                });
              return readStream();
            } else {
              // 如果响应状态不为 ok 或响应体不存在，返回一个拒绝的 Promise，携带响应对象。
              // Promise.reject(response)：创建一个立即拒绝的 Promise，拒绝的原因是 response。
              // response：通常是一个包含错误信息的响应对象。
              // 用途：在处理请求失败的情况下，使用 Promise.reject 可以将错误传递给上层的错误处理逻辑。
              return Promise.reject(response);
            }
          }),
        retryOptions
      );
      // response as OpenAI.Chat.Completions.ChatCompletion：将 response 断言为 OpenAI.Chat.Completions.ChatCompletion 类型
      // ?.choices：安全访问 choices 属性，如果 response 为 null 或 undefined，则返回 undefined。
      // 检查响应  - 如果响应存在且格式正确 - 提取内容并返回
      const choices = (response as OpenAI.Chat.Completions.ChatCompletion)?.choices;
      if (
        choices &&
        choices[0] &&
        choices[0].message &&
        choices[0].message.content &&
        choices[0].message.content.length > 0
      ) {
        // 调用 trimLeadingWhitespace 函数，移除消息内容开头的空白字符。
        return trimLeadingWhitespace(choices[0].message.content);
      } else {
        return null;
      }
    } else {
      // 条件: 如果模型不是 gpt-3.5、gpt-4 或 gpt-4o，则使用普通完成接口 (/completions)。
      const body = {
        prompt: input,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: engine,
        stream: true,
      // ...(options.gpts ? { gpts: options.gpts } : {}),
      };
      // 使用 backOff 处理重试逻辑
      const response = await backOff(
        () =>
          // 使用 fetch 发送 POST 请求到 OpenAI API。
          fetch(`${options.completionEndpoint}/completions`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            }
          }).then((response) => {
            // 检查响应状态：确保响应状态为 ok 且有响应体。
            if (response.ok && response.body) {
              // 读取流：使用 TextDecoderStream 解码响应体，逐块读取数据。
              const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
              let result = "";
              const readStream = (): any =>
                reader.read().then(({ value, done }) => {
                  if (done) {
                    reader.cancel();
                    // 完成流：流读取完成后，调用 onStop 回调函数。
                    onStop();
                    return Promise.resolve({ choices: [{ text: result }] });
                  }

                  const data = getDataFromStreamValue(value);
                  if (!data || !data[0]) {
                    return readStream();
                  }

                  let res = "";
                  for (let i = 0; i < data.length; i++) {
                    res += data[i].choices[0]?.text || "";
                  }
                  result += res;
                  // 处理数据：将每块数据拼接成最终结果，并调用 onContent 回调函数
                  onContent(res);
                  return readStream();
                });
              return readStream();
            } else {
              return Promise.reject(response);
            }
          }),
        retryOptions
      );
      const choices = (response as OpenAI.Completion)?.choices;
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
  } catch (e: any) {
    if (e?.response?.data?.error) {
      console.error(e?.response?.data?.error);
      throw new Error(e?.response?.data?.error?.message);
    } else {
      throw e;
    }
  }
} */


// 升级2-1-1-1-1-push7/9-1-push12/12-1-10.24:push24/25 测试25次，24次无bug，去除注释版（和上述注释版代码相同，仅仅是无注释的简洁版）
// 和10.25号的原函数相比，只是：新增功能：支持 gpt-4o 引擎；调试信息：新增了两条被注释掉的调试信息，
/* export async function openAIWithStream(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
  const engine = options.completionEngine!;

  try {
    if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4") || engine.startsWith("gpt-4o")) {
      // console.log("engine is: ", engine);
      // console.log("\nchatCompletionEndpoint is: ", options.completionEndpoint);
      const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: "user", content: input }];
      if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
        inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
      }
      const body = {
        messages: inputMessages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: engine,
        stream: true
      };
      const response = await backOff(
        () =>
          fetch(`${options.completionEndpoint}/chat/completions`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            }
          }).then((response) => {
            if (response.ok && response.body) {
              const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
              let result = "";
              const readStream = (): any =>
                reader.read().then(({ value, done }) => {
                  if (done) {
                    reader.cancel();
                    onStop();
                    return Promise.resolve({ choices: [{ message: { content: result } }] });
                  }

                  const data = getDataFromStreamValue(value);
                  if (!data || !data[0]) {
                    return readStream();
                  }

                  let res = "";
                  for (let i = 0; i < data.length; i++) {
                    res += data[i].choices[0]?.delta?.content || "";
                  }
                  result += res;
                  onContent(res);
                  return readStream();
                });
              return readStream();
            } else {
              return Promise.reject(response);
            }
          }),
        retryOptions
      );
      const choices = (response as OpenAI.Chat.Completions.ChatCompletion)?.choices;
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
      const body = {
        prompt: input,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: engine,
        stream: true
      };
      const response = await backOff(
        () =>
          fetch(`${options.completionEndpoint}/completions`, {
            method: "POST",
            body: JSON.stringify(body),
            headers: {
              Authorization: `Bearer ${options.apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'text/event-stream'
            }
          }).then((response) => {
            if (response.ok && response.body) {
              const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
              let result = "";
              const readStream = (): any =>
                reader.read().then(({ value, done }) => {
                  if (done) {
                    reader.cancel();
                    onStop();
                    return Promise.resolve({ choices: [{ text: result }] });
                  }

                  const data = getDataFromStreamValue(value);
                  if (!data || !data[0]) {
                    return readStream();
                  }

                  let res = "";
                  for (let i = 0; i < data.length; i++) {
                    res += data[i].choices[0]?.text || "";
                  }
                  result += res;
                  onContent(res);
                  return readStream();
                });
              return readStream();
            } else {
              return Promise.reject(response);
            }
          }),
        retryOptions
      );
      const choices = (response as OpenAI.Completion)?.choices;
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
  } catch (e: any) {
    if (e?.response?.data?.error) {
      console.error(e?.response?.data?.error);
      throw new Error(e?.response?.data?.error?.message);
    } else {
      throw e;
    }
  }
} */

  // 调试信息：新增的调试信息有助于开发和维护阶段的问题排查，尤其是在复杂的生产环境中。
  // 异步函数：将 readStream 改为异步函数，使代码更易读，避免了回调地狱，提高了代码的可维护性。
  // 超时机制：增加了超时机制，提高了系统的健壮性和稳定性，防止因长时间无响应而导致的资源浪费。
  // 错误处理：增强了错误处理，提供了更详细的错误信息，并对前端用户进行了友好的提示，提高了用户体验。

  // 更新后的第三次优化函数 10次测试有8次没有出错，出错的2次，再测试还是正确的； 只是出现：Unknown OpenAI Error的提醒框 但可以作为一个过渡版本 还不错

  export async function openAIWithStream(
    input: string,
    openAiOptions: OpenAIOptions,
    onContent: (content: string) => void,
    onStop: () => void
  ): Promise<string | null> {
    const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
    const engine = options.completionEngine!;
  
    try {
      if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4") || engine.startsWith("gpt-4o")) {
        console.log("engine is: ", engine);
        console.log("\nchatCompletionEndpoint is: ", options.completionEndpoint);
  
        const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: "user", content: input }];
        if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
          inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
        }
        const body = {
          messages: inputMessages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          model: engine,
          stream: true
        };
  
        const response = await backOff(
          () =>
            fetch(`${options.completionEndpoint}/chat/completions`, {
              method: "POST",
              body: JSON.stringify(body),
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
              }
            }).then(async (response) => {
              if (response.ok && response.body) {
                const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                let result = "";
                const readStream = async (): Promise<any> => {
                  const { value, done } = await reader.read();
                  if (done) {
                    reader.cancel();
                    onStop();
                    return Promise.resolve({ choices: [{ message: { content: result } }] });
                  }
  
                  if (value !== null && value !== undefined) {
                    const data = getDataFromStreamValue(value);
                    if (data && data[0]) {
                      let res = "";
                      for (let i = 0; i < data.length; i++) {
                        res += data[i].choices[0]?.delta?.content || "";
                      }
                      result += res;
                      onContent(res);
                    }
                  }
  
                  const timeoutId = setTimeout(() => {
                    reader.cancel();
                    onStop();
                    console.error("Stream timed out");
                    throw new Error("Stream timed out");
                  }, 30000);
  
                  const promise = readStream();
                  promise.then(() => clearTimeout(timeoutId));
                  return promise;
                };
                return readStream().catch(error => {
                  console.error("Error in readStream:", error);
                  throw error;
                });
              } else {
                return Promise.reject(response);
              }
            }),
          retryOptions
        );
  
        if (response) {
          const choices = (response as OpenAI.Chat.Completions.ChatCompletion)?.choices;
          if (choices && choices[0] && choices[0].message && choices[0].message.content && choices[0].message.content.length > 0) {
            return trimLeadingWhitespace(choices[0].message.content);
          } else {
            return null;
          }
        } else {
          return null;
        }
      } else {
        const body = {
          prompt: input,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          model: engine,
          stream: true
        };
  
        const response = await backOff(
          () =>
            fetch(`${options.completionEndpoint}/completions`, {
              method: "POST",
              body: JSON.stringify(body),
              headers: {
                Authorization: `Bearer ${options.apiKey}`,
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
              }
            }).then(async (response) => {
              if (response.ok && response.body) {
                const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
                let result = "";
                const readStream = async (): Promise<any> => {
                  const { value, done } = await reader.read();
                  if (done) {
                    reader.cancel();
                    onStop();
                    return Promise.resolve({ choices: [{ text: result }] });
                  }
  
                  if (value !== null && value !== undefined) {
                    const data = getDataFromStreamValue(value);
                    if (data && data[0]) {
                      let res = "";
                      for (let i = 0; i < data.length; i++) {
                        res += data[i].choices[0]?.text || "";
                      }
                      result += res;
                      onContent(res);
                    }
                  }
  
                  const timeoutId = setTimeout(() => {
                    reader.cancel();
                    onStop();
                    console.error("Stream timed out");
                    throw new Error("Stream timed out");
                  }, 30000);
  
                  const promise = readStream();
                  promise.then(() => clearTimeout(timeoutId));
                  return promise;
                };
                return readStream().catch(error => {
                  console.error("Error in readStream:", error);
                  throw error;
                });
              } else {
                return Promise.reject(response);
              }
            }),
          retryOptions
        );
  
        if (response) {
          const choices = (response as OpenAI.Completion)?.choices;
          if (choices && choices[0] && choices[0].text && choices[0].text.length > 0) {
            return trimLeadingWhitespace(choices[0].text);
          } else {
            return null;
          }
        } else {
          return null;
        }
      }
    } catch (e: any) {
      // 统一错误提示
      const errorMessage = "抱歉，网络略有不畅导致系统超时，请稍后重试";
      console.error(errorMessage);
      const errorMessageElement = document.getElementById('error-message');
      if (errorMessageElement) {
        errorMessageElement.textContent = errorMessage;
      }
      throw new Error(errorMessage);
    }
  }






function getDataFromStreamValue(value: string) {
  const matches = [...value.split("data:")];
  return matches.filter(content => content.trim().length > 0 && !content.trim().includes("[DONE]"))
    .map(match =>{
      try{
        return JSON.parse(match)
      } catch(e) {
        return null
      }
    });
}

function trimLeadingWhitespace(s: string): string {
  return s.replace(/^\s+/, "");
}



// 该版拼接正确，但不断有浮窗产生
      /* export async function openAIWithStreamGpts(
        input: string,
        openAiOptions: OpenAIOptions,
        onContent: (content: string) => void,
        onStop: () => void
      ): Promise<string | null> {
        const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
      
        try {
          const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: "user", content: input }];
          if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
            inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
          }
      
          const body = {
            messages: inputMessages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
            model: options.gpts,
            stream: true, // 启用流式传输
          };
      
          const response = await backOff(
            () =>
              fetch(`${options.completionEndpoint}/chat/completions`, {
                method: "POST",
                body: JSON.stringify(body),
                headers: {
                  Authorization: `Bearer ${options.apiKey}`,
                  'Content-Type': 'application/json',
                  'Accept': 'text/event-stream',
                  'User-Agent': 'Apifox/1.0.0 (https://apifox.com)',
                },
                redirect: 'follow'
              }),
            retryOptions
          );
      
          if (response.ok && response.body) {
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let result = "";
      
            const readStream = (): any =>
              reader.read().then(({ value, done }) => {
                if (done) {
                  reader.cancel();
                  onStop();
                  return Promise.resolve({ choices: [{ message: { content: result } }] });
                }
      
                const data = getDataFromStreamValue(value);
                if (!data || !data[0]) {
                  return readStream();
                }
      
                let res = "";
                for (let i = 0; i < data.length; i++) {
                  res += data[i].choices[0]?.delta?.content || "";
                }
                result += res;
                onContent(res);
                return readStream();
              });
      
            return readStream();
          } else {
            throw new Error(`API request failed with status ${response.status}`);
          }
        } catch (e: any) {
          if (e?.response?.data?.error) {
            console.error(e?.response?.data?.error);
            throw new Error(e?.response?.data?.error?.message);
          } else {
            throw e;
          }
        } finally {
          onStop();
        }
      } */

// 升级2-2-1-1-1-push7/9-1-push12/12
export async function openAIWithStreamGpts(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };

  try {
    const inputMessages: OpenAI.Chat.CreateChatCompletionRequestMessage[] = [{ role: "user", content: input }];
    if (openAiOptions.chatPrompt && openAiOptions.chatPrompt.length > 0) {
      inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
    }

    const body = {
      messages: inputMessages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      model: options.gpts,  // 单独增加
      stream: true,
    };

    const response = await backOff(
      () =>
        fetch(`${options.completionEndpoint}/chat/completions`, {    // 内嵌了gpts（为model）的body体，只请求/chat/completions格式
          method: "POST",
          body: JSON.stringify(body),// 此处有内嵌的 model: options.gpts
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
            'User-Agent': 'Apifox/1.0.0 (https://apifox.com)', //单独增加
          },
          redirect: 'follow'//单独增加
        }).then(async (response) => {
          if (response.ok && response.body) {
            const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
            let result = "";

            const readStream = (): any =>
              reader.read().then(({ value, done }) => {
                if (done) {
                  reader.cancel();
                  onStop();
                  return Promise.resolve({ choices: [{ message: { content: result } }] });
                }

                const data = getDataFromStreamValue(value);
                if (!data || !data[0]) {
                  return readStream();
                }

                let res = "";
                for (let i = 0; i < data.length; i++) {
                  res += data[i].choices[0]?.delta?.content || "";
                }
                result += res;
                onContent(res);
                return readStream();
              });

            return readStream();
          } else if (response.status === 429) {
            console.warn("Rate limit exceeded. Retrying...");
            throw new Error("Rate limit exceeded.");
          } else {
            throw new Error(`API request failed with status ${response.status}`);
          }
        }),
      retryOptions
    );

    if (response) {
      const choices = (response as OpenAI.Chat.Completions.ChatCompletion)?.choices;
      if (choices && choices[0] && choices[0].message && choices[0].message.content && choices[0].message.content.length > 0) {
        return trimLeadingWhitespace(choices[0].message.content);
      }
    }

    return null;
  } catch (e: any) {
    console.error("Error in openAIWithStreamGpts:", e);
    if (e?.response?.data?.error) {
      console.error(e?.response?.data?.error);
      throw new Error(e?.response?.data?.error?.message);
    } else {
      throw e;
    }
  } finally {
    onStop();
  }
}

// 新增函数2 系列
export async function readImageURL(url: string, openAiOptions: OpenAIOptions): Promise<string> {
  const apiKey = openAiOptions.apiKey;
  const baseUrl = openAiOptions.completionEndpoint ? openAiOptions.completionEndpoint : "https://gptgod.cloud/v1";  
                                                                                      // https://api.openai.com/v1
  const model = openAiOptions.completionEngine? openAiOptions.completionEngine: "gpt-4o-mini";

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const message = {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "What's in this image? 请详细解读一下该图片"    //此处命令可以根据需求来改进和自定义！！！
      },
      {
        "type": "image_url",
        "image_url": {
          "url": url
        }
      }
    ]
  };

  const body = JSON.stringify({
    model: model,
    messages: [message],
    max_tokens: 300
  });

  // Send a request to the OpenAI API using JSON body
  const response = await backOff(
    () => fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: headers,
      body: body,
    }), retryOptions);

  // Check if the response status is OK
  if (!response.ok) {
    throw new Error(`Error reading image: ${response.statusText}`);
  }

  // Parse the response JSON and extract the description
  const jsonResponse = await response.json();
  return jsonResponse.choices[0].message.content;
}



//test增加
// 读取本地图片并调用 OpenAI API 新增函数

export async function readLocalImageURL(imagePath: string, openAiOptions: OpenAIOptions): Promise<string> {
  const apiKey = openAiOptions.apiKey;
  const baseUrl = openAiOptions.completionEndpoint || "https://api.openai.com/v1";
  const model = openAiOptions.completionEngine || "gpt-4o-mini";

  // 检查图像路径是否有效
  if (!imagePath) {
    throw new Error("Invalid image path provided.");
  }

  // 读取本地图片并编码为 Base64
  const base64Image = await encodeImageToBase64(imagePath);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  };

  const message = {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": "What's in this image? 请详细解读一下该图片"
      },
      {
        "type": "image_url",
        "image_url": {
          "url": `data:image/jpeg;base64,${base64Image}`
        }
      }
    ]
  };

  const body = JSON.stringify({
    model: model,
    messages: [message],
    max_tokens: 300
  });

  try {
    // 发送 API 请求
    const response = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: headers,
      body: body,
    });

    if (!response.ok) {
      throw new Error(`Error reading image: ${response.statusText}`);
    }

    const jsonResponse = await response.json();
    return jsonResponse.choices[0].message.content;
  } catch (error) {
    console.error("Error in readLocalImageURL:", error);
    throw error;  // 重新抛出错误
  }
}


async function encodeImageToBase64(imagePath: string): Promise<string> {
  try {
    console.log('Image path:', imagePath);

    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined' && typeof FileReader !== 'undefined') {
      // 创建一个 FileReader 对象
      const reader = new FileReader();

      // 处理相对路径
      let fullImagePath = imagePath;

      // 如果路径是 lsp:// 协议，尝试转换为有效的 HTTP 路径
      if (imagePath.startsWith('lsp://')) {
        // 假设你有一个中间服务器可以处理这些请求
        fullImagePath = `http://your-middle-server.com/proxy/${encodeURIComponent(imagePath)}`;
      } else {
        fullImagePath = new URL(imagePath, window.location.href).href;
      }

      console.log('Full image path:', fullImagePath);

      // 读取文件内容
      const response = await fetch(fullImagePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.statusText}`);
      }
      const blob = await response.blob();

      return new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          if (reader.result && typeof reader.result === 'string') {
            resolve(reader.result.replace('data:', '').replace(/^.+,/, ''));
          } else {
            reject(new Error('Failed to read file as Base64'));
          }
        };
        reader.onerror = () => {
          reject(new Error('Failed to read file as Base64'));
        };
        reader.readAsDataURL(blob);
      });
    } else {
      // 如果在 Node.js 环境中，使用 fs 和 util
      const fs = require('fs');
      const path = require('path');
      const { promisify } = require('util');

      const readFile = promisify(fs.readFile);

      // 解析相对路径
      const absolutePath = path.resolve(__dirname, imagePath);
      console.log('Absolute path:', absolutePath);

      // 读取文件内容
      const buffer = await readFile(absolutePath, null); // 使用 null 以获取 Buffer 对象

      // 确保 buffer 是 Buffer 类型
      if (!(buffer instanceof Buffer)) {
        throw new Error('Failed to read file as Buffer');
      }

      // 将文件内容编码为 Base64
      const base64Image = buffer.toString('base64');
      return base64Image;
    }
  } catch (error) {
    console.error('Failed to encode image to Base64:', error);
    throw error;
  }
}