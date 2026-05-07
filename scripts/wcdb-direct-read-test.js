/**
 * WCDB 直连验证脚本 (JS 版)
 *
 * 运行方式:
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/wcdb-direct-read-test.js
 */

async function main() {
  console.log('='.repeat(60));
  console.log('  WCDB 直连验证脚本');
  console.log('='.repeat(60));

  // 使用项目已编译的服务
  // 注意：编译后的文件是 hash 命名的，需要用 dynamic require
  const servicesDir = require('path').join(__dirname, '..', 'dist-electron');
  const { app } = require('electron');

  // 扫描 dist-electron 找编译后的服务模块
  const fs = require('fs');
  const files = fs.readdirSync(servicesDir);
  const serviceFiles = files.filter(f => f.startsWith('main-') && f.endsWith('.js'));

  if (serviceFiles.length === 0) {
    console.log('❌ 未找到编译后的 main 模块，请先运行 npm run build');
    return;
  }

  // 加载最新的编译文件
  const mainModule = require(require('path').join(servicesDir, serviceFiles[serviceFiles.length - 1]));

  console.log('✅ 已加载编译模块:', serviceFiles[serviceFiles.length - 1]);
  console.log('');
  console.log('⚠️  此脚本仅用于验证 Electron 环境是否正常');
  console.log('   完整测试需要在 app.whenReady() 回调中执行');
  console.log('   详见 TypeScript 源文件: scripts/wcdb-direct-read-test.ts');
  console.log('');
  console.log('='.repeat(60));
  console.log('  验证清单:');
  console.log('='.repeat(60));
  console.log('');
  console.log('  [数据库文件]        [状态]    [说明]');
  console.log('  session.db         ❓     需 app 运行时验证');
  console.log('  contact.db         ❓     需 app 运行时验证');
  console.log('  message_*.db       ❓     需 app 运行时验证');
  console.log('  emoticon.db        ❓     需 app 运行时验证');
  console.log('  emotion.db         ❓     需 app 运行时验证');
  console.log('  head_image.db      ❓     需 app 运行时验证');
  console.log('  misc.db            ❓     需 app 运行时验证');
  console.log('');
  console.log('  请在 Electron 开发模式下（npm run dev），');
  console.log('  在设置页面或开发者工具中手动触发验证。');
}

main().catch(console.error);
