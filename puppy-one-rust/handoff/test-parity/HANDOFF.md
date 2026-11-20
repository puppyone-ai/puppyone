# 交接：Rust 测试对齐 TS 测试（test parity）

写于 2026-11-20，交接时分支 HEAD 为 `9f971b156`。新会话请先通读本文，再从「6. 下一步」接着做。

## 1. 目标与完成标准

把 TS 产品的每一条测试用例，逐条对到 Rust 测试上，直到覆盖完整。每条 TS 用例只能是下面三种结局之一：

- **mapped**：有真实的 Rust 测试，验证的是同一个**可观察的验收行为**（不是机械地一个文件对一个文件，Rust 的内部机制可以不同）。
- **gap**：Rust 目前确实做不到这个行为。必须写明原因，并指定 puppy-issues 里负责该行为的文档（owner）。
- **out-of-scope**：Rust 有意采用不同设计，或者那条用例测的是纯 TS/Electron/DOM 的内部机制。同样要写原因和 owner 文档。

写测试时发现的产品缺陷**要修**，不能为了让测试通过去放宽测试或护栏。

完成标准：`python3 tools/verify-test-parity.py --require-complete` 通过。它要求：没有未处理用例、没有 gap、辅助文件（e2e/smoke/bench）都处理过、`openAcceptance` 清空。**在真正完成之前它必须保持失败**，绝对不能为了让它通过而改动它。现实地说，最后会剩一批 gap，需要用户逐个决定修还是接受；在那之前它会一直失败，这是预期的。

## 2. 位置

| 东西 | 位置 |
|---|---|
| Worktree | `~/project/puppyone-rust-test-completeness`（git worktree；Rust 工程在子目录 `puppy-one-rust/`） |
| 分支 | `codex/rust-test-completeness`，已推到 `origin`（github.com/puppyone-ai/puppyone） |
| 分出点 | qubits `966f415d2`。交接时本分支比它多 97 个提交；qubits 之后又前进了 6 个提交，本分支没有合入 |
| 最终合并目标 | 本地 `qubits` 分支（主 checkout 在 `~/project/puppyone-qubits`，多个会话共用，别在那里乱动） |
| Ledger（核心产物） | `puppy-one-rust/fixtures/test-parity-contracts.json` |
| TS 参照仓库 | `puppy-one-rust/artifacts/reference-checkouts/typescript/`（git 忽略；是 `~/project/puppyone` 的克隆，固定在 `dc8468ccca89`，与 `fixtures/test-parity-reference.json` 一致） |
| TS 用例清单 | `puppy-one-rust/artifacts/test-parity/typescript-cases.json`（git 忽略；由 `node tools/collect-test-cases.mjs` 生成） |
| 辅助脚本（实际在用的那份） | `~/project/rust-test-parity-work/`（不在 git 里） |
| 辅助脚本快照（在本分支） | `puppy-one-rust/handoff/test-parity/kit/`（与上面那份内容相同，作为云端备份） |
| 文档仓库 | `~/project/puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/` |
| 不能删的目录 | `~/project/puppyone-baseline-5e87974ef`（v0.4.4 基线 checkout） |

如果 `~/project/rust-test-parity-work/` 不见了，从 `handoff/test-parity/kit/` 原样复制回去：`match.py` 和 `verify.sh` 里写死了这个路径。

如果换成全新 worktree，`artifacts/` 是空的，需要重建：

```sh
cd puppy-one-rust
git clone ~/project/puppyone artifacts/reference-checkouts/typescript
git -C artifacts/reference-checkouts/typescript checkout dc8468ccca89a3f75a0ebadbbe0de5688e4dc2e2
(cd artifacts/reference-checkouts/typescript && npm ci)   # collect-test-cases.mjs 需要它的 vitest
PUPPYONE_PARITY_ROOT=artifacts/reference-checkouts/typescript node tools/collect-test-cases.mjs
```

注意：`fixtures/test-parity-reference.json` 的 `checkout` 指向 `../../puppyone-qubits`，但那个 checkout 早已不在 `dc8468ccc`。所以凡是跑 `tools/verify.py`、`tools/verify-test-parity.py`、`tools/collect-test-cases.mjs`，都要加 `PUPPYONE_PARITY_ROOT=artifacts/reference-checkouts/typescript`。`parity.py` 自己就读 `artifacts/reference-checkouts/typescript`，不需要加。**不要在未经用户审查的情况下改动参照的固定提交。**

