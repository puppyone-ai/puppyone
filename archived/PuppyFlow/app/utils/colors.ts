// UI 颜色常量
export const UI_COLORS = {
  // 边框和线条颜色
  EDGENODE_BORDER_GREY: '#8B8B8B',
  LINE: '#8B8B8B', // 与边框颜色保持一致
  LINE_ACTIVE: '#FFA73D',

  // 其他常用颜色
  MAIN_BLUE: '#4599DF',
  MAIN_ORANGE: '#FFA73D',
  MAIN_GREEN: '#39BC66',
  MAIN_GREY: '#CDCDCD',
  MAIN_BLACK_THEME: '#252525',
  MAIN_DEEP_GREY: '#3E3E41',
} as const;

// 导出类型以便 TypeScript 类型检查
export type UIColorKey = keyof typeof UI_COLORS;
