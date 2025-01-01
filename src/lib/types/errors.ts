import { showMessage } from "../logseq";

export enum ContentModerationErrorType {
  PROFANITY = "profanity",
  POLITICS = "politics",
  VIOLENCE_EXTREME = "violence_extreme",
  VIOLENCE_MILD = "violence_mild",
  DISCRIMINATION = "discrimination",
  HARASSMENT = "harassment",
  ILLEGAL = "illegal",
  HATE_SPEECH = "hate_speech",
  SEXUAL = "sexual",
  API_ERROR = "api_error",
}

export interface ContentModerationError {
  type: ContentModerationErrorType;
  message: string;
  words?: string[];
}

export interface PromptData {
  prompt?: string;
  text?: string;
  description?: string;
  size?: string;
  n?: number | string;
  count?: number | string;
}

export class JSONParseError extends Error {
  constructor(message: string, public jsonString?: string) {
    super(message);
    this.name = "JSONParseError";
  }
}

export function handleOpenAIError(e: any) {
  // 处理 token 限制错误
  if (
    e.message?.includes("maximum context length") ||
    e.message?.includes("max_tokens") ||
    e.message?.includes("maximum tokens") ||
    e.message?.startsWith("maximum_tokens_") ||
    e.name === "MaxTokensExceeded"
  ) {
    // 从错误消息中提取实际的 maxTokens 值
    const actualMaxTokens = e.message?.startsWith("maximum_tokens_")
      ? Number(e.message.split("_")[2])
      : Number(logseq.settings?.["openAIMaxTokens"]) || 4000;

    const suggestedTokens = Math.min(actualMaxTokens * 2, 128000);

    // 构建更详细的错误消息
    const message =
      `⚠️ 响应已中断：达到最大令牌数限制（${actualMaxTokens}）\n\n` +
      `原因：当前响应长度超过了设置的最大令牌数限制（${actualMaxTokens}）。\n\n` +
      `建议操作：\n` +
      `1. 在插件设置中找到"最大令牌数"选项\n` +
      `2. 建议将其值增加到 ${suggestedTokens}\n` +
      `3. 对于复杂描述（如"八仙过海"），建议设置为 8000\n` +
      `4. 设置完成后重新执行命令\n\n` +
      `提示：\n` +
      `- 当前模型（gpt-4o-mini）支持最大 128k tokens\n` +
      `- 已显示部分内容仅为不完整响应\n\n` +
      `[点击此消息关闭]`;

    // 使用更醒目的警告样式
    showMessage(message, "warning");

    return {
      error: message,
      type: "max_tokens_exceeded",
      details: {
        currentLimit: actualMaxTokens,
        suggested: suggestedTokens,
        isPartialResponse: true,
      },
    };
  }

  // 处理 JSON 相关错误
  if (e instanceof Error) {
    switch (e.message) {
      case "incomplete_json":
        showMessage("JSON 响应不完整，请重试", "warning");
        return { error: "JSON 响应不完整", type: "incomplete_json" };
      case "empty_prompt":
        showMessage("提示词不能为空", "error");
        return { error: "提示词不能为空", type: "empty_prompt" };
      case "prompt_length_exceeded":
        const message = "提示词长度超过限制（3000字符），请精简描述";
        showMessage(message, "warning");
        return { error: message, type: "prompt_length_exceeded" };
    }
  }

  // 在现有错误处理逻辑前添加安全系统错误检查
  if (e.message?.includes("safety system")) {
    const message =
      "由于安全系统的限制，您的请求被拒绝。提示词中可能包含不被允许的内容。请修改后重试。";
    showMessage(message, "warning");
    return { error: message };
  }

  // JSON 解析错误处理
  if (e instanceof JSONParseError) {
    const message = "提示词格式错误: " + (e.message || "请检查命令模板");
    showMessage(message, "warning");
    console.debug("JSON 解析错误详情:", {
      message: e.message,
      jsonString: e.jsonString,
      stack: e.stack,
    });
    return { error: message };
  }

  if (e instanceof SyntaxError && e.message.includes("JSON")) {
    const message = "提示词格式无效: " + e.message;
    showMessage(message, "warning");
    console.debug("JSON 语法错误:", e);
    return { error: message };
  }

  // 先处理已知的特定错误类型
  if (e instanceof JSONParseError) {
    const message = "提示词格式错误，请检查命令模板";
    showMessage(message, "warning");
    console.debug("JSON 解析错误详情:", e.jsonString);
    return { error: message };
  }

  // 图片生成相关错误
  if (
    e.message?.includes("image generation") ||
    e.message?.includes("DALL-E")
  ) {
    showMessage("图片生成失败，请稍后重试", "error");
    return { error: "图片生成失败" };
  }

  // 图片保存错误
  if (
    e.message?.includes("saving image") ||
    e.message?.includes("file system")
  ) {
    showMessage("图片保存失败，请检查权限", "error");
    return { error: "图片保存失败" };
  }

  // 内容审核错误
  if (e.type && e.message) {
    const severity =
      e.level === "extreme"
        ? "error"
        : e.level === "mild"
        ? "warning"
        : "warning";
    const message =
      e.message + (e.words ? ` ------"${e.words.join('", "')}"` : "");
    showMessage(message, severity);
    return { error: message };
  }

  // API 错误
  if (e.error?.type && e.error?.message) {
    showMessage(e.error.message, "error");
    return { error: e.error.message };
  }

  // Billing 限制错误
  if (e.message?.includes("Billing hard limit has been reached")) {
    const message = "API 计费额度已达上限，请稍后重试或升级账户";
    const requestId = e.message.match(/request id: (.*)\)/)?.[1] || "";
    const detailedMessage = `${message}\n请求ID: ${requestId}\n\n建议:\n1. 等待额度重置\n2. 升级账户计划\n3. 检查账户设置`;

    showMessage(detailedMessage, "error");
    console.debug("Billing limit error:", { requestId, originalError: e });

    return {
      error: message,
      status: 400,
      type: "billing_limit",
    };
  }

  // 未知但有类型和消息的错误
  if (typeof e === "object" && e !== null && e.type && e.message) {
    showMessage(e.message, "error");
    return { error: e.message };
  }

  // API 密钥相关错误
  if (e.message?.includes("API key")) {
    showMessage("API 密钥无效或未设置，请检查您的 API 密钥配置！", "error");
    return { error: "API 密钥无效或未设置" };
  }

  // 配额错误
  if (e.message?.includes("insufficient_quota")) {
    showMessage("API 使用额度已耗尽，请检查您的账户余额！", "error");
    return { error: "API 使用额度已耗尽" };
  }

  // 网络错误
  if (e instanceof TypeError && e.message === "Failed to fetch") {
    showMessage("网络连接失败，请检查网络连接！", "error");
    return { error: "网络连接失败" };
  }

  // 超时错误
  if (e.name === "AbortError" || e.name === "TimeoutError") {
    showMessage("请求超时，请稍后重试", "error");
    return { error: "请求超时" };
  }

  // 用户取消
  if (
    e.name === "DOMException" &&
    e.message.includes("The user aborted a request")
  ) {
    showMessage("用户取消了请求", "warning");
    return { error: "用户取消请求" };
  }

  // 流处理错误
  if (e.message?.includes("流超时") || e.message?.includes("stream timeout")) {
    showMessage("响应流处理超时，请重试", "error");
    return { error: "流处理超时" };
  }

  // 标准 Error 实例
  if (e instanceof Error) {
    showMessage(e.message, "error");
    return { error: e.message };
  }

  // 有消息的未知错误
  if (e.message) {
    showMessage(e.message, "error");
    return { error: e.message };
  }

  // 添加图片生成相关错误处理
  if (e.message?.includes("429")) {
    showMessage("服务器繁忙，请稍后重试", "warning");
    return {
      error: "\n服务器繁忙，请稍后重试 (错误代码: 429)\n",
      status: 429,
    };
  }

  // 图片生成失败
  if (e.message?.includes("Failed to generate image")) {
    showMessage("图片生成失败，请稍后重试", "error");
    return {
      error: "\n图片生成失败\n",
    };
  }

  // 图片保存失败
  if (e.message?.includes("Failed to save image")) {
    showMessage("图片保存失败，请检查权限", "error");
    return {
      error: "\n图片保存失败\n",
    };
  }

  // 处理 visiblePlaceholder 相关错误
  if (e.message?.includes("placeholder")) {
    const errorMessage = e.message?.includes("429")
      ? "\n服务器繁忙，请稍后重试 (错误代码: 429)\n"
      : "\n图片生成失败\n";
    return { error: errorMessage };
  }

  // 完全未知的错误
  console.error("Unexpected error:", e);
  showMessage("发生未知错误，请稍后重试", "error");
  return { error: "未知错误" };

  // 添加页面内容获取错误处理
  if (e.message?.includes("Block not found")) {
    console.error("获取页面内容失败：找不到指定的块", e);
    showMessage("找不到指定的块", "error");
    return { error: "找不到指定的块" };
  }

  if (e.message?.includes("Page not found")) {
    console.error("获取页面内容失败：找不到指定的页面", e);
    showMessage("找不到指定的页面", "error");
    return { error: "找不到指定的页面" };
  }

  // 添加音频文件处理错误
  if (e.message?.includes("Audio file")) {
    console.error("音频文件处理失败：", e);
    showMessage("音频文件处理失败", "error");
    return { error: "音频文件处理失败" };
  }

  // 添加流式响应错误
  if (e.message?.includes("stream response")) {
    console.error("流式响应处理失败：", e);
    showMessage("响应处理失败，请重试", "error");
    return { error: "响应处理失败" };
  }

  // 添加 API 响应错误
  if (e.message?.includes("API response")) {
    console.error("API 响应异常：", e);
    showMessage("API 响应异常，请重试", "error");
    return { error: "API 响应异常" };
  }

  // 添加提示词长度超限的处理
  if (e.message?.includes("prompt_length_exceeded")) {
    const message =
      "提示词过长：当前输入超过4000字符。请精简描述以确保最终生成的图片提示词能符合API对输入字符在1000字符的限制。";
    showMessage(message, "warning");
    return {
      error: message,
      type: "prompt_length_exceeded",
    };
  }
}
