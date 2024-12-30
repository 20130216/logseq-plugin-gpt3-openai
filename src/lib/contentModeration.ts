import { ContentModerationErrorType } from "./types/errors";

// 定义敏感词类型
interface SensitiveCategory {
  extreme?: ReadonlyArray<string>; // 绝对禁止的词
  mild?: ReadonlyArray<string>; // 需要警惕的词
  context?: ReadonlyArray<string>; // 需要上下文判断的词
}

type SensitiveWordType = {
  profanity: SensitiveCategory;
  politics: SensitiveCategory;
  violence: SensitiveCategory;
  discrimination: SensitiveCategory;
  harassment: SensitiveCategory;
  illegal: SensitiveCategory;
  hate_speech: SensitiveCategory;
  sexual: SensitiveCategory;
};

// 敏感词库定义
export const SENSITIVE_WORDS: SensitiveWordType = {
  profanity: {
    extreme: [
      "傻逼",
      "妈的",
      "操",
      "草",
      "艹",
      "滚",
      "去死",
      "废物",
      "垃圾",
      "贱",
      "蠢",
      "混蛋",
      "王八蛋",
    ],
    mild: [],
    context: [],
  },
  politics: {
    extreme: [
      "颠覆",
      "分裂",
      "暴动",
      "政变",
      "叛乱",
      "恐怖主义",
      "极端主义",
      "分裂势力",
    ],
    mild: ["示威", "抗议", "镇压", "政权", "制裁", "暴乱", "政治迫害"],
    context: [
      "总统",
      "主席",
      "政府",
      "军队",
      "民主",
      "自由",
      "独立",
      "革命",
      "政治",
      "毛泽东",
      "刘少奇",
      "李先念",
      "杨尚昆",
      "江泽民",
      "胡锦涛",
      "习近平",
      "华国锋",
      "赵紫阳",
      "周恩来",
      "华锋",
      "赵紫阳",
      "李鹏",
      "朱镕基",
      "温家宝",
      "李克强",
      "张高丽",
      "韩正",
    ],
  },
  violence: {
    extreme: [
      "残杀",
      "屠杀",
      "灭口",
      "处死",
      "枪杀",
      "血腥",
      "虐待",
      "折磨",
      "残害",
      "毒杀",
    ],
    mild: ["打架", "斗殴", "威胁", "恐吓", "欺负", "报复", "冲突", "推搡"],
    context: [],
  },
  discrimination: {
    extreme: [],
    mild: [
      "贱民",
      "低等",
      "蛮夷",
      "野蛮人",
      "性别歧视",
      "种族歧视",
      "地域歧视",
    ],
    context: [],
  },
  harassment: {
    extreme: [],
    mild: ["性骚扰", "猥亵", "偷拍", "偷窥", "勒索", "纠缠", "性侵", "强迫"],
    context: [],
  },
  illegal: {
    extreme: [],
    mild: [
      "毒品",
      "走私",
      "贩毒",
      "非法",
      "犯罪",
      "诈骗",
      "盗窃",
      "抢劫",
      "黑市",
      "洗钱",
    ],
    context: [],
  },
  hate_speech: {
    extreme: [],
    mild: ["仇恨", "诅咒", "诽谤", "中伤", "污蔑", "人身攻击", "谩骂", "辱骂"],
    context: [],
  },
  sexual: {
    extreme: [],
    mild: ["色情", "淫秽", "下流", "露骨", "性交易", "卖淫", "嫖娼"],
    context: [],
  },
} as const;

// 版本控制
export const MODERATION_VERSION = "1.2.0";
export const LAST_UPDATED = "2024-01-20";

// 定义错误提示信息映射
const ERROR_MESSAGES = {
  profanity: {
    extreme: "请文明用语，避免使用严重的脏话",
    mild: "请注意用语文明",
    context: "请注意用语得体",
  },
  politics: {
    extreme: "内容包含极端政治敏感词，请修改",
    mild: "内容包含政治敏感词，请谨慎",
    context: "内容可能涉及敏感政治倾向",
  },
  violence: {
    extreme: "内容包含严重暴力元素，请修改",
    mild: "内容包含轻微暴力元素",
    context: "内容可能涉及暴力倾向",
  },
  discrimination: {
    extreme: "内容包含严重歧视性言论",
    mild: "请避免使用歧视性语言",
    context: "内容可能涉及歧视倾向",
  },
  harassment: {
    extreme: "内容包含严重骚扰性质的词语",
    mild: "请避免使用骚扰性语言",
    context: "内容可能涉及骚扰倾向",
  },
  illegal: {
    extreme: "内容涉及违法犯罪",
    mild: "内容可能涉及违法信",
    context: "内容可能涉及不当行为",
  },
  hate_speech: {
    extreme: "内容包含严重仇恨言论",
    mild: "请避免使用仇恨性言论",
    context: "内容可能涉及偏激言论",
  },
  sexual: {
    extreme: "内容包含严重不当性暗示",
    mild: "请避免不性暗示内容",
    context: "内容可能涉及不当暗示",
  },
} as const;

