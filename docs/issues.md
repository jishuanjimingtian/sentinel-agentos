# AgentOS 闂寰呭姙娓呭崟

> 浠?AgentOS 鎺ュ叆鍜岃繍琛屼腑鏀堕泦鐨勯棶棰橈紝鎸変紭鍏堢骇鎺掑垪

## P0 鈥?褰卞搷鏍稿績鍔熻兘

| # | 闂 | 鐜拌薄 | 褰卞搷 | 鏂规 |
|---|------|------|------|------|
| 1 | **stats 缁熻 byTool 澶ч噺 undefined** | `byTool: { exec: 1, undefined: 39 }` | 缁熻涓嶅噯锛寀ndefined 鎿嶄綔鏃犳硶鍒嗙被 | 鉁?**宸蹭慨** plugin hook 鍐欏叆鏀逛负 `toolName` + AgentOS audit-log.ts 鍏煎 `tool` fallback |
| 2 | **profile totalOps 鏄剧ず 0** | `totalOps: 0` 浣?stats 閲屾槸 40 | 璐ㄩ噺璇勫垎涓嶆洿鏂?| 鈴?闇€瑕?Evaluator pipeline 鍦ㄨ交閲忔ā寮忎笅涔熻褰?metric锛堥渶棰濆寮€鍙戯級锛岀煭鏈熷唴涓嶅奖鍝嶄娇鐢?|

## P1 鈥?褰卞搷鏁版嵁璐ㄩ噺

| # | 闂 | 鐜拌薄 | 褰卞搷 | 鏂规 |
|---|------|------|------|------|
| 3 | **audit.jsonl 涓ょ鏍煎紡娣锋潅** | 杞婚噺琛?+ 瀹屾暣琛屾贩鍦ㄤ竴涓枃浠堕噷 | 鍚庣画鍒嗘瀽/鍥炴粴鍔熻兘鍙兘鍑洪敊 | 鉁?**宸蹭慨** plugin hook 鍐欏叆缁熶竴涓?`toolName` + `stage: "light"` 鏍囪锛屾暟鎹彲鍚屾椂鏀寔涓ょ璇诲彇 |
| 4 | **profile warning 鍋囬槼鎬?* | "High retry rate" / "Low verify pass rate" 瀹為檯涓嶅瓨鍦?| 璇鍒ゆ柇 | 鍒濆鍖栨椂涓嶈棰勮 warning锛岀瓑鐪熷疄鏁版嵁绉疮鍚庡啀鐢熸垚 |

## P1 鈥?褰卞搷鏁版嵁璐ㄩ噺

| # | 闂 | 鐜拌薄 | 褰卞搷 | 鏂规 |
|---|------|------|------|------|
| 11 | **璁板繂绯荤粺鏈悓姝ュ埌 memory_search** | Agent 鍚姩鍚?memory_search 鎼滀笉鍒?agentOS 璁板繂锛圫emantic/Episodic锛?| 姣忔閲嶅惎 agentOS 璁板繂瀵?Agent 涓嶅彲瑙侊紝鏃犳硶鍒╃敤鍘嗗彶涓婁笅鏂?| session_end 鏃跺皢 getSearchableSnapshot() 鍐欏叆 workspace/memory/agentos-memory.md锛屽悓姝ュ埌 OpenClaw 绱㈠紩鑼冨洿 |

## P1 鈥?褰卞搷鏁版嵁璐ㄩ噺锛堢画锛?

