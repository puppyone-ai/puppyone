// scripts/format-frontend.js
const { execSync } = require('child_process');
const path = require('path');

function formatFrontend(files) {
  if (files.length === 0) {
    console.log('📝 没有前端文件需要格式化');
    return;
  }

  const projectRoot = path.resolve(__dirname, '..');

  try {
    // 处理文件路径，添加引号防止空格问题
    const quotedFiles = files.map(file => `"${file}"`).join(' ');
    const command = `npx prettier --write ${quotedFiles}`;

    console.log(`🎨 正在格式化 ${files.length} 个前端文件...`);
    console.log(`📁 文件: ${files.join(', ')}`);

    // 执行 Prettier 格式化
    const result = execSync(command, {
      stdio: 'pipe',
      cwd: projectRoot,
      encoding: 'utf8',
    });

    // Prettier 通常不输出内容到 stdout，除非有错误
    if (result.trim()) {
      console.log('📋 Prettier 输出:', result);
    }

    console.log('✅ 前端文件格式化完成');

    // 重新 stage 格式化后的文件（重要！）
    const gitAddCommand = `git add ${quotedFiles}`;
    execSync(gitAddCommand, {
      cwd: projectRoot,
      stdio: 'pipe',
    });
    console.log('📝 已重新 stage 格式化后的文件');
  } catch (error) {
    console.error('❌ 前端格式化失败:', error.message);

    // 如果有 stderr 输出，显示详细错误信息
    if (error.stderr) {
      console.error('📋 错误详情:', error.stderr.toString());
    }

    process.exit(1);
  }
}

// 从命令行参数获取文件列表
const files = process.argv.slice(2);
formatFrontend(files);
