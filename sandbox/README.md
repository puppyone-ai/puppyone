# JSON 编辑沙盒

使用 Docker 容器安全执行 Claude 返回的 CLI 命令来编辑 JSON 文件。

## 快速开始

### 1. 构建沙盒镜像（可选，提升启动速度）

```bash
cd sandbox
docker build -t json-sandbox .
```

如果不构建，API 会自动使用 alpine 镜像并安装 jq（首次较慢）。

### 2. 启动前端开发服务器

```bash
cd frontend
npm run dev
```

### 3. 测试 API

使用 curl 测试：

```bash
# 查看 JSON 内容
curl -X POST http://localhost:3000/api/agent-local \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "帮我看看这个 JSON 文件里有什么内容",
    "jsonPath": "/Users/supersayajin/Desktop/puppyone/sandbox/test-data.json"
  }'

# 修改 JSON 内容
curl -X POST http://localhost:3000/api/agent-local \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "把第一个用户的名字改成 \"小明\"",
    "jsonPath": "/Users/supersayajin/Desktop/puppyone/sandbox/test-data.json"
  }'

# 添加新字段
curl -X POST http://localhost:3000/api/agent-local \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "在 settings 里添加一个 timezone 字段，值为 Asia/Shanghai",
    "jsonPath": "/Users/supersayajin/Desktop/puppyone/sandbox/test-data.json"
  }'

# 删除字段
curl -X POST http://localhost:3000/api/agent-local \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "删除 tags 数组",
    "jsonPath": "/Users/supersayajin/Desktop/puppyone/sandbox/test-data.json"
  }'
```

## API 说明

### POST /api/agent-local

请求体：
```json
{
  "prompt": "用户的指令，描述要对 JSON 做什么操作",
  "jsonPath": "JSON 文件的绝对路径"
}
```

响应：
```json
{
  "success": true,
  "message": "Claude 的回复文本",
  "updatedData": { ... },  // 修改后的 JSON 对象
  "iterations": 3          // 执行了多少轮对话
}
```

## 工作原理

1. 启动一个临时 Docker 容器
2. 把指定的 JSON 文件挂载到容器的 `/workspace/data.json`
3. Claude 使用 bash tool 生成 jq/cat 等命令
4. 命令在容器内执行，只能访问挂载的文件
5. 执行完成后读取修改后的 JSON 返回
6. 销毁容器

## 安全性

- 命令在隔离的 Docker 容器中执行
- 容器只能访问挂载的 JSON 文件
- 容器用完即销毁
- 适合本地开发测试

## 故障排查

### Docker 未运行
```
Error: Cannot connect to Docker daemon
```
解决：启动 Docker Desktop

### 文件路径错误
```
Error: JSON file not found
```
解决：确保 jsonPath 是正确的绝对路径

### 权限问题
```
Error: permission denied
```
解决：确保 JSON 文件有读写权限

