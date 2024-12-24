import { performanceOptimizer } from './performance';
import { resourceOptimizer } from './resourceOptimizer';

// 统一的优化器管理接口
export const appOptimizer = {
  performance: performanceOptimizer,
  resource: resourceOptimizer,
  
  // 初始化所有优化器
  initialize: () => {
    // 初始化资源优化
    appOptimizer.resource.fontLoader.loadChineseFonts();
    appOptimizer.resource.resourceLoader.optimizeLoadOrder();

    // 初始化性能优化
    appOptimizer.performance.optimizeFontLoading();
  },

  // 应用容器优化
  setupContainer: (container: HTMLElement | null) => {
    if (container) {
      appOptimizer.performance.addPassiveEventListeners(container);
    }
  }
};

export type AppOptimizer = typeof appOptimizer; 