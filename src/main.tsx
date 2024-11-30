import "./ui/style.css";
import "@logseq/libs";
import { openAIWithStream } from "./lib/openai";
import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Command, LogseqAI } from "./ui/LogseqAI";
import { loadUserCommands, loadBuiltInCommands, loadBuiltInGptsTomlCommands } from "./lib/prompts";
import { getOpenaiSettings, settingsSchema } from "./lib/settings";
import { createRunGptsTomlCommand, handleOpenAIError, runDalleBlock, runGptBlock, runGptPage, runGptsID, runWhisper } from "./lib/rawCommands";
import { BlockEntity, IHookEvent } from "@logseq/libs/dist/LSPlugin.user";
import { useImmer } from 'use-immer';
import { showMessage } from './lib/logseq';

logseq.useSettingsSchema(settingsSchema);

// 主入口函数
async function main() {
  const root = ReactDOM.createRoot(document.getElementById("app")!);
  root.render(
    <React.StrictMode>
      <LogseqApp />
    </React.StrictMode>
  );

  const createModel = () => ({
    show() {
      logseq.showMainUI({ autoFocus: true });
    },
  });

  logseq.provideModel(createModel());
  logseq.setMainUIInlineStyle({
    zIndex: 11,
  });
}

logseq.ready(main).catch(console.error);

type SelectionType = 'singleBlockSelected' | 'multipleBlocksSelected' | 'noBlockSelected';
type AppState = {
  selection: {
    type: SelectionType;
    block?: BlockEntity;
    blocks?: BlockEntity[];
  };
};

const defaultAppState: AppState = {
  selection: {
    type: "noBlockSelected",
  },
};

