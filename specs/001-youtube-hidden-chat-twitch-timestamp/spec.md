# 001 — YouTube 聊天室隱藏仍出彈幕 ＋ Twitch 時間戳開關
status: in_progress
created: 2026-11-15
branch: feat/youtube-hidden-chat-twitch-timestamp
origin: 2026-11-15 使用者需求（fork 自用）；參考專案 ~/git/YCS、~/git/nightdev-api-proxy、~/git/danmaku.rocks

## 背景與現況

兩個獨立需求，各自一個 Phase，共用一條 branch。

### YouTube：聊天室收合後彈幕停止

2026-11-15 盤點（子 agent 靜態閱讀＋實機驗證，頁面 `https://www.youtube.com/watch?v=r4D4Ck3acq8`，匿名、一般 Chrome UA）：

- danmage 讀的是同源 iframe 的 DOM：`refresher.ts:28-34` 取 `#chatframe`，`#chat #items` 為容器；`chat_pool.ts:123-154`（`OnPageChatPool.read`）每幀取整列 `innerHTML`。
- `refresher.ts:275-281`（`compareElements`）只判斷「存在」、不判斷「可見」，必要元素任一為 null 就 teardown（`:260-263`）。
- **實測**：收合後 `#chatframe`、`#chat-container`、`#panels-full-bleed-container` 仍在，但 `#chatframe` 被導成新的 `about:blank`（document 物件被換掉、舊元素 `isConnected=false`、10 秒內不會恢復），`#chat #items` 消失、renderer 數歸零。失敗點就是 `#chat #items`。
- **實測**：展開後 2 秒內 `#chat #items` 恢復，但 renderer 整批重建（首次約 60 個），舊參考全部失效。
- 使用者自己的「隱藏聊天室」開關（`showChatWindow`，`chat_window_toggler.ts:41-48`）只對 `#chat-container`、`#panels-full-bleed-container` 設 `display:none`，不動 iframe，刻意不中斷連線（commit `41491d0`）。所以它不受此問題影響。
- 備援方案實測：收合狀態下自建 iframe `https://www.youtube.com/live_chat?v=<id>&embed_domain=www.youtube.com`，3 秒內載入、same-origin、有 `yt-live-chat-app` 與 `#chat #items`；`display:none`、畫面外 400x600、`0x0`、`visibility:hidden` 四種隱藏方式，28 秒內 renderer 數量都持續增加；78 個 renderer 都有 `#timestamp`、`#author-name`、`#message`。

2026-11-15 再測「已結束的首播」（`QOZyHyc6rVg`，12 小時前首播、片長 1:04:20、聊天室為重播）與「重播」（`YowU6Nn7EzY`），匿名、一般 Chrome UA，收合用 iframe 內的「關閉」按鈕（真實 UI 路徑）：

- 兩頁展開時原生 iframe 都是 `/live_chat_replay?continuation=…`，有 `#items`；訊息隨影片時間推送（播放約 8 秒時最後一則從 `-10:47` 變 `0:07`，只在片頭驗到）。
- 收合後 `#chatframe` 仍在、`about:blank`（`#blocked`）、無 `#items`、`ytd-live-chat-frame` 帶 `collapsed`；展開約 0.3 秒內 `#items` 恢復。
- 備援 `live_chat?v=<id>&embed_domain=…`：載入成功、`contentDocument` 可存取，但沒有 `#items`、0 則，`bodyText` 為「這部直播影片的聊天室已停用。」。兩頁相同。
- 載入即收合確實存在：已結束首播頁每次載入都預設收合（`#chatframe` 在、`about:blank`、`collapsed`），展開後 reload 也一樣；重播頁收合後 reload 會是展開（YouTube 不記住收合）。
- DOM 標記：`.ytp-time-display` 帶 `ytp-live` 的只有直播（首播頁與重播頁都沒有）；`#movie_player` 本身沒有 `ytp-live`。`.ytp-live-badge` 的 `disabled` 與文字、時間列「觀看直播」／「觀看完整影片」也不同，但是語系字串，不採用。
- 收合後的 iframe 在任何頁面類型都是 `about:blank`，無法從它判斷頁面類型。`isLive`／`isPremiere` 在 `movie_player.getVideoData()` 上，推測隔離 world 讀不到，未驗證。

2026-11-15 再測全螢幕與重播隱藏 iframe（匿名、一般 Chrome UA、YouTube 全程靜音；`r4D4Ck3acq8` 當時已沒有聊天室，改用直播 `jygdgmmsGxQ`、`HwT-nkStbSs`）：

