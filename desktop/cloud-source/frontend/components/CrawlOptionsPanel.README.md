# CrawlOptionsPanel 组件

## 概述

`CrawlOptionsPanel` 是一个可复用的爬取选项配置组件，用于控制 Firecrawl 网页爬取的行为和范围。

## 功能特性

- ✅ 智能检测 URL 类型（SaaS 平台自动隐藏）
- ✅ 可折叠的高级选项面板
- ✅ 基础设置：页面数限制、爬取深度
- ✅ 路径过滤：包含/排除路径（正则表达式）
- ✅ 域名控制：整个域名、子域名、外部链接
- ✅ 其他选项：Sitemap 策略、爬取延迟
- ✅ 完全受控组件（Controlled Component）
- ✅ 与现有 UI 风格保持一致

## 使用位置

1. **ConnectContentView** - Connect 页面的 URL 解析
2. **ImportModal** - 创建表时的 URL 导入

## 智能显示逻辑

组件会自动检测 URL 类型，对以下 SaaS 平台自动隐藏（因为它们使用原生 API）：

- Notion (`notion.so`, `notion.site`)
- GitHub (`github.com`)
- Google Sheets (`docs.google.com/spreadsheets`)
- Linear (`linear.app`)
- Airtable (`airtable.com`)

## Props

```typescript
interface CrawlOptionsPanelProps {
  url: string;                        // 当前 URL，用于判断类型
  value: CrawlOptions;                // 当前配置值
  onChange: (options: CrawlOptions) => void;  // 值变化回调
  disabled?: boolean;                 // 是否禁用
}
```

## CrawlOptions 接口

```typescript
export interface CrawlOptions {
  limit?: number;                    // 最大页面数，默认 10000
  maxDiscoveryDepth?: number;        // 爬取深度
  includePaths?: string[];           // 包含路径正则
  excludePaths?: string[];           // 排除路径正则
  crawlEntireDomain?: boolean;       // 是否爬取整个域名
  sitemap?: 'only' | 'include' | 'skip';  // Sitemap 使用策略
  allowSubdomains?: boolean;         // 是否包含子域名
  allowExternalLinks?: boolean;      // 是否跟随外链
  delay?: number;                    // 爬取延迟（秒）
}
```

## 默认值

```typescript
{
  limit: 100,              // 合理的默认页面数
  maxDiscoveryDepth: 2,    // 避免爬取过深
  sitemap: 'include',      // 包含 sitemap
}
```

## 使用示例

```tsx
import { CrawlOptionsPanel } from './CrawlOptionsPanel';
import { CrawlOptions } from '../lib/connectApi';

function MyComponent() {
  const [url, setUrl] = useState('');
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    limit: 100,
    maxDiscoveryDepth: 2,
    sitemap: 'include',
  });

  return (
    <>
      <input 
        value={url} 
        onChange={e => setUrl(e.target.value)} 
      />
      
      <CrawlOptionsPanel
        url={url}
        value={crawlOptions}
        onChange={setCrawlOptions}
        disabled={false}
      />
    </>
  );
}
```

## 数据流

1. **前端** → 用户配置爬取选项
2. **前端** → 调用 `parseUrl(url, crawlOptions)`
3. **后端** → 接收 `crawl_options` 参数
4. **后端** → 传递给 Firecrawl API
5. **Firecrawl** → 根据选项执行爬取
6. **后端** → 返回结果给前端

## 样式规范

- 背景色：`#111111` / `#1a1a1a` / `#0a0a0a`
- 边框：`1px solid #2a2a2a`
- 文字颜色：`#CDCDCD`（标题），`#8B8B8B`（次要）
- 圆角：`6px` / `8px`
- 字体大小：11px（标签），12-13px（输入）

## 注意事项

1. 对 SaaS 平台（Notion/GitHub 等）自动隐藏
2. 路径过滤支持正则表达式
3. 组件状态完全受控，需要通过 `onChange` 更新
4. 可通过 `disabled` 属性禁用所有交互
