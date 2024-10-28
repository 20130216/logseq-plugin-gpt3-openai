import "./ui/style.css";
import "@logseq/libs";
import { openAIWithStream } from "./lib/openai";
import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { Command, LogseqAI } from "./ui/LogseqAI";
import { loadUserCommands, loadBuiltInCommands } from "./lib/prompts";
import { getOpenaiSettings, settingsSchema } from "./lib/settings";
import { runDalleBlock, runGptBlock, runGptPage, runGptsID, runReadImageURL, runWhisper } from "./lib/rawCommands";
import { BlockEntity, IHookEvent } from "@logseq/libs/dist/LSPlugin.user";
import { useImmer } from 'use-immer';

logseq.useSettingsSchema(settingsSchema);

async function main() {
  const root = ReactDOM.createRoot(document.getElementById("app")!);
  root.render(
    <React.StrictMode>
      <LogseqApp />
    </React.StrictMode>
  );

  function createModel() {
    return {
      show() {
        logseq.showMainUI({ autoFocus: true });
      },
    };
  }

  logseq.provideModel(createModel());
  logseq.setMainUIInlineStyle({
    zIndex: 11,
  });
}

logseq.ready(main).catch(console.error);

type singleBlockSelected = {
  type: "singleBlockSelected";
  block: BlockEntity;
};

type multipleBlocksSelected = {
  type: "multipleBlocksSelected";
  blocks: BlockEntity[];
};

type noBlockSelected = {
  type: "noBlockSelected";
};

type AppState = {
  selection: (singleBlockSelected | multipleBlocksSelected | noBlockSelected);
}

const defaultAppState: AppState = {
  selection: {
    type: "noBlockSelected",
  },
};