- **全螢幕不等於原生收合**：進出全螢幕時 `#chatframe` 會先短暫導成 `about:blank`（`#items` 為 0），約 0.5～1 秒後變回 `/live_chat`，是新的 document、renderer 整批重建（進入前 76 個、恢復後 76 個）；`#chatframe` 全程 `display:block`、400×594，`ytd-live-chat-frame` 沒有 `collapsed`，全螢幕時新訊息持續進來（8 秒內 73→75）。空窗時長只用 50ms 輪詢量過兩次（460ms、約 1 秒）。重播頁的全螢幕沒測。
- 使用者觀察到 danmage 的「隱藏聊天室」在全螢幕會失效；實測 `#chatframe` 在全螢幕仍是可見的 400×594，與此一致，但根本原因沒驗證。
- **重播隱藏 iframe**：`live_chat_replay?v=<id>&embed_domain=…` 回「Something went wrong」，不可用；用原生 iframe 收合前的 `contentDocument.location.href`（含 continuation，路徑 `/live_chat_replay`）原樣載入，可載入、same-origin、有 `#chat #items`。該 URL 無法自行構造，內含 seek 位置，收合後就拿不到。
- **時間同步協定**：YouTube 對原生 iframe 約每 272ms 呼叫 `contentWindow.postMessage(data, "https://www.youtube.com")`，data 只有 `{"yt-player-video-progress": <影片秒數 float>}` 與 `{"yt-player-state-change": N}`（N=3/1/2：緩衝／播放／暫停）。隱藏 iframe 載入後不送訊息，播放 10 秒仍是 0 個 renderer；每 500ms 送同形狀的 progress（值為 `video.currentTime`）後，約 4 秒有 52 個 renderer，與原生聊天室對應同一段影片時間。送合成的 progress 也能驅動（1800→51 個、1830→53 個、1900→63 個），往回送則整批重建。

2026-11-15 使用者回報「進出全螢幕時畫面上既有的彈幕被清掉再重新跑」，L3 與基準版（main `cef5c82`）對照偵錯：

- **根本原因有兩層**：(1) 聊天 iframe 被清空時 `#chat #items` 是 Refresher 的必要元素，一消失就 `PlayerController.remove()`；(2) YouTube 進出全螢幕與切換劇場模式時，會把 `div#player-container`（`#movie_player` 的祖先）在 DOM 裡搬到另一個容器，瀏覽器因此取消子樹內所有進行中的 CSS transition，每個彈幕的 computed transform 瞬間變成終點值（−舊 canvas 寬度），發生在擴充功能程式碼之前。
- main 同樣有 (2)，只是 (1) 在 +370ms 把彈幕整批 `remove()` 蓋住了。只修 (1) 後，彈幕節點保留但全部疊到同一個 X，約 3 秒後一起消失；離開全螢幕時新 canvas 比跳掉的位置窄，`startTransition` 直接判定已飄完，+551ms 全部移除（24 個）。
- 全螢幕時 `#movie_player` 尺寸在 30～100ms 內分 3 次變動（815×458 → 878×949 → 1598×1024 → 1396×1024）。reparent 到第一次 ResizeObserver 回呼之間約 10～40ms。

### Twitch：時間戳混進彈幕

- Twitch 讀取方式：`OnPageChatPool` 取整列 `innerHTML`（`chat_pool.ts:138`），沒有 timestamp 欄位。
- `TwitchChatContentBuilder.build`（`chat_content_builder.ts:273-318`）只無條件移除 VOD 的 `.vod-message__header`（`:309-312`），沒有任何直播時間戳處理、也沒有開關。
- **實測**（`https://www.twitch.tv/henyathegenius`）：時間戳預設關閉，使用者在「聊天設定 → 聊天室外觀 → 新訊息的時間戳記」開啟後，每行多一個 `<span class="chat-line__timestamp" data-a-target="chat-timestamp">8:21</span>`，位於 `.chat-line__message` 內，整列 `innerText` 為 `8:21Arbalest_765: …`。因此整列 `innerHTML` 會把時間戳帶進彈幕。
- 現有設定都在聊天室旁的 in-page 面板，沒有 popup / options 頁；存 `localStorage["PlayerSettings"]` 加後端 Datastore（`player_settings_storage.ts`）。新欄位照 `showUserName` 的路徑加。

