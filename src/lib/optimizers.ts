import { ResourceOptimizer } from "./resourceOptimizer";

// 统一的优化器管理接口
export const appOptimizer = {
  initialize() {
    // 使用新的 ResourceOptimizer 类
    ResourceOptimizer.initialize();
  },

  setupContainer(container: HTMLElement | null) {
    if (!container) return;

    // 添加性能优化相关的设置
    container.style.willChange = "transform";
    container.style.transform = "translateZ(0)";
  },

  // 优化的定时器处理
  optimizedSetTimeout(callback: () => void, delay: number) {
    const start = performance.now();
    return setTimeout(() => {
      const elapsed = performance.now() - start;
      if (elapsed > delay) {
        console.warn(`Timer took longer than expected: ${elapsed}ms`);
      }
      callback();
    }, delay);
  },

  // 优化的动画帧处理
  optimizedRAF(callback: () => void) {
    const start = performance.now();
    return requestAnimationFrame(() => {
      const elapsed = performance.now() - start;
      if (elapsed > 16) {
        // 60fps = 16.67ms per frame
        console.warn(`Frame took longer than 16ms: ${elapsed}ms`);
      }
      callback();
    });
  },
};

export type AppOptimizer = typeof appOptimizer;