| # | 闂 | 鐜拌薄 | 褰卞搷 | 鏂规 |
|---|------|------|------|------|
| 11 | **璁板繂绯荤粺鏈悓姝ュ埌 memory_search** | Agent 鍚姩鍚?memory_search 鎼滀笉鍒?agentOS 璁板繂锛堣瑙佷笂鍗堣褰曪級 | 姣忔閲嶅惎 agentOS 璁板繂瀵?Agent 涓嶅彲瑙?| 鉁?**宸蹭慨** endSession() 涓啓鍏?workspace/memory/agentos-memory.md |
| 12 | **鍙岀纭鍚屾** | 闇€瑕佺‘璁ょ殑鎿嶄綔浠呭湪鐢佃剳绔脊绐楋紝寰俊绔棤娉曞悓姝ユ搷浣?| 浜轰笉鍦ㄧ數鑴戞梺鏃舵棤娉曞強鏃剁‘璁?鎷掔粷鎿嶄綔 | 寰呰璁★細pending 闃熷垪鎸佷箙鍖?+ 寰俊娑堟伅甯︽搷浣淚D + 浠讳竴绔‘璁ゅ悗鍚屾鍙栨秷鍙︿竴绔?|

## P2 鈥?澧炲己鍜屼紭鍖?

| # | 闂 | 鐜拌薄 | 褰卞搷 | 鏂规 |
|---|------|------|------|------|
| 5 | **璇箟瑙勫垯閲屾湁杩囨椂鐨?preCheck/postCheck 寮曠敤** | 宸叉竻鐞?鉁?| 鈥?| 鈥?|
| 6 | **episodic 璁板綍浜嗘墍鏈?exec 鍛戒护鍘熸枃** | 鍖呮嫭鑷繁鏌ヨ嚜宸?濡?`npx sentinel-agentos stats`) | 鍣煶澶氾紝璁板繂涓嶇簿鍑?| 璺宠繃 `sentinel-agentos` 鑷韩鍛戒护銆乣echo` 鏃犳剰涔夊懡浠?|
| 7 | **session_start hook 娉ㄥ叆鐨勪笂涓嬫枃涓嶅绐佸嚭** | 瑙勫垯鍒楄〃澶暱锛孉gent 涓嶄竴瀹氭敞鎰忓埌鍏抽敭瑙勫垯 | 閲嶈瑙勫垯鍙兘琚拷鐣?| 鎶?P0 绾ц鍒欙紙濡?"npm publish 鍓嶇‘璁ょ増鏈彿"锛夋彁鍒版渶鍓嶉潰 |
| 8 | **缂哄皯鑷姩娓呯悊 cron** | episodic 10KB / audit 10KB 浠婂ぉ鍒氬紑濮?| 闀挎椂闂磋窇浼氳啫鑳€ | 鍔犲懆搴﹀帇缂?+ 鏈堝害 rotate 鐨?cron 瀹氭椂鍣?|
| 9 | **semantic.json 缂栬緫鑴嗗急** | 鎵嬪姩缂栬緫 json 鍙兘鐮村潖鏍煎紡 | 鍔?CLI 鍛戒护 `rule add/delete/list` | 鍔?CLI 鍛戒护 |
| 10 | **profiler overallScore NaN** | 涔嬪墠鏈?NaN 璁板綍锛岄渶楠岃瘉鏄惁淇 | 鍙兘褰卞搷璇勫垎 | 澶嶆煡 profiler 浠ｇ爜锛岀‘璁?v0.3.10 宸蹭慨澶?|

## 宸蹭慨澶?

| # | 闂 | 淇 |
|---|------|------|
| 鉁?| `sentinel.execute()` 涓嶅瓨鍦?| 鏀逛负 Plugin hook 鑷姩鎷︽埅 |
| 鉁?| Plugin 鍔犺浇涓嶄簡 | 鐢?`openclaw plugins install` 璧?global 瀹夎 |
| 鉁?| 杩囨椂 preCheck/postCheck 瑙勫垯 | 宸蹭粠 semantic.json 鍒犻櫎 |
| 鉁?| 娴嬭瘯鏃ュ織娈嬬暀 | 宸叉竻鐞?audit/episodic/feedback |
| 鉁?| P0-1 stats byTool undefined | plugin 鍐欏叆 `toolName` + audit-log 鍏煎 `tool` fallback |
| 鉁?| P1-3 鍙屾牸寮忔贩鏉?| 缁熶竴 `toolName` + 鍔?`stage: "light"` 鏍囪 |