// 定义检查结果的接口
interface CheckResult {
  level?: "extreme" | "mild" | "context";
  type?: ContentModerationErrorType;
  words?: string[];
}

// 修改 validateContent 函数
export async function validateContent(content: string) {
  try {
    const result = checkUserInput(content);

    if (result?.level === "extreme") {
      // 如果有多个词（extreme + mild组合，或多个extreme）
      if (!result.type) {
        throw {
          type: result.type,
          level: "extreme",
          message: `内容包含多个敏感词——"${result.words?.join("、")}"`,
          words: result.words,
        };
      }
      // 单个extreme词的情况
      const errorMessages =
        ERROR_MESSAGES[result.type as keyof typeof ERROR_MESSAGES];
      throw {
        type: result.type,
        level: "extreme",
        message: `${errorMessages.extreme}——"${result.words?.join("、")}"`,
        words: result.words,
      };
    }

    if (result?.level === "mild") {
      if (!result.type || result.words?.length! > 1) {
        // 如果没有具体类型或有多个mild词，使用通用提示
        throw {
          type: result.type,
          level: "mild",
          message: `内容包含多个敏感词——"${result.words?.join("、")}"`,
          words: result.words,
        };
      }
      // 单个mild词的情况
      const errorMessages =
        ERROR_MESSAGES[result.type as keyof typeof ERROR_MESSAGES];
      throw {
        type: result.type,
        level: "mild",
        message: `${errorMessages.mild}——"${result.words?.join("、")}"`,
        words: result.words,
      };
    }

    if (result?.level === "context") {
      throw {
        type: result.type,
        level: "context",
        message: `这些词组合在一块有可能构成潜在的敏感词——"${result.words?.join(
          "、"
        )}"`,
        words: result.words,
      };
    }

    return true;
  } catch (error) {
    throw error;
  }
}

// 修改 checkUserInput 函数
export function checkUserInput(input: string): CheckResult | void {
  const normalizedInput = input.toLowerCase().replace(/\s+/g, "");

  const matches = {
    extreme: new Map<string, string[]>(),
    mild: new Map<string, string[]>(),
    context: new Map<string, string[]>(),
  };

  // 收集所有匹配的词
  for (const [category, words] of Object.entries(SENSITIVE_WORDS)) {
    ["extreme", "mild", "context"].forEach((level) => {
      const levelWords = words[level as keyof SensitiveCategory];
      if (levelWords) {
        const found = levelWords.filter((word) =>
          normalizedInput.includes(word.toLowerCase())
        );
        if (found.length > 0) {
          matches[level as keyof typeof matches].set(category, found);
        }
      }
    });
  }

  // 取所有唯一的敏感词
  const extremeWords = [
    ...new Set(Array.from(matches.extreme.values()).flat()),
  ];
  const mildWords = [...new Set(Array.from(matches.mild.values()).flat())];
  const contextWords = [
    ...new Set(Array.from(matches.context.values()).flat()),
  ];

  // 1. 处理包含 extreme 词的情况
  if (extremeWords.length > 0) {
    // 如果同时存在 extreme 和 mild/context 词，或存在多个 extreme 词
    if (mildWords.length > 0 || extremeWords.length > 1) {
      const allWords = [...extremeWords, ...mildWords];
      return {
        level: "extreme",
        words: [...new Set(allWords)],
      };
    }
    // 如果只有一个 extreme 词
    const [category] = Array.from(matches.extreme.keys());
    return {
      level: "extreme",
      type: category as ContentModerationErrorType,
      words: extremeWords,
    };
  }

  // 2. 处理多个不同mild词的组合
  const uniqueMildCategories = new Set(matches.mild.keys());
  if (uniqueMildCategories.size > 1) {
    const [category] = Array.from(matches.mild.keys());
    return {
      level: "mild",
      type: category as ContentModerationErrorType,
      words: mildWords,
    };
  }

  // 3. 处理mild词和context词的组合
  if (mildWords.length > 0 && contextWords.length > 0) {
    const [category] = Array.from(matches.mild.keys());
    return {
      level: "mild",
      type: category as ContentModerationErrorType,
      words: mildWords,
    };
  }

  // 4. 处理多个不同context词的组合
  const uniqueContextWords = new Set(contextWords);
  if (uniqueContextWords.size > 1) {
    return {
      level: "context",
      words: Array.from(uniqueContextWords),
    };
  }

  // 5. 单个mild词（包括重复）或单个context词（包括重复）直接返回undefined
  return;
}

// 添加段落位置验证机制
export class ParagraphValidator {
  validateParagraphStructure(content: string) {
    const paragraphs = content.split(/段落\d+/);
    return paragraphs.every((p, index) => {
      // 确保每个段落都在正确的位置
      const expectedParagraphNum = index + 1;
      const hasCorrectHeader = p.startsWith(`段落${expectedParagraphNum}`);
      const hasCorrectImage = p.match(/!\[\]\(assets\/.*\/dalle-.*\.png\)/);
      return hasCorrectHeader && hasCorrectImage;
    });
  }
}
