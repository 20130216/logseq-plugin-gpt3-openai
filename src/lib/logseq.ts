import { BlockEntity, BlockUUIDTuple } from "@logseq/libs/dist/LSPlugin.user";
import { getOpenaiSettings } from "./settings";
import { handleOpenAIError } from "./rawCommands";

function isBlockEntity(b: BlockEntity | BlockUUIDTuple): b is BlockEntity {
  return (b as BlockEntity).uuid !== undefined;
}

async function getTreeContent(b: BlockEntity) {
  let content = "";
  const trimmedBlockContent = b.content.trim();
  if (trimmedBlockContent.length > 0) {
    content += trimmedBlockContent;
  }

  if (!b.children) {
    return content;
  }

  for (const child of b.children) {
    if (isBlockEntity(child)) {
      content += await getTreeContent(child);
    } else {
      const childBlock = await logseq.Editor.getBlock(child[1], {
        includeChildren: true,
      });
      if (childBlock) {
        content += await getTreeContent(childBlock);
      }
    }
  }
  return content;
}

export async function getPageContentFromBlock(b: BlockEntity): Promise<string> {
  try {
    let blockContents = [];

    const currentBlock = await logseq.Editor.getBlock(b);
    if (!currentBlock) {
      throw new Error("Block not found");
    }

    const page = await logseq.Editor.getPage(currentBlock.page.id);
    if (!page) {
      throw new Error("Page not found");
    }

    const pageBlocks = await logseq.Editor.getPageBlocksTree(page.name);
    for (const pageBlock of pageBlocks) {
      const blockContent = await getTreeContent(pageBlock);
      if (blockContent.length > 0) {
        blockContents.push(blockContent);
      }
    }
    return blockContents.join(" ");
  } catch (error: unknown) {
    console.error("获取页面内容时出错:", error);
    throw await handleOpenAIError(error);
  }
}

export async function saveDalleImage(imageURL: string): Promise<string> {
  console.log("原响应的Azure Blob Storage URL地址:", imageURL);

  const settings = getOpenaiSettings();
  const s = logseq.Assets.makeSandboxStorage();
  const imageName = `dalle-${Date.now()}.png`;

  try {
    let finalUrl = imageURL;
    if (settings.useProxy && settings.proxyEndpoint) {
      finalUrl = `${settings.proxyEndpoint}?url=${encodeURIComponent(
        imageURL
      )}`;
      console.log("使用代理获取图片:", finalUrl);
    }

    // 增加重试机制
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
          console.log(`第 ${attempt} 次尝试超时，正在中断...`);
        }, 30000); // 增加到 30 秒

        console.log(`开始第 ${attempt} 次尝试获取图片...`);
        const response = await fetch(finalUrl, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/*, */*",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseArrayBuffer: any = await response.arrayBuffer();
        console.log(
          "成功获取图片数据，大小:",
          responseArrayBuffer.byteLength,
          "bytes"
        );

        await s.setItem(imageName, responseArrayBuffer);
        const pluginId = logseq.baseInfo.id || "logseq-plugin-gpt3-openai";

        const imageFileName = `![](assets/storages/${pluginId}/${imageName})`;
        console.log("图片保存成功，路径:", imageFileName);
        return imageFileName;
      } catch (fetchError: unknown) {
        lastError =
          fetchError instanceof Error
            ? fetchError
            : new Error(String(fetchError));
        console.log(`第 ${attempt} 次尝试失败:`, lastError.message);

        if (attempt < maxRetries) {
          const waitTime = 3000 * attempt; // 增加等待时间
          console.log(`等待 ${waitTime / 1000} 秒后重试...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError || new Error("未知错误");
  } catch (error: unknown) {
    console.error("保存 DALL-E 图片时出错:", error);
    throw await handleOpenAIError(error);
  }
}

export async function getAudioFile(content: string): Promise<File | null> {
  //supported formats are mp3, mp4, mpeg, mpga, m4a, wav, and webm
  //extract file path in () from markdown link like ![my file](assets/2023-03-17-13-24-36.m4a)
  const regex = /!\[.*\]\((.*(mp3|mp4|mpeg|mpga|m4a|wav|webm))\)/;
  const path = (await logseq.App.getCurrentGraph())?.path;
  const match = regex.exec(content);
  if (!match || !match[1]) {
    return null;
  }
  //get extension from file path
  const extension = match[1].split(".").pop();
  if (!extension) {
    return null;
  }
  //remove ../ from path
  const filepath = match[1].replace("../", "");
  // get filename from path by removing assets/ from path
  const filename = filepath.replace("assets/", "");
  const fullFilename = "file://" + path + "/" + filepath;
  const response = await fetch(fullFilename);
  const audioBlob = await response.blob();
  const file = new File([audioBlob], filename, { type: `audio/${extension}` });
  return file;
}

//新增函数
/* export async function getImageUrlFromBlock(content: string): Promise<string | null> {
  // 正则表达式匹配Markdown格式的URL
  const markdownRegex = /\[.*\]\((https?:\/\/[^)]+)\)/;
  // 正则表达匹配一般格式的URL
  const generalRegex = /(http[s]?:\/\/[^\s]+)/;

  // 先尝试匹配Markdown格式的URL
  const markdownMatch = content.match(markdownRegex);
  if (markdownMatch && markdownMatch[1]) {
    return markdownMatch[1];
  }

  // 如果没有找到Markdown格式的URL，再尝试匹配一般格式的URL
  const generalUrls = content.match(generalRegex);
  if (generalUrls && generalUrls.length > 0) {
    // 假设第一个匹配的就是图片链接
    return generalUrls[0];
  }

  // 如果两种匹配都没有找到合适的URL，则返回null
  return null;
} 

}*/

// 获取图片 URL
export async function getImageUrlFromBlock(
  content: string
): Promise<string | null> {
  // 正则表达式匹配Markdown格式的URL
  const markdownRegex = /\[.*\]\((https?:\/\/[^\)]+|[\w.-]+\/[^\)]+)\)/;

  console.log("Content:", content);

  // 先尝试匹配Markdown格式的URL
  const markdownMatch = content.match(markdownRegex);
  if (markdownMatch && markdownMatch[1]) {
    console.log("Markdown match:", markdownMatch[1]);
    return markdownMatch[1];
  }

  // 如果没有找到Markdown格式的URL，再尝试匹配一般格式的URL
  const generalRegex = /(http[s]?:\/\/[^\s]+|[\w.-]+\/[^\s]+)/;
  const generalUrls = content.match(generalRegex);
  if (generalUrls && generalUrls.length > 0) {
    console.log("General URLs:", generalUrls);
    // 假设第一个匹配的就是图片链接
    return generalUrls[0];
  }

  console.log("No matches found.");
  return null;
}
export const showMessage = (
  message: string,
  status: "success" | "warning" | "error" = "success"
) => {
  logseq.UI.showMsg(message, status);
};
