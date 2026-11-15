# danmage

把 YouTube / Twitch / Kick / Crunchyroll 的聊天室訊息變成彈幕的 Chrome 擴充功能（pc035860 的 fork，目前不打算 PR 回上游）。

## 結構

- `frontend/chrome_extension/`：MV3 擴充功能。`content_script/`（讀聊天室 DOM、畫彈幕、設定面板）、`background/`、`_locales/`（四個語系，新增文案四個都要補）
- `backend/`：Datastore handler；`interface/*.yaml` 是訊息定義，`.ts` 由它產生
- `specs/`：功能規格；`specs/handover/` 是自動產生的交接報告（已 gitignore）

## 指令

- 安裝與建置：`npm ci`；`npm run ext_linux` 產生 `chrome_extension_bin/`（gitignored，載入未封裝項目；會直接連 PROD 後端 www.danmage.com）。Firefox 用 `npm run ext_firefox_linux_zip`
- 重新產生 `interface/*.ts`：`node_modules/.bin/geneage interface/<name>.yaml`，不要手改 `.ts`
- 單元測試（沒有 `test` script）：`CHROME=<Chrome 執行檔> node_modules/.bin/bundage prun <測試檔路徑，不含 .ts>`
- `tsc --noEmit -p tsconfig.json` 在 `frontend/web`、`script/` 有既存錯誤，與擴充功能無關；改動範圍內應為 0

## 慣例與地雷

- 測試檔是 `*_test.ts`（`@selfage/puppeteer_test_runner`）：環境的 `tearDown` 不是每個 case 都跑，case 要自己清 DOM；`eq()` 不能比陣列，用 `isArray([eq(...)])`
- 設定以二進位、依欄位 index 送到後端；舊後端遇到未知 index 會拋 `TypeError`，整包更新失敗。新增 `PlayerSettings` 欄位時要在 `PlayerSettingsStorage.save()` 送出前拿掉（`showTimestamp` 即如此），否則已登入使用者的雲端同步全壞
- YouTube 聊天 iframe 在收合、進出全螢幕時會被清空再重建。聊天容器不能當 Refresher 的必要元素，否則 PlayerController 整個重建、畫面上的彈幕全被拆掉；改由 `SwitchingChatPool` 換來源。YouTube 跨影片會沿用播放器，換影片靠 `videoToken` 觸發重建
- YouTube 進出全螢幕與切劇場模式時會搬動 `#player-container`，瀏覽器取消所有 CSS transition，computed transform 跳到終點。彈幕位置不要讀 `getComputedStyle`；`DanmakuElement` 用「起點 − 速度 × 時間」，且四個站台共用
- 新容器出現後 `OnPageChatPool` 會略過 2 秒內出現的訊息（`backlogWindow`，只有 YouTube 聊天傳值），否則剛渲染的聊天室歷史會被當成新彈幕噴出
- 聊天室隱藏備援（`hidden_chat_fallback.ts`）只用於進行中的直播（`.ytp-time-display` 帶 `ytp-live`）；`live_chat?v=` 對重播與已結束首播回「聊天室已停用」。重播備援還沒做，見 `specs/001-*/spec.md` 的 Phase 3
- 用 agent-browser 實機驗證 YouTube：要帶一般 Chrome 的 `--user-agent`（HeadlessChrome 會顯示「舊版瀏覽器」）、用 `--extension` 載入、`--mute-audio`；彈幕只在影片播放中才會出

## Recent Significant Changes

- Twitch 新增 `showTimestamp`（預設顯示，只存本地、不送後端），可關掉彈幕裡的聊天室時間戳
- YouTube 進行中直播收合聊天室時，改由隱藏 iframe 備援讀聊天室，彈幕不中斷
- 聊天容器不再是 Refresher 必要元素，進出全螢幕時 controller 與畫面上的彈幕不被拆掉
- `DanmakuElement` 位置改用時間模型，抵抗 YouTube 搬動播放器造成的 transition 取消
