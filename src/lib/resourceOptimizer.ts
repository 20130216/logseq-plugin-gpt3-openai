// 资源预加载和缓存管理
export class ResourceOptimizer {
  private static resources: Map<string, Promise<any>> = new Map();
  private static resourceCache: Map<string, any> = new Map();
  private static initialized = false;

  // 初始化预加载
  static async initialize() {
    if (this.initialized) return;

    // 预加载 OpenAI 设置
    this.preloadResource("openai-settings", async () => {
      const { getOpenaiSettings } = await import("./settings");
      return getOpenaiSettings();
    });

    this.initialized = true;
  }

  // 资源预加载
  static preloadResource(key: string, loader: () => Promise<any>) {
    if (!this.resources.has(key)) {
      const loadingPromise = loader()
        .then((result) => {
          this.resourceCache.set(key, result);
          return result;
        })
        .catch((error) => {
          console.error(`Failed to preload resource: ${key}`, error);
          throw error;
        });

      this.resources.set(key, loadingPromise);
    }
    return this.resources.get(key)!;
  }

  // 获取资源
  static async getResource(key: string) {
    // 优先从缓存获取
    if (this.resourceCache.has(key)) {
      return this.resourceCache.get(key);
    }

    // 其次从加载中的资源获取
    if (this.resources.has(key)) {
      return await this.resources.get(key);
    }

    throw new Error(`Resource not found: ${key}`);
  }

  // 清理资源
  static clearResources() {
    this.resources.clear();
    this.resourceCache.clear();
    this.initialized = false;
  }
}

// 添加内容组织优化器
export class ContentOrganizer {
  reorganizeContent(content: string) {
    const sections = content.split(/段落\d+/);
    return sections
      .map((section, index) => {
        // 确保描述、需求和图片的正确顺序
        const [description, requirement, image] = this.extractParts(section);
        return `段落${index + 1}\n${description}\n${requirement}\n${image}`;
      })
      .join("\n\n");
  }

  private extractParts(section: string) {
    // 提取并验证各个部分
    const description = section.match(/.*?(?=【绘图需求】)/s)?.[0] || "";
    const requirement = section.match(/【绘图需求】：.*?(?=!\[\])/s)?.[0] || "";
    const image = section.match(/!\[\].*\.png\)/)?.[0] || "";
    return [description, requirement, image];
  }
}
