import { ContentModerationErrorType } from './types/errors';
import { OpenAIOptions } from './openai';
import { handleOpenAIError } from './rawCommands';

// 定义敏感词类型
interface SensitiveCategory {
  extreme?: ReadonlyArray<string>;  // 绝对禁止的词
  mild?: ReadonlyArray<string>;     // 需要警惕的词
  context?: ReadonlyArray<string>;  // 需要上下文判断的词
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
      '傻逼', '妈的', '操', '草', '艹', '滚', '去死',
      '废物', '垃圾', '贱', '蠢', '混蛋', '王八蛋'
    ],
    mild: [],
    context: []
  },
  politics: {
    extreme: [
      '颠覆', '分裂', '暴动', '政变', '叛乱',
      '恐怖主义', '极端主义', '分裂势力'
    ],
    mild: [
      '示威', '抗议', '镇压', '政权', 
      '制裁', '暴乱', '政治迫害'
    ],
    context: [
      '总统', '主席', '政府', '军队', '民主',
      '自由', '独立', '革命', '政治',
      '毛泽东', '刘少奇', '李先念', '杨尚昆', '江泽民', 
      '胡锦涛', '习近平', '华国锋', '赵紫阳',
      '周恩来', '华国锋', '赵紫阳', '李鹏', '朱镕基', 
      '温家宝', '李克强', '张高丽', '韩正'
    ]
  },
  violence: {
    extreme: [
      '残杀', '屠杀', '灭口', '处死', '枪杀',
      '血腥', '虐待', '折磨', '残害', '毒杀'
    ],
    mild: [
      '打架', '斗殴', '威胁', '恐吓', '欺负',
      '报复', '冲突', '推搡'
    ],
    context: []
  },
  discrimination: {
    extreme: [],
    mild: [
      '贱民', '低等', '蛮夷', '野蛮人', 
      '性别歧视', '种族歧视', '地域歧视'
    ],
    context: []
  },
  harassment: {
    extreme: [],
    mild: [
      '性骚扰', '猥亵', '偷拍', '偷窥', 
      '勒索', '纠缠', '性侵', '强迫'
    ],
    context: []
  },
  illegal: {
    extreme: [],
    mild: [
      '毒品', '走私', '贩毒', '非法', '犯罪',
      '诈骗', '盗窃', '抢劫', '黑市', '洗钱'
    ],
    context: []
  },
  hate_speech: {
    extreme: [],
    mild: [
      '仇恨', '诅咒', '诽谤', '中伤', '污蔑',
      '人身攻击', '谩骂', '辱骂'
    ],
    context: []
  },
  sexual: {
    extreme: [],
    mild: [
      '色情', '淫秽', '下流', '露骨',
      '性交易', '卖淫', '嫖娼'
    ],
    context: []
  }
} as const;

// 版本控制
export const MODERATION_VERSION = '1.2.0';
export const LAST_UPDATED = '2024-01-20';

