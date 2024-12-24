export const resourceOptimizer = {
  fontLoader: {
    loadChineseFonts: () => {
      // 定义本地字体列表
      const systemFonts = {
        macos: [
          '-apple-system',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei'
        ],
        windows: [
          'Microsoft YaHei',
          'Microsoft JhengHei',
          'SimSun'
        ],
        linux: [
          'Noto Sans CJK SC',
          'WenQuanYi Micro Hei'
        ],
        fallback: ['sans-serif']
      };

      const getOS = () => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        if (userAgent.includes('mac')) return 'macos';
        if (userAgent.includes('win')) return 'windows';
        if (userAgent.includes('linux')) return 'linux';
        return 'fallback';
      };

      const os = getOS();
      const fontStack = [
        ...systemFonts[os],
        ...systemFonts.fallback
      ].join(', ');

      // 只应用必要的字体样式
      const style = document.createElement('style');
      style.textContent = `
        /* 全局字体设置 */
        :root {
          --ls-font-family: ${fontStack};
        }

        /* 主要内容区域 */
        .cp__header, 
        .cp__sidebar, 
        .cp__right-sidebar,
        .block-content {
          font-family: ${fontStack};
        }

        /* 编辑器区域 */
        .editor-inner {
          font-family: ${fontStack};
        }
      `;
      document.head.appendChild(style);
    }
  },

  resourceLoader: {
    optimizeLoadOrder: () => {
      // 只在开发环境下监控性能
      if (process.env.NODE_ENV === 'development') {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'layout-shift') {
              const layoutShift = entry as LayoutShiftAttribution;
              if (layoutShift.value > 0.1) {
                console.debug('Layout shift:', layoutShift.value);
              }
            }
          }
        });
        
        try {
          observer.observe({ entryTypes: ['layout-shift'] });
        } catch (e) {
          // 忽略错误
        }
      }
    }
  }
};

interface LayoutShiftAttribution extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
} 