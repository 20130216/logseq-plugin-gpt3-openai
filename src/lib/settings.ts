import { SettingSchemaDesc } from "@logseq/libs/dist/LSPlugin";
import { DalleImageSize, DalleModel, DalleQuality, DalleStyle, OpenAIOptions } from "./openai";

interface PluginOptions extends OpenAIOptions {
  openAIKey: string;
  openAICompletionEngine: string;
  chatCompletionEndpoint: string;
  gpts?: string;
  chatPrompt?: string;
  openAITemperature?: number;
  openAIMaxTokens?: number;
  dalleImageSize?: DalleImageSize;
  dalleModel?: DalleModel;
  dalleQuality?: DalleQuality;
  dalleStyle?: DalleStyle;
  shortcutBlock?: string;
  popupShortcut?: string;
  injectPrefix?: string;
  customHeaders?: string;
  disabled?: boolean;
  useProxy?: boolean;
  proxyEndpoint?: string;
}

// 将字符串中的 \n 转换为实际换行符
function unescapeNewlines(s: string) {
  return s.replace(/\\n/g, "\n");
}

// 插件设置的 schema 定义
export const settingsSchema: SettingSchemaDesc[] = [
  {
    key: "openAIKey",
    type: "string",
    default: "",
    title: "填入API Key", // "Fill in API Key"
    description: "请把您购买的openAI API的Key值填入此处", // "Please fill in the key value of your purchased openAI API here"
  },
  {
    key: "openAICompletionEngine",
    type: "string",
    default: "gpt-4o-mini",
    title: "填入你要使用的大模型名称", // "Fill in the name of the large model you want to use"
    description: "推荐：<br/>1.默认的gpt-4o-mini是性价比最高的OpenAI的模型；<br/>2.ChatGPT-4o-latest是在世界范围内长期霸榜多个大模型评测榜单榜首的模型（虽略贵，但效果爆表）", // "Recommended models and their features"
  },
  {
    key: "chatCompletionEndpoint",
    type: "string",
    default: "https://api.shubiaobiao.cn/v1",
    title: "API接口地址", // "API interface address"
    description: "非专业人士此处不要随意更改此处设置！", // "Do not change this setting unless you are a professional"
  },
  {
    key: "gpts",
    type: "string",
    default: "",
    title: "GPTs模型ID", // "GPTs model ID"
    description: "非专业人士此处不要随意更改此处设置！", // "Do not change this setting unless you are a professional"
  },
  {
    key: "chatPrompt",
    type: "string",
    default: "Do not refer to yourself in your answers. Do not say as an AI language model，默认用中文回复！",
    title: "系统提示词", // "System prompt"
    description: "设定系统提示词，初化模型如何按约定回复你的问题！", // "Set system prompt to initialize model response behavior"
  },
  {
    key: "openAITemperature",
    type: "string",
    default: "1.0",
    title: "模型温度值", // "Model temperature value"
    description: "控制模型输出的随机性。较高的值会使输出更加多样化和创意性，较低的值会使输出更加集中和确定性。建议创意性任务使用0.9，明确答案的任务使用0。", // "Controls output randomness. Higher for creativity, lower for consistency"
  },
  {
    key: "openAIMaxTokens",
    type: "string",
    default: "1000",
    title: "最大令牌数", // "Maximum token number"
    description: "生成内容的最大长度限制。", // "Maximum length limit for generated content"
  },
  {
    key: "dalleImageSize",
    type: "string",
    default: "1024",
    title: "图像尺寸", // "Image size"
    description: "生成图像的尺寸大小。可选值：256x256、512x512或1024x1024。", // "Size of generated images. Options: 256x256, 512x512, or 1024x1024"
  },
  {
    key: "dalleModel",
    type: "string",
    default: "dall-e-3",
    title: "DALL-E模型版本", // "DALL-E model version"
    description: "选择使��的DALL-E模型版本，可选dall-e-2或dall-e-3。", // "Choose DALL-E model version: dall-e-2 or dall-e-3"
  },
  {
    key: "dalleQuality",
    type: "string",
    default: "standard",
    title: "图像质量", // "Image quality"
    description: "生成图像的质量等级。'hd'模式会生成更细致和连贯的图像，默认为'standard'标准模式。", // "Quality level of generated images. 'hd' for higher detail, 'standard' by default"
  },
  {
    key: "dalleStyle",
    type: "string",
    default: "vivid",
    title: "图像风格", // "Image style"
    description: "生成图像的风格选择。'vivid'生动模式会生成更夸张和戏剧性的图像，'natural'自然模式会生成更自然、真实的图像。", // "Style of generated images. 'vivid' for dramatic, 'natural' for realistic"
  },
  {
    key: "shortcutBlock",
    type: "string",
    default: "mod+j",
    title: "区块命令快捷键", // "Block command shortcut"
    description: "用于触发/gpt-block命令的键盘快捷键。", // "Keyboard shortcut for /gpt-block command"
  },
  {
    key: "popupShortcut",
    type: "string",
    default: "mod+g",
    title: "弹窗命令快捷键", // "Popup command shortcut"
    description: "用于触发/gpt弹窗的键盘快捷键。", // "Keyboard shortcut for /gpt popup"
  },
  {
    key: "injectPrefix",
    type: "string",
    default: "",
    title: "注入前缀", // "Inject prefix"
    description: "在每次生成内容前添加的固定前缀文本。", // "Fixed prefix text added before each generation"
  },
  {
    key: "customHeaders",
    type: "string",
    default: "",
    title: "自定义请求头", // "Custom headers"
    description: "自定义的HTTP请求头", // "Custom HTTP headers"
  },
  {
    key: "disabled",
    type: "boolean",
    default: false,
    title: "禁用插件", // "Disable plugin"
    description: "是否禁用此插件", // "Whether to disable this plugin"
  },
  {
    key: "useProxy",
    type: "boolean",
    default: false,
    title: "使用代理", // "Use proxy"
    description: "是否使用代理服务器", // "Whether to use proxy server"
  },
  {
    key: "proxyEndpoint",
    type: "string",
    default: "",
    title: "代理服务器地址", // "Proxy endpoint"
    description: "代理服务器的地址", // "The endpoint of proxy server"
  }
];

