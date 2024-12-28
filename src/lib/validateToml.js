const fs = require('fs');
const toml = require('@iarna/toml');
const pinyin = require('node-pinyin');

// 检查 TOML 文件是否有效
function isTomlFileValid(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    toml.parse(content);
    return true;
  } catch (error) {
    console.error(`TOML 文件无效: ${error.message}`);
    return false;
  }
}

// 检查键名是否有效
function isValidIdentifier(key) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

// 修复键名
function sanitizeKey(key) {
  console.log(`原始键名: ${key}`);

  // 检查是否为纯英文表头（包含字母、数字、空格和常见标点）
  if (/^[a-zA-Z0-9\s\(\)]+$/.test(key)) {
    // 处理英文表头，保持单词的完整性
    let sanitizedKey = key
      .replace(/[^a-zA-Z0-9\s]/g, ' ') // 将标点符号转换为空格
      .trim()                          // 去除前后空格
      .replace(/\s+/g, '_');           // 将连续空格转换为单个下划线

    console.log(`英文处理后: ${sanitizedKey}`);
    return sanitizedKey;
  }

  // 处理包含中文的表头
  let sanitizedKeyParts = [];
  let currentWord = '';

  for (let char of key) {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      // 如果当前积累的英文单词不为空，先处理它
      if (currentWord) {
        sanitizedKeyParts.push(currentWord.trim());
        currentWord = '';
      }

      // 获取拼音数组
      const pinyinArray = pinyin(char, { style: 'normal', segment: true });
      if (Array.isArray(pinyinArray) && pinyinArray.length > 0) {
        const cleanPinyin = pinyinArray.map(pinyinPart => {
          if (Array.isArray(pinyinPart) && pinyinPart.length > 0) {
            return pinyinPart[0].toLowerCase().replace(/[\u0300-\u036f]/g, '');
          } else if (typeof pinyinPart === 'string') {
            return pinyinPart.toLowerCase().replace(/[\u0300-\u036f]/g, '');
          }
          return '';
        }).join('');

        sanitizedKeyParts.push(cleanPinyin);
      }
    } else if (/[a-zA-Z0-9]/.test(char)) {
      currentWord += char;
    } else {
      // 处理非中文非英文字符
      if (currentWord) {
        sanitizedKeyParts.push(currentWord.trim());
        currentWord = '';
      }
    }
  }

  // 处理最后可能剩余的英文单词
  if (currentWord) {
    sanitizedKeyParts.push(currentWord.trim());
  }

  // 合并所有部分，用下划线连接
  let sanitizedKey = sanitizedKeyParts.join('_').toLowerCase();
  console.log(`合并后: ${sanitizedKey}`);

  // 确保以字母或下划线开头
  if (!/^[a-zA-Z_]/.test(sanitizedKey)) {
    sanitizedKey = 'key_' + sanitizedKey;
  }

  // 清理连续的下划线
  sanitizedKey = sanitizedKey
    .replace(/_{2,}/g, '_')     // 将多个连续下划线替换为单个
    .replace(/^_+|_+$/g, '');   // 去除首尾下划线

  // 如果处理后为空，使用默认值
  if (sanitizedKey === '') {
    sanitizedKey = 'invalid_key';
  }

  console.log(`最终键名: ${sanitizedKey}`);
  return sanitizedKey;
}

// 修复无效键名
function fixInvalidKeys(content) {
  const lines = content.split('\n');
  const fixedLines = lines.map(line => {
    const match = line.match(/^\[(.*)\]$/);
    if (match && !isValidIdentifier(match[1])) {
      const fixedKey = sanitizeKey(match[1]);
      console.log(`修复无效的表头: ${match[1]} -> ${fixedKey}`);
      return `[${fixedKey}]`;
    }
    return line;
  });
  return fixedLines.join('\n');
}

// 修复 prompt 字段
function fixPromptField(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixedContent = fixInvalidKeys(content);
    const data = toml.parse(fixedContent);

    let fixed = false;

    for (const sectionName in data) {
      const section = data[sectionName];

      if ('name' in section && typeof section.name !== 'string') {
        console.log(`修复无效的 name 字段: ${section.name}`);
        section.name = String(section.name);
        fixed = true;
      }

      if ('description' in section && typeof section.description !== 'string') {
        console.log(`修复无效的 description 字段: ${section.description}`);
        section.description = String(section.description);
        fixed = true;
      }

      if ('prompt' in section) {
        let prompt = section.prompt;
        if (typeof prompt !== 'string') {
          console.log(`修复无效的 prompt 字段: ${prompt}`);
          section.prompt = `'''${String(prompt)}'''`;
          fixed = true;
        } else if (prompt.includes('\n') && !prompt.startsWith("'''")) {
          console.log(`修复多行 prompt 字段: ${prompt}`);
          section.prompt = `'''${prompt}'''`;
          fixed = true;
        }
      }
    }

    if (fixed) {
      const updatedContent = toml.stringify(data);
      fs.writeFileSync(filePath, updatedContent, 'utf-8');
      console.log(`已修复文件: ${filePath}`);
      return true;
    } else {
      console.log(`文件已有效，无需修复: ${filePath}`);
      return true;
    }
  } catch (error) {
    console.error(`无法解析 TOML 文件: ${error.message}`);
    return false;
  }
}

// 校验并修复 TOML 文件
function validateAndFixToml(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`文件不存在: ${filePath}`);
    return false;
  }

  if (!isTomlFileValid(filePath)) {
    // 尝试修复文件
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixedContent = fixInvalidKeys(content);
    fs.writeFileSync(filePath, fixedContent, 'utf-8');
    console.log(`已修复文件键名: ${filePath}`);

    // 重新验证文件
    if (!isTomlFileValid(filePath)) {
      console.error(`文件修复后仍无效: ${filePath}`);
      return false;
    }

    // 如果文件有效，继续修复 prompt 字段
    const promptFixed = fixPromptField(filePath);

    // 再次验证文件
    if (!isTomlFileValid(filePath)) {
      console.error(`文件修复后仍无效: ${filePath}`);
      return false;
    }

    console.log(`修改后的 TOML 文件有效，无需修复！`);
    return promptFixed;
  } else {
    console.log(`文件已有效: ${filePath}`);
    return true;
  }
}

// 使用相对路径
const filePath = './src/prompts/prompts-gpts.toml';
validateAndFixToml(filePath);

// 导出函数（如果需要在其他地方使用）
module.exports = {
  validateAndFixToml,
  isTomlFileValid,
  fixPromptField,
};