## 3. 进度（交接时）

总计 8416 条 TS 用例：

| 状态 | 数量 | 占比 |
|---|---|---|
| mapped | 4625 | 55.0% |
| gap | 281 | 3.3% |
| out-of-scope | 1581 | 18.8% |
| **未处理** | **1929** | **22.9%** |

另外：540 条 contract 行、177 条 known difference；86 个辅助文件（e2e/smoke/bench）全部未处理；`openAcceptance` 有 3 条（剩余清单的逐条审查、真实 OS/WebView 自动冒烟、真实 Cloud 与跨设备验收）。

剩余用例按组（未处理 / 总数）。`python3 ~/project/rust-test-parity-work/parity.py summary` 随时能看最新数字：

```
component/editor          422 / 806   ← 进行中
component/workspace       338 / 377
unit/platform             251 / 492
unit/workspace            157 / 205
unit/appearance           136 / 183
component/settings        103 / 147
unit/source-control        91 / 254
component/platform         69 / 69
unit/model-connections     66 / 66
component/source-control   53 / 58
component/ui-primitives    51 / 51
component/appearance       43 / 43
unit/extensions            24 / 24
unit/localization          21 / 21
unit/settings              20 / 44
unit/telemetry             18 / 30
unit/release               13 / 87
unit/updates               13 / 101
component/updates          12 / 12
component/telemetry         9 / 9
unit/ui-primitives          7 / 7
component/model-connections 5 / 5
component/localization      3 / 3
component/release           3 / 3
component/extensions        1 / 1
```

已完成的组：cloud 全部、agent 全部、workbench、terminal、hosts、unit/editor 全部。component/editor 已完成：markdown HTML（run、conformance）、HTML 预览链接导航、MDX 组件，以及更早几轮的部分文件。

## 4. 每个 TS 文件的工作流

以下命令都假设：

```sh
export PATH="$HOME/.cargo/bin:$PATH" CARGO_BUILD_JOBS=6
K=~/project/rust-test-parity-work
cd ~/project/puppyone-rust-test-completeness/puppy-one-rust
```

1. **挑文件**：`python3 $K/parity.py files tests/component/editor` 列出该目录下剩余的文件和数量。
2. **看用例**：`python3 $K/parity.py cases <TS 路径>` 列出每条用例的序号、状态、行号；`python3 $K/parity.py show <TS 路径> [序号...]` 打印 TS 源码。把整个 TS 测试文件读一遍，搞清楚它到底验收什么。
3. **找 Rust 对应物**：在 `src/` 里 grep 对应功能的实现和已有测试。已有测试可能已经覆盖；可以用 `python3 $K/match.py <前缀>` 按名字推荐候选（要先生成 `/tmp/rust-tests.json`），但推荐只是线索，必须读测试确认验收真的一致。
4. **写 Rust 测试**：用产品的真实输入（TS 测试里的 fixture 原样搬过来）。测试名用描述行为的英文句子，doc 注释引用 TS 用例名（反引号括起），风格照周边代码。
5. **测试暴露缺陷就修产品代码**，把修复写进提交说明，也记到 `doc-notes.md`。
6. **写 ledger 行**：在 `$K/rows/<批次名>.json` 写条目（格式见第 5 节），然后 `python3 $K/parity.py add $K/rows/<批次名>.json`。它会写入 ledger 并做校验。
7. **跑 gate**：`python3 $K/gate_rows.py <批次名> --changed`，确认新增或改动的行引用的 Rust 测试都存在且通过（它对比的是 HEAD 的 ledger，所以必须先做第 6 步）。
8. **整体校验**：`zsh $K/verify.sh po-editor`（参数是改动涉及的 crate，可以多个）。它依次跑 cargo fmt、严格 clippy（`-D warnings`，失败会打印 `CLIPPY_FAILED` 并退出）、`tools/check-ui-boundaries.py`、`tools/check-editor-architecture.py`、每个 crate 的 lib 测试（po-app 跑 `--bin puppy-one-rust --features dev-capture`）、ledger 检查，最后打印 git status。
9. **提交**：只 `git add` 明确的路径，**绝不用 `git add .` 或 `-A`**。提交说明用英文，标题说清行为，正文说明修了什么、映射了什么。结尾带：
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   ```
10. **记文档笔记**：在 `$K/doc-notes.md` 追加一节（批次名、修了什么、新 gap / out-of-scope 的 id 和 owner 文档、需要更正的文档事实）。最后统一同步到 puppy-issues（见 6.3）。
11. 每完成一批，给用户发一段简短的中文进度更新。

## 5. Ledger 条目格式与判定

`parity.py add` 读一个 JSON 数组。条目有四种：

```jsonc
// 新 contract 行
{"id": "markdown-mdx-tabs-component",
 "acceptance": "用一段话写清可观察的验收行为（英文，覆盖所有引用用例）",
 "typescript": [{"path": "tests/component/…/x.test.ts", "cases": [0,1,2]}],
 "rust": [{"package": "po-editor", "test": "editor::markdown::features::mdx::tests::xxx"}]}

