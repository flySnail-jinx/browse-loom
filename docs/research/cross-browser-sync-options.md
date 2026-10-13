# BrowseLoom 无自建服务器跨浏览器同步方案调研

> 调研日期：2026-09-01\
> 范围：设置、扩展内书签、用户壁纸；目标浏览器以当前已发布的 Chrome / Edge 包为主。\
> 来源原则：只采用浏览器厂商、云服务商、IETF/RFC 等第一方资料；“接受度”只做有明确依据的相对判断，不把不同公司的用户数字当成可直接比较的市场份额。

## 结论先行

如果目标是**不自建服务器、Chrome 和 Edge 真正共用同一份数据、并支持壁纸文件**，浏览器自带的 `storage.sync` 不够用，必须接一个独立于浏览器厂商的云存储或让用户自己选同步文件。

建议按下面顺序决策：

1. **自动同步的首选 PoC：Dropbox App Folder。** 它不是账户覆盖最广的方案，但在“无需后端、Chrome/Edge 共用、最小文件权限、长期授权”这几个约束同时成立时，官方支持路径最完整：App Folder 只允许访问应用自己的目录；OAuth 2.0 PKCE 明确面向纯 JavaScript、开源和无服务器客户端；单次上传 150 MiB，足够覆盖 BrowseLoom 当前单张不超过 8 MiB、最多 10 张的壁纸库。
2. **OneDrive App Folder 作为第二个 PoC。** 对 Windows、Edge、Microsoft 365 用户更自然，也支持个人及工作/学校 OneDrive；但官方权限参考目前仍把委托权限 `Files.ReadWrite.AppFolder` 标成 preview，且 SPA 刷新令牌通常只有 24 小时，需要验证扩展里能否稳定静默续期，否则会出现频繁重新授权。
3. **Google Drive `appDataFolder` 的产品接受度可能更高，但不是当前约束下最省事的跨商店实现。** 存储权限很干净，目录对用户和其他应用隐藏，`drive.appdata` 还是 non-sensitive scope；然而 Chrome 推荐的 `identity.getAuthToken()` 跟 Chrome 扩展 ID / Chrome Web Store 项目绑定，而 Edge 明确不支持该方法，只能改用 `launchWebAuthFlow()`。这使 Chrome 包和 Edge Add-ons 包的无后端认证路径需要单独做真实商店 ID PoC，不能仅凭 Chromium API 兼容性下结论。
4. **不要把 iCloud / CloudKit 作为第一版。** CloudKit 是开发者管理的应用容器和数据库，不是让用户选择一个 iCloud Drive 文件夹；Apple 官方 CloudKit JS 又要求从 Apple CDN 加载脚本，而 Chrome MV3 禁止扩展执行远程托管代码。即使改为打包 SDK或直接调 Web Services，仍要维护容器、schema、API token、Apple 登录和冲突处理，复杂度明显高于网盘 App Folder。
5. **WebDAV 适合“高级用户自定义同步”，不适合作为默认入口。** WebDAV 只标准化 HTTP 文件操作，不提供统一的服务发现、OAuth 或账户 UX；每个服务的端点、认证方式、限额都可能不同。

为了尽快验证需求，也可以先做一个**手动导出/导入同步包**：用户把 `.zip` / `.json` 放进 iCloud Drive、OneDrive 或 Dropbox 的本地同步目录。它没有 OAuth 和服务器成本，但本质是备份/恢复，不是无感自动同步。

## 当前数据边界

