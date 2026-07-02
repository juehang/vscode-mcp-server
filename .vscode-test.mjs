import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  version: '1.99.3',
  // 使用本地已安装的 VS Code（跳过下载）
  reuseMachineInstall: true,
  launchArgs: ['--no-sandbox', '--disable-chromium-sandbox', '--disable-setuid-sandbox', '--disable-gpu-sandbox'],
  env: {
    ELECTRON_DISABLE_SANDBOX: '1'
  }
});