// 给已有行追加用例或测试
{"id": "existing-row-id", "extend": true, "typescript": [...], "rust": [...]}

// 新 known difference
{"id": "mdx-tabs-keyboard", "kind": "gap",            // 或 "out-of-scope"
 "reason": "TS 怎么做；Rust 怎么做或缺什么；为什么",
 "owner": "puppy-issues/document/puppyone-desktop/platform/rust-native-frontend/…/x.md",
 "typescript": [{"path": "…", "cases": [22]}]}

// 给已有 difference 追加用例
{"id": "existing-difference-id", "kind": "gap", "extend": true, "typescript": [...]}
```

- `rust` 测试路径的写法：po-editor / po-platform / po-contracts / po-workspace / po-ui / po-agent 写 `{"package": "po-x", "test": "模块路径::测试名"}`；po-app 要加 `"target": "puppy-one-rust"`；Python 工具测试另有 `"python"` 字段（参考已有行）。模块路径里可能嵌套 `tests::` 子模块，以 gate 实际跑通为准。
- 先找已有的 id 再新建：`python3 -c` 读 ledger，按关键词搜 `contracts` 和 `knownDifferences`。已有的 difference 能套上就用 `extend`，并视情况补充它的 reason。
- 还有 12 条老 contract 没有 `cases` 字段（save-lifecycle、retained-documents、cloud-event-shapes、cloud-write-scope、cloud-cache、cloud-http-integration、explorer-reconciliation、native-whiteboard-webkit-runtime、native-git-section-resize-interaction、native-git-patch-path-integrity、native-git-history-read-integrity、native-update-http-resource-ownership）。碰到它们对应的 TS 文件时，把用例挂到这些已有行上，不要再建重复行。
- **mapped**：Rust 测试真的断言了同一个可观察结果。只是名字像的不算。
- **gap**：用户能感知到的缺失行为。只要合理可修，先尝试修；修不了或需要设计决定的才记 gap，并在进度更新里告诉用户。
- **out-of-scope**：TS 的机制性测试（React StrictMode、DOM 事件细节、Electron IPC、Worker、CodeMirror 内部、Lezer 增量解析等），或者 Rust 有意的不同设计。**Rust 以它自己当前的行为为准**，有意的设计差异记为 out-of-scope，不要往 TS 方向改。

## 6. 下一步

### 6.1 继续 component/editor（剩 422 条，67 个文件）

按用例数从多到少（`parity.py files tests/component/editor` 可以看完整列表）：

- `markdown/embeds/markdownEmbedRuntime.test.ts`（26）
- `markdown/commands/markdownBlockMove.test.ts`（21）
- `markdown/tables/context-menu.test.ts`（20）
- `markdown/rendering/markdownPointerSelection.test.ts`（17）
- `csv/csvTableHandles.test.tsx`（17）
- `markdown/parsing/markdownConvergence.test.ts`（16）
- `markdown/parsing/markdownOversizedBlocks.test.ts`（13）
- `markdown/html/markdownHtmlAnchors.test.ts`（12）
- `runtime/editorLayout.test.ts`（12）
- `runtime/editorPaneSourceSwitching.test.tsx`（11）
- `markdown/rendering/markdownLinkActivation.test.ts`（11）
- 各 10 条：`runtime/documentSurfaceHost`、`markdown/rendering/markdownHeadingOutline`、`markdown/commands/markdownInlineCommands`、`csv/csvTableInteractions`、`csv/csvEdgeExpansion`
- 其余是 1–9 条的小文件

### 6.2 之后的组

建议按这个顺序：component/workspace（338）→ unit/platform（251）→ unit/workspace（157）→ unit/appearance（136）→ component/settings（103）→ unit/source-control（91）→ component/platform（69）→ unit/model-connections（66）→ component/source-control（53）→ component/ui-primitives（51）→ component/appearance（43）→ 剩下的小组。

然后处理 86 个辅助文件（e2e/smoke/bench）。它们大多需要真实 Electron 或真实窗口，多半要按文件判定成 out-of-scope，或者对到 Rust 的 lab/capture 工具。最后讨论 `openAcceptance` 的 3 条。

### 6.3 收尾（全部映射完以后）

1. **同步文档**：把 `doc-notes.md` 的每一节落到 puppy-issues 对应文档。puppy-issues 有大约 144 个用户自己的未提交改动，必须原样保留：只把本任务的补丁用 `git apply --cached` 的方式暂存，不碰用户的改动，不 stash、不 reset。改完运行 `node document/validate-documentation.mjs`。**不要推送 puppy-issues**，除非用户明确说可以。
2. **参照提交**：要不要把 TS 参照重新固定到更新的提交，需要用户审查后决定，不要自己改。
3. **完整验证**：cargo fmt、对整个 workspace 跑严格 clippy、全量测试（`cargo test --locked --offline --workspace`，外加 po-app 的 `--bin puppy-one-rust --features dev-capture`）、`PUPPYONE_PARITY_ROOT=artifacts/reference-checkouts/typescript python3 tools/verify.py`。
4. **删掉 `puppy-one-rust/handoff/`**（交接用的临时目录，不进产品）。
5. **本地合并进 qubits**：先把 qubits 新增的提交合进本分支、解决冲突、重新验证，再合并到本地 `qubits`。这一步**不推送**，等用户决定。

## 7. 必须遵守的规则（用户定的）

- 所有回复用简体中文，过程中定期汇报进度。
- 每条 TS 用例要么对到真实的 Rust 测试、保持可观察验收不变，要么记成有原因、有 owner 文档的已知差异。
- 发现产品缺陷就修；不放宽测试，不放宽护栏，`--require-complete` 在真正完成前保持失败。
- 只暂存明确的路径，不用 `git add .`/`-A`；不 stash、不 reset 用户的工作。stash 栈是所有 worktree 共用的，真要用就加唯一标签，用完按标签找到再删。
- 没有用户明确授权，不推送、不改远端。（这次推送 `codex/rust-test-completeness` 是用户明确授权的；以后再推需要再次确认。）
- 研究和代码核对自己做，不开 subagent 或 workflow，除非用户要求。
- Rust 以它自己当前的行为为准；有意的 Rust 设计记为 out-of-scope。
- 磁盘只剩约 43 GB（90% 已用）。`target/` 很大，别随手再开新 worktree 做全量编译。

## 8. 写 Rust 测试的套路

- **crate 对照**：po-editor（`editor::*`、`documents::*`、render_service、web_host）、po-app（`app::*`、`features::*`、lab、capture，测试走 bin target）、po-platform（`platform::*`、localization）、po-contracts（`model::*`、`formats::*`、workspace::contracts）、po-workspace（`workspace::*`、`cloud::*`）、po-agent（`agent::*`）、po-ui（theme、typography、ui）。源码都在 `puppy-one-rust/src/`，各 crate 通过 `#[path]` 引用。
- **单跑测试**：`cargo test --locked --offline -p po-editor --lib -- <过滤词>`。
- **Markdown 的模型层测试**：`plans::compile(&doc, &syntax, &CalloutFolds::default(), MDX_FEATURES | FEATURES)` 和 `decorations::decorate(&DecorateCx{..})`，看 `hidden`、`blocks`（`Block::Widget` / `Block::Line`）。例子见 `src/editor/markdown/features/mdx/mod.rs` 的 tests。
- **Markdown 的 GPUI 测试**：`src/editor/markdown/tests.rs` 的 `setup` / `setup_with_focus`（MDX 方言用 `MarkdownExtension::new(true, Scale::Medium).mdx()`）。绘制：`cx.run_until_parked(); cx.update(|w, cx| { w.draw(cx).clear(cx); })`。查元素：`cx.debug_bounds("selector")`，配合产品代码里的 `.debug_selector(|| …)`（需要就加，命名照现有的 `md-…:<主体>` 风格）。点击：`cx.simulate_click(bounds.center(), Modifiers::default())`。键盘：`cx.simulate_keystrokes("cmd-z")`、`cx.simulate_input("text")`。资源：`config_transaction(SetAssets(Some(DocumentAssets{..})))`。只读：`v.set_read_only(true, cx)`。新的验收测试文件放在 `src/editor/markdown/tests/`，并在 `tests.rs` 里注册 `mod`。
- **CommonMark 与 Lezer 的差异**：Rust 用 pulldown-cmark（CommonMark）。例如非 1 开头的有序列表不能打断段落；链接目标里不能有空格（产品的图片扫描是自己做的）。遇到这类差异，查 ledger 里已有的 difference（如 `commonmark-ordered-list-interruption`），套上去并补充 reason。
- **常见坑**：
  - clippy 的 `single_range_in_vec_init` 不允许 `[a..b]` 这种单元素数组，改用元组。
  - `read_with` 闭包返回 `&str` 会有生命周期错误，返回前 `.to_owned()`。
  - `debug_bounds` 要 `&'static str`；动态拼的字符串用 `Box::leak` 在测试里转一下。
  - 销毁有未保存内容的 view 不是产品路径（dirty slot 会被钉住），不要为它写测试。
  - `gate_rows.py --changed` 对比的是 HEAD 的 ledger，必须先 `parity.py add`。

