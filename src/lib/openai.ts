import OpenAI from "openai";
import "@logseq/libs";
import { backOff } from "exponential-backoff";

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
// openAIWithStream 函数：负责与 OpenAI API 交互，处理流式响应，并逐步拼接结果。
export async function openAIWithStream(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };
  const engine = options.completionEngine!;

  try {
    if (engine.startsWith("gpt-3.5") || engine.startsWith("gpt-4") || engine.startsWith("gpt-4o-mini")) {
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
        ...(options.gpts ? { gpts: options.gpts } : {}),   //代码增加
      }
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
              let result = ""
              // 定义一个递归函数const readStream = (): any => {...}，用于逐块读取流中的数据。
              const readStream = (): any =>
                // 读取流中的下一个数据块
                reader.read().then(({
                                      //## value：当前读取的数据块。
                                      value,
                                      // done：布尔值，表示是否已读取完所有数据。
                                      done
                                    }) => {
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

                  let res = ""
                  for (let i = 0; i < data.length; i++) {
                    // 将每个数据项的内容拼接到 res 中。
                    res += data[i].choices[0]?.delta?.content || ""
                  }
                  result += res
                  //## 每次循环：调用 onContent 内容回调函数，将内容块拼接到 result 中，传递当前数据块的内容
                  onContent(res)
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
      const body = {
        prompt: input,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: engine,
        stream: true,
        ...(options.gpts ? { gpts: options.gpts } : {}),   //代码增加
      }
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
              let result = ""
              const readStream = (): any =>
                reader.read().then(({
                                      value,
                                      done
                                    }) => {
                  if (done) {
                    reader.cancel();
                    // 完成流：流读取完成后，调用 onStop 回调函数。
                    onStop();
                    return Promise.resolve({ choices: [{ text: result }]});
                  }

                  const data = getDataFromStreamValue(value);
                  if (!data || !data[0]) {
                    return readStream();
                  }

                  let res = ""
                  for (let i = 0; i < data.length; i++) {
                    res += data[i].choices[0]?.text || ""
                  }
                  result += res
                  // 处理数据：将每块数据拼接成最终结果，并调用 onContent 回调函数
                  onContent(res)
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




//新增函数1
export async function openAIWithStreamGpts(
  input: string,
  openAiOptions: OpenAIOptions,
  onContent: (content: string) => void,
  onStop: () => void
): Promise<string | null> {
  const options = { ...OpenAIDefaults(openAiOptions.apiKey), ...openAiOptions };

  try {
    if (options.gpts === "gpt-4-gizmo-g-B3hgivKK9") {
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
        stream: false,
        ...(options.gpts ? { gpts: options.gpts } : {}),
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

      if (response.ok) {
        const data = await response.json();
        const choices = (data as OpenAI.Chat.Completions.ChatCompletion)?.choices;
        if (
          choices &&
          choices[0] &&
          choices[0].message &&
          choices[0].message.content &&
          choices[0].message.content.length > 0
        ) {
          onContent(choices[0].message.content);
          return trimLeadingWhitespace(choices[0].message.content);
        } else {
          return null;
        }
      } else {
        throw new Error(`API request failed with status ${response.status}`);
      }
    } else {
      const body = {
        prompt: input,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
        model: options.gpts,
        stream: false,
        ...(options.gpts ? { gpts: options.gpts } : {}),
      };

      const response = await backOff(
        () =>
          fetch(`${options.completionEndpoint}/completions`, {
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

      if (response.ok) {
        const data = await response.json();
        const choices = (data as OpenAI.Completion)?.choices;
        if (
          choices &&
          choices[0] &&
          choices[0].text &&
          choices[0].text.length > 0
        ) {
          onContent(choices[0].text);
          return trimLeadingWhitespace(choices[0].text);
        } else {
          return null;
        }
      } else {
        throw new Error(`API request failed with status ${response.status}`);
      }
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
}






// 新增函数2 系列
export async function readImageURL(url: string, openAiOptions: OpenAIOptions): Promise<string> {
  const apiKey = openAiOptions.apiKey;
  const baseUrl = openAiOptions.completionEndpoint ? openAiOptions.completionEndpoint : "https://api.openai.com/v1";
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