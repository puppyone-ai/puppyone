# Native Editor Lab

独立的小型原生编辑器验证，**不替换主应用的 Web 编辑器**。Rust + GPUI Kit 0.8.0（gpui-pre 0.3.9）；没有 WebView，不加载 JavaScript。与主程序共享 GPUI 文本输入 primitive，文档模型和统一撤销由本验证独立拥有。

这里只使用内存中的示例文档，不读写真实文档、正式设置或账户。关闭改动过的窗口会询问是否丢弃；没有磁盘保存和崩溃恢复。请不要在这里录入重要内容。

## Run

```bash
cd puppy-one-rust/native-editor-probe
cargo run --release --locked
# 可选：共享已有的编译缓存，不改变主程序
CARGO_TARGET_DIR=../target cargo run --release --locked
```

常规构建不需要 Node、Python 或本地服务器。界面使用 Geist，正文使用原产品的 Open Sans 四种字形（Regular/Bold/Italic/BoldItalic），使 GPUI 的粗体/斜体均有实际字体匹配。窗口标题是 **PuppyOne — GPUI Native Editor Lab (memory only)**。

## Try

- 段落、标题、表格单元格可以直接编辑，不需要点击切换源码。
- **选中文字**，按 `⌘B` / `⌘I`（其他平台使用 Ctrl），或点击 B / I，改变粗体/斜体。这里没有空选区的“接下来输入采用某格式”模式。
- 表格中用 Tab / Shift+Tab 移动到下一个/上一个单元格；Enter 移到下一行同列，末尾循环。工具栏可增删行列，保护表头和最后一列/最后一行数据。
- 粘贴包含制表符的矩形 TSV，会从当前单元格填入并在限额内扩展表格；拒绝超限或不规则数据，不部分覆盖。不是支持引号规则的 CSV 导入。
- `⌘Z` / `⌘⇧Z`：统一撤销/重做文本、样式和表格结构，并恢复选区。IME preedit 到 commit 作为一次文档撤销；普通输入目前按原生文本变更事件记录，不是成熟的连续输入分组。
- Markdown 投影只读，也可以复制到剪贴板。**这是有限投影，不是通用解析器或无损往返 codec**；格式 run 的空白边界等语法尚需完善。

## Deliberate limits

- 单块内选择；没有跨段落/表格的连续选区、多格范围选择、合并单元格、列宽拖动或虚拟化。
- 表格最多 12 行 × 6 列，每个文本节点最多 4096 Unicode scalar，历史最多 64 个快照；该存储方式只适合此验证。
- IME 使用 GPUI `EntityInputHandler` 与平台适配；合成事件测试不代表真实系统输入法、候选窗、失焦、多语言和辅助技术已验收。
- Unicode scalar、UTF-8 和 UTF-16 索引映射已测试；左右移动/删除按 grapheme 边界，组合 emoji 删除有回归测试。系统 CJK 字体 fallback、粗体字重、复杂文字 shaping 仍有待验证，未承诺跨平台相同字形。
- 剪贴板复制是纯文本；TSV 粘贴有自己的明确入口，不保留 HTML/外部富文本格式。
- 不提供正式 Markdown 模型、文件保存、Working Copy、多文档生命周期或像素/性能验收。它的结构化模型不能直接替换主产品的规范 Markdown 内核。

规范与验证记录归 `puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/evidence/gpui-migration-2026-10-22.md（早期 egui 收据保留在同目录 native-editor-probe-2026-10-04.md）`。

## Verify

```bash
python3 tools/verify.py
```

运行 fmt、23 项 Rust/GPUI 测试、Clippy `-D warnings`、Release 构建和依赖边界检查；写入 `artifacts/verification.json` 及日志、源文件 SHA-256。脚本不启动/关闭 GUI，不操作用户文档。`block 0.1.6` / `proc-macro-error2 2.0.1` 的上游 future-incompatibility 提示尚在。

OS 截图 `artifacts/window.png` 只证明窗口和渲染存在，不证明真实鼠标/IME 已通过。

## Source and licenses

- 本验证的文档模型、样式映射、表格操作和 UI 协调为独立实现，未移植第三方应用的编辑器源码。
- 共享输入 primitive 基于 GPUI 0.2.2 的 Apache-2.0 `examples/input.rs` 改写，增加换行、样式、限额、IME 事务和滚动；保留明确出处，见许可说明。
- 原创代码沿用仓库 Apache-2.0；第三方依赖和字体仍适用其自身许可，见 [Third-party material](THIRD_PARTY.md)。这是本地验证，尚未完成分发包的全依赖 notices 审计。

## Files

- `../src/native_editor/gpui/input.rs` 与 `input/`：共享原生输入；`layout.rs`、`hit_test.rs`、`presentation.rs` 分别负责 Kit 排版、坐标与外观。`../src/ui/input.rs` 保留旧导入路径；验证收据覆盖实际共享源文件。
- `src/model.rs`：有稳定 ID 的文本/表格、样式、限额、TSV、快照历史和有限 Markdown 投影。
- `src/buffer.rs`：模型 Unicode scalar 与 GPUI UTF-8 输入快照之间的投影；排版、系统 UTF-16 适配由共享输入 primitive 负责。
- `src/app.rs`：原生控件、选区与焦点、快捷键、IME 事务分组、关闭确认。
- `src/app/tests.rs`：合成的原生文本/剪贴板/IME/键盘事件回归。