// 获取设置值的函数
export function getOpenaiSettings(): PluginOptions {
  // 获取设置值时也按照相同顺序
  const apiKey = logseq.settings!["openAIKey"] as string;
  const completionEngine = logseq.settings!["openAICompletionEngine"] as string;
  const chatCompletionEndpoint = logseq.settings!["chatCompletionEndpoint"] as string;
  const gpts = logseq.settings!["gpts"] as string;
  const chatPrompt = logseq.settings!["chatPrompt"] as string;
  const temperature = Number.parseFloat(logseq.settings!["openAITemperature"] as string);
  const maxTokens = Number.parseInt(logseq.settings!["openAIMaxTokens"] as string);
  const dalleImageSize = logseq.settings!["dalleImageSize"] as DalleImageSize;
  const dalleModel = logseq.settings!["dalleModel"] as DalleModel;
  const dalleQuality = logseq.settings!["dalleQuality"] as DalleQuality;
  const dalleStyle = logseq.settings!["dalleStyle"] as DalleStyle;
  const shortcutBlock = logseq.settings!["shortcutBlock"] as string;
  const popupShortcut = logseq.settings!["popupShortcut"] as string;
  const injectPrefix = unescapeNewlines(logseq.settings!["injectPrefix"] as string);
  const customHeaders = logseq.settings!["customHeaders"] as string;
  const disabled = logseq.settings!["disabled"] as boolean;
  const useProxy = logseq.settings!["useProxy"] as boolean;
  const proxyEndpoint = logseq.settings!["proxyEndpoint"] as string;

  // 添加日志检查实际使用的配置
  console.log("Current OpenAI Settings:", {
    apiKey: apiKey ? `${apiKey.substring(0, 10)}...` : 'undefined',
    completionEngine,
    chatCompletionEndpoint,
    gpts,
  });

  // 返回值需要同时满足 OpenAIOptions 和 PluginOptions
  return {
    // OpenAIOptions 字段
    apiKey,                              // 从 OpenAIOptions 继承
    completionEngine,                    // 从 OpenAIOptions 继承
    chatCompletionEndpoint,             // 只保留一次

    // PluginOptions 字段
    openAIKey: apiKey,                   // "sk-fRajR8nRQKGbNCYp209c505e5412478a8e6e8d586a7a91Ea"
    openAICompletionEngine: completionEngine,  // "gpt-4o-mini"
    gpts,                                // "gpt-4-gizmo-g-B3hgivKK9"
    chatPrompt,                          // "Do not refer to yourself..."
    openAITemperature: temperature,      // 1
    openAIMaxTokens: maxTokens,          // 1000
    dalleImageSize,                      // "1024"
    dalleModel,                          // "dall-e-3"
    dalleQuality,                        // "standard"
    dalleStyle,                          // "vivid"
    shortcutBlock,                       // "mod+j"
    popupShortcut,                       // "mod+g"
    injectPrefix,                        // "Generate From GPT-4o:\n"
    customHeaders,                       // ""
    disabled,                            // false
    useProxy,                            // false
    proxyEndpoint,                       // ""
  };
}