## 9. 本分支修过的产品缺陷（节选）

完整列表看 `git log --oneline 966f415d2..HEAD`，细节在 `kit/doc-notes.md`。

- **Markdown**：
  - 嵌套列表窗口丢了外层列表的结束位置。
  - 路径带空格的图片显示不出来。
  - 代码块 info 推断不出语言。
  - 不安全的行内 `<a>` 现在保持源码显示。
  - 补上 ⌘D 删除线。
  - `<form>` 包着的内容会被丢掉，现在保留。
  - HTML 图片宽高为 0 或非法值时不再生效。
  - MDX：产品自己的 Tabs 示例原本渲染不出来，现在可以了；组件现在独占它覆盖的行（新增 trait 钩子 `MarkdownFeature::owns_block_lines`）；不支持的组件整段保持源码，并带 `mdx-component.*` 诊断码。
- **App Preview**：保存配置前做原生预检，检查 HTML 文件、工作目录和 package 脚本。
- **更早几轮**：cloud 发布、历史与认证，agent 输入框、审批与 transcript，workbench、终端、外观、模型连接、项目、发布等，各有若干修复（见上面的 git log）。

## 10. 需要用户拍板的重要缺口（已记为 gap）

都是用户能感知到的行为，建议后面集中问用户修不修：