## 拍板記錄
| # | 決策 | 內容 | 狀態 |
|---|---|---|---|
| D1 | YouTube 做法 | 方案 A：原生聊天室不可用時，自建隱藏 iframe 當備援，沿用 DOM 輪詢與 `YouTubeChatContentBuilder`。不做方案 B（直接打 `get_live_chat`）、不用 nightdev proxy | 提案 |
| D2 | 備援觸發 | 只有原生 `#chat #items` 不存在時才起隱藏 iframe；原生回來就切回並移除隱藏 iframe。聊天室可見時行為完全不變、不多一條連線 | 提案 |
| D3 | 隱藏 iframe 的隱藏方式 | 固定在畫面外、保留尺寸（`position:fixed; left:-9999px; 400x600`），`aria-hidden`、`tabindex=-1`、`pointer-events:none`。四種方式實測無差異，這是預防瀏覽器對 `display:none` 的節流 | 提案 |
| D4 | 範圍 | danmage 現況沒有直播／首播／重播的判斷，純靠 `#chatframe` 存在與否分 Chat／Structured 兩種模式（`refresher.ts:28-39`）。備援只在「`#chatframe` 存在」且「`.ytp-time-display` 帶 `ytp-live` class（進行中的直播）」時觸發。已結束的直播／首播與重播一律不啟用：實測 `live_chat?v=` 對它們回「這部直播影片的聊天室已停用」，沒有 `#items`。此條只限 Phase 2 的 `live_chat?v=` 備援，重播另見 D8 | 提案 |
| D5 | Twitch 欄位 | 新增 `showTimestamp`（boolean，`DisplaySettings` index 14），預設 `true`（顯示），既有使用者行為不變；使用者關閉後才移除時間戳 | PC 2026-11-15 |
| D6 | 時間戳與封鎖比對 | `TwitchChatContentBuilder.extractContent` 一律移除時間戳（它是中繼資料不是內容），不論開關 | 提案 |
| D7 | 順手修的缺陷 | `refresher.ts:33-34` 缺 `contentDocument` null 保護，例外會跳過 `:272` 的 `setTimeout`，輪詢永久停止；備援改動會動到這段，一併加保護 | 提案 |
| D8 | 重播／已結束首播 | Phase 3：同樣用隱藏 iframe。原生可用時持續記下其 `/live_chat_replay` continuation URL，收合後載入該 URL，並自己把 `video.currentTime` 以 `yt-player-video-progress` 轉送給它。不做自動展開（R4）、不自己抓重播 API（R2）。可以晚於 Phase 1、2 另開 PR | 提案 |
| D9 | `showTimestamp` 與後端 | 只存本地：`PlayerSettingsStorage.save()` 送往後端的副本拿掉 `showTimestamp`，localStorage 完整保存。原因：實測舊 descriptor 解到未知 index 14 會直接拋 `TypeError`，整包設定更新都會失敗，已登入使用者所有設定的雲端同步都會壞；自行部署帶新 descriptor 的後端後可移除這個處理 | PC 2026-11-15 |
| D10 | 歷史訊息不噴出 | `OnPageChatPool` 新增 `backlogWindow`（只有 YouTube 聊天傳 2000ms，其他站台預設 0 不變），從 pool 建立起算，視窗內出現的訊息一律略過，並用 `MutationObserver` 追蹤游標，不依賴 `read()` 的呼叫頻率。取代原本「空容器等 2 秒再信任」的做法（Codex 審查指出等待時間無法證明歷史已載完）。代價：每次重新組裝後約 2 秒的即時訊息會被略過 | 提案 |
| D11 | controller 不隨聊天容器重建 | `YouTubeAssembler.queryElements()` 不再回傳聊天容器，改回傳每支影片一個的 `videoToken`；`PlayerController.createYouTubeChat` 收 `getChatContainer()`；新增 `SwitchingChatPool`。行為變化：載入即收合的頁面（已結束首播、重播）現在也會出現控制按鈕與 canvas，只是沒有彈幕 | 提案（行為變化待 PC 確認） |
| D12 | 彈幕位置用時間模型 | `DanmakuElement` 不再從 `getComputedStyle` 讀位置，因為 YouTube 搬動 `#player-container` 時瀏覽器會取消 transition、computed 值跳到終點。共用檔案，Twitch、Kick、Crunchyroll 都受影響 | 提案 |

## 設計

### Phase 1 — Twitch 時間戳開關

使用者在顯示設定分頁切換「顯示時間戳（Twitch）」，已存在與新進的 Twitch 彈幕立即依設定顯示或不顯示時間戳。

