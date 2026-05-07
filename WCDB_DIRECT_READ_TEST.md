# WCDB 直连验证测试

## 背景

目前 CipherTalk 的数据流是：
```
微信加密 .db → WCDB 解密 → 拷贝到 CipherTalkData/ → better-sqlite3 读取
```

这种拷贝方案的问题：
- 每次增量必须全量解密整个数据库文件（几百 MB）
- WAL 不一致：拷贝时微信可能正在写入
- 存储翻倍

本测试用于验证能否跳过拷贝步骤，**直接用 WCDB 直连微信的原生加密数据库**：

```
微信加密 .db → WCDB execQuery 直连读取（跳过拷贝）
```

---

## 前置条件

1. 微信已登录（需要在进程内存中读取数据库密钥）
2. 开发环境已启动（`npm run dev`）
3. Electron 窗口已打开

---

## 测试方法

### 方式一：控制台执行（推荐）

Electron 窗口打开后，按 `Cmd+Option+I` 打开开发者工具控制台，输入：

```js
await window.electronAPI.invoke('wcdb:runDirectReadTest')
```

脚本会自动完成以下步骤：

| 步骤 | 说明 |
|------|------|
| 1. 路径检测 | `dbPathService.autoDetect()` 自动找到微信数据库目录 |
| 2. WXID 扫描 | `dbPathService.scanWxids()` 获取当前微信 ID |
| 3. 密钥获取 | `wxKeyServiceMac.autoGetDbKey()` 从微信进程内存读取数据库密钥 |
| 4. WCDB 连接 | `wcdbService.open()` 用密钥打开微信的加密数据库 |
| 5. 逐库验证 | 对所有数据库执行 `SELECT LIMIT` 查询 |
| 6. 字段完整性 | 检查 `message_content` 等二进制字段是否被 JSON 序列化截断 |

### 方式二：命令行

```bash
npm run test:wcdb
```

> ⚠️ 注意：koffi 是 native addon，依赖 Electron 运行时。命令行方式可能因环境问题无法执行，推荐使用方式一。

---

## 验证的数据库

| 数据库文件 | 验证内容 | 重要性 |
|-----------|---------|--------|
| `session.db` | 会话列表、好友关系 | 🔴 核心 |
| `contact.db` | 联系人详情（昵称、备注） | 🔴 核心 |
| `message_*.db` | 聊天消息（主数据） | 🔴 核心 |
| `emoticon.db` | 表情包数据 | 🟡 辅助 |
| `emotion.db` | 商店表情数据 | 🟡 辅助 |
| `head_image.db` | 头像缓存 | 🟡 辅助 |
| `misc.db` | 杂项配置 | 🟢 低 |

---

## 预期输出

执行成功后，控制台会输出类似以下结果：

```
=== 验证结果 ===
session.db: ✅ 成功 (返回 3 行, 字段: SessionTable, ...)
contact.db: ✅ 成功 (返回 50 行, 字段: username, nickname, ...)
message_1.db: ✅ 成功 (返回 3 行, 字段: local_id, message_content, ...)
emoticon.db: ✅ 成功 (返回 3 行, 字段: ...)

=== 结论 ===
WCDB 直连可行度: 100%
等级: 🟢 推荐迁移
```

> ⚠️ 如果 `message_content` 等二进制字段在 JSON 序列化中被截断，会显示部分成功（🟡），此时需要走混合方案（直连做增量拉取 + 解密文件兜底）。

---

## 失败排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| `密钥获取失败` | 微信未登录或版本不兼容 | 确保微信已登录，尝试重启微信 |
| `路径检测失败` | 微信数据库路径变更 | 检查 `dbPathService.ts` 中的路径匹配 |
| `数据库打开失败` | 密钥错误或 WCDB 库不匹配 | 检查 `libwcdb_api.dylib` 是否存在 |
| `消息库查询失败` | 表名格式与预期不符 | 检查实际的消息表命名模式 |

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `electron/main/ipc/wcdbHandlers.ts` | IPC handler（`wcdb:runDirectReadTest`） |
| `scripts/wcdb-direct-read-test.ts` | 验证脚本源码 |
| `scripts/wcdb-direct-read-test.js` | 验证脚本 JS 版 |
| `electron/services/wcdbService.ts` | WCDB 原生库封装 |
| `electron/services/wxKeyServiceMac.ts` | 微信密钥获取 |
| `electron/services/dbPathService.ts` | 微信数据库路径检测 |
