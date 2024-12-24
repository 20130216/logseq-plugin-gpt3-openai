import { ResourceOptimizer } from './resourceOptimizer';

// 统一的优化器管理接口
export const appOptimizer = {
  initialize() {
    // 使用新的 ResourceOptimizer 类
    ResourceOptimizer.initialize();
  },

  setupContainer(container: HTMLElement | null) {
    if (!container) return;
    
    // 添加性能优化相关的设置
    container.style.willChange = 'transform';
    container.style.transform = 'translateZ(0)';
  }
};

export type AppOptimizer = typeof appOptimizer; 