- 欄位：`showTimestamp`，預設 `true`（`defaults.ts` 的 `SHOW_TIMESTAMP_DEFAULT`）。`interface/player_settings.yaml` 為來源，`.ts` 由 `@selfage/generator_cli` 重新產生，不手改。
- 預設為 `true` 的布林欄位已有先例（`enable`、`showChatWindow`），合併寫法相同，所以舊資料沒有此欄位時會落到預設 `true`、行為不變。
- 欄位只存本地（D9）：`save()` 送往後端的副本拿掉 `showTimestamp`，localStorage 保留完整設定。重新產生 `.ts` 的指令是 `node_modules/.bin/geneage interface/player_settings.yaml`（dry-run 輸出與 commit 的 `.ts` 一致）。
- `TwitchChatContentBuilder.build`：`showTimestamp` 為 false 時移除 `.chat-line__timestamp`。`extractContent` 無條件移除（D6）。
- 既有彈幕：切換開關走現有 `updateDisplaySettings` → `reRender()` 路徑（`display_settings_tab.ts` → `control_panel.ts:434-437` → `danmaku_canvas_controller.ts:257-270`），不需新機制。
- 設定合併：`normalizePlayerSettings` 照 `showUserName` 寫「remote ?? local ?? default」；舊資料沒有該欄位時取預設。
- UI：`DisplaySettingsTab` 加一個 `SwitchCheckbox`，位置緊接 `showUserName`；重設設定（`:328` 一帶）要包含它。
- i18n：`_locales/{en,ja,zh_CN,zh_TW}/messages.json` 各加一個 key，四語都補。
- 7TV 直播聊天的 DOM 不同（`Twitch7tvChatContentBuilder`，`:321-372`），本 Phase 不處理，見 Open questions。

### Phase 2 — YouTube 聊天室隱藏時的備援來源

使用者在 YouTube 直播頁按原生「隱藏聊天室」後，彈幕繼續出現；展開後無縫接回原生聊天室。

- 偵測：Refresher 發現 `#chatframe` 存在、其 `contentDocument` 內沒有 `#chat #items`（收合後為 `about:blank`），且 `.ytp-time-display` 帶 `ytp-live`（D4），才視為「進行中的直播，原生聊天室不可用」。不帶 `ytp-live` 的頁面（一般影片、已結束的直播／首播、重播）維持現狀。
- 備援：在 `document.body` 新增一個 iframe（`data-danmage-hidden-chat` 屬性標記），`src = https://www.youtube.com/live_chat?v=<videoId>&embed_domain=<location.hostname>`，隱藏方式見 D3。載入完成後用它的 `#chat #items` 建 `OnPageChatPool`。歷史訊息不得噴成彈幕：由 D10 的 `backlogWindow` 處理，原生與隱藏兩個來源都適用。
- 切回：原生 `#chat #items` 重新出現時（document 已被重建，必須重新查詢、不得沿用舊參考），重新綁定原生容器，移除隱藏 iframe。同一時間只有一個來源在輪詢。
- 清理：teardown、換影片（SPA 導航 videoId 變了）、離開頁面時移除隱藏 iframe。
- 失敗處理：隱藏 iframe 在逾時內沒出現 `#chat #items`（例如聊天室被關閉、會員限定）就放棄，不重試迴圈、不重複建立 iframe（Refresher 每 500ms 跑一次，要有 guard）。實作：10 秒沒有容器就放棄，直到原生回來或換影片才重置。
- 寬限期：原生不可用要持續滿 2 秒才建隱藏 iframe，避免進出全螢幕的 0.5～1 秒空窗白建 iframe。
- 生命週期：隱藏 iframe 由 `HiddenChatFallback`（`hidden_chat_fallback.ts`）在 `queryElements` 內管理，不放在 `assembler.remove()`。因為容器還沒載入時 Refresher 會先 teardown 並呼叫 `remove()`，放在那裡會把剛建的 iframe 砍掉而無限重建。Refresher 本身沒有改動，只是 `queryElements` 回傳的聊天容器在原生不可用時換成隱藏 iframe 的容器。
- D7：`refresher.ts:33-34` 加 `contentDocument` null 保護，確保單次例外不會讓輪詢永久停止。
- 沿用現有資料模型：`ChatEntry.content` 仍是原生 renderer 的 `innerHTML`，`YouTubeChatContentBuilder` 與封鎖比對不變。
- 全螢幕：進出全螢幕時 `#items` 會短暫消失約 0.5～1 秒再整批重建（見背景）。聊天容器不再是 Refresher 的必要元素（D11），controller 與已在畫面上的彈幕不被拆掉；`SwitchingChatPool` 在容器消失、重建或換來源時換掉內部的 `OnPageChatPool`（新來源套 D10 的積壓略過）；`GlobalDocuments.addDocument/removeDocument` 在聊天 iframe 換新 document 時補掛／移除 handler；換影片由 `videoToken` 觸發重建（YouTube 跨影片會沿用播放器，原本是聊天容器換了才順便重建）。
- 彈幕位置（D12）：進出全螢幕與切換劇場模式時 YouTube 會搬動 `#player-container`，瀏覽器取消 CSS transition。`DanmakuElement` 的位置改為時間模型（起點 − 速度 × 經過時間），不再讀 `getComputedStyle`；`startTransition` 重入時先同步位置並清掉舊計時器。這個檔案 Twitch、Kick、Crunchyroll 共用。