- 当前 MV3 清单只声明 `storage`，没有 `identity` 或网盘 API 的 host permission（[`extension/manifest.json`](../../extension/manifest.json)）。
- 结构化数据通过 `chrome.storage.local` 读写，schema 版本当前为 8；其中包含 `bookmarkLibrary`、搜索设置、隐私设置等（[`extension/services/storage-service.js`](../../extension/services/storage-service.js)）。
- 用户壁纸存放在独立 IndexedDB；当前限制为最多 10 张、单张源文件不超过 20 MiB、处理后不超过 8 MiB（[`extension/services/wallpaper-service.js`](../../extension/services/wallpaper-service.js)）。因此最坏仅壁纸正文就可能接近 80 MiB，尚未计缩略图和结构化数据。
- 现有隐私政策明确承诺壁纸不上传、无账户、无后端。任何云同步功能都必须是用户主动开启，并同步更新产品内说明、隐私政策和商店披露（[`PRIVACY.md`](../../PRIVACY.md)）。

## 方案比较

| 方案 | Chrome↔Edge | 壁纸 | 无自建服务器 | 用户额外账户 | 实现难度 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `chrome.storage.sync` / `browser.storage.sync` | 否，只在各自浏览器同步体系内 | 否 | 是 | 浏览器账户 | 低 | 只适合小设置，可作为辅助层 |
| Google Drive `appDataFolder` | 理论可，但认证需跨商店 PoC | 是 | 是 | Google | 中高 | 权限优秀，跨 Edge 认证是关键风险 |
| OneDrive App Folder | 是 | 是 | 是 | Microsoft | 中 | 用户自然，但委托 scope 仍标 preview |
| Dropbox App Folder | 是 | 是 | 是 | Dropbox | 中 | 当前约束下最干净的自动同步 PoC |
| iCloud CloudKit | 理论可 | 是（Asset） | 是 | Apple | 高 | 不是 iCloud Drive 文件夹，不推荐首版 |
| WebDAV | 是 | 是 | 是 | 服务商账户/凭据 | 中高 | 适合高级自定义，不适合默认 |
| 本地同步文件 | Chrome/Edge 桌面端可用 | 是 | 是 | 取决于本地网盘 | 低（手动）/中（自动） | 很适合先做备份/恢复 |

## 1. 浏览器内置同步的真实边界

Chrome 官方说明：`storage.sync` 使用 Chrome Sync；开启同步时，数据会到达用户已登录的其他 Chrome 浏览器，关闭同步时则退化为本地存储。它的硬限制是：

- 总量 102,400 bytes；
- 单项 8,192 bytes；
- 最多 512 项；
- 每分钟最多 120 次、每小时最多 1,800 次写操作；
- `local` / `sync` 区域不应存机密数据，因为它们没有加密保证。

