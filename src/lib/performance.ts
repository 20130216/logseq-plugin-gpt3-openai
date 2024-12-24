export const performanceOptimizer = {
  // 添加被动事件监听器
  addPassiveEventListeners: (element: HTMLElement) => {
    const events = ['touchstart', 'touchmove', 'mousewheel', 'scroll'];
    const options = { passive: true };
    
    events.forEach(event => {
      element.addEventListener(event, () => {}, options);
    });
  },

  // 优化定时器
  createOptimizedTimer: (callback: () => void, delay: number) => {
    let timeoutId: number;
    
    return {
      start: () => {
        timeoutId = window.setTimeout(() => {
          window.requestAnimationFrame(callback);
        }, delay);
      },
      stop: () => {
        window.clearTimeout(timeoutId);
      }
    };
  },

  // 优化字体加载
  optimizeFontLoading: () => {
    // 预加载字体
    const fontUrl = 'https://fonts.gstatic.com/s/firacode/v22/uU9eCBsR6Z2vfE9aq3bL0fxyUs4tcw4W_D1sJVD7NuzlojwUKQ.woff2';
    
    if ('fonts' in document) {
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'font';
      link.type = 'font/woff2';
      link.href = fontUrl;
      link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
    }
  }
}; 