#!/usr/bin/env tsx
/**
 * Semantic Separation Impact Analyzer
 * 
 * 分析语义解离（chunks→entries/parts）的实际影响范围
 * 基于import/export关系计算依赖图
 * 
 * Usage:
 *   npx tsx scripts/analyze-semantic-separation-impact.ts
 * 
 * Output:
 *   - 依赖关系图（JSON）
 *   - 影响范围报告（Markdown）
 *   - 可视化依赖图（Mermaid）
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// 配置
// ============================================================================

const TARGET_SYMBOLS = {
  // Part 1: Vector Indexing
  vectorIndexing: [
    'VectorChunk',
    'VectorIndexingItem',
    'extractChunks',
    'chunks', // 仅在indexingList上下文
  ],
  
  // Part 2: Storage Partitioning
  storagePartitioning: [
    'ChunkDescriptor',
    'ChunkingService',
    'chunk', // 方法名
    'chunkContent',
    'uploadChunkList',
    'chunk_size',
    'CHUNK_SIZE',
  ],
  
  // Part 3: Workflow Chunk Edge (排除)
  workflowEdge: [
    'ChunkEdge',
    'ChunkingByLength',
    'ChunkingByCharacter',
  ],
};

const WORKSPACE_ROOTS = [
  '/Users/j.z/code/puppy/PuppyAgent-Jack/PuppyFlow',
  '/Users/j.z/code/puppy/PuppyAgent-Jack/PuppyEngine',
  '/Users/j.z/code/puppy/PuppyAgent-Jack/PuppyStorage',
];

const FILE_PATTERNS = {
  typescript: /\.(ts|tsx)$/,
  python: /\.py$/,
  markdown: /\.md$/,
};

// ============================================================================
// 类型定义
// ============================================================================

interface FileNode {
  path: string;
  relativePath: string;
  type: 'typescript' | 'python' | 'markdown' | 'other';
  imports: string[];
  exports: string[];
  symbolUsages: {
    symbol: string;
    category: 'vectorIndexing' | 'storagePartitioning' | 'workflowEdge';
    lineNumbers: number[];
    context: string[];
  }[];
}

interface DependencyGraph {
  files: Map<string, FileNode>;
  edges: Array<{ from: string; to: string; symbols: string[] }>;
}

interface ImpactAnalysis {
  directImpact: string[];
  transitiveImpact: string[];
  safeZone: string[];
  riskLevel: { [file: string]: 'high' | 'medium' | 'low' };
}

// ============================================================================
// 文件发现
// ============================================================================

function findRelevantFiles(roots: string[]): string[] {
  const files: string[] = [];
  
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    
    const output = execSync(`find "${root}" -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.py" \\) | grep -v node_modules | grep -v __pycache__`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
    
    files.push(...output.split('\n').filter(Boolean));
  }
  
  return files;
}

// ============================================================================
// Symbol扫描
// ============================================================================

function scanFileForSymbols(filePath: string, content: string): FileNode['symbolUsages'] {
  const usages: FileNode['symbolUsages'] = [];
  const lines = content.split('\n');
  
  // 扫描所有target symbols
  const allSymbols = [
    ...TARGET_SYMBOLS.vectorIndexing.map(s => ({ symbol: s, category: 'vectorIndexing' as const })),
    ...TARGET_SYMBOLS.storagePartitioning.map(s => ({ symbol: s, category: 'storagePartitioning' as const })),
    ...TARGET_SYMBOLS.workflowEdge.map(s => ({ symbol: s, category: 'workflowEdge' as const })),
  ];
  
  for (const { symbol, category } of allSymbols) {
    const lineNumbers: number[] = [];
    const contexts: string[] = [];
    
    // 使用正则匹配symbol（考虑单词边界）
    const regex = new RegExp(`\\b${symbol}\\b`, 'g');
    
    lines.forEach((line, idx) => {
      if (regex.test(line)) {
        lineNumbers.push(idx + 1);
        contexts.push(line.trim());
      }
    });
    
    if (lineNumbers.length > 0) {
      usages.push({
        symbol,
        category,
        lineNumbers,
        context: contexts.slice(0, 3), // 只保留前3个上下文
      });
    }
  }
  
  return usages;
}

// ============================================================================
// Import/Export解析
// ============================================================================

function parseImportsExports(filePath: string, content: string): { imports: string[]; exports: string[] } {
  const imports: string[] = [];
  const exports: string[] = [];
  
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    // TypeScript
    const importRegex = /import\s+.*?\s+from\s+['"](.+?)['"]/g;
    const exportRegex = /export\s+.*?\s+from\s+['"](.+?)['"]/g;
    
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }
    while ((match = exportRegex.exec(content)) !== null) {
      exports.push(match[1]);
    }
  } else if (filePath.endsWith('.py')) {
    // Python
    const importRegex = /(?:from\s+(\S+)\s+)?import\s+(.+)/g;
    
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      if (match[1]) {
        imports.push(match[1]);
      }
    }
  }
  
  return { imports, exports };
}

// ============================================================================
// 依赖图构建
// ============================================================================

function buildDependencyGraph(files: string[]): DependencyGraph {
  const graph: DependencyGraph = {
    files: new Map(),
    edges: [],
  };
  
  console.log(`\n🔍 正在分析 ${files.length} 个文件...\n`);
  
  // 第一遍：扫描所有文件
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const { imports, exports } = parseImportsExports(filePath, content);
    const symbolUsages = scanFileForSymbols(filePath, content);
    
    const relativePath = filePath.replace(/^.*\/PuppyAgent-Jack\//, '');
    
    const fileType = filePath.endsWith('.ts') || filePath.endsWith('.tsx')
      ? 'typescript'
      : filePath.endsWith('.py')
      ? 'python'
      : 'other';
    
    graph.files.set(filePath, {
      path: filePath,
      relativePath,
      type: fileType,
      imports,
      exports,
      symbolUsages,
    });
    
    if (symbolUsages.length > 0) {
      console.log(`  ✓ ${relativePath}: ${symbolUsages.length} symbol(s)`);
    }
  }
  
  // 第二遍：构建edges（基于import关系）
  for (const [fromPath, fromNode] of graph.files) {
    for (const importPath of fromNode.imports) {
      // 尝试解析相对路径
      const resolvedPath = resolveImportPath(fromPath, importPath, graph.files);
      if (resolvedPath && graph.files.has(resolvedPath)) {
        const toNode = graph.files.get(resolvedPath)!;
        const sharedSymbols = findSharedSymbols(fromNode, toNode);
        
        if (sharedSymbols.length > 0) {
          graph.edges.push({
            from: fromPath,
            to: resolvedPath,
            symbols: sharedSymbols,
          });
        }
      }
    }
  }
  
  return graph;
}

function resolveImportPath(fromPath: string, importPath: string, files: Map<string, FileNode>): string | null {
  // 处理相对路径
  if (importPath.startsWith('.')) {
    const dir = path.dirname(fromPath);
    const resolved = path.resolve(dir, importPath);
    
    // 尝试添加扩展名
    for (const ext of ['.ts', '.tsx', '.py', '/index.ts', '/index.tsx']) {
      const candidate = resolved + ext;
      if (files.has(candidate)) return candidate;
    }
  }
  
  // 处理绝对路径（库名）
  for (const [filePath, node] of files) {
    if (node.relativePath.includes(importPath)) {
      return filePath;
    }
  }
  
  return null;
}

function findSharedSymbols(nodeA: FileNode, nodeB: FileNode): string[] {
  const symbolsA = new Set(nodeA.symbolUsages.map(u => u.symbol));
  const symbolsB = new Set(nodeB.symbolUsages.map(u => u.symbol));
  
  return Array.from(symbolsA).filter(s => symbolsB.has(s));
}

// ============================================================================
// 影响分析
// ============================================================================

function analyzeImpact(graph: DependencyGraph): ImpactAnalysis {
  const directImpact: Set<string> = new Set();
  const transitiveImpact: Set<string> = new Set();
  const safeZone: Set<string> = new Set();
  const riskLevel: { [file: string]: 'high' | 'medium' | 'low' } = {};
  
  // 1. 识别直接影响（使用了target symbols）
  for (const [filePath, node] of graph.files) {
    const hasVector = node.symbolUsages.some(u => u.category === 'vectorIndexing');
    const hasStorage = node.symbolUsages.some(u => u.category === 'storagePartitioning');
    const hasWorkflow = node.symbolUsages.some(u => u.category === 'workflowEdge');
    
    if (hasVector || hasStorage) {
      directImpact.add(filePath);
      
      // 风险评估
      const totalUsages = node.symbolUsages.reduce((sum, u) => sum + u.lineNumbers.length, 0);
      if (totalUsages > 10) {
        riskLevel[filePath] = 'high';
      } else if (totalUsages > 3) {
        riskLevel[filePath] = 'medium';
      } else {
        riskLevel[filePath] = 'low';
      }
    } else if (hasWorkflow) {
      safeZone.add(filePath);
    }
  }
  
  // 2. 传递性影响（依赖于直接影响的文件）
  const visited = new Set<string>();
  
  function traverse(filePath: string, depth: number) {
    if (visited.has(filePath) || depth > 3) return; // 限制深度
    visited.add(filePath);
    
    // 找到所有依赖于当前文件的文件
    for (const edge of graph.edges) {
      if (edge.to === filePath && !directImpact.has(edge.from) && !safeZone.has(edge.from)) {
        transitiveImpact.add(edge.from);
        traverse(edge.from, depth + 1);
      }
    }
  }
  
  for (const filePath of directImpact) {
    traverse(filePath, 0);
  }
  
  // 3. 安全区域（没有任何target symbols）
  for (const [filePath, node] of graph.files) {
    if (!directImpact.has(filePath) && !transitiveImpact.has(filePath) && !safeZone.has(filePath)) {
      if (node.symbolUsages.length === 0) {
        safeZone.add(filePath);
      }
    }
  }
  
  return {
    directImpact: Array.from(directImpact),
    transitiveImpact: Array.from(transitiveImpact),
    safeZone: Array.from(safeZone),
    riskLevel,
  };
}

// ============================================================================
// 报告生成
// ============================================================================

function generateMarkdownReport(graph: DependencyGraph, impact: ImpactAnalysis): string {
  const report: string[] = [];
  
  report.push('# Semantic Separation Impact Analysis Report\n');
  report.push(`> Generated: ${new Date().toISOString()}\n`);
  report.push('---\n');
  
  // 总览
  report.push('## 📊 Executive Summary\n');
  report.push('| Metric | Count |');
  report.push('|--------|-------|');
  report.push(`| Total Files Scanned | ${graph.files.size} |`);
  report.push(`| Direct Impact | ${impact.directImpact.length} 🔴 |`);
  report.push(`| Transitive Impact | ${impact.transitiveImpact.length} 🟡 |`);
  report.push(`| Safe Zone | ${impact.safeZone.length} ✅ |`);
  report.push(`| Dependency Edges | ${graph.edges.length} |\n`);
  
  // 直接影响
  report.push('## 🔴 Direct Impact Files (需要修改)\n');
  report.push('这些文件直接使用了需要重命名的symbols：\n');
  
  const sortedDirect = impact.directImpact
    .map(f => ({ file: f, node: graph.files.get(f)!, risk: impact.riskLevel[f] }))
    .sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      return riskOrder[a.risk] - riskOrder[b.risk];
    });
  
  for (const { file, node, risk } of sortedDirect) {
    const riskEmoji = risk === 'high' ? '🔴' : risk === 'medium' ? '🟡' : '🟢';
    const totalUsages = node.symbolUsages.reduce((sum, u) => sum + u.lineNumbers.length, 0);
    
    report.push(`### ${riskEmoji} ${node.relativePath} (${risk.toUpperCase()})\n`);
    report.push(`- **Risk Level**: ${risk}`);
    report.push(`- **Total Symbol Usages**: ${totalUsages}`);
    report.push(`- **Symbols Used**:\n`);
    
    for (const usage of node.symbolUsages) {
      report.push(`  - \`${usage.symbol}\` (${usage.category}): ${usage.lineNumbers.length} usages`);
      report.push(`    - Lines: ${usage.lineNumbers.slice(0, 10).join(', ')}${usage.lineNumbers.length > 10 ? '...' : ''}`);
      if (usage.context.length > 0) {
        report.push(`    - Context: \`${usage.context[0]}\``);
      }
    }
    report.push('');
  }
  
  // 传递性影响
  report.push('## 🟡 Transitive Impact Files (可能需要更新)\n');
  report.push('这些文件依赖于直接影响的文件，可能需要更新import或类型定义：\n');
  
  for (const file of impact.transitiveImpact.slice(0, 20)) {
    const node = graph.files.get(file)!;
    const dependencies = graph.edges.filter(e => e.from === file).map(e => graph.files.get(e.to)!.relativePath);
    
    report.push(`- **${node.relativePath}**`);
    if (dependencies.length > 0) {
      report.push(`  - Depends on: ${dependencies.slice(0, 3).join(', ')}${dependencies.length > 3 ? '...' : ''}`);
    }
  }
  
  if (impact.transitiveImpact.length > 20) {
    report.push(`\n...and ${impact.transitiveImpact.length - 20} more files.\n`);
  }
  
  // 安全区域
  report.push('\n## ✅ Safe Zone (无需修改)\n');
  report.push(`共 ${impact.safeZone.length} 个文件未使用任何target symbols，无需修改。\n`);
  
  // Mermaid依赖图（仅显示高风险文件）
  report.push('## 🗺️ Dependency Graph (High Risk Only)\n');
  report.push('```mermaid');
  report.push('graph TD');
  
  const highRiskFiles = sortedDirect.filter(f => f.risk === 'high').map(f => f.file);
  const relevantEdges = graph.edges.filter(e => 
    highRiskFiles.includes(e.from) || highRiskFiles.includes(e.to)
  );
  
  for (const edge of relevantEdges.slice(0, 50)) {
    const fromNode = graph.files.get(edge.from)!;
    const toNode = graph.files.get(edge.to)!;
    const fromLabel = path.basename(fromNode.relativePath);
    const toLabel = path.basename(toNode.relativePath);
    report.push(`  ${fromLabel}[${fromLabel}] --> ${toLabel}[${toLabel}]`);
  }
  
  report.push('```\n');
  
  // 推荐行动
  report.push('## 🎯 Recommended Actions\n');
  report.push('1. **Phase 1**: 修改所有🔴 HIGH risk文件（核心API层）');
  report.push('2. **Phase 2**: 修改🟡 MEDIUM risk文件（集成层）');
  report.push('3. **Phase 3**: 修改🟢 LOW risk文件（UI组件等）');
  report.push('4. **Phase 4**: 检查🟡 Transitive Impact文件的import是否需要更新');
  report.push('5. **Phase 5**: 运行测试验证✅ Safe Zone文件未受影响\n');
  
  return report.join('\n');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║      Semantic Separation Impact Analyzer                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // 1. 发现文件
  console.log('📂 正在发现代码文件...');
  const files = findRelevantFiles(WORKSPACE_ROOTS);
  console.log(`✓ 发现 ${files.length} 个文件\n`);
  
  // 2. 构建依赖图
  console.log('🔗 正在构建依赖图...');
  const graph = buildDependencyGraph(files);
  console.log(`✓ 构建完成: ${graph.files.size} nodes, ${graph.edges.length} edges\n`);
  
  // 3. 影响分析
  console.log('🎯 正在分析影响范围...');
  const impact = analyzeImpact(graph);
  console.log(`✓ 分析完成\n`);
  
  // 4. 生成报告
  console.log('📝 正在生成报告...');
  const report = generateMarkdownReport(graph, impact);
  
  const outputDir = '/Users/j.z/code/puppy/PuppyAgent-Jack/docs/implementation';
  const reportPath = path.join(outputDir, 'semantic-separation-impact-analysis.md');
  
  fs.writeFileSync(reportPath, report, 'utf-8');
  console.log(`✓ 报告已保存: ${reportPath}\n`);
  
  // 5. 输出摘要
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    分析完成                                  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`📊 Direct Impact:      ${impact.directImpact.length} files 🔴`);
  console.log(`📊 Transitive Impact:  ${impact.transitiveImpact.length} files 🟡`);
  console.log(`📊 Safe Zone:          ${impact.safeZone.length} files ✅\n`);
  console.log(`📄 Full report: ${reportPath}\n`);
}

main().catch(console.error);

