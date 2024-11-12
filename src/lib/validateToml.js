const fs = require('fs');
const toml = require('@iarna/toml');
const pinyin = require('node-pinyin');

function isTomlFileValid(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    toml.parse(content);
    return true;
  } catch (error) {
    console.error(`TOML文件无效: ${error.message}`);
    return false;
  }
}

function isValidIdentifier(key) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key);
}

function sanitizeKey(key) {
  console.log(`原始键名: ${key}`);
  // 检查是否为英文表头
  if (/^[a-zA-Z0-9_ ]+$/.test(key)) {
    return key.replace(/ /g, '_');
  }

  // 将中文字符转换为拼音，并在每个拼音之间加上下划线
  let sanitizedKey = key.split('').map(char => {
    if (/[\u4e00-\u9fa5]/.test(char)) {
      // 获取拼音数组，确保每个拼音之间加上下划线
      const pinyinArray = pinyin(char, { style: 'normal', segment: true });
      if (Array.isArray(pinyinArray) && pinyinArray.length > 0) {
        // 确保每个拼音都是字符串并去除声调符号
        const cleanPinyin = pinyinArray.map(pinyinPart => {
          if (Array.isArray(pinyinPart) && pinyinPart.length > 0) {
            return pinyinPart[0].toLowerCase().replace(/[\u0300-\u036f]/g, '');
          } else if (typeof pinyinPart === 'string') {
            return pinyinPart.toLowerCase().replace(/[\u0300-\u036f]/g, '');
          }
          return '';
        }).join('');
        return cleanPinyin;
      } else {
        return char; // 如果无法获取拼音，保留原字符
      }
    } else {
      return char;
    }
  }).join('_'); // 在每个拼音之间加上下划线
  console.log(`转换拼音后: ${sanitizedKey}`);
  // 替换其他非字母数字字符为下划线
  sanitizedKey = sanitizedKey.replace(/[^a-zA-Z0-9_]/g, '_');
  console.log(`替换非字母数字字符后: ${sanitizedKey}`);
  if (!/^[a-zA-Z_]/.test(sanitizedKey)) {
    // 确保第一个字符为字母或下划线
    sanitizedKey = 'key_' + sanitizedKey;
  }
  console.log(`确保第一个字符为字母或下划线后: ${sanitizedKey}`);
  // 去除连续的下划线
  sanitizedKey = sanitizedKey.replace(/_{2,}/g, '_');
  console.log(`去除连续的下划线后: ${sanitizedKey}`);
  // 去除前后的下划线
  sanitizedKey = sanitizedKey.replace(/^_+|_+$/g, '');
  console.log(`去除前后的下划线后: ${sanitizedKey}`);

  // 如果最终结果为空，则添加一个默认前缀
  if (sanitizedKey === '') {
    sanitizedKey = 'invalid_key';
  }
  console.log(`最终键名: ${sanitizedKey}`);
  return sanitizedKey;
}

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

function fixPromptField(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const fixedContent = fixInvalidKeys(content);
    const data = toml.parse(fixedContent);

    let fixed = false;

    for (const sectionName in data) {
      const section = data[sectionName];

      if ('name' in section && typeof section.name !== 'string') {
        console.log(`修复无效的name字段: ${section.name}`);
        section.name = String(section.name);
        fixed = true;
      }

      if ('description' in section && typeof section.description !== 'string') {
        console.log(`修复无效的description字段: ${section.description}`);
        section.description = String(section.description);
        fixed = true;
      }

      if ('prompt' in section) {
        let prompt = section.prompt;
        if (typeof prompt !== 'string') {
          console.log(`修复无效的prompt字段: ${prompt}`);
          section.prompt = `'''${String(prompt)}'''`;
          fixed = true;
        } else if (prompt.includes('\n') && !prompt.startsWith("'''")) {
          console.log(`修复多行prompt字段: ${prompt}`);
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
    console.error(`无法解析TOML文件: ${error.message}`);
    return false;
  }
}

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

    // 如果文件有效，继续修复prompt字段
    const promptFixed = fixPromptField(filePath);

    // 再次验证文件
    if (!isTomlFileValid(filePath)) {
      console.error(`文件修复后仍无效: ${filePath}`);
      return false;
    }

    console.log(`修改后的TOML文件有效，无需修复！`);
    return promptFixed;
  } else {
    console.log(`文件已有效: ${filePath}`);
    return true;
  }
}

// 使用相对路径
const filePath = './src/prompts/prompts-gpts.toml';
validateAndFixToml(filePath);