const LogseqApp = () => {

  const [builtInCommands, setBuiltInCommands] = useState<Command[]>([]);
  const [userCommands, setUserCommands] = useState<Command[]>([]);
  const [appState, updateAppState] = useImmer<AppState>(defaultAppState);
  
  // 打开 UI
  const openUI = async () => {
    const reloadedUserCommands = await loadUserCommands();
    setUserCommands(reloadedUserCommands);
    logseq.showMainUI({ autoFocus: true });
    setTimeout(() => {
      document.getElementById("logseq-openai-search")?.focus();
    }, 100);
  };
  // 加载内置命令
  React.useEffect(() => {
    const doLoadBuiltInCommands = async () => {
      const loadedBuiltInCommands = await loadBuiltInCommands();
      setBuiltInCommands(loadedBuiltInCommands);
    };

    doLoadBuiltInCommands();
  }, []);
  // 加载用户命令
  React.useEffect(() => {
    const doLoadUserCommands = async () => {
      const loadedUserCommands = await loadUserCommands();
      setUserCommands(loadedUserCommands);
    };
    doLoadUserCommands();
  }, []);
  // 注册快捷键
  React.useEffect(() => {
    if (logseq.settings!["popupShortcut"]) {
    logseq.App.registerCommandShortcut(
      {
        binding: logseq.settings!["popupShortcut"],
      },
      async () => {
        const activeText = await logseq.Editor.getEditingCursorPosition();
        const currentBlock = await logseq.Editor.getCurrentBlock();
        const currentPage = await logseq.Editor.getCurrentPage();
        const selectedBlocks = await logseq.Editor.getSelectedBlocks();
        if (selectedBlocks && selectedBlocks.length > 0) {
          updateAppState(draft => {
            draft.selection = {
              type: "multipleBlocksSelected",
              blocks: selectedBlocks,
            };
          });
        } else if (!activeText && !currentPage) {
          logseq.App.showMsg("Put cursor in block or navigate to specific page to use keyboard shortcut", "warning");
          return;
        } else if (activeText && currentBlock) {
          updateAppState(draft => {
            draft.selection = {
              type: "singleBlockSelected",
              block: currentBlock,
            };  
          });
        } else {
          updateAppState(draft => {
            draft.selection = {
              type: "noBlockSelected",
            };
          });
        }
        openUI();
      }
    );
    }
  }, []);

  React.useEffect(() => {
    logseq.Editor.registerBlockContextMenuItem("gpt", async (b) => {
      const block = await logseq.Editor.getBlock(b.uuid);
      if (block) {
        updateAppState(draft => {
          draft.selection = {
            type: "singleBlockSelected",
            block: block,
          };
        });
        openUI();
      }
    });

    logseq.Editor.registerSlashCommand("gpt", async (b) => {
      const block = await logseq.Editor.getBlock(b.uuid);
      if (block) {
        updateAppState(draft => {
          draft.selection = {
            type: "singleBlockSelected",
            block: block,
          };
        });
        openUI();
      }
    });
    // 注册上下文菜单项和斜杠命令
    logseq.Editor.registerSlashCommand("gpt-page", runGptPage);
    logseq.Editor.registerBlockContextMenuItem("gpt-page", runGptPage);
    logseq.Editor.registerSlashCommand("gpt-block", runGptBlock);
    logseq.Editor.registerBlockContextMenuItem("gpt-block", runGptBlock);
    logseq.Editor.registerSlashCommand("dalle", runDalleBlock);
    logseq.Editor.registerBlockContextMenuItem("dalle", runDalleBlock);
    logseq.Editor.registerSlashCommand("whisper", runWhisper);
    logseq.Editor.registerBlockContextMenuItem("whisper", runWhisper);

    logseq.Editor.registerSlashCommand("read-image-URL", runReadImageURL);  //新增
    logseq.Editor.registerBlockContextMenuItem("read-image-URL", runReadImageURL); //新增  

  // 定义命令和对应的 gptsID
  const commandsConfig = [
    { commandName: "writingForMe", gptsID: "gpt-4-gizmo-g-B3hgivKK9" },
    { commandName: "marketing insights and analysis", gptsID: "gpt-4-gizmo-g-O5mNWQGMa" }, 
    { commandName: "dall-e", gptsID: "gpt-4-gizmo-g-2fkFE8rbu" },
    { commandName: "彩色连环画", gptsID: "gpt-4-gizmo-g-DerYxX7rA" },       //coloring-book-hero
    { commandName: "小红书爆款", gptsID: "gpt-4-gizmo-g-bhOvRzYzI" },   //bao-kuan-xiao-hong-shu
    { commandName: "image-generator-pro", gptsID: "gpt-4-gizmo-g-8m2CPAfeF" },
    { commandName: "抖音短视频创作", gptsID: "gpt-4-gizmo-g-87zN9yfMy" }, //dou-yin-duan-shi-pin-chuang-zuo-short-video-creation
    { commandName: "营销-品牌推广-广告文案撰稿人", gptsID: "gpt-4-gizmo-g-Ji2QOyMml" },//copywriter-gpt-marketing-branding-ads
  ];
  // 只有在用户通过：“斜杠命令“或”上下文菜单注册命令“时才会被调用，并处理相应的逻辑 
 function createRunGptsIDCommand(gptsID: string) {
    return (b: IHookEvent) => runGptsID(b, gptsID); // 明确指定 b 的类型为 IHookEvent
  } 
    
   commandsConfig.forEach(({ commandName, gptsID }) => {
   logseq.Editor.registerSlashCommand(commandName, createRunGptsIDCommand(gptsID));
   logseq.Editor.registerBlockContextMenuItem(commandName, createRunGptsIDCommand(gptsID));
  });
  
// 备用函数：如果需要动态修改 gptsID，可以重新注册命令 
/* function updateCommandGptsID(commandName: string, newGptsID: string) {
  const command = commandsConfig.find(cmd => cmd.commandName === commandName);
  if (command) {
    command.gptsID = newGptsID;
    logseq.Editor.unregisterSlashCommand(commandName);
    logseq.Editor.unregisterBlockContextMenuItem(commandName);
    logseq.Editor.registerSlashCommand(commandName, createRunGptsIDCommand(newGptsID));
    logseq.Editor.registerBlockContextMenuItem(commandName, createRunGptsIDCommand(newGptsID));
  }
}   */

  
  if (logseq.settings!["shortcutBlock"]) {
      logseq.App.registerCommandShortcut(
        { "binding": logseq.settings!["shortcutBlock"] },
        runGptBlock
      );
    }
  }, []);

  // 合并命令
  const allCommands = [...builtInCommands, ...userCommands];
  // 处理命令
  const handleCommand = async (command: Command, onContent: (content: string) => void): Promise<string> => {
    let inputText;
    if (appState.selection.type === "singleBlockSelected") {
      inputText = appState.selection.block.content;
    } else if (appState.selection.type === "multipleBlocksSelected") {
      inputText = appState.selection.blocks.map(b => b.content).join("\n");
    } else {
      inputText = "";
    }

    const openAISettings = getOpenaiSettings();
    // Set temperature of command instead of global temperature
    if (command.temperature!=null && !Number.isNaN(command.temperature)) {
      openAISettings.temperature = command.temperature;
    }

/* 
    console.log("handleCommand called with command:", command); // 添加调试信息
    // 检查 command 和 command.prompt 是否已定义
    if (!command) {
      console.error("command is not defined");
      return "";
    }
    if (!command.prompt) {
      console.error("command.prompt is not defined");
      return "";
    }

    // Set temperature of command instead of global temperature
    if (command.temperature != null && !Number.isNaN(command.temperature)) {
      openAISettings.temperature = command.temperature;
    }

    // 打印 command.prompt 的值  */
    console.log("重要测试command.prompt:", command.prompt); 

    const response = await openAIWithStream(command.prompt + inputText, openAISettings, onContent, () => {
    });
    if (response) {
      console.log("重要测试command.prompt:", command.prompt+inputText);
      return response;
    } else {
      throw new Error("No OpenAI results.");
    }
  };
  // 插入内容
  const onInsert = async (text: string) => {
    let result = text;
    if (getOpenaiSettings().injectPrefix) {
      result = getOpenaiSettings().injectPrefix + result;
    }
    if (appState.selection.type === "singleBlockSelected") {
      if (appState.selection.block.content.length > 0) {
        logseq.Editor.insertBlock(appState.selection.block.uuid, result, {
          sibling: false,
        });
      } else {
        logseq.Editor.updateBlock(appState.selection.block.uuid, result);
      }
    } else if (appState.selection.type === "multipleBlocksSelected") {
      const lastBlock = appState.selection.blocks[appState.selection.blocks.length - 1];
      logseq.Editor.insertBlock(lastBlock.uuid, result, {
        sibling: true,
      });
    } else if (appState.selection.type === "noBlockSelected"){
      const currentPage = await logseq.Editor.getCurrentPage();
      if (currentPage) {
        logseq.Editor.appendBlockInPage(currentPage.uuid, result);
      }
    } else {
      console.error("Unknown selection type");
    }

    logseq.hideMainUI({ restoreEditingCursor: true });
  };
  // 替换内容
  const onReplace = async (text: string) => {
    let result = text;
    if (getOpenaiSettings().injectPrefix) {
      result = getOpenaiSettings().injectPrefix + result;
    }

    if (appState.selection.type === "singleBlockSelected") {
      logseq.Editor.updateBlock(appState.selection.block.uuid, result);
    } else if (appState.selection.type === "multipleBlocksSelected") {
      const firstBlock = appState.selection.blocks[0];
      logseq.Editor.updateBlock(firstBlock.uuid, result);
      if (appState.selection.blocks.length > 1) {
        const remainingBlocks = appState.selection.blocks.slice(1);
        const blocksToRemove = remainingBlocks.map(b => logseq.Editor.removeBlock(b.uuid));
        await Promise.all(blocksToRemove);
      }
    } else if (appState.selection.type === "noBlockSelected"){
      const currentPage = await logseq.Editor.getCurrentPage();
      if (currentPage) {
        logseq.Editor.appendBlockInPage(currentPage.uuid, result);
      }
    } else {
      console.error("Unknown selection type");
    }

    logseq.hideMainUI({ restoreEditingCursor: true });
  };
  // 关闭 UI
  const onClose = () => {
    logseq.hideMainUI({ restoreEditingCursor: true });
  };
  // 渲染 LogseqAI 组件
  return (
    <LogseqAI
      commands={allCommands}
      handleCommand={handleCommand}
      onClose={onClose}
      onInsert={onInsert}
      onReplace={onReplace}
    />
  );
};
