# BrowseLoom Backlog

本清单只记录当前商店版尚未完成、且与标签页/会话/稍后再看/本地书签单一用途直接相关的工作。已经交付的历史功能见 `CHANGELOG.md`，产品长期约束见 `PRODUCT.md` 和 `AGENTS.md`。

## 发布前

- [ ] 使用 Chrome for Testing 运行 `npm run test:browser`，完成新标签页、Side Panel、书签导入、稍后再看物理删除/撤销、当前窗口会话和多窗口会话的真实扩展回归。
- [ ] 在 Chrome Web Store 后台补齐英文、简体中文商店描述和隐私披露。
- [ ] 使用干净 Chrome 116+ 配置文件加载 `dist/browse-loom-chrome-1.1.0.zip` 解压内容并做一次发布 smoke test。
- [ ] 人工检查截图与当前 14 套主题、书签工作区、Side Panel 标签中心一致，不再出现已移除的 Tools 工作台。

## 可靠性

- [ ] 为关闭全部、关闭分组和重复清理评审统一的短时撤销模型；先明确浏览器关闭后可恢复范围，再实现。
- [ ] 增加持久化容量压力测试，覆盖大规模书签、会话和 favicon 缓存共存时的 quota 错误。
- [ ] 增加扩展升级 smoke test：schema 6 → 7、schema 7 正常启动、未来 schema 拒绝读写。

## 结构治理

- [ ] 单独评审 `extension/app.js` 的分拆方案；按持久化、标签操作、会话、渲染和隐私交互设置模块 seam，不做机械按函数拆文件。
- [ ] 收口 Preferences 服务：以外观、工作区、隐私屏幕和搜索等领域配置为边界提供统一读写接口；保留各领域独立存储、校验和演进，不合并成万能 `appSettings`。
- [ ] 清理 `extension/style.css`、`extension/sidepanel.css`、`extension/glass.css` 和 `extension/effects.mjs` 中已经没有 DOM 消费者的历史 Command Dock / Tools 样式与选择器。
- [ ] 将浏览器回归接入 CI；在具备 Chrome for Testing 的 runner 上执行，避免把本机浏览器路径写入仓库。

## 非承诺兼容性

- [ ] Edge、Brave 只做按需能力验证。验证结果应记录浏览器版本和失败能力，不写成持续支持承诺。
