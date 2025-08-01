const { execSync } = require('child_process');
const path = require('path');
const os = require('os');

function formatPython(files) {
  const projectRoot = path.resolve(__dirname, '..');
  const isWindows = os.platform() === 'win32';

  // 虚拟环境中的 Black 路径
  const blackPath = isWindows
    ? path.join(projectRoot, '.venv', 'Scripts', 'black.exe')
    : path.join(projectRoot, '.venv', 'bin', 'black');

  // 检查虚拟环境是否存在
  const fs = require('fs');
  if (!fs.existsSync(blackPath)) {
    console.error('❌ Python 虚拟环境未找到，请先运行：');
    console.error('   python -m venv .venv');
    console.error(
      '   .venv/Scripts/activate (Windows) 或 source .venv/bin/activate (macOS/Linux)'
    );
    console.error('   pip install black==24.8.0');
    process.exit(1);
  }

  try {
    const command = `"${blackPath}" --config pyproject.toml ${files.join(' ')}`;
    execSync(command, { stdio: 'inherit', cwd: projectRoot });
    console.log('✅ Python 文件格式化完成');
  } catch (error) {
    console.error('❌ Python 格式化失败:', error.message);
    process.exit(1);
  }
}

// 从命令行参数获取文件列表
const files = process.argv.slice(2);
if (files.length > 0) {
  formatPython(files);
}
