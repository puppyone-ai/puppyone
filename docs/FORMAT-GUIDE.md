# **代码格式化完全指南**

> 📖 **在Notion上查看**: [Code Formatting Guide](https://www.notion.so/puppyagent/Code-Formatting-Guide-241bbe13bfbb800e99aaf706fa6751aa?source=copy_link)

> ⚠️ **重要通知**：**Python 后端代码格式化已暂时禁用**
> 
> 目前只启用前端代码（JavaScript/TypeScript）的格式化功能。Python 代码格式化将合适的时候启用。

## 1. 为什么需要代码格式化？

如果统一的代码格式标准，会导致：

- **代码审查困难**：格式差异掩盖了真正的逻辑变更
- **Git 历史混乱**：无意义的格式修改产生大量噪音提交
- **维护成本增加**：不一致的代码风格降低可读性

## 2. 双重防护机制

我们设计了一套**双重防护机制**，确保任何进入代码库的代码都符合统一标准：

### **第一道防线：本地开发中 IDE 实时格式化**
- **触发时机**：每次保存文件时 (`Ctrl+S`)
- **作用范围**：当前正在编辑的文件
- **技术实现**：VS Code/Cursor 插件 + 项目配置文件
- **目的**：让开发者在编码过程中就能看到规范化的代码，提供即时反馈

### **第二道防线：Git 提交前格式化**
- **触发时机**：执行 `git commit` 时
- **作用范围**：本次提交中所有被修改的文件
- **技术实现**：Git Hooks (Husky) + lint-staged
- **目的**：作为最后的安全网，防止任何未格式化的代码进入代码库


## 3. 技术架构说明

### **前端格式化工具链** ✅ **已启用**
```
VS Code/Cursor Prettier 插件 → .prettierrc 配置文件 → Prettier (npm 包)
```

### **后端格式化工具链** ⏸️ **暂时禁用**
```
VS Code/Cursor Black Formatter 插件 → pyproject.toml 配置文件 → Black (Python 包)
```

### **Git 钩子工具链**
```
git commit → Husky → lint-staged → Prettier → 格式化成功/失败
```

---

## 4. 我（开发者）要怎么配置？

现在，让我手把手教你如何配置这套系统。

### **步骤 1：拉取最新项目代码**

```bash
# 拉取最新代码
git pull origin qubits
```

### **步骤 2：安装 VS Code/Cursor 插件**

打开 VS Code/Cursor，按 `Ctrl+Shift+X` 打开插件市场，搜索并安装以下插件：

1. **Prettier - Code formatter** ✅ **必需**
   - 作者：Prettier
   - 用途：格式化前端代码（JavaScript, TypeScript, CSS 等）

2. **Black Formatter** ⏸️ **暂时不需要**
   - 作者：Microsoft
   - 用途：格式化 Python 代码（当前已禁用）

> **💡 提示**：安装完成后，VS Code/Cursor 会自动读取项目中的 `.vscode/settings.json` 文件，我已经在该文件中编写了必要的格式化设置。

### **步骤 3：安装前端依赖**

在项目根目录执行：

```bash
npm install
```

这个命令会安装：
- **Prettier**：前端代码格式化工具
- **Husky**：Git 钩子管理工具
- **lint-staged**：只对暂存文件执行操作的工具

### **步骤 4：配置 Python 环境** ⏸️ **暂时跳过**

> **⚠️ 注意**：由于 Python 代码格式化已暂时禁用，此步骤可以跳过。

~~由于 Black 是 Python 工具，我们需要在独立的虚拟环境中安装它：~~

```bash
# 创建 Python 虚拟环境
python -m venv venv

# 激活虚拟环境
# Windows 用户：
venv\Scripts\activate
# macOS/Linux 用户：
source venv/bin/activate

# 安装 Python 开发依赖（包含 Black）
pip install -r requirements-dev.txt
```

> **💡 提示**：虚拟环境确保了 Black 的版本与项目要求一致，避免了全局安装可能带来的版本冲突。

### **步骤 5：验证配置是否成功**

现在让我们测试两道防线是否正常工作。

#### **测试第一道防线（IDE 格式化）**

**测试前端格式化：** ✅ **正常工作**

1. 在 VS Code/Cursor 中打开项目中的任意 `.ts` 或 `.js` 文件
2. 故意破坏代码格式，比如：
   ```typescript
   // 故意写成这样的混乱格式
   const   user={name:"John",age:25,email:"john@example.com"};
   ```
3. 按 `Ctrl+S` 保存文件
4. **预期结果**：代码应该自动变成：
   ```typescript
   const user = {
     name: "John",
     age: 25,
     email: "john@example.com",
   };
   ```

**测试 Python 格式化：** ⏸️ **暂时禁用**

> **⚠️ 注意**：Python 代码格式化已暂时禁用，保存 Python 文件时不会自动格式化。

~~1. 在 VS Code/Cursor 中打开项目中的任意 `.py` 文件~~
~~2. 故意破坏代码格式，比如：~~
~~   ```python~~
~~   # 故意写成这样的混乱格式~~
~~   def hello(name,age):~~
~~       return f'Hello {name}, you are {age} years old'~~
~~   ```~~
~~3. 按 `Ctrl+S` 保存文件~~
~~4. **预期结果**：代码应该自动变成：~~
~~   ```python~~
~~   def hello(name, age):~~
~~       return f"Hello {name}, you are {age} years old"~~
~~   ```~~

#### **测试第二道防线（Git 提交前格式化）**

1. 创建一个测试文件，故意写一些格式不规范的代码
2. 将文件添加到 Git 暂存区：
   ```bash
   git add test-file.ts  # 前端文件会正常格式化
   # git add test-file.py  # Python 文件暂时不会格式化
   ```
3. 尝试提交：
   ```bash
   git commit -m "test formatting"
   ```
4. **预期结果**：
   - **前端文件**：如果格式有问题，lint-staged 会自动修复并重新暂存
   - **Python 文件**：暂时跳过格式化检查
   - 如果修复成功，提交会正常完成
   - 如果修复失败，会显示错误信息，提交被阻止

### **步骤 6：确认配置细节（重要）**

如果你想确认工具是否使用了正确的配置，可以查看 VS Code/Cursor 的输出面板：

**查看 Prettier 输出：** ✅ **正常工作**
1. 按 `Ctrl+Shift+U` 打开输出面板
2. 在下拉菜单中选择 "Prettier"
3. 保存一个前端文件，你应该看到类似信息：
   ```
   ["INFO" - 19:43:40] Using config file at /path/to/project/.prettierrc
   ["INFO" - 19:43:40] PrettierInstance: ... "version": "3.6.2"
   ```

**查看 Black 输出：** ⏸️ **暂时禁用**
> **⚠️ 注意**：由于 Python 格式化已禁用，Black 输出面板将不会显示格式化信息。

~~1. 在输出面板下拉菜单中选择 "Black Formatter"~~
~~2. 保存一个 Python 文件，你应该看到类似信息：~~
~~   ```~~
~~   python.exe -m black --config pyproject.toml --stdin-filename ...~~
~~   All done! ✨ 🍰 ✨~~
~~   1 file reformatted~~
~~   ```~~

## 5. 日常使用

配置完成后，你的日常开发流程变得非常简单：

1. **正常编写代码** - 不用担心格式问题
2. **保存文件** (`Ctrl+S`) - 第一道防线自动格式化（仅前端）
3. **提交代码** (`git commit`) - 第二道防线确保质量（仅前端）
4. **享受一致、美观的代码库** 🎉

> **💡 提示**：Python 代码暂时需要手动保持格式一致性，建议遵循 PEP 8 规范。

## 6. 常见问题解决

### **问题：保存后代码没有自动格式化**

**排查步骤：**
1. 确认插件已安装并启用
2. 检查 VS Code/Cursor 设置中的 "Format On Save" 是否开启
3. 查看输出面板中的错误信息
4. 确认 `.vscode/settings.json` 文件存在
5. **注意**：Python 文件暂时不会自动格式化，这是正常现象

### **问题：Git 提交被阻止**

这是正常现象，说明第二道防线在工作：
1. 仔细阅读终端中的错误信息
2. 修复提示的问题（通常是语法错误）
3. 重新添加修改后的文件：`git add .`
4. 再次提交：`git commit -m "your message"`
-

## 7. 总结

通过这套双重防护机制，你可以：

- ✅ **专注业务逻辑**：不再为代码格式分心
- ✅ **提高代码质量**：自动化确保一致性（前端）
- ✅ **改善团队协作**：减少格式相关的代码审查噪音
- ✅ **提升开发效率**：无需手动调整代码格式（前端）

> **📝 当前状态**：
> - ✅ **前端代码格式化**：完全正常工作
> - ⏸️ **Python 代码格式化**：暂时禁用，将在后续版本中重新启用

记住：**一次配置，终身受益**。现在就开始享受自动化代码格式化带来的便利吧！