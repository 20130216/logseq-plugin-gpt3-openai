import { Command } from "../ui/LogseqAI";
import toml from "toml";
import prompts from "../prompts/prompts.toml?raw";
import promptsGpts from "../prompts/prompts-gpts.toml?raw";
import { handleOpenAIError } from "./types/errors";

//extract content from inside ```gpt-prompt codeblock
function extractCodeblock(content: string) {
  const codeblockRegex = /```prompt\s+([\s\S]+)\s+```/g;
  const codeblock = content.match(codeblockRegex);
  if (codeblock) {
    return codeblock[0].replace(codeblockRegex, "$1");
  }
  return "";
}

export async function loadUserCommands() {
  const templatesQuery = `
[:find (pull ?b [*])
           :where
           [?b :block/properties ?props]
           [(get ?props :prompt-template)]]
`;

  const gptCodeBlock = "```prompt";

  const templatesContentsQuery = `
[:find (pull ?b [*])
           :where
           [?p :block/properties ?props]
           [(get ?props :prompt-template)]
           [?b :block/parent ?p]
           [?b :block/content ?c]
           [(re-pattern "${gptCodeBlock}") ?q]
           [(re-find ?q ?c)]]
`;

  const templateContentsResults = await logseq.DB.datascriptQuery(
    templatesContentsQuery
  );
  const templateContents = new Map<number, string>();
  for (const result of templateContentsResults) {
    const content = extractCodeblock(result[0].content);
    templateContents.set(result[0].parent.id, content);
  }
  const customTemplatesResults = await logseq.DB.datascriptQuery(
    templatesQuery
  );
  let customCommands = new Array<Command>();

  for (const result of customTemplatesResults) {
    const type = result[0].properties["prompt-template"];
    const prompt = templateContents.get(result[0].id);
    if (type && prompt) {
      customCommands.push({
        type: type,
        name: type,
        isParseJson: type,
        temperature: Number(result[0].properties["prompt-temperature"]),
        prompt: prompt,
      });
    }
  }

  return customCommands;
}

interface Prompt {
  name: string;
  isParseJson: string;
  temperature: number;
  description: string;
  prompt: string;
}
type Prompts = Record<string, Prompt>;

function promptsToCommands(prompts: Prompts): Command[] {
  return Object.entries(prompts).map(([name, prompt]) => {
    return {
      type: name,
      name: prompt.name,
      isParseJson: prompt.isParseJson,
      description: prompt.description,
      prompt: prompt.prompt,
      temperature: prompt.temperature,
    };
  });
}
//prompts.toml 文件的内容被成功转换为 Command 对象数组。
export async function loadBuiltInCommands() {
  try {
    //使用 toml.parse 方法解析 prompts 字符串，得到的结果是一个 JavaScript 对象：
    const parsedPrompts: Prompts = toml.parse(prompts);
    //调用 promptsToCommands 函数，将解析后的对象转换为 Command 对象数组：
    const parsedCommands = promptsToCommands(parsedPrompts);
    return parsedCommands;
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    handleOpenAIError(error);
    return [];
  }
}

//新增函数，专门处理这个新增的命令文件"../prompts/prompts-gpts.toml?raw"
export async function loadBuiltInGptsTomlCommands() {
  try {
    // 使用 toml.parse 方法解析 prompts 字符串，得到的结果是一个 JavaScript 对象
    const parsedPromptsGpts: Prompts = toml.parse(promptsGpts);
    console.log("Parsed promptsGpts:", parsedPromptsGpts); // 添加日志

    // 调用 promptsToCommands 函数，将解析后的对象转换为 Command 对象数组
    const parsedCommands = promptsToCommands(parsedPromptsGpts);
    console.log("Parsed commands:", parsedCommands); // 添加日志

    return parsedCommands;
  } catch (error: any) {
    // 使用 handleOpenAIError 统一处理错误
    handleOpenAIError(error);
    return [];
  }
}