### Phase 3 — 重播／已結束首播的收合備援（提案，D8）

使用者在重播頁（含已結束首播）收合原生聊天室後，彈幕繼續依影片時間出現。

- 捕捉：原生 `#chat #items` 存在時，Refresher 持續記下 `chatframe.contentDocument.location.href`（路徑為 `/live_chat_replay`，含 continuation）。這個 URL 不能自己構造，收合後就拿不到，所以一定要在展開狀態下記。
- 觸發：原生不可用、頁面沒有 `ytp-live`、且手上有記下的 `/live_chat_replay` URL，才建隱藏 iframe（隱藏方式同 D3）載入該 URL。
- 時間同步：隱藏 iframe 不會自己前進，以約 300ms 間隔對它 `contentWindow.postMessage({"yt-player-video-progress": video.currentTime}, "https://www.youtube.com")`。`yt-player-state-change` 是否需要沒測。
- 讀取：沿用 `OnPageChatPool` 與 `YouTubeChatContentBuilder`。seek 時 iframe 會整批重建，要確認不會把歷史訊息一次噴成彈幕。
- 切回、清理、失敗放棄：同 Phase 2。
- 沒記到 URL（載入即收合、從未展開）時不啟用。

## 改動清單

Phase 1（路徑相對 `frontend/chrome_extension/`，除非另註）：
- `interface/player_settings.yaml`、`interface/player_settings.ts`（由 yaml 重新產生）
- `content_script/common/defaults.ts`：`SHOW_TIMESTAMP_DEFAULT`
- `content_script/common/player_settings_storage.ts`：`normalizePlayerSettings`、`save()`（D9，遠端不送 `showTimestamp`），新增 `common/player_settings_storage_test.ts`
- `content_script/display_settings_tab/display_settings_tab.ts`：Ref、`SwitchCheckbox`、監聽、handler、重設
- `_locales/{en,ja,zh_CN,zh_TW}/messages.json`
- `content_script/common/chat_content_builder.ts`：`TwitchChatContentBuilder.build`、`extractContent`
- 新增 `content_script/common/chat_content_builder_test.ts`（測 Twitch builder 的時間戳移除）

Phase 2：
- `content_script/refresher.ts`：備援偵測、隱藏 iframe 的建立／切換／清理、`contentDocument` 保護
- `content_script/chat_pool.ts`：`OnPageChatPool` 的 `backlogWindow`（D10）；`content_script/player_controller.ts`：`createYouTubeChat` 傳入視窗
- 新增 `content_script/hidden_chat_fallback_test.ts`、`content_script/on_page_chat_pool_test.ts`
- D11：`content_script/refresher.ts`（`YouTubeAssembler`）、`content_script/chat_pool.ts`（`SwitchingChatPool`）、`content_script/player_controller.ts`（`createYouTubeChat`）、`content_script/common/global_documents.ts`（`addDocument`／`removeDocument`）；新增 `switching_chat_pool_test.ts`、`refresher_test.ts`、`common/global_documents_test.ts`
- D12：`content_script/danmaku_canvas/danmaku_element.ts`；新增 `danmaku_canvas/danmaku_element_test.ts`
- 備援邏輯若超過幾十行，抽成獨立檔（例如 `content_script/hidden_chat_iframe.ts`），不要塞滿 `refresher.ts`

Phase 3：
- 同上，備援檔加上 URL 捕捉與 progress 轉送；`refresher.ts` 只負責呼叫

## 驗證與驗收

證據取得方式：單元測試用 `CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node_modules/.bin/bundage prun <測試檔，不含 .ts>`；實機用 `npm ci && npm run ext_linux`，載入 `chrome_extension_bin/` 為未封裝擴充功能（用 agent-browser 時需用一般 Chrome UA，預設 HeadlessChrome UA 會讓 YouTube 聊天 iframe 顯示「舊版瀏覽器」）。

Phase 1：
- [x] 開啟 Twitch「新訊息的時間戳記」且 `showTimestamp=false`：`https://www.twitch.tv/henyathegenius` 的彈幕 `innerText` 不含 `\d+:\d+` 時間文字
- [x] 預設值（全新安裝，以及升級後本地與後端都沒有此欄位的既有使用者）：彈幕含時間戳，行為與改動前一致
- [x] 後端回傳的設定沒有此欄位時，合併結果為 `true` 而不是被反序列化成 `false`
- [x] 切換開關後，畫面上已存在的彈幕立即更新
- [x] 重新整理頁面後設定保留（`localStorage["PlayerSettings"]`）
- [ ] 封鎖關鍵字（含純數字或 `:`）不會比對到時間戳（單元測試只證明 `extractContent` 會移除時間戳，沒有實機驗過封鎖路徑）
- [x] 重設設定會把 `showTimestamp` 還原
- [x] `chat_content_builder_test.ts` 通過，測試在此環境以 `CHROME=… bundage prun <測試檔>` 可跑
- [ ] 登入狀態下，設定更新請求不含 `showTimestamp`（單元測試已涵蓋 `save()`；匿名狀態下請求在送出前就因無授權失敗，實機觀察不到）