来源：[Chrome `storage` API](https://developer.chrome.com/docs/extensions/reference/api/storage)

Firefox 也实现了 `storage.sync`，且限额与 Chromium 对齐，但它通过 Mozilla 账户和 Add-on ID 工作；桌面端还要求用户在 Sync 中勾选 Add-ons，Firefox Android 当前不参与该同步。

来源：[Mozilla `storage.sync`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/sync)

Edge 支持扩展 `storage` API，但 Edge 的同步文档描述的是登录 Microsoft 账户后在各个 Edge 实例之间同步；Chrome 则明确使用 Chrome Sync。由两家第一方文档可以得出：即便 API 名称相同，云端命名空间和账户体系也不同，**不能用 `storage.sync` 在 Chrome 和 Edge 之间交换数据**。

来源：[Edge 扩展 API 支持列表](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)、[Microsoft Edge 同步](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-enterprise-sync)

对 BrowseLoom 的含义：

- 主题、语言、开关等小设置可以使用内置同步，用户无需再登录一次；
- 书签库需要先测真实序列化尺寸，超过约 100 KiB 后必须分层或改走文件存储；
- 壁纸单张上限 8 MiB，和 100 KiB 总限额相差两个数量级，不能进入 `storage.sync`；
- 它解决的是“同浏览器跨设备”，不是用户提出的“不同浏览器”。

## 2. Google Drive `appDataFolder`

官方能力：

- `appDataFolder` 是每个第三方应用的隐藏目录，只能被创建它的应用访问，用户和其他 Drive 应用在 Drive UI 中都看不到；
- 使用最小权限 `https://www.googleapis.com/auth/drive.appdata`，该 scope 被官方标为 non-sensitive；
- 用户断开/卸载应用后数据目录可被删除，用户也能手动删除应用数据；
- 适合配置文件，也能通过 Drive 文件 API 存放壁纸二进制。

来源：[Google Drive：Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata)、[Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)、[Drive API limits](https://developers.google.com/workspace/drive/api/guides/limits)

主要问题不是存储，而是无后端跨浏览器认证：

- Chrome 的官方扩展方案使用 `chrome.identity.getAuthToken()`，OAuth client 类型为 Chrome Extension，并以扩展 Item ID 注册；Google 的已安装应用文档还写明，验证 Chrome Extension OAuth client 时必须有相同 Item ID 的 Chrome Web Store 项目。
- Microsoft 官方明确列出 Edge 不支持 `identity.getAuthToken`，替代方案是 `identity.launchWebAuthFlow()`。
- `launchWebAuthFlow()` 可以捕获 `https://<extension-id>.chromiumapp.org/*` 回调，但 Chrome 和 Edge 商店包通常具有不同扩展 ID，因此必须分别注册和验证回调/客户端。Google Web JavaScript 的长期授权 code model 又把 refresh token 交换放在后端；直接把它当成无后端 SPA 方案会漏掉认证生命周期问题。

来源：[Chrome 扩展 Google OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)、[Chrome `identity` API](https://developer.chrome.com/docs/extensions/reference/api/identity)、[Google OAuth for installed apps](https://developers.google.com/identity/protocols/oauth2/native-app)、[Edge API support：`getAuthToken` 不支持](https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/api-support)、[Google Web authorization model](https://developers.google.com/identity/oauth2/web/guides/choose-authorization-model)

判断：**存储模型很合适，账户接受度也很强，但不能在没有真实 Chrome/Edge 商店 ID 的情况下宣称认证方案已闭环。** 如果选择它，PoC 必须覆盖两个商店安装版的登录、重启后续期、撤销授权和多账户切换。

“接受度”旁证：Google 官方称 Cross-Account Protection 已覆盖 32 亿使用 Google 账号登录网站和应用的用户。这个数字只能证明 Google 登录覆盖广，不能当作 Drive 活跃用户数。

来源：[Google Cross-Account Protection](https://blog.google/innovation-and-ai/technology/safety-security/the-new-global-signal-exchange-will-help-fight-scams-and-fraud/)

## 3. Microsoft OneDrive App Folder

官方能力：

- 固定入口 `/me/special/approot`，首次访问自动创建 `Apps/{Entra 应用名}`；
- `Files.ReadWrite.AppFolder` 将访问限制在应用自己的目录；
- 同时支持 OneDrive home 和 work/school；
- 用户仍可查看、修改或删除目录中的文件；
- App Folder 计入用户 OneDrive / SharePoint quota；
- 单次 `PUT .../content` 支持不超过 250 MB 的文件，足够当前壁纸。

来源：[Microsoft Graph：Using app folder](https://learn.microsoft.com/en-us/graph/onedrive-sharepoint-appfolder)、[OneDrive App Folder](https://learn.microsoft.com/en-us/onedrive/developer/rest-api/concepts/special-folders-appfolder?view=odsp-graph-online)、[Upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0)

认证方面，Microsoft 官方支持浏览器 SPA 使用 authorization code + PKCE，因此可通过扩展的 `launchWebAuthFlow()` 纯客户端完成，不需要保存 client secret。不过：

- 注册为 SPA 的 refresh token 默认 24 小时且是非滑动窗口；之后通常需要再次走授权页，第三方 Cookie 被阻止时可能需要顶层窗口/弹窗；
- 官方 Graph 权限参考目前仍将委托 `Files.ReadWrite.AppFolder` 的显示文字标成 `(preview)`，应视为发布稳定性风险，先做租户与个人账户实测。

来源：[Microsoft OAuth code + PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)、[Refresh token lifetime](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)、[Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)

判断：**如果 BrowseLoom 用户明显偏 Windows/Edge，这个方案的产品认知最自然；但在 scope 正式稳定和续期体验验证之前，不建议直接承诺上线。**

## 4. Dropbox App Folder

官方能力：

- 创建 Dropbox API 应用时可选 App Folder，API 能力被限制在用户 `/Apps` 下的应用目录；
- Dropbox 明确要求最小权限，并指出权限过宽会降低用户接受授权的概率；
- OAuth code flow + PKCE 被官方推荐给纯 JavaScript、无服务器、开源或无法保存 client secret 的应用；可以请求 offline access 获得 refresh token；
- 普通上传接口不要超过 150 MiB，更大文件使用 upload session。BrowseLoom 当前 8 MiB 单壁纸远低于此限制。

来源：[Dropbox OAuth Guide](https://developers.dropbox.com/oauth-guide)、[Dropbox JavaScript SDK `filesUpload`](https://dropbox.github.io/dropbox-sdk-js/Dropbox.html)

判断：

- 在技术上，它是几种方案中最符合“无后端 + Chrome/Edge + 长期自动同步”的；
- 只需注册一个 Dropbox app，两个浏览器包分别登记 `chromiumapp.org` 回调，使用同一 PKCE 流；
- 代价是用户必须有 Dropbox 账号，且 Dropbox 在不同地区的自然渗透不如 Google/Microsoft 账户稳定。

“接受度”旁证：Dropbox 2025 年官方财报称其在约 180 个国家拥有超过 7 亿注册用户。注册用户不是月活，但足以说明它不是小众开发者服务。

来源：[Dropbox 2025 Form 10-Q](https://investors.dropbox.com/static-files/b2374b09-7dae-49d1-bc3b-b43e1b65b02f)

## 5. iCloud / CloudKit

需要区分两个概念：

- **iCloud Drive 同步文件夹**：用户文件系统中的网盘目录，可通过手动导出/导入或 File System Access API 选择；
- **CloudKit**：开发者创建并管理的容器、数据库、schema 和 API token。用户私有数据存放在该应用容器的 private database，并计入用户 iCloud quota。它不是“让用户选择一个 iCloud Drive 文件”。

Apple 官方 CloudKit JS 的使用前提包括已有 CloudKit app、容器/schema、启用 web services，并从 `https://cdn.apple-CloudKit.com/ck/2/CloudKit.js` 加载 Apple 托管脚本。Chrome MV3 则要求扩展逻辑必须自包含，明确禁止包外 `<script>` 远程代码。

来源：[Apple CloudKit JS](https://developer.apple.com/documentation/CloudKitJS)、[Apple private Cloud database](https://developer.apple.com/documentation/cloudkit/ckcontainer/privateclouddatabase)、[Chrome MV3 remote hosted code policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements/)

可以研究把 CloudKit JS 在构建时固定并打包，或完全使用 CloudKit Web Services REST，但这会引入 SDK 许可/更新、Apple Web Auth、API token origin、schema 和冲突处理问题。Apple 自己也将手工使用 CloudKit base API 描述为最复杂的路径，需要自行处理增量、冲突、change token 等。

来源：[Apple：Deciding whether CloudKit is right for your app](https://developer.apple.com/documentation/cloudkit/deciding-whether-cloudkit-is-right-for-your-app)、[CloudKit Web Services](https://developer.apple.com/library/archive/documentation/DataManagement/Conceptual/CloudKitWebServicesReference/SettingUpWebServices.html)

判断：**只在未来明确要做 Safari/iOS/macOS 原生生态时再考虑，不应因为用户提到 iCloud 就把它当成简单网盘接口。**

## 6. WebDAV

WebDAV（RFC 4918）是在 HTTP 上增加目录、属性、锁、写入等资源管理能力的标准。它没有规定统一 OAuth 提供商、账户发现或 UI；RFC 的认证章节仍围绕 HTTP authentication，并要求 Basic 认证只能用于安全连接。

来源：[RFC 4918](https://www.rfc-editor.org/rfc/rfc4918)

浏览器扩展从自身页面或 service worker 对 WebDAV 端点 `fetch()` 是可行的，但必须获得对应 host permission。对于运行时才知道的用户自定义服务器，Chrome 允许在 `optional_host_permissions` 先声明 `https://*/*`，再只向用户请求实际端点的 origin。

来源：[Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)、[Chrome permissions API](https://developer.chrome.com/docs/extensions/reference/api/permissions)

实际产品成本包括：

- 服务 URL、用户名、app password / token 的设置和验证；
- 不同服务端的认证差异、路径规则、ETag/锁支持差异；
- 证书、TLS、401/403/409/423 等错误解释；
- 凭据安全存储。浏览器扩展没有通用系统 Keychain API，而 Chrome 还明确提示 extension local/sync storage 不适合机密数据。

判断：**可以作为“自定义 WebDAV（高级）”入口，不宜用作所有用户默认同步。** 如果未来支持，至少只允许 HTTPS，优先 app password / token，不接收用户主密码。

## 7. 不接 API：同步文件 / 导出导入

最省开发和审核成本的第一步，是把当前结构化数据与壁纸组织成一个有版本的同步包，让用户自己放到 iCloud Drive、OneDrive、Dropbox 等本地同步目录：

- 第一阶段：`导出备份` / `从备份恢复`，完全不需要 OAuth；
- 第二阶段（Chromium）：用户通过 File System Access API 选定一个同步文件或目录，扩展在用户授权后读写；
- 限制：文件选择器必须由用户手势触发，权限可能需要重新确认，且 API 主要覆盖 Chromium 浏览器；用户还必须在每台电脑安装对应网盘客户端并选择同一路径。因此它不应宣称“无感跨浏览器实时同步”。

来源：[Chrome File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)、[MDN `showOpenFilePicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)

判断：**很适合先验证用户是否真的愿意迁移书签和壁纸，也能先确定同步包格式；但不是自动同步的最终答案。**

## 推荐的验证顺序（不含产品代码修改）

1. 先测真实数据量：空库、100/1,000/5,000 条书签，以及 1/10 张壁纸的导出包尺寸和耗时。
2. 定义一个与云厂商无关的同步包格式：`manifest.json`（schema、revision、device、更新时间、校验值）+ 结构化数据 + 以内容哈希命名的壁纸 Blob。不要先设计多家 provider 的复杂抽象。
3. 做 Dropbox App Folder 最小 PoC：Chrome 商店安装版 + Edge 商店安装版，覆盖登录、上传、下载、离线、本地/远端同时修改、撤销授权、浏览器重启后的 token refresh。
4. 如果产品用户明显偏 Microsoft 生态，再并行验证 OneDrive App Folder 的 preview scope 和 24 小时续期体验；通过后再决定是否把它作为默认 provider。
5. Google Drive 只有在真实 Edge 包完成无后端 OAuth 闭环后，才进入候选默认项；不要只在 Chrome 开发者模式通过就下结论。
6. 第一版冲突策略保持可解释：单一快照 + revision/ETag 条件写入；检测冲突时保留“本机副本”和“云端副本”，让用户选择，不做不可逆的静默覆盖。

## 最终建议

- 如果只能选一个做自动同步 PoC：**Dropbox App Folder**。
- 如果目标用户以 Windows / Edge 为主：**OneDrive App Folder 做第二个真实 PoC，验证通过后可能更适合作为默认项**。
- 如果只要最低成本先上线：**版本化导出/导入同步包**，让用户自己放进网盘目录。
- `storage.sync`：只同步小设置，不承担跨浏览器和壁纸。
- iCloud CloudKit、通用 WebDAV：暂不作为默认方案。

无论选哪家，云同步都应默认关闭、由用户主动连接；清楚展示“会上传哪些数据、存到谁的账户、如何断开和删除”；并在实现前更新 BrowseLoom 的 local-first 隐私承诺。