// OpenAI Moderation API 检查
export async function checkContentModeration(
  prompt: string, 
  options: OpenAIOptions
): Promise<void> {
  const response = await fetch(`${options.chatCompletionEndpoint}/moderations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ input: prompt })
  });

  if (!response.ok) {
    throw {
      type: ContentModerationErrorType.API_ERROR,
      message: 'Content moderation API request failed'
    };
  }

  const result = await response.json();
  if (result.results[0].flagged) {
    const categories = Object.entries(result.results[0].categories)
      .filter(([_, flagged]) => flagged)
      .map(([category]) => category)
      .join(', ');
    
    throw {
      type: ContentModerationErrorType.API_ERROR,
      message: `Content violates community guidelines. Categories: ${categories}`
    };
  }
}

// 定义错误提示信息映射
const ERROR_MESSAGES = {
  profanity: {
    extreme: '请文明用语，避免使用严重的脏话',
    mild: '请注意用语文明',
    context: '请注意用语得体'
  },
  politics: {
    extreme: '内容包含极端政治敏感词，请修改',
    mild: '内容包含政治敏感词，请谨慎',
    context: '内容可能涉及敏感政治倾向'
  },
  violence: {
    extreme: '内容包含严重暴力元素，请修改',
    mild: '内容包含轻微暴力元素，请注意',
    context: '内容可能涉及暴力倾向'
  },
  discrimination: {
    extreme: '内容包含严重歧视性言论',
    mild: '请避免使用歧视性语言',
    context: '内容可能涉及歧视倾向'
  },
  harassment: {
    extreme: '内容包含严重骚扰性质的词语',
    mild: '请避免使用骚扰性语言',
    context: '内容可能涉及骚扰倾向'
  },
  illegal: {
    extreme: '内容涉及违法犯罪',
    mild: '内容可能涉及违法信息',
    context: '内容可能涉及不当行为'
  },
  hate_speech: {
    extreme: '内容包含严重仇恨言论',
    mild: '请避免使用仇恨性言论',
    context: '内容可能涉及偏激言论'
  },
  sexual: {
    extreme: '内容包含严重不当性暗示',
    mild: '请避免不当性暗示内容',
    context: '内容可能涉及不当暗示'
  }
} as const;

// 统一的内容检查函数
export async function validateContent(
  input: string,
  options: OpenAIOptions
): Promise<void> {
  // 1. 先进行本地敏感词检查
  try {
    checkUserInput(input);
  } catch (error: any) {
    if (error.type && error.message) {
      handleOpenAIError({
        type: error.type,
        level: error.level || 'extreme',
        message: error.message,
        words: error.words
      });
    }
    throw error; // 抛出错误以中断流程
  }
  
  // 2. 进行 API 检查
  try {
    await checkContentModeration(input, options);
  } catch (error: any) {
    if (error.message?.includes("Content violates community guidelines")) {
      const category = error.message.split('Categories: ')[1].toLowerCase();
      const mappedCategory = mapCategoryToErrorType(category);
      const errorMessage = getErrorMessage(mappedCategory, category);
      
      handleOpenAIError({
        type: mappedCategory,
        level: 'extreme',
        message: errorMessage,
        words: [category]
      });
    }
    throw error; // 抛出错误以中断流程
  }
}

// 辅助函数：根据错误类型和原始类别获取错误消息
function getErrorMessage(errorType: ContentModerationErrorType, originalCategory: string): string {
  // 创建反向映射
  const reverseMap = new Map<ContentModerationErrorType, keyof typeof ERROR_MESSAGES>([
    [ContentModerationErrorType.VIOLENCE_EXTREME, 'violence'],
    [ContentModerationErrorType.HATE_SPEECH, 'hate_speech'],
    [ContentModerationErrorType.SEXUAL, 'sexual'],
    [ContentModerationErrorType.HARASSMENT, 'harassment'],
    [ContentModerationErrorType.DISCRIMINATION, 'discrimination'],
    [ContentModerationErrorType.POLITICS, 'politics'],
    [ContentModerationErrorType.PROFANITY, 'profanity'],
    [ContentModerationErrorType.ILLEGAL, 'illegal']
  ]);

  // 获取对应的类别键
  const categoryKey = reverseMap.get(errorType);

  if (categoryKey && ERROR_MESSAGES[categoryKey]) {
    const messages = ERROR_MESSAGES[categoryKey];
    // 根据不同级别返回对应消息
    if (originalCategory.includes('extreme') || originalCategory.includes('graphic')) {
      return messages.extreme;
    } else if (originalCategory.includes('mild')) {
      return messages.mild;
    } else {
      return messages.context;
    }
  }

  // 如果找不到对应的消息，返回默认消息
  return `内容包含不当内容(${originalCategory})，请修改`;
}

// 修改映射函数，确保所有类别都能正确映射
function mapCategoryToErrorType(category: string): ContentModerationErrorType {
  const categoryLower = category.toLowerCase();
  const map: Record<string, ContentModerationErrorType> = {
    'violence': ContentModerationErrorType.VIOLENCE_EXTREME,
    'hate': ContentModerationErrorType.HATE_SPEECH,
    'sexual': ContentModerationErrorType.SEXUAL,
    'harassment': ContentModerationErrorType.HARASSMENT,
    'discrimination': ContentModerationErrorType.DISCRIMINATION,
    'politics': ContentModerationErrorType.POLITICS,
    'profanity': ContentModerationErrorType.PROFANITY,
    'illegal': ContentModerationErrorType.ILLEGAL,
    'self-harm': ContentModerationErrorType.VIOLENCE_EXTREME,
    'threatening': ContentModerationErrorType.HARASSMENT,
    'graphic': ContentModerationErrorType.VIOLENCE_EXTREME,
    'malicious': ContentModerationErrorType.HATE_SPEECH,
    'misleading': ContentModerationErrorType.ILLEGAL,
    'spam': ContentModerationErrorType.ILLEGAL
  };

  // 使用模糊匹配，如果找不到精确匹配，尝试部分匹配
  const exactMatch = map[categoryLower];
  if (exactMatch) return exactMatch;

  // 部分匹配
  for (const [key, value] of Object.entries(map)) {
    if (categoryLower.includes(key)) {
      return value;
    }
  }

  return ContentModerationErrorType.API_ERROR;
}

// 修改敏感词检查函数
export function checkUserInput(input: string): void {
  const normalizedInput = input.toLowerCase().replace(/\s+/g, '');
  
  // 收集所有匹配
  const matches = {
    extreme: new Map<string, string[]>(),
    mild: new Map<string, string[]>(),
    context: new Map<string, string[]>()
  };

  // 收集所有匹配的词
  for (const [category, words] of Object.entries(SENSITIVE_WORDS)) {
    // 检查每个级别的词
    ['extreme', 'mild', 'context'].forEach((level) => {
      const levelWords = words[level as keyof SensitiveCategory];
      if (levelWords) {
        const found = levelWords.filter(word => 
          normalizedInput.includes(word.toLowerCase())
        );
        if (found.length > 0) {
          matches[level as keyof typeof matches].set(category, found);
        }
      }
    });
  }

  // 1. 首先检查极端敏感词
  if (matches.extreme.size > 0) {
    const [category, words] = Array.from(matches.extreme.entries())[0];
    const errorType = category as keyof typeof ERROR_MESSAGES;
    if (ERROR_MESSAGES[errorType]) {
      throw {
        type: category as ContentModerationErrorType,
        level: 'extreme',
        message: ERROR_MESSAGES[errorType].extreme,
        words
      };
    }
  }

  // 2. 检查轻微敏感词
  if (matches.mild.size > 0) {
    const [category, words] = Array.from(matches.mild.entries())[0];
    const errorType = category as keyof typeof ERROR_MESSAGES;
    if (ERROR_MESSAGES[errorType]) {
      throw {
        type: category as ContentModerationErrorType,
        level: 'mild',
        message: ERROR_MESSAGES[errorType].mild,
        words
      };
    }
  }

  // 3. 检查中性词组合
  if (matches.context.size > 0) {
    // 检查是否有其他类型的敏感词或多个中性词
    const hasOtherSensitiveWords = matches.extreme.size > 0 || matches.mild.size > 0;
    const hasMultipleContextWords = Array.from(matches.context.values())
      .reduce((total, words) => total + words.length, 0) > 1;

    // 只有当中性词与其他词共现，或有多个中性词时才触发警告
    if (hasOtherSensitiveWords || hasMultipleContextWords) {
      const categories = Array.from(matches.context.keys());
      const words = Array.from(matches.context.values()).flat();
      const firstCategory = categories[0] as keyof typeof ERROR_MESSAGES;
      if (ERROR_MESSAGES[firstCategory]) {
        throw {
          type: firstCategory as ContentModerationErrorType,
          level: 'context',
          message: ERROR_MESSAGES[firstCategory].context,
          words
        };
      }
    }
  }
}
  