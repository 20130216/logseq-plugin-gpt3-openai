import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { DalleImageSize, OpenAIOptions } from "./openai";

interface PluginOptions extends OpenAIOptions {
  injectPrefix?: string;
}
// 插件初始化时的默认设置；settingsSchema 中的默认值会在用户输入新值后被覆盖
// 后端定义的数据结构（例如 SettingSchemaDesc[]）可以直接用于前端 UI 的生成，从而实现自动生成表格的功能。
export const settingsSchema: SettingSchemaDesc[] = [
  {
    key: "openAIKey",
    type: "string",
    default: "",
    title: "填入API Key",// "openAI API Key",
    description:
      "请把您购买的openAI API的Key值填入此处",//原来："Your OpenAI API key. You can get one at https://beta.openai.com",
  },
  {
    key: "openAICompletionEngine",
    type: "string",
    default: "gpt-4o-mini", //原来：gpt-3.5-turbo
    title: "填入你要使用的大模型名称",//"OpenAI Completion Engine"
    description: "推荐：<br/>" +"1.默认的gpt-4o-mini是性价比最高的OpenAI的模型；<br/>" +"2.ChatGPT-4o-latest是在世界范围内长期霸榜多个大模型评测榜单榜首的模型（虽略贵，但效果爆表）", 
                 //原来："See Engines in OpenAI docs."
  },
  {
    key: "chatCompletionEndpoint",
    type: "string",
    default: "https://api.openai.com/v1",
    title: "OpenAI API Completion Endpoint",
    description:
      "非专业人士此处不要随意更改此处设置！",//"The endpoint to use for OpenAI API completion requests. You shouldn't need to change this.",
  },
    //代码新增：gpts相关
    {
      key: "gpts",
      type: "string",
      default: "",//原来"gpt-4-gizmo-g-B3hgivKK9",
      title: "gpts对应ID",
      // description: "See Engines in OpenAI docs.",
      description:"非专业人士此处不要随意更改此处设置！",// "请填入要调用的chatgpt中的gpts ID",//代码修改：为中文
    },
  {
    key: "chatPrompt",//设置在system对应的系统提示词 inputMessages.unshift({ role: "system", content: openAiOptions.chatPrompt });
    type: "string",
    default:
      "Do not refer to yourself in your answers. Do not say as an AI language model，默认用中文回复！",//添加：默认用中文回复
    title: "OpenAI Chat Prompt",
    description:
      "设定系统提示词，初始化模型如何按约定回复你的问题！"//"Initial message that tells ChatGPT how to answer. Only used for gpt-3.5. See https://platform.openai.com/docs/guides/chat/introduction for more info.",
  },
  {
    key: "openAITemperature",
    type: "number",
    default: 1.0,
    title: "OpenAI Temperature（0--2）",
    description:
      "控制生成文本时的随机性和创造性;越靠近0，输出结果确定性越高，但文本更加保守、重复性更高；越靠近2，结果会更随机，更有创造性，但内容越变得不那么连贯或符合逻辑<br/>"+
      "对于需要创意但仍需合理性和逻辑性的场景（例如广告文案、故事创作等），在保持文本连贯性和逻辑性的前提下，增加生成内容的多样性和创造性,大约在 0.7 到 1.2 之间是一个比较合适的选择."
      //"The temperature controls how much randomness is in the output.<br/>" +
      // "You can set a different temperature in your own prompt templates by adding a 'prompt-template' property to the block.",
  },
  {
    key: "openAIMaxTokens",
    type: "number",
    default: 1000,
    title: "OpenAI Max Tokens",
    description:
      "The maximum amount of tokens to generate. Tokens can be words or just chunks of characters. The number of tokens processed in a given API request depends on the length of both your inputs and outputs. As a rough rule of thumb, 1 token is approximately 4 characters or 0.75 words for English text. One limitation to keep in mind is that your text prompt and generated completion combined must be no more than the model's maximum context length (for most models this is 2048 tokens, or about 1500 words).",
  },
  {
    key: "injectPrefix",
    type: "string",
    default: "",
    title: "Output prefix",
    description:
      "Prepends the output with this string. Such as a tag like [[gpt3]] or markdown like > to blockquote. Add a space at the end if you want a space between the prefix and the output or \\n for a linebreak.",
  },
  {
    key: "dalleImageSize",
    type: "string",
    default: "1024",
    title: "DALL-E Image Size",
    description:
      "Size of the image to generate. Can be 256, 512, or 1024 for dall-e-2;  Must be one of 1024x1024 , 1792x1024 , or 1024x1792 for dall-e-3 models.",
  },
  {
    key: "dalleModel",
    type: "string",
    default: "dall-e-3",
    title: "DALL-E Model",
    description: "The DALL-E model to use. Can be dall-e-2 or dall-e-3.",
  },
  {
    key: "dalleStyle",
    type: "string",
    default: "vivid",
    title: "Style",
    description:
      "The style of the generated images. Must be one of vivid or natural. Vivid causes the model to lean towards generating hyper-real and dramatic images. Natural causes the model to produce more natural, less hyper-real looking images.",
  },
  {
    key: "dalleQuality",
    type: "string",
    default: "standard",
    title: "Quality",
    description:
      "The quality of the image that will be generated. ‘hd’ creates images with finer details and greater consistency across the image. Defaults to ‘standard’.",
  },
  {
    key: "shortcutBlock",
    type: "string",
    default: "mod+j",
    title: "Keyboard Shortcut for /gpt-block",
    description: "",
  },
  {
    key: "popupShortcut",
    type: "string",
    default: "mod+g",
    title: "Keyboard Shortcut for /gpt popup",
    description: "",
  },
];
// 将字符串中出现的 \\n（转义的换行符）替换为实际的换行符 \n。
function unescapeNewlines(s: string) {
  return s.replace(/\\n/g, "\n");
}

export function getOpenaiSettings(): PluginOptions {
  const apiKey = logseq.settings!["openAIKey"];
  const completionEngine = logseq.settings!["openAICompletionEngine"];
  const injectPrefix = unescapeNewlines(logseq.settings!["injectPrefix"]);
  const temperature = Number.parseFloat(logseq.settings!["openAITemperature"]);
  const maxTokens = Number.parseInt(logseq.settings!["openAIMaxTokens"]);
  const dalleImageSize = logseq.settings!["dalleImageSize"] as DalleImageSize;
  const dalleModel = logseq.settings!["dalleModel"];
  const dalleStyle = logseq.settings!["dalleStyle"];
  const dalleQuality = logseq.settings!["dalleQuality"];
  const gpts = logseq.settings!["gpts"]; //代码新增
  const chatPrompt = logseq.settings!["chatPrompt"];
  const completionEndpoint = logseq.settings!["chatCompletionEndpoint"];
  return {
    apiKey,
    completionEngine,
    temperature,
    maxTokens,
    dalleImageSize,
    dalleModel,
    dalleQuality,
    dalleStyle,
    injectPrefix,
    gpts, //代码新增
    chatPrompt,
    completionEndpoint,
  };
}