const LogseqApp = () => {
  const [builtInCommands, setBuiltInCommands] = useState<Command[]>([]);
  const [builtInGptsTomlCommands, setBuiltInGptsTomlCommands] = useState<Command[]>([]);
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

  // 加载prompts.toml中的内置命令
  useEffect(() => {
    const loadBuiltInCommandsAsync = async () => {
      const loadedBuiltInCommands = await loadBuiltInCommands();
      setBuiltInCommands(loadedBuiltInCommands);
    };
    loadBuiltInCommandsAsync();
  }, []);

  // 加载用户命令
  useEffect(() => {
    const loadUserCommandsAsync = async () => {
      const loadedUserCommands = await loadUserCommands();
      setUserCommands(loadedUserCommands);
    };
    loadUserCommandsAsync();
  }, []);

  // 加载内置在 prompts-gpts.toml 文件中的命令
  useEffect(() => {
    const loadBuiltInGptsTomlCommandsAsync = async () => {
      const loadedBuiltInGptsTomlCommands = await loadBuiltInGptsTomlCommands();
      setBuiltInGptsTomlCommands(loadedBuiltInGptsTomlCommands);
    };
    loadBuiltInGptsTomlCommandsAsync();
  }, []);

  // 把内置在 prompts-gpts.toml 文件中的命令转化为commands数组后，注册成 “斜杠和菜单栏”命令
  useEffect(() => {
    const registerGptsTomlCommands = async () => {
      if (builtInGptsTomlCommands.length > 0) {
        builtInGptsTomlCommands.forEach(async (command) => {
          logseq.Editor.registerSlashCommand(command.name, await createRunGptsTomlCommand(command));
          logseq.Editor.registerBlockContextMenuItem(command.name, await createRunGptsTomlCommand(command));
        });
      }
    };
    registerGptsTomlCommands();
  }, [builtInGptsTomlCommands]);

  // 处理快捷键
  useEffect(() => {
    const registerPopupShortcut = () => {
      console.log("Registering popup shortcut...");
      if (logseq.settings!["popupShortcut"]) {
        logseq.App.registerCommandShortcut(
          { binding: logseq.settings!["popupShortcut"] as string },
          async () => {
            console.log(`Running popup shortcut: ${logseq.settings!["popupShortcut"]}`);
            const activeText = await logseq.Editor.getEditingCursorPosition();
            const currentBlock = await logseq.Editor.getCurrentBlock();
            const currentPage = await logseq.Editor.getCurrentPage();
            const selectedBlocks = await logseq.Editor.getSelectedBlocks();
  
            if (selectedBlocks && selectedBlocks.length > 0) {
              console.log("Multiple blocks selected.");
              updateAppState(draft => {
                draft.selection = {
                  type: "multipleBlocksSelected",
                  blocks: selectedBlocks,
                };
              });
            } else if (!activeText && !currentPage) {
              console.log("No valid context for shortcut.");
              showMessage("Put cursor in block or navigate to specific page to use keyboard shortcut", "warning");
              return;
            } else if (activeText && currentBlock) {
              console.log("Single block selected.");
              updateAppState(draft => {
                draft.selection = {
                  type: "singleBlockSelected",
                  block: currentBlock,
                };
              });
            } else {
              console.log("No block selected.");
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
    };
  
    registerPopupShortcut();
  }, [logseq.settings]);

  // 注册 gpt 相关命令
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
      } else {
        showMessage("所选块无效，请选择一个有效的块。", "warning");
      }
    });
    logseq.Editor.registerSlashCommand("gpt-page", runGptPage);
    logseq.Editor.registerBlockContextMenuItem("gpt-page", runGptPage);
    logseq.Editor.registerSlashCommand("gpt-block", runGptBlock);
    logseq.Editor.registerBlockContextMenuItem("gpt-block", runGptBlock);
    logseq.Editor.registerSlashCommand("dalle", runDalleBlock);
    logseq.Editor.registerBlockContextMenuItem("dalle", runDalleBlock);
    logseq.Editor.registerSlashCommand("whisper", runWhisper);
    logseq.Editor.registerBlockContextMenuItem("whisper", runWhisper);

    if (logseq.settings!["shortcutBlock"]) {
      logseq.App.registerCommandShortcut(
        { binding: logseq.settings!["shortcutBlock"] as string },
        runGptBlock
      );
    }
  }, []);

  // 注册 gptsID 命令
  useEffect(() => {
    const registerGptsIDCommands = () => {
      const gptsIDCommands = [

    "// 注册分隔符",

    //Prompt Professor：我对 Prompt Engineering 了如指掌。您想了解关于 prompt 的哪些内容？
    //Prompt Professor； 评级1k+ 4.4分，类别 Productivity生产力 ，对话100k+， 2024.10.28
    { 
      commandName: "提示词教授（对话人次100k+）", 
      gptsID: "gpt-4-gizmo-g-qfoOICq1l" 
    },
    //提示词工程师：生成卓越的 ChatGPT 提示或改进您现有的提示。通过学习和应用��提示实践，成为一名专业的提示工程师。      
    //prompt-engineer     评级1k+ 4.3分，类别 Productivity生产力，对话200k+， 2024.10.28                                  
    { 
      commandName: "提示词工程师（对话人次200k+）", 
      gptsID: "gpt-4-gizmo-g-5XtVuRE8Y" 
    },
    //Prompt Perfect：自动增强您的提示，提供细节和清晰度，以获得快速、准确的结果。     
    //prompt-perfect     评级1k+ 4.1分，类别 Productivity生产力，对话200k+， 2024.10.28                                  
    { 
      commandName: "提示词完美优化（对话人次200k+）", 
      gptsID: "gpt-4-gizmo-g-0QDef4GiE" 
    },
    //Midjourney Prompt Generator (V6) 生成 5 个详细、有创意、优化的提示，准备好在 Midjourney V6 中创建出色的图像。如果需要以 “--niji 6” 结尾，请提及 “niji”      
    //romidjourneyro-mj-prompt-generator-v6    评级5k+ 4.5分，无分类，对话800k+， 2024.10.28                                  
    { 
      commandName: "Midjourney提示词(V6) （对话人次200k+）", 
      gptsID: "gpt-4-gizmo-g-tc0eHXdgb" 
    },

    //Midjourney 逼真的图像提示(V6.1) 为 Midjourney V6.1 创建令人惊叹的人物和事物图像提示（营销、品牌、广告、库存图片等）
    //romidjourney-v6-1-photorealistic-image-prompts   评级1k+ 4.3分，无分类，对话100k+， 2024.10.28                                  
    { 
      commandName: "Midjourney提示词(V6.1)（对话人次100k+）", 
      gptsID: "gpt-4-gizmo-g-6MlHy4WPo" 
    },

    "// 注册分隔符",    

    //Logo Creator徽标创建器 用我来生成专业的 logo 设计和应用程序图标！
    //logo-creator  对话3个月+
    { 
      commandName: "logo设计器（“logo设计“排名第一）", 
      gptsID: "gpt-4-gizmo-g-gFt1ghYJl" 
    },      
    //image generator pro图像生成器专业版 世界上最强大的图像生成器
    //image-generator-pro  50K+，3.7分；对话2个月+
    { 
      commandName: "image-generator-pro（“生产力”第二名：图像生成器专业版）", 
      gptsID: "gpt-4-gizmo-g-8m2CPAfeF" 
    },
    // 删除：测试下来，总是只给5个模版，没有相关图片；而chatgpt里面则可以给出5个图片
/*     Canva 轻松设计任何内容：演示文稿、徽标、社交媒体帖子等
    canva 1k+评级4.3分，类别 Productivity生产力，3M+， 2024.10.28
    { 
      commandName: "Canva画布（“生产力”第一名：logo、社交媒体帖等）", 
      gptsID: "gpt-4-gizmo-g-alKfVrz9K" 
    },  */  
    //image generator图像生成器：一个专门生成和优化图像的 GPT，混合了专业和友好的 tone.image 生成器
    //image-generator 7M+（7个月+）， 2024.10.28
    { 
      commandName: "image图像生成器（“热门趋势”第一名）", 
      gptsID: "gpt-4-gizmo-g-pmuQfob8d" 
    }, 

    "// 注册分隔符",

    //DALL·E达尔·E  让我把你的想象力变成图像
    //dall-e类别 Other， 2024.10.28
    { 
      commandName: "dall-e（OpenAI官方推荐：image图像生成）", 
      gptsID: "gpt-4-gizmo-g-2fkFE8rbu" 
    },
    //Coloring Book Hero图画书英雄 把任何想法变成异想天开的图画书页。
    //coloring-book-hero  
    { 
      commandName: "彩色连环画（OpenAI官方力荐：连环image图像生成）", 
      gptsID: "gpt-4-gizmo-g-DerYxX7rA" 
    },      

    "// 注册分隔符",

    //Whimsical Diagrams异想天开的图表：使用流程图、思维导图和序列图解释和可视化概念。
    //whimsical-diagrams 25k+评分4.1分 1M+（1个月+）， 2024.10.28
    { 
      commandName: "异想天开的图表（力荐：生成流程图、思维导图等可视化图表）", 
      gptsID: "gpt-4-gizmo-g-vI2kaiM9N" 
    },  
    //Video GPT by VEEDVEED 的视频 GPT：AI 视频制作器。使用文本提示生成和编辑视频。键入描述，设置样式，并生成完整的视频 - 包括字幕和即时画外音。使用文本到语音转换、添加音乐和库存素材。VEED 的 AI 视频生成器和文本转视频工具使视频制作变得简单！
    //video-gpt-by-veed 50K+评测3.9分（2个月+）对话， 2024.10.28
    { 
      commandName: "AI视频GPT（热门：文生视频+文本转语音+视频脚本编写）", 
      gptsID: "gpt-4-gizmo-g-Hkqnd7mFT" 
    },     
    //Video Script: Viral Video Content for Social Media视频脚本：社交媒体的病毒式视频内容  🔴 #1 AI 视频脚本生成器 🔴 为 YouTube、Instagram、TikTok 等创建病毒式视频脚本。这个 GPT 提供了一个具有准确字数的分步过程。单击下面的对话启动器之一开始！
    //video-script-viral-video-content-for-social-media 1k+评分4.5分，Writing类别， 50K+ 2024.10.28
    { 
      commandName: "Social Media视频脚本（评分很高：病毒式视频脚本）", 
      gptsID: "gpt-4-gizmo-g-0NDPWPZ9v" 
    },

// 删除：测试下来，发现视频不适合，即便有时出来，也会让你到外网上去下载，而且效果不太好    
/*    
    "// 注册分隔符",

    Cartoonize Me 👉 Image to Cartoon将我的👉图像卡通化为卡通 最好的免费和简单的皮克斯风格漫画制作器 GPT。AI 设计师将人脸从相机照片或个人资料图片转换为自定义卡通图画。卡通化我 是一个转换器和创作者，可以将任何面孔变成可爱的 2D 或 3D 彩色动画绘画。
    cartoonize-me-image-to-cartoon 300+评分3.2分,无分类，10k+， 2024.10.28
    { 
      commandName: "Image to Cartoon（图片2卡通）", 
      gptsID: "gpt-4-gizmo-g-X2Cy0Tv71" 
    },     
 Image to Video图像到视频 这个 GPT 通过友好聊天将图像转换为视频。轻松为社交媒体创建动态内容。
    image-to-video 100+评分2.6分 Productivity 生产力 100k+， 2024.10.28
    { 
      commandName: "Image to Video（图片2视频）", 
      gptsID: "gpt-4-gizmo-g-YVDm0SPIZ" 
    },     
    将文本生成器到 Video Maker一个创新的 Video Maker Bot！使用我们的 AI 驱动的工具创建和编辑带有画外音的动态视频。
    generator-text-to-video-maker 10k+评分3.9分 600K+，Writing第6名 2024.10.28
    { 
      commandName: "text-to-video-maker（热门：带有画外音的动态视频）", 
      gptsID: "gpt-4-gizmo-g-CPgdui5Ib" 
    },     
    Sora 视频生成：超强视频生成模型
    nosorashi-pin-sheng-cheng 700+评分3.7分 Productivity 生产力 25k+， 2024.10.28
    { 
      commandName: "Sora 视频生成（万众瞩目：请帮我生成一个8秒的视频）", 
      gptsID: "gpt-4-gizmo-g-gc7XEBQ4O" 
    },   */      

    "// 注册分隔符",

    //微信公众号标题神器：通过“开幕雷击”原则，给您的公众号文章起一个吸引眼球的标题。
    //wei-xin-gong-zhong-hao-biao-ti-shen-qi 评级10+ 4.2分,无类别，对话1k+， 2024.10.28
    { 
      commandName: "微信公众号标题神器", 
      gptsID: "gpt-4-gizmo-g-9cn4GFxKQ" 
    }, 
    //微信公众号爆款写作专家：微信公众号文章爆款写作专家，调试了很久，投喂了很多爆款文章！
    //wei-xin-gong-zhong-hao-bao-kuan-xie-zuo-zhuan-jia 评级20+ 4.4分,类别 Writing写作，对话1k+， 2024.10.28
    { 
      commandName: "微信公众号爆款写作专家", 
      gptsID: "gpt-4-gizmo-g-5BOOo69Fl" 
    }, 
    //很6的公众号改写专家 让GPT帮你改写10W+爆款文案
    //hen-6de-gong-zhong-hao-gai-xie-zhuan-jia 评级100+ 4.5分,类别 Writing写作，对话5k+， 2024.10.28
    { 
      commandName: "很6的微信公众号改写专家", 
      gptsID: "gpt-4-gizmo-g-B5Gew3y87" 
    },     
    //微信朋友圈写手：擅长撰写微信朋友圈
    //wei-xin-peng-you-quan-xie-shou 评级10+ 3.5分,无类别，对话1k+， 2024.10.28
    { 
      commandName: "���信朋友圈写���", 
      gptsID: "gpt-4-gizmo-g-xJCEKei5d" 
    }, 

    "// 注册分隔符",
  
    // 知乎回答大师：帮您回答知乎的一切问题，赢得高赞，走向人生巅峰
    // zhi-hu-hui-da-da-shi 无评级,类别 Lifestyle 生活方式，对话1k+， 2024.10.28
    { 
      commandName: "知乎回答大师（对话人次1k+）", 
      gptsID: "gpt-4-gizmo-g-WcyReiblz" 
    },     
    // 知乎文案专家：这是大全编写的一名资深的知乎文案专家，专长于创作引人入胜且专业的各种内容，包括问题或者任何文章，并自动配图三张。欢���关注我的公众号"大全Prompter"领取更多好玩的 GPTs 小应用。使用教程：https://t.zsxq.com/2b5jM；GPTs合集 https://t.zsxq.com/18jTBeB8a（公众号: "大全Prompter"）
    // zhi-hu-wen-an-zhuan-jia-gong-zhong-hao-bao-wen 100+评比4.7分,类别 Writing （写作，对话5k+， 2024.10.28
    { 
      commandName: "知乎文案专家（评分高，对话人次5k+）", 
      gptsID: "gpt-4-gizmo-g-9eJRg2QVj" 
    },      
  
    "// 注册分隔符",
  
    // 小红书笔记专家 专注小红书爆款笔记写作
    // xiao-hong-shu-bi-ji-zhuan-jia评级100+ 3.9分,类别 Other其他 ，对话10k+， 2024.10.28
    { 
      commandName: "小红书笔记专家（对话人次5k+）", 
      gptsID: "gpt-4-gizmo-g-mVzzElRwY" 
    },  
    // 小红书GPT：小红书爆款写作专家，帮助您快速生成个个性化、吸引人的小红书内容。
    // xiao-hong-shu-gpt评级60+ 4.2分,类别 Writing （写作） ，对话10k+， 2024.10.28
    { 
      commandName: "小红书GPT（对话人次10k+）", 
      gptsID: "gpt-4-gizmo-g-9C31yVNIr" 
    },   
    // 10W+爆款小红书，爆款文案生成器
    // 10w-bao-kuan-xiao-hong-shu评级200+ 4.0分,类别 Writing （写作） ，对话25k+， 2024.10.28
    { 
      commandName: "10W+爆款小红书（对话人次25k+）", 
      gptsID: "gpt-4-gizmo-g-bhOvRzYzI" 
    }, 

    "// 注册分隔符",
  
    // 生成抖音爆款标题和5S开头文案
    //dou-yin-bao-kuan-5s-biao-ti无评分,类别 Writing （写作） ，对话5k+， 2024.10.28
    { 
      commandName: "抖音爆款5S+标题（对话人次5k+）", 
      gptsID: "gpt-4-gizmo-g-ncd84wbko" 
    },     
    // 这是一个可以帮你生成短视频文案的机器人！
    //dou-yin-duan-shi-pin-wen-an 评级100+ 3.7分,类别 Writing （写作） ，对话10k+， 2024.10.28
    { 
      commandName: "抖音短视频文案（对话人次10k+）", 
      gptsID: "gpt-4-gizmo-g-MQjNl9IxD" 
    }, 
    //抖音短视频创作(Short Video Creation) 🎥⭐抖音、视频号、小红书短视频创作利器！❤️ 支持：1）20大爆款创意类型；2）爆款标题+5s吸睛开头/标签/热点/景别/运镜；3）各种情景短视频脚本; 4）支持A/B两种分镜素描图生成；5）一键打包下载；6）可直接上传产品图；7）可直接发送产品链接；8）针对电商场景，产品信息，售卖对象，优惠信息优化。（V05.16）持续更新 ......（The ability to automatically generate short video shooting prompt for various scenarios.）
    //dou-yin-duan-shi-pin-chuang-zuo-short-video-creation 评级200+ 4.3分,类别 Productivity生产力 ，对话10k+， 2024.10.28
    { 
      commandName: "抖音短视频创作（对话人次10k+）", 
      gptsID: "gpt-4-gizmo-g-87zN9yfMy" 
    }, 

    "// 注册分隔符",  

    //小红书营销专家 帮你规划小红书账号运营策略，爆款文案的标题和内容书写建议。
    //xiao-hong-shu-ying-xiao-zhuan-jia 20+评级4.2分，类别 Productivity生产力，对话1k+， 2024.10.28
    { 
      commandName: "小红书营销策略专家", 
      gptsID: "gpt-4-gizmo-g-qeeTwZt1X" 
    },    
    //抖音运营策略专家 抖音 #矩阵运营 #爆款文案 #DOU+投放 #私域留存 #转化 复购
    //dou-yin-yun-ying-ce-lue-zhuan-jia 40+评级4.4分，暂无分类，对话1k+， 2024.10.28
    { 
      commandName: "抖音运营策略专家", 
      gptsID: "gpt-4-gizmo-g-NuLXgss8E" 
    },     

    "// 注册分隔符", 

    // 小红书违禁词检测，帮助你测试文案是否包含违禁词
    // xiao-hong-shu-wei-jin-ci-jian-ce无评级,类别 Lifestyle生活方式，对话2， 2024.10.28
    { 
      commandName: "小红书违禁词检测", 
      gptsID: "gpt-4-gizmo-g-cgO71rKhw" 
    }, 
    //抖音违禁词机器人 短视频内容检查工具
    //dou-yin-wei-jin-ci-ji-qi-ren 暂无评分 类别 Productivity生产力 ，对话400+， 2024.10.28
    { 
      commandName: "抖音违禁词机器人", 
      gptsID: "gpt-4-gizmo-g-Hhao2TImy" 
    }, 
    //广告法违禁词查询 查询《广告法》违禁词，并且给出合理的替代词语。
    //yan-gao-fa-wei-jin-ci-cha-xun 暂无评分 类别 Productivity生产力 ，对话10+， 2024.10.28
    { 
      commandName: "广告法违禁词查询", 
      gptsID: "gpt-4-gizmo-g-tgAhuSoaN" 
    },     

    "// 注册分隔符",

    //4A营销广告营销文案专家 参考拥有 20 年4A广告公司营销经验的营销文案专家，专长于创造直击用户价值观的流量广告文案。
    //4aying-xiao-yan-gao-ying-xiao-wen-an-zhuan-jia 40+评级4.0分，类别 Writing写作，对话1k+， 2024.10.28
    { 
      commandName: "4A营销广告和文案专家（参考20年以上的4A广告公司）", 
      gptsID: "gpt-4-gizmo-g-Gdkxsg69f" 
    },     
    //广告文案大师 这是李继刚(即刻同名)创建的用于创建广告文案的 Bot。 模仿一位拥有 20 年营销经验的营销文案专家，专长于创造直击用户价值观的广告文案。
    //yan-gao-wen-an-da-shi 70+评级4.0分，无类别 ，对话5k+， 2024.10.28
    { 
      commandName: "营销广告文案大师（对话人次5k+） ", 
      gptsID: "gpt-4-gizmo-g-f8phtYiLj" 
    },   
    //Branding GPT™品牌 GPT™ 将 me 用于品牌推广的所有事情：从品牌命名到品牌战略、个性、语气、标语创建等等。
    //branding-gpttm 1k+评级4.3分，类别 Productivity生产力，对话25k+， 2024.10.28
    { 
      commandName: "品牌营销文案GPT™（对话人次25k+）", 
      gptsID: "gpt-4-gizmo-g-YyQjyGgeQ" 
    },      

    "// 注册分隔符",    

    // Copywriter GPT - Marketing, Branding, AdsCopywriter GPT - 营销、品牌推广、广告；您的病毒式广告文案的创新合作伙伴！入研究根据的需求微调的病毒式营销策略！现在支持自定义网站链接、图片和文档上传！  
    //copywriter-gpt-marketing-branding-ads    评级10k+ 4.2分,类别 属于Writing (全球)，对话1个月+， 2024.10.28
    { 
      commandName: "Marketing市场营销-品牌推广-广告文案撰稿人（好评率高，病毒式广告）", 
      gptsID: "gpt-4-gizmo-g-Ji2QOyMml" 
    },
    //Marketing营销  您的广告专家导师 >> 指导在 Big 6 机构工作的媒体专业人士。
    //marketing    评级5k+ 4.3分,类别 属于Research & Analysis (全球)，对话300k+， 2024.10.28
    { 
      commandName: "Marketing市场营销（好评率高，堪比媒体专业人士）", 
      gptsID: "gpt-4-gizmo-g-DtjWjSDiv" 
    },
    // Marketing Research and Competitive Analysis市场研究和竞争分析 您值得信赖的尖端营销洞察助手，由 API 提供支持，提供战略资源。不断发展以提供更快的分析和更深入的品牌研究。喜欢这个工具吗？通过键入 /coffee ☕ 来支持其增长。谢谢！
    //marketing-research-and-competitive-analysis   评级10k+ 4.4分,类别 属于Research & Analysis (研究与分析)，对话300k+， 2024.10.28
    { 
      commandName: "Marketing市场研究和竞争分析（好评率最高的营销类洞察助手）", 
      gptsID: "gpt-4-gizmo-g-O5mNWQGMa" 
    },    
    
    "// 注册分隔符",  


    //Humanize AI人性化 AI 前 1 名 AI 人性化工具可帮助您获得类似人类的内容。使用可用的免费积分使您的 AI 生成的内容人性化。
    //humanize-ai 10k+评级4.1分，类别 Writing写作，对话1M+， 2024.10.28
    { 
      commandName: "人性化 AI（”写作“排名第三）", 
      gptsID: "gpt-4-gizmo-g-a6Fpz8NRb" 
    }, 
    //AI Humanizer AI 人性化 #1 世界上🏆的 AI人性化者：在几秒钟内获得类似人类的内容。这个 GPT 通过可用的免费积分使 AI 生成的文本人性化，同时保持内容的含义和质量。
    //ai-humanizer Gpts排名第二，50k+评分3.9，对话3M+， 2024.10.28
    { 
      commandName: "AI 人性化 （”写作“排名第二）", 
      gptsID: "gpt-4-gizmo-g-2azCVmXdy" 
    },
    //Write For Me为我写 编写量身定制的、引人入胜的内容，重点关注质量、相关性和精确的字数。
    //write-for-me Gpts排名第一，5个月对话5M+， 2024.10.28
    { 
      commandName: "writeForMe（”写作“排名第一）", 
      gptsID: "gpt-4-gizmo-g-B3hgivKK9" 
    },    
    //Write Anything（写任何东西）The world's most powerful writing tool.世界上最强大的书写工具。
    //write-anything 25k+评级4.2分，类别 Writing写作，对话1M+， 2024.10.28
    { 
      commandName: "Write Anything“（”写作“力荐：常规模式；学术模式；创造模式）", 
      gptsID: "gpt-4-gizmo-g-odWlfAKWM" 
    }, 

    "// 注册分隔符",

    // 文案改写 改写各类自媒体公众号、知乎、百家号文章、段落
    // wen-an-gai-xie 60+评比4.2分,类别 Writing （写作，对话5k+， 2024.10.28
    { 
      commandName: "文案改写（”写作“ 对话人次5k+）", 
      gptsID: "gpt-4-gizmo-g-LEjXLGa0o" 
    },   
    // 文章改写 专业且口语化的文章改写专家
    // wen-zhang-gai-xie 100+评比4.3分,类别 Writing （写作，对话10k+， 2024.10.28
    { 
      commandName: "文章改写（”写作“ 对话人次10k+）", 
      gptsID: "gpt-4-gizmo-g-8MKokXMpN" 
    },     
    //Improve My Writing提高我的写作水平 在保留意义和本质的同时改进您的写作。轻松提升清晰度和风格！
    //improve-my-writing 50+评比4.4分,类别 Writing （写作，对话5k+， 2024.10.28
    { 
      commandName: "文章润色（”写作“ 对话人次10k+）", 
      gptsID: "gpt-4-gizmo-g-QGedJoJpD" 
    },      

    "// 注册分隔符",       

  ]
  
  const createRunGptsIDCommand = (gptsID: string, commandName: string) => async (b: IHookEvent) => {
    const block = await logseq.Editor.getBlock(b.uuid);
    if (!block) {
      console.error("Block not found, showing warning message.");
      showMessage("所选块无效，请选择一个有效的块。", "warning");
    }
    await runGptsID(b, gptsID, commandName);
  };

  gptsIDCommands.forEach((item, index, array) => {
    if (index > 0 && typeof array[index - 1] === 'string' && (array[index - 1] as string).startsWith("// 注册分隔符")) {
      console.log("Registering separator...");
      logseq.Editor.registerBlockContextMenuItem("------------------------------------", () => Promise.resolve());
    }
    if (typeof item === 'object' && 'commandName' in item && 'gptsID' in item) {
      console.log(`Registering command: ${item.commandName}`);
      logseq.Editor.registerSlashCommand(item.commandName, createRunGptsIDCommand(item.gptsID, item.commandName));
      logseq.Editor.registerBlockContextMenuItem(item.commandName, createRunGptsIDCommand(item.gptsID, item.commandName));
    }
  });

  if (gptsIDCommands.length > 0 && typeof gptsIDCommands[gptsIDCommands.length - 1] === 'object') {
    console.log("Registering final separator...");
    logseq.Editor.registerBlockContextMenuItem("------------------------------------", () => Promise.resolve());
  }
};

registerGptsIDCommands();
}, []);


  // 合并所有命令
  const allCommands = [...builtInCommands, ...builtInGptsTomlCommands, ...userCommands];

  const handleCommand = async (command: Command, onContent: (content: string) => void): Promise<string> => {
    let inputText = "";
  
    // 检查选择类型并获取输入文本
    if (appState.selection.type === "singleBlockSelected" && appState.selection.block) {
      inputText = appState.selection.block.content;
    } else if (appState.selection.type === "multipleBlocksSelected" && appState.selection.blocks) {
      inputText = appState.selection.blocks.map(b => b.content).join("\n");
    }
  
    // 获取 OpenAI 设置
    const openAISettings = getOpenaiSettings();
  
    // 设置命令温度
    if (command.temperature != null && !Number.isNaN(command.temperature)) {
      openAISettings.temperature = command.temperature;
    }
  
    // 调用 OpenAI API 并处理响应
    try {
      const response = await openAIWithStream(command.prompt + inputText, openAISettings, onContent, () => { });
  
      if (response) {
        return response;
      } else {
        throw new Error("No OpenAI results.");
      }
    } catch (error) {
      // 调用专门的错误处理函数
      handleOpenAIError(error);
      throw error; // 重新抛出错误，以便调用者可以处理
    }
  };

  // 插入内容
  const onInsert = async (text: string) => {
    let result = text;
    if (getOpenaiSettings().injectPrefix) {
      result = getOpenaiSettings().injectPrefix + result;
    }

    if (appState.selection.type === "singleBlockSelected" && appState.selection.block) {
      if (appState.selection.block.content.length > 0) {
        logseq.Editor.insertBlock(appState.selection.block.uuid, result, { sibling: false });
      } else {
        logseq.Editor.updateBlock(appState.selection.block.uuid, result);
      }
    } else if (appState.selection.type === "multipleBlocksSelected" && appState.selection.blocks) {
      const lastBlock = appState.selection.blocks[appState.selection.blocks.length - 1];
      logseq.Editor.insertBlock(lastBlock.uuid, result, { sibling: true });
    } else if (appState.selection.type === "noBlockSelected") {
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

    if (appState.selection.type === "singleBlockSelected" && appState.selection.block) {
      logseq.Editor.updateBlock(appState.selection.block.uuid, result);
    } else if (appState.selection.type === "multipleBlocksSelected" && appState.selection.blocks) {
      const firstBlock = appState.selection.blocks[0];
      logseq.Editor.updateBlock(firstBlock.uuid, result);
      if (appState.selection.blocks.length > 1) {
        const remainingBlocks = appState.selection.blocks.slice(1);
        const blocksToRemove = remainingBlocks.map(b => logseq.Editor.removeBlock(b.uuid));
        await Promise.all(blocksToRemove);
      }
    } else if (appState.selection.type === "noBlockSelected") {
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


