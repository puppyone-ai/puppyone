# Server API Proxy Migration - 测试指南

## 🎯 完成的工作

### 1. 创建了 Server API 代理 (`/app/api/server/[[...path]]/route.ts`)
- ✅ 自动从 HttpOnly cookie 注入用户认证 token
- ✅ 过滤敏感 headers，防止客户端直接传递认证信息
- ✅ 统一的错误处理和日志记录
- ✅ 支持所有 HTTP 方法 (GET, POST, PUT, PATCH, DELETE, OPTIONS)

### 2. 更新了客户端 hooks
- ✅ **useServerManagement.ts** - 移除客户端认证处理，使用 `credentials: 'include'`
- ✅ **useServerDisplay.ts** - API 和 chatbot 调用现在通过代理处理
- ✅ 移除了所有 `getUserToken()` 和手动 Authorization header 处理
- ✅ 更新了服务验证逻辑，不再要求客户端验证 API keys

## 🧪 测试步骤

### 测试前准备
1. 确保服务已启动：
   ```bash
   # 启动 PuppyFlow 前端
   npm run dev
   
   # 确保后端服务运行在配置的端口
   # - API Server: 8004 (默认)
   # - Engine: 8001 (默认)
   # - Storage: 8002 (默认)
   ```

2. 确保用户已登录并有有效的 `access_token` cookie

### 测试用例

#### 1. 测试服务管理 API
```javascript
// 在浏览器控制台中运行
fetch('/api/server/deployments', {
  credentials: 'include'
}).then(r => r.json()).then(console.log);
```

#### 2. 测试 API 服务创建
```javascript
fetch('/api/server/create_api', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    workspace_id: 'your-workspace-id',
    // ... other API data
  })
}).then(r => r.json()).then(console.log);
```

#### 3. 测试 Chatbot 配置
```javascript
fetch('/api/server/config_chatbot', {
  method: 'POST', 
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({
    workspace_id: 'your-workspace-id',
    input: 'user_input',
    output: 'assistant_output',
    // ... other config
  })
}).then(r => r.json()).then(console.log);
```

## 🔍 检查点

### 安全性检查
- [ ] 客户端 Network 面板中不应再显示 Authorization headers 被客户端发送
- [ ] API keys 和 chatbot keys 不应出现在客户端代码或控制台中
- [ ] 所有请求应使用 `credentials: 'include'` 发送 cookies

### 功能性检查
- [ ] 用户认证状态正常工作
- [ ] API 服务创建/删除/更新功能正常
- [ ] Chatbot 服务创建/删除/更新功能正常  
- [ ] 服务列表获取功能正常
- [ ] API 执行和 Chatbot 对话功能正常

### 错误处理检查
- [ ] 未认证用户收到适当的错误响应
- [ ] 网络错误得到正确处理
- [ ] 服务端错误返回有意义的错误信息

## 🚨 已知风险缓解

### 解决的安全问题
1. **API 密钥暴露** - ✅ 现在完全在服务端处理
2. **认证 token 客户端处理** - ✅ 现在从 HttpOnly cookie 自动注入
3. **敏感请求头暴露** - ✅ 代理过滤并重新构建请求头

### 向后兼容性
- API 接口保持不变，客户端代码只需要移除手动认证处理
- 现有的业务逻辑和 UI 组件无需修改

## 🔄 回滚计划

如果出现问题，可以：
1. 注释掉代理路由文件
2. 恢复客户端 hooks 中的认证处理代码
3. 重新添加 `getUserToken` 相关逻辑

## 📈 性能影响

- **正面影响**：减少客户端 bundle 大小（移除认证相关代码）
- **负面影响**：增加一层代理调用（预期影响minimal）
- **安全收益**：显著提升，消除了客户端 API 密钥暴露风险

## 🎉 下一步

本次迁移完成了第一优先级的安全风险缓解。后续可以考虑：

1. **生产环境日志清理** - 移除敏感数据的 console.log
2. **Ollama 模型管理优化** - 条件化详细日志输出
3. **工作流数据脱敏** - 如果包含商业敏感信息

---

*完成时间：第一阶段迁移*  
*安全等级：高风险 → 低风险* ✅