Phase 2：
- [x] 聊天室可見時行為不變，DOM 中沒有 `iframe[data-danmage-hidden-chat]`
- [x] 用真實 UI 路徑收合原生聊天室後，彈幕持續出現，`iframe[data-danmage-hidden-chat]` 存在且其 renderer 數量成長
- [x] 收合瞬間與展開瞬間，沒有歷史訊息一次噴出
- [x] 展開後切回原生聊天室、隱藏 iframe 被移除，沒有重複彈幕
- [ ] 收合狀態下經 SPA 導航到另一支影片，隱藏 iframe 被清掉且不殘留輪詢
- [ ] 一般影片（沒有聊天面板、走 Structured 模式）行為與改動前一致
- [x] 重播頁（`YowU6Nn7EzY`）與已結束首播頁（`QOZyHyc6rVg`）：行為與改動前一致，不建立隱藏 iframe
- [ ] 進行中的首播（需要一場正在進行的）：`ytp-live` 有無、收合時備援是否運作，結果記回 spec
- [ ] 直播中往回拖（DVR）後收合聊天室：備援仍運作，或行為在 Open questions 中記明
- [ ] 進行中的直播頁載入時就已收合：`#chatframe` 是否存在，結果記回 spec
- [ ] 收合 10 分鐘以上仍持續收到訊息（目前只實測 28 秒）
- [ ] 登入狀態下重做收合／展開流程（目前只測匿名）
- [x] `showChatWindow` 開關行為不變
- [x] 直播頁進出全螢幕：空窗期後彈幕自動恢復，沒有歷史訊息噴出，沒有殘留隱藏 iframe
- [x] 進入／離開全螢幕與切換劇場模式：控制按鈕仍是同一節點，畫面上既有的彈幕保留且位置接續（穩定後誤差 ≤ 40px；離開時只有已超出新寬度的才被移除）
- [x] 換影片（SPA）時舊彈幕被清掉；全螢幕重建後點聊天室仍能收起控制面板選單
- [x] 彈幕壽命與 (畫布寬度＋彈幕寬度)／速度 一致（YouTube 8 個、Twitch 80 個，差 0.0 秒）；Twitch 彈幕正常出現、飄過、被移除
- [ ] 進出全螢幕後前 3 秒新增彈幕數與穩態同一量級（L3 實測 0～5 個、約 +2.8～4.0 秒才開始，原因是 D10 的 2 秒視窗加上約 0.7 秒的容器空窗，是設計代價；見 Open questions）
- [ ] YouTube 影片暫停再播放，彈幕位置接續、不往回跳（只在 Twitch 驗到；YouTube 因播放器在測試環境持續卡住而沒驗到）

Phase 3：
- [ ] 重播頁（`YowU6Nn7EzY`）展開狀態下行為不變，且 Refresher 有記下 `/live_chat_replay` URL
- [ ] 重播頁用 UI 收合後，彈幕繼續依影片時間出現，隱藏 iframe 的 renderer 與原生聊天室對應同一段影片時間
- [ ] 重播頁 seek（往前、往後）後彈幕跟著影片時間走，沒有歷史訊息一次噴出
- [ ] 暫停與播放時行為正確（確認是否需要轉送 `yt-player-state-change`）
- [ ] 重播頁進出全螢幕（目前沒測過）
- [ ] 已結束首播頁（`QOZyHyc6rVg`，載入即收合）：不啟用備援、行為與改動前一致
- [ ] 展開後切回原生聊天室，隱藏 iframe 被移除，沒有重複彈幕

## 不做的事

- 方案 B（直接呼叫 `youtubei/v1/live_chat/get_live_chat`）與 nightdev-api-proxy：改動量大、要把 JSON 轉成 renderer HTML，也要多維護一台伺服器
- superchat 金額、會員等級等資料層解析：現有只做外觀 CSS，維持不變
- Kick、Crunchyroll 等其他站台
- 新增 popup / options 頁
- 改變 `showChatWindow` 的語意
- R4：偵測到原生收合就自動展開、再用 danmage 的容器隱藏蓋掉。使用者明確表示不要調整原生功能（PC 2026-11-15）
- R2：自己呼叫 `get_live_chat_replay` 分頁抓重播資料餵 `StructuredChatPool`。改版風險最高、樣式會掉，Phase 3 實測可行前不考慮

## 風險與 Open questions

- **影片暫停時組裝的 controller 不出彈幕**：`PlayerController` 建構時只在影片未暫停才排程 `play()`，`chatPool.start()` 在 `play()` 裡。L3 第一輪收合後 60 秒 0 彈幕（隱藏 iframe 有 250 則訊息），當時播放器處於錯誤狀態、影片暫停，疑似此因；但同一輪後來播放器出錯後彈幕卻仍出現，沒解釋。之後 4 輪在健康播放器上都正常。需在穩定環境再測，並確認這是既有行為而非本次引入。
- **`OnPageChatPool` 的 `MutationObserver` 沒有 teardown**：只會在視窗外的下一次 mutation 時自行斷線，安靜的容器在 controller 移除後仍保留 observer 與 pool，直到容器被回收或再次變動。Codex 第 3 輪列為非阻擋建議，延後處理。
- **Refresher／Assembler 的整合測試沒做**：建構真的 `PlayerController` 需要完整的 YouTube 播放器 DOM；`createYouTubeChat` 傳入視窗的接線只由 L3 實機驗證涵蓋，單元測試是直接傳 2000 建 pool，漏傳不會被攔到。
- **切換後約 3 秒沒有新彈幕（D10 的代價）**：容器空窗約 0.7 秒再加 2 秒積壓視窗，這段時間進來的即時訊息被略過。可能的改法：改用訊息自己的 `id` 去重（只略過已播過的 id、新 id 照出），既不噴歷史、也不丟訊息；前提是 YouTube 聊天項目的 `id` attribute 在不同來源（原生／隱藏 iframe、重建前後）一致，沒驗證過，沒有 `id` 時退回視窗。
- **reparent 後的錯位幀**：`#player-container` 被搬動後，到第一次 ResizeObserver 回呼之間彈幕短暫在錯誤位置（L3 實測：reparent 後第一個 rAF 幀偏差中位 457～674px、最大 1666px，下一幀回到 ≤17px，距 reparent +22～172ms）。headless 環境另有 250～350ms 的渲染卡頓，基準版同樣有。肉眼是否可接受尚待使用者實際看過。
- **搬動後寬度不變**：只有寬度變動才會呼叫 `updateCanvasSize`；若搬動取消 transition 但寬度不變，時間模型不會重設畫面上的 transform。YouTube 全螢幕與劇場模式切換時寬度都有變，沒有寬度不變的實機證據。
- **YouTube 暫停→續播的實機驗證**：測試環境的播放器持續卡住，只在 Twitch 驗到暫停期間位置不動、續播不往回跳。`DanmakuElement` 單元測試涵蓋了暫停與重入。
- **D11 的行為變化沒有經過使用者確認**：載入即收合的重播與已結束首播頁，現在也會出現控制按鈕與 canvas。
- **收合路徑只模擬過**：實測是移除 `#show-hide-button` 的 `hidden` 再點它，沒有走真實 UI；匿名版面沒有可見的隱藏按鈕。需要在有該按鈕的版面（登入後或不同版面）重驗。
- **現況沒有直播／重播判斷**：2026-11-15 grep `replay|premiere|live_chat|isLive|ytInitial|upcoming` 在 `content_script` 零命中，只有 `video_id_extractor.ts:33` 取 `v` 參數。Chat 模式下直播、首播、重播都是讀 `#chat #items`。
- **`ytp-live` 的證據較弱**：直播頁的 `.ytp-time-display.ytp-live` 是用 4 支直播（含 `lofi hip hop radio`）驗的，但播放沒真的起來，只有靜態 class 證據。在直播中往回拖（DVR）時 class 會不會消失沒測；若會消失，備援會在這段時間失效。實作後要驗。
- **進行中的首播沒測到**：`QOZyHyc6rVg` 已結束，實測的是已結束首播。進行中首播的聊天室預期是 live chat，`ytp-live` 與備援是否可用未知。若不帶 `ytp-live`，D4 會讓它維持現狀（安全但沒有新功能）。
- **載入即收合的情況**：實測存在（已結束首播頁），此時 `#chatframe` 在，所以偵測條件涵蓋它。但進行中的直播頁載入即收合是否也保有 `#chatframe`，沒測；若不存在，danmage 會落入 Structured 模式，且「沒有 `#chatframe`」是一般影片的正常狀態，不能當作聊天室被隱藏。
- **載入即收合的重播頁拿不到 continuation URL**：Phase 3 需要在展開狀態下記 URL，已結束首播頁每次載入都預設收合，所以預設不會有。候選：fetch `watch?v=<id>&pbj=1` 解析初始 continuation（YCS `core.ts:181-238`、`chat.ts:118-177`）。該 token 是否能組成可載入的 `/live_chat_replay` URL，沒驗證。
- **Phase 3 沒測到的**：重播頁的全螢幕；聊天密集區段的連續性（實測區段稀疏）；seek 時 YouTube 是否額外送訊息；`yt-player-state-change` 是否必要；送 progress 的最小間隔。
- **seek 重建與歷史噴出**：往回 seek 時隱藏 iframe 整批重建，`OnPageChatPool.read` 在指標被移除時會從 `firstElementChild` 重來（`chat_pool.ts:125-129`，子 agent 靜態閱讀），可能把整批當新訊息噴出。原生重播聊天室現在是否已有同樣行為沒驗證。
- **協定依賴 YouTube 內部**：`yt-player-video-progress` 與 continuation URL 都不是公開介面，改版就失效。
- **測試環境**：播放約 15 秒後常出現播放器錯誤，seek 會卡住，重播聊天室的時間同步只在片頭驗到。
- **`embed_domain`**：實測用 `www.youtube.com` 可行，取 `location.hostname` 是否等價沒測。
- **無法用備援的直播**：關閉聊天、會員限定、年齡限制等，`live_chat?v=` 可能載不出來，沒有測過；目前設計是放棄且不重試。
- **訊息間隙**：原生收合與展開、隱藏 iframe 建立過程中，可能有最多數秒的訊息漏掉。預期可接受，但要在驗收時確認是否明顯。
- **兩個來源短暫並存**：切換瞬間若原生與隱藏 iframe 同時有內容，要確認不會重複出彈幕。
- **7TV 時間戳**：`Twitch7tvChatContentBuilder` 沒有時間戳處理，7TV 的 DOM 沒驗證過。使用者是否用 7TV？若用，Phase 1 要補驗證其時間戳元素。
- **開關顯示範圍**：`showTimestamp` 只對 Twitch 有作用，但 `DisplaySettingsTab` 對所有站台一視同仁顯示（`showChatWindow` 對 Twitch 也是無作用卻照樣顯示）。目前 D5 沿用這個慣例，標籤加註「（Twitch）」；是否要依站台隱藏是另一個決定。
- **YouTube 改版**：隱藏 iframe 依賴 `live_chat?v=` 嵌入與 renderer 的內部結構，與現有 DOM 輪詢同樣會受 YouTube 改版影響，沒有額外退路。

