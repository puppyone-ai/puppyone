# Puppy CLI (puppy push)

一个极简命令行工具，用于把一次对话（User/Assistant）整理并上传至 PuppyStorage，输出 `resource_key`。随后在工作区的目标区块（block）中粘贴该 key，即可使用外部存储的方式引用内容。

## 功能概览
- 采集输入：命令行参数、stdin（如从 Cursor/Claude 复制）、或导出文件
- 整理格式：
  - structured（JSONL，推荐）：两行记录 `{role, content}`
  - text：合并为一段可读文本
- 上传到 PuppyStorage，标记完成，输出 `resource_key`
- 可选 `--copy`：自动复制 `resource_key` 到剪贴板（macOS）

## 安装
建议使用虚拟环境（venv）或 pipx（避免系统 Python 受管制问题）。

### 方式一：venv（推荐本仓库开发者）
```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -e tools/puppy_cli
```

### 方式二：pipx（推荐终端常用用户）
```bash
brew install pipx
# 进入仓库根目录
pipx install --force tools/puppy_cli
```

## 环境变量
- 必需：
  - `PUPPY_API_TOKEN`：鉴权 Token
- 可选：
  - `PUPPY_STORAGE_URL`：存储服务地址（默认回退到 `NEXT_PUBLIC_PUPPYSTORAGE_URL`，否则 `http://localhost:8002`）

示例（zsh）：
```bash
echo 'export PUPPY_API_TOKEN=xxxxxxxx' >> ~/.zshrc
# 可选
echo 'export PUPPY_STORAGE_URL=https://storage.puppyagent.com' >> ~/.zshrc
source ~/.zshrc
```

## 快速开始
### 1) 从剪贴板推送（推荐 structured）
```bash
pbpaste | puppy push ws_abc123/block_chat \
  --from-stdin --type structured --copy --token "$PUPPY_API_TOKEN"
# 输出：user_abc/block_chat/v-20250822-xxxx
```

### 2) 显式传参（text）
```bash
puppy push ws_abc123/block_daily --type text \
  --user "给我今天提交摘要" \
  --assistant "已生成5个提交摘要..." \
  --copy --token "$PUPPY_API_TOKEN"
```

### 3) 从导出 JSON 文件（Cursor/Claude）
```bash
# Cursor 导出（包含 messages）
puppy push ws_abc123/block_chat \
  --from-file ./chat.json --format cursor --type structured --copy

# Claude 导出
puppy push ws_abc123/block_chat \
  --from-file ./claude.json --format claude --type structured --copy
```

> 说明：命令中的第一个参数 `ws_abc123/block_*` 是工作区 ID 和块 ID 的组合。若只传入 `block_id`，也可生成 `resource_key`，但 UI 粘贴时需确保目标块一致。

### 4) 录制终端并上传（shell 上下文捕获）
- 打开录制的子 shell，结束后手动 push：
```bash
puppy record --dir ~/.puppy/sessions --file my.log
cat ~/.puppy/sessions/my.log | puppy push block_shell --from-stdin --type text --copy --token "$PUPPY_API_TOKEN"
```
- 打开录制的子 shell，退出后自动 push：
```bash
puppy record --auto-push --target block_shell --copy --token "$PUPPY_API_TOKEN"
```

## 在工作区中使用 resource_key
1. 打开目标工作区，并选择要承载内容的区块（文本或结构化）。
2. 点击区块右上角的齿轮按钮，打开设置菜单。
3. 选择“Use external storage (paste resource_key)”，粘贴 `resource_key`。
   - 文本块默认 `content_type: text`
   - 结构化块默认 `content_type: structured`
4. 保存工作区。前端将根据 manifest 自动拉取与预览。
5. 如需恢复内部存储，可在同一菜单中选择“Clear external pointer”。

## 命令行参数
```bash
puppy push <workspace_id>/<block_id> [options]

Options:
  --type text|structured     整理为文本或 JSONL（默认 structured）
  --user "..."               用户消息
  --assistant "..."          助手消息
  --from-stdin               从 stdin 读取内容
  --from-file chat.json      从导出文件读取
  --format cursor|claude     搭配 --from-file 指定格式
  --token TOKEN              API Token（默认从 PUPPY_API_TOKEN 读取）
  --copy                     macOS 自动复制 resource_key 到剪贴板
```

## 常见问题
- 报错：`Missing environment variable: PUPPY_API_TOKEN`
  - 解决：正确导出 `PUPPY_API_TOKEN`，或通过 `--token` 传入。
- 403/401 鉴权失败
  - 解决：检查 Token 是否有效、是否有 PuppyStorage 访问权限。
- 连接失败
  - 解决：设置 `PUPPY_STORAGE_URL` 指向正确的 PuppyStorage 服务地址。
- 只得到 `block_id`，没有 `workspace_id`
  - 说明：`puppy push` 仍会生成 `resource_key`。前端粘贴时，只需确保目标块 `block_id` 一致即可。

## 安全提示
- Token 建议通过环境变量注入，不要硬编码到脚本或仓库。

## 版本
- puppy_cli 0.1.0