- `markdown-inline-html-runs`：README 徽章、`<picture>` 这类行内 HTML 在段落里显示成原始 HTML。
- `markdown-table-horizontal-scroll`：宽表格在窗格边缘被截断。
- `markdown-single-block-documents-reparse`：只有一个巨大列表的文档每次按键全量重解析（1 万行约 43 ms）。
- `html-preview-link-routing`：HTML 预览里点链接，不会路由到工作区或外部目标（31 条用例）。
- `mdx-tabs-keyboard`：Tabs 标签栏不能用键盘切换。
- `markdown-html-presentational-attributes`：bgcolor、border 等展示属性，以及 `<picture>` 的媒体条件没有生效。
- `markdown-content-language-tag`、`markdown-table-column-width-sessions`、`markdown-format-shortcut-repeat`、`markdown-presentation-overrides`。
- cloud 相关：`cloud-publish-transfer-progress`、`cloud-auth-replay-after-same-account-sign-in`、`cloud-history-graph-not-drawn`、`cloud-publish-header-watch-awareness`。

全部 gap 的列表：

```sh
python3 -c "import json;d=json.load(open('fixtures/test-parity-contracts.json'));[print(k['id'],'|',k['owner'].split('rust-native-frontend/')[-1]) for k in d['knownDifferences'] if k['kind']=='gap']"
```

## 11. 给新会话的开场提示词（可直接粘贴）

> 接手 Rust 测试对齐 TS 测试的工作。先完整阅读 `~/project/puppyone-rust-test-completeness/puppy-one-rust/handoff/test-parity/HANDOFF.md`，并遵守第 7 节的全部规则。在 worktree `~/project/puppyone-rust-test-completeness` 的分支 `codex/rust-test-completeness` 上，从第 6.1 节 component/editor 的 `markdownEmbedRuntime.test.ts` 开始，按第 4 节的流程逐个文件做：映射到真实 Rust 测试，修复暴露出的缺陷，记录差异，gate、verify、只暂存明确路径地提交，追加 doc-notes，每批用中文汇报进度。没有我的明确同意不要推送。