## Changelog
- 2026-11-15：建檔，依 2026-11-15 的程式碼盤點與兩個頁面實機驗證撰寫
- 2026-11-15：D5 預設改為顯示（PC 拍板，維持既有行為），同步改 Phase 1 設計與驗收；D4 改寫並新增重播／載入即收合／首播的 Open questions，因為確認 danmage 沒有任何直播／重播判斷
- 2026-11-15：使用者回報進出全螢幕會清掉畫面上的彈幕。新增 D11（聊天容器不再是必要元素、`SwitchingChatPool`）與 D12（`DanmakuElement` 位置時間模型），改寫 Phase 2 設計與改動清單，補根本原因到背景。第二個 Codex session 審查 3 輪＋1 輪確認（最後 0 blocker）；L3 以 sonnet 重驗：位置接續、換影片、handler、回歸都通過，「切換後 3 秒內新增彈幕」依字面判準未通過（D10 代價），YouTube 暫停續播因環境卡住沒驗到
- 2026-11-15：Phase 1 + 2 實作完成（未 commit）。Codex 審查 3 輪收斂（最後一輪 0 blocker）、L3 實機驗證 PASS；新增 D9（`showTimestamp` 只存本地，PC 拍板）、D10（`backlogWindow`）；改寫 Phase 2 設計（寬限期、生命週期、歷史訊息處理）、改動清單、Open questions；勾選已驗項目。status 維持 in_progress，因為仍有未驗項目（SPA 導航、一般影片、DVR、載入即收合、長時間、登入、封鎖路徑）
- 2026-11-15：status 改 in_progress。PC 指示開新 branch、先做 Phase 1 + 2（Phase 3 延後）、驗收走 verify-code-change；目前沒有要 PR 回上游
- 2026-11-15：補全螢幕與重播隱藏 iframe 的實測結果；新增 D8 與 Phase 3（提案）；D4 限定為 Phase 2；「不做的事」記入 R4（PC 否決）與 R2，因為使用者不要調整原生功能，且實測 `postMessage` 轉送時間可行
- 2026-11-15：依已結束首播與重播的實測，D4 改為以 `.ytp-time-display.ytp-live` 判斷進行中的直播才啟用備援，因為 `live_chat?v=` 對已結束內容回「聊天室已停用」；背景補實測結果、改寫 Open questions 與驗收項
