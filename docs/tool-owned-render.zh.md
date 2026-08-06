# Agent Note：渲染归工具所有——一个供工具组合的 layout 包

Status: proposed

[English](2026-08-03-unified-list-of-blocks-tool-render.md) | 中文

## 问题

Web UI 里每一张工具结果卡片都是一个定制零件：自带数据形状、自带 CSS 几何、在一条手工维护的分发链里各占一格。当前有五张工具结果卡片——`TerminalBlock`、`ReadBlock`、`DiffBlock`、`SearchBlock`、`WebBlock`——外加通用兜底行和共享代码面 `CodeBlock`，它们在结构上没有任何共识：

- **状态在四个地方各自推导。** 只有 `TerminalBlock` 在卡片*内部*带一个运行态指示（整次调用一个 `StateDot`，只画在第一条 prompt 行，位于 [TerminalBlock.tsx:240](../../../../packages/client/ui-primitives/src/TerminalBlock.tsx#L240)，外加一个退出码/信号 `Pill`）。另外四张卡片都不带；它们的成功、失败、停止态由外围的行 chrome 涂色。这些推导不共享来源：`ToolRowState`（[tool-call-model.ts:23](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L23)）、`terminalFailed`（[terminal-card-model.ts:71](../../../../packages/client/ui-conversation/src/client/contract/terminal-card-model.ts#L71)，之所以需要是因为一条失败的 bash 命令会以 `isError: false` 落定）、`StateDotState` 的四个取值、以及 `TerminalBlock` 自己内部的 运行/退出/信号 映射，是同一个概念的四套独立编码。

- **「输入」没有共享表示。** 只有 `terminal`（command/cwd/description）和 `diff`（`FileDiff[]`）声明了结构化的 call view。`read`、`grep`、`glob`、`web_search`、`web_fetch` 都落到 `card: 'generic'` 的 call view——一个 `title` 字符串（read 另加 `kind` 和 `locations`），行的摘要和正文则从原始 `argsRaw` JSON 现推（[tool-call-model.ts](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts)）；grep 的 `path`/`include` 只作为 `"Grep X in Y (Z)"` 的子串留存。今天唯一真正渲染一对 IN/OUT segment 的地方是通用兜底的 `div.ioCard`（[ToolRow.tsx:294](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L294)），它硬编码在 `ToolRow` 内部、恰好只支持两个 segment、既不能嵌套也不能复用。

- **分发是一条中央链，还写了两遍。** 选一个工具渲染成哪张卡片，是一条多臂链——[ToolRow.tsx:258](../../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L258) 的嵌套三元表达式，以及在 [DetailsPanel.tsx:150](../../../../packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx#L150) 又以不同顺序写了一遍的 if/return 链。新增或改动一个工具的渲染，就得动这条共享中央链（和它的孪生），外加那个工具的 `*-card-model`——所以没有任何一个工具的呈现能被孤立地改动。

- **结构靠约定重复，而非靠代码共享。** 没有共享的卡片外壳（`grep -rn CardShell` = 0）。五个 CSS 模块各自声明一个 `.block` 根、重复同样四个属性，各自定义自己的 `--dsl-<name>-radius: 12px` 和 `--dsl-<name>-line-height: 22px`（`WebBlock` 只声明了 radius）。`headTailCap` 和 `useCopyFeedback` 各自恰好只有两个调用方；`ReadBlock` 和 `DiffBlock` 把同一套 head/tail 算术和 1000ms 复制超时连同硬编码的中文字面量各自内联一遍。三个 `CHAT_*_MAX_LINES = 8` 常量重复同一条注释。

- **i18n 不对称。** 只有 `TerminalBlock` 有完整的 `TerminalBlockLabels` 面；另外四张卡片内联中文字面量——[ui-primitives/README.md](../../../../packages/client/ui-primitives/README.md) 只记录了 `WebBlock` 这一处缺口，另外三处未记录。

促发这项工作的需求是交互式、多命令的 bash：一次 bash 调用会跑好几条命令，而一个持久/交互会话（一个 REPL、一个 PTY）会在多个回合里交换 stdin/stdout。两者都不契合 `TerminalBlock` 那套扁平的「一张卡、一条命令横幅、一个输出框、一个状态」形状。只扩展 bash 会在中央链上再添第六个定制变体。

## 提案

有两条设计原则决定形态，其余都由它们推出：

1. **一个工具的呈现必须能被孤立地改动**——改一个工具的渲染只触及那个工具的模块，绝不触及某个共享的中央 switch 或另一个工具。
2. **工具作者保留重构自己呈现的权利**——layout 是可组合的零件，不是一个工具必须往里塞的固定外壳。

所以渲染是**归工具所有，而非归骨架所有**。从 `ui-conversation` 里抽出一个 client 包——`@deepseek-ai/dsh-client-tool-render`——它只装三样东西，不含任何工具专属内容：

- **layout 零件**，供工具组合：`ToolCard`、`Segment`、`Group`（见下），外加一个给「只想要标准排布」的工具用的默认组合 helper。
- **注册接口**：keyed 的 `conversation.chat.toolview` slot 声明，以及一个已注册组件收到的 props（工具的 call view 和 result view）。
- **内建 registrant**：每个内建工具（`bash`、`read`、`search`、`web`、`write`/`edit`……）一个自足模块，各自注册自己的 React 组件，组件组合这些零件、并做自己的 wire→props。`ui-conversation` 收缩为聊天 chrome（消息、compaction、队列、输入）并挂载 slot。

**没有中央渲染分发，也没有中央 render-kind 联合。** keyed slot *就是*分发：每次工具调用通过以其工具名注册的组件渲染，没有注册时走通用兜底。改 `read` 的渲染就是改 `read` 这个 registrant 模块——它的组件和它的 wire→props——只依赖包里的零件；它不触及任何中央 switch、任何共享联合、任何其它工具。新增一个工具的渲染就是一个新 registrant，中央零改动。第三方工具作者只依赖这一个包、发布自己的 registrant。

一个验证视觉形态的交互原型（所有工具形态、各种压力用例）放在孤立的 assets 分支上、不进代码树：[`unified-list-of-blocks-mock.html`](https://github.com/deepseek-harness/deepseek-harness/blob/list-of-blocks-assets/unified-list-of-blocks-mock.html)。它是一次性的设计产物——以本 note 文本、而非原型，作为最终交付内容的权威。

### 零件：ToolCard / Segment / Group

包导出的是可组合的零件，不是一套强制层级。工具的组件按需取用：

```
ToolCard   — the card frame (border, padding, the transcript row shell)
  Segment  — one IN or OUT content unit: a [gutter][body] grid with an
             optional lamp, optional line-number gutter, per-segment scroll
             and copy. This is the core unit; most tools compose Segments
             directly.
  Group    — OPTIONAL. Bundles several Segments under one lamp, for a tool
             with more than one observable execution unit (multi-command
             bash; interactive rounds). A single-execution tool never uses it.
```

- `Segment` 是多数工具唯一会碰的零件。`read` 是 `ToolCard` → 一个 IN `Segment`（路径 + 范围）→ 一个 OUT `Segment`（带号的行）。没有 `Group`。
- `Group` 只在一个工具的单次调用里确实含多个执行单元时才用。它为那个单元承载灯；嵌套 `Group`（一种递归）留到以后（见 §递归整体延后）。
- `ToolCard` 是框。想重构整行的工具用 `ToolCard` 画自己的框（或替换它）；想要标准行的工具用默认组合 helper。行框在工具间的一致性是内建们遵循的约定，不是锁——这就是原则 2。

这些名字刻意避开早期草案撞上的两个冲突：它们**不是** `*Block` 叶子家族（`TerminalBlock` 等仍是 Segment 可内嵌的内容渲染器），而 `Group` **不是**会话模型的 `Turn`（`turn/start`/`turn/end`）。

词汇对工具中立：零件只认识 `Segment`、`role: 'in' | 'out'`、一个可选的灯、以及工具提供的内容——不认识 shell 词汇（`command`/`cwd`/`exitCode`），因为同一套零件必须承载一次文件读取、一个 diff、一次搜索查询、一个抓取的 URL。

### 灯：一套观察式推导，作为 helper 提供

包导出一个灯态函数，基于 harness 能观察到的东西；工具的 registrant 把结果喂给它、再把状态交给 `Segment` 或 `Group`。它替换今天四套独立的状态推导。工具可以传自己的状态，但共享 helper 才是让每个工具达成一致的东西：

- **`isError === false` → 绿（done）。** 完成本身就是可观察的信号。对*每个*工具的基线规则。
- **取消 → 琥珀（warn）。** 一次 dispatch 级中止会在*任何*工具的结果上持久化 `error.info.code` = `ABORTED`（或 `ABORTED_BEFORE_DISPATCH`）（[tools/index.ts:1180/1588/1602](../../../../packages/core/tools/src/index.ts#L1180)），无论是否终端类，所以一次被取消的 read、web、bash 都映射到琥珀。helper 在通用 error 规则*之前*检查这个 code，因为被取消的结果会以 `isError: true` 落定*并且*带着这个 code——红优先会误映。
- **error → 红。** 工具报了 `isError` 且没有 `ABORTED` code。
- **running → 蓝**（`ongoing` 那个像素追逐点）。
- **终端类卡片工具进一步细分**（bash，以及 Windows 上的 `tool-pwsh`，它们带同样的退出/信号/超时字段、且以 `isError: false` 落定一个非零退出）：`timedOut` → 琥珀；一个非源于我们超时/中止的终止 `signal` → 红（一次崩溃的 `SIGSEGV`，或一个外部 `SIGTERM`；我们为超时发出的 `SIGTERM` 已被琥珀规则拦下）；否则由退出码决定。
- **灰（neutral）** 只用在结果确实无法观察之处——一个交互 shell 回合、其结果尚无结构化通道（见下）。helper 绝不去解析一段 Traceback、为它观察不到的东西凭空造一个红灯。

归因只用 harness 自己的信号，绝不猜是谁发了某个 OS 信号。`timedOut` 存在 bash 结果值里、位于呈现器看不到的成功路径上，所以它搭上新的 bash 结构化结果。一条单 shell 的 bash 命令在跑到一半被中止时也会持久化 `ABORTED`——工具抛出 `HarnessError('tool call aborted', TOOL_ABORTED)`（[tool-bash/src/index.ts:385](../../../../packages/bash/tool-bash/src/index.ts#L385)，dispatch 前的臂在 :360）——所以它在回放时是琥珀，无需延后改动。`stopped` 行态读取的、客户端合成的 `interrupted` code（[tool-call-model.ts:215](../../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L215)，铸于 [history-fold.ts:304](../../../../packages/client/runtime/src/client/session-history/history-fold.ts#L304)）也映射到琥珀。还有三种已落定的中止形状仍无 code、在各自的 PR 落地前渲染成红：一次持久 shell 回合的中止（[tool-bash-persistent/src/index.ts:322-324](../../../../packages/pty/tool-bash-persistent/src/index.ts#L322)）、它的调用方中止（:393）、以及一次原始 PTY send 的中止（[tool-pty/src/index.ts:279](../../../../packages/pty/tool-pty/src/index.ts#L279)）；要让它们变琥珀，需各自持久化一个可区分的 code。

`warn`（琥珀）与 `neutral`（灰）是相对今天三态 `StateDot` 用法（`done`/`error`/`ongoing`）新增的两个态；琥珀的 token 已存在，灰今天既没有 `StateDotState` 成员也没有 CSS 规则，所以两者都要加。灯是纯颜色且 `aria-hidden`；每个都配一段对应的无障碍状态文本（沿用行的 `stateStatus` 模式），所以 done/error/running/warn/neutral 在无颜色时也能存活。

### 一个 Segment 给工具什么

一个 `Segment` 是一个 `[gutter][body]` 网格；工具提供 body，零件提供共享机制，让任何工具都不必重实现它们：

- **gutter，按 role 互斥。** 一个 IN segment 的 gutter 承载**灯**（最左、仅第一行）；一个 IN segment **永不承载行号**，即便有很多行（一段 heredoc 脚本、一个 `run_code` 程序体、一大坨 args JSON）——那些行是输入，不是文件内容。一个 OUT segment 的 gutter 只为展示*文件内容*的 OUT（read、grep、diff）承载**行号**（右对齐）；一个 diff 的 gutter 展示真实的旧/新行号，**不是** `+`/`-` 记号（红删/绿增给号和 body 上色；一行被删除和它的替换行可能显示同一个号）。非文件 OUT（bash 输出、web body、args JSON）让 gutter 留空。
- **每个 `ToolCard` 一个 gutter 宽**，`max(灯最小宽, 最宽行号)`，让每个 Segment 的 body 从同一列起始；对一个 6 位数自适应。行号始终可见，绝不 hover 才显。
- **逐 segment 滚动**：一个超过高度上限的 Segment 变成定高滚动区；行号随 body 滚动，灯钉在不滚动的外壳上。长行水平溢出；缩进绝不折叠。滚动条复用 ui-theme 的主题化滚动条 token 对（`--dsh-scrollbar-thumb`/`-hover`），而非自绘覆盖层，遵循[指针显隐滚动条那篇 note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md)：静止时 `transparent`，被指向时用该表面的 l2 对，画在预留的 gutter 上（[预留 gutter 那篇 note](../../implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)）所以什么都不位移。一个画在抬升表面上的 thumb 用 l2 对；一个静止的 `transparent` thumb 什么都不画、因而不欠 l2——即*隐藏不再算作抬升*那一条。
- **逐 segment 复制**（IN 和 OUT 各一个——复制命令和复制输出是分开的；没有整卡复制）。控件锚定在 segment 不滚动的右上角，hover / `:focus-within` / 触摸时显现。
- **字号**沿用现有卡片（13px/22px 的 `--dsw-font-*` 代码块 token），依设计评审。
- 一个 segment **不**渲染动词徽标（`READ`/`WRITE`）：工具行的图标和标题已经命名了工具。

空的和无输入的 segment 对称折叠：一个空的 OUT 把高度折到零但保留边框（两条相邻分隔线——「输出区，空」）；一个无输入的 OUT（一坨通用控制台转储）在它的第一行自己承载灯、且没有命令行。

### 每个工具作为一个 registrant

每个内建工具都是一个自足的 registrant 模块：一个组合零件的 React 组件、做自己的 wire→props，以其工具名 key 注册。下表是每个工具的组件渲染*什么*——不是一套中央的「kinds」：

| 工具 | IN | OUT | 灯 |
|---|---|---|---|
| bash（1 条命令） | prompt 行：cwd + command | 输出文本（无行号） | 退出/信号/超时/中止 |
| bash（N 条命令） | 原始 `command` 作为一条 prompt 行（单个 `command`；逐命令拆分是延后的 executor 改动） | 合并输出 | 今天整次调用一个灯；逐命令 `Group` 需延后的 executor 改动 |
| bash（交互式） | 该回合的 prompt 行 | 回合输出 | 每个回合是它自己的 `bash` 调用；逐回合 done/error 需持久 shell 工具的规范值先保留回合退出码（今天它只作为非零 `[exit code: N]` 记号进入持久化数据，而 `tool-bash-persistent` 没有结构化结果）——延后；在此之前灰 |
| read | 路径 + 行范围 | 带号文件行 | done/error |
| write / edit | `path` | 应用后的 diff，真实的（旧/）新行号 | done/error |
| grep | 查询 + 范围 | 匹配组（行号）+ 恢复定位（第 2 个 OUT） | done/error |
| web_search | 查询 | 答案 + 带号来源列表（可点的仅 `http(s)` 链接，复用 `SafeLink`） | done/error |
| web_fetch | url | 状态行（第 1 个 OUT）+ 抓取正文（第 2 个 OUT） | done/error |
| generic（兜底） | args JSON | 结果文本 | done/error |

一次**运行中**的调用渲染为一个 pending OUT 和一个蓝灯；IN 来自工具的 call view（`terminal` 的 command/cwd、`diff` 的 `FileDiff`、`read` 的 `kind`/`locations`）。一个只带 `title` 的 call view 把该 title 渲染为运行中的 IN——这是一个有界的降保真情形，各工具靠丰富自己的 `presentCall` 收口，而非新增一个 view。write/edit 保留运行态的调用时 diff（在途时把意图改动作为 OUT，落定时换成应用后的 diff）；代码变体的程序体（`run_code`、`cordis_mount`）渲染为一个等宽、语法高亮的 IN segment（无行号），复用仓库的 shiki 集成。

### 一个工具的两条路，没有声明式中间层

一个工具抵达 UI 恰好有两条路：

1. **写一个组件（主路）。** 工具的 registrant 组合零件——完全掌控、可孤立重构。内建工具走这条；想要便利的工具组合默认 helper；想重构一切的工具用 `ToolCard` 画自己的框。
2. **通用兜底（零代码）。** 一个没有 registrant 的工具，经包的通用 registrant 渲染为 IN = args JSON、OUT = 结果文本——所以它依然拿到灯、gutter、滚动、复制，而不是今天那个寒酸的 `ioCard`。

**没有中央 render-kind 联合，也没有声明式中间档。** 一个带中央 `assertNever` switch 的封闭 render-kind 联合曾被考虑并否决：新增一个 kind 是在共享 switch 处一处会打断编译的改动，而这恰恰就是「你无法孤立地改一个工具」——它违反原则 1。想共享内容渲染的工具，去**组合**现有的叶子组件（`ReadBlock`、`DiffBlock`、`TerminalBlock`、`CodeBlock`）到自己的 Segment 里；那是组合，不是中央 switch。

### 数据来源：可由文本重建的边界被保留

一个工具是否需要模型可见结果文本以外的结构化数据，本项工作不改变。bash 能从 args 和输出重建 `command`/`cwd`/退出，这正是为什么它是今天唯一*不*用 `presentationMeta` 的卡片（这里它会拿到一个，替换它 `parseExitStatus` 的文本往返）。read 的行号、search 的分组、web 的来源在文本里是有损的，所以它们搭 `presentationMeta`——那是唯一在回放中存活的结构化通道，因为 `ToolEventView` 从不持久化（[api/events.ts](../../../../packages/host/apiproxy/src/api/events.ts)）。一个 registrant 读工具的 call/result view（客户端从不直接看到 `presentationMeta`；它是宿主侧投影的输入）。不变式 **模型可见 ⟺ 已记录**（[AGENTS.md:100](../../../../AGENTS.md#L100)）成立：模型看到拍平的文本，UI 看到结构化 view，两者出自同一次执行。

### 递归整体延后

嵌套 `Group`——把一组执行折叠成一个可折叠单元、带一个聚合灯——**整体延后，类型里不留字段**：没有聚合规则、没有递归渲染器、没有组摘要。它需要跨五个灯态的状态聚合、一个 bash 不提供的组标题来源、一段本地化的折叠摘要——而促发的需求（多命令、交互）都不要求这些。真要做时，它作为一次会打断编译的类型扩展、连同它的消费方一起落地。

### 迁移形态

**PR 1 —— 抽包 + 零件 + bash + 一个工具。** 一个 stacked PR 序列（每步基于上一步），每步只做一件事：

1. **抽出 `@deepseek-ai/dsh-client-tool-render`。** 把 `conversation.chat.toolview` slot 声明和 registrant props 契约从 `ui-conversation/contract/slots.ts` 移进新包；`ui-conversation` 依赖它、仍挂载 slot。机械改动；无行为变化、无视觉变化。既有的逐工具 registrant 原样继续工作。
2. **零件**（`ToolCard`/`Segment`/`Group` + 默认 helper + 灯 helper）落在新包、构建于 `ui-primitives` 之上：一套灯推导、自适应 gutter、逐 segment 滚动 + 主题化滚动条、逐 segment 复制。组件单测 + 渲染快照，含一张多 `Group` 卡片以演练可选分组。
3. **bash** 转成一个组合零件的 registrant，配一个新的 bash `presentationMeta` 承载结构化结果（command、cwd、输出、退出/信号/超时/timedOut）。第一个真实工具——需要真实工具数据的快照/e2e 覆盖在这里落地。一次多命令调用今天是一个 `Group`（逐命令 `Group` 是延后的 executor 改动）。
4. **再一个工具**（read 或 search）转换，证明零件确实对工具中立、不是 bash 形状；配它自己的快照/e2e。

**PR 2 —— 转换其余工具并删除中央分发。** 零件验证过后，把其余每个工具转成自组合的 registrant——read/search 的剩余部分、write/edit、grep/glob、web_search/web_fetch、代码变体 `run_code`/`cordis_mount`、以及 `tool-pwsh`（同一终端形状）；持久 shell 和 PTY 工具在它们拿到结构化的逐回合结果后跟上。然后**删除中央链**：`ToolRow` 的三元、`DetailsPanel` 的 if/return 孪生、以及五个 `*-card-model` 全部消失——keyed slot 现在是唯一的分发。退掉逐 block 的 `.block` 几何和重复的 cap/copy 代码；统一 `CHAT_*` 常量；把 i18n 收进一个 labels 面。以逐工具组的 stack（write/edit；grep/glob；web）交付，因为单个约 8–10k 行的 PR 无法评审。

**PR 3 —— 侧边预览面板。** 一个可调宽、右侧停靠、单例的预览容器（点击替换，带二级展开到真正全屏），由今天的 `DetailsPanel` Output 面演化而来，由逐 segment 的 `⤢` 按钮打开。它渲染工具自己的 registrant 组件（不是另一套分发），因而免费继承每个工具的呈现。独立、优先级更低；前面的 PR 既不渲染也不引用它。

**以后** —— 一次联合多命令调用的逐命令 `Group` 捕获、持久/PTY 工具的结构化逐回合结果（两者都是 executor/backend 改动、零件已经容纳——一个生产方多发几个 `Group` / 一个值保留退出码）、嵌套 `Group` 递归、以及逐行为的状态形状（流式、后台任务、需审批、沙箱拒绝——新字段，各自作为一次会打断编译的扩展、连同其消费方一起）、以及能让持久/PTY 中止变琥珀的无 code 中止 code。每一项都随它服务的行为一起落地。

本 note 拥有的工作是 PR 1；PR 2（完整转换 + 删除中央分发）先于 PR 3（侧边预览面板）。

## 曾考虑的替代方案

- **一个拥有渲染的中央骨架，工具提供声明式 render kinds。** 这是早期草案：一个 `Block`/`Turn`/`Segment` 骨架、一个封闭 render-kind 联合、一个穷尽的 `assertNever` switch；工具靠挑 kind 来描述自己的 segment。依原则 1 否决：新增或改一个 kind 是在共享中央 switch 处一处会打断编译的改动，所以一个工具的呈现无法被孤立地改动——依原则 2 也否决：一个工具无法超出联合提供的 kind 去重构。归工具所有的模型保住了同样的*视觉*结果（组合零件）而没有那份中央耦合。

- **只把 bash 扩到多命令，另外四张卡片不动。** 否决：「输入是一个 title 字符串」「状态住在卡片外」「OUT 已经是两样东西」这些问题是跨工具共享的、不是 bash 专属，而中央分发链无论如何都要长出第六条臂。

- **一个扁平的 `Segment[]` 流，没有 `Group`。** 否决：它把「哪些 segment 属于同一次执行」从数据里删掉了，逼渲染器去推断分组；交互会话（一个进程、多个回合）就无法与相互独立的命令区分开。`Group` 是可选的，但在场时承载那个事实。

- **一个工具必须往里塞的强制中央卡壳（chrome 完全中央拥有）。** 依原则 2 否决：它把工具约束到外壳的排布里。包改为导出工具组合的零件、并给常见情形一个默认 helper——一致性靠约定，不靠锁。

- **逐工具的姊妹包（每个工具发布自己的渲染包）。** 因太重否决：后端工具包不能 import React，所以每个都要一个姊妹 client 包。一个抽出的渲染包、内含逐工具的 registrant 模块，以包数量的零头给到同样的隔离（改一个模块）。

- **展开为一个居中模态 / 全屏接管。** 否决，改用可调宽、右侧停靠的侧边预览面板（单例、点击替换、可选二级全屏）加逐 segment 滚动；该面板保持会话可见、并复用每个工具的 registrant。

- **自绘覆盖层滚动条。** 否决——与[指针显隐滚动条那篇 note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md) 同样的判断：它为一点装饰性收益，付出命中测试、拖拽、滚轮、惯性、以及两套调色板的 hover 态。零件改为复用 ui-theme 的 token 间接层。

## 验收标准

- `@deepseek-ai/dsh-client-tool-render` 存在，装着 `conversation.chat.toolview` slot 声明 + registrant props、`ToolCard`/`Segment`/`Group` 零件 + 默认 helper、以及灯 helper；`ui-conversation` 依赖它并挂载 slot。slot 抽取（PR 1a）不改行为、不改像素（快照不变）。
- bash 和另一个工具渲染为组合零件的 registrant；对这两个工具，四套当前状态推导被替换为一套灯 helper。
- bash 经 `presentationMeta` 承载它的结构化结果（command、cwd、输出、退出/信号/超时/timedOut）；它的 `parseExitStatus` 文本往返消失；模型可见的 bash 文本不变（快照）。一次单命令调用渲染为一个灯；一次联合多命令调用是一个 `Group`（逐命令 `Group` 是延后的 executor 改动）；单命令情形与今天的 `TerminalBlock` 视觉等价（快照）。
- 每个 `ToolCard` 一个 gutter 宽对齐每个 Segment 的 body；行号始终可见；空的和无输入的 segment 按规则折叠；逐 segment 的 IN/OUT 复制可用。
- 改一个已转换工具的渲染只触及那个工具的 registrant 模块（由 1d 不触及任何 bash 文件来演示）；PR 2 后不存在中央渲染分发、也不存在 render-kind 联合。
- 交付完整测试矩阵（unit per-file 100%、real-API e2e、keyless 快照、适用面上的 web 浏览器快照、smoke、CI gates、sandbox），含一个经真实可运行示例、断言组装后 transcript 的 keyless 快照。覆盖集中在含真实工具、能产出 transcript 的 PR 里。

## 风险

- **范围。** 这抽出一个包、重接每个工具的渲染路径、外加 host→client 的 view 流。它分阶段（抽包 → 零件 → bash → 一个工具 → 其余）以约束每个 PR，且 PR 1a（slot 抽取）行为与像素中立以降风险。
- **wire 不可信。** `sessions.schema.ts` 只校验 `for` + `card: string`；每个 registrant 都必须防御性地重新收窄自己的 view，否则一个畸形 payload 会让它那一行崩——这正是 card-model 今天保持的纪律，现在住进每个 registrant 里。
- **回放纯度。** registrant 和灯 helper 跑在实时和回放两条路上，必须保持是 view 的纯函数（args + result meta），无 I/O、时钟、会话状态（[adding-a-tool.md](../../../../docs/cookbook/adding-a-tool.md)）。
- **一致性靠约定。** 因为一个工具可以重构整行（原则 2），行到行的视觉一致性依赖内建们遵循默认 helper、而非一个中央锁；快照套件是抓住漂移行的东西。
- **放弃了什么。** 统一状态意味着今天*不*显示卡内状态的四张卡（只有 `TerminalBlock` 带一个）会拿到一个灯；对确实无法观察的结果，诚实的值是灰、绝不是伪造的绿。三样东西延后：一次联合多命令调用的逐命令 `Group`；一个结构化的逐回合结果、好让一次*成功*的持久/PTY 回合能读作 done（今天一次零退出的回合不留记号、且这些工具不带结构化结果，所以一个纯呈现器只能重建一次失败的持久 shell 回合、原始 PTY 回合一个都重建不了）；以及嵌套 `Group` 递归。在它们落地前，一次多命令调用是一个带一个灯的 `Group`，每个交互回合是它自己的卡片、非零退出显红、成功显灰。
- **AGENTS.md 漂移。** [AGENTS.md:116](../../../../AGENTS.md#L116) 仍列三种卡片 kind；render-intent 联合已经更多。本工作应在同一个 PR 里更新那一行和 render-intent 设计 note。

## 取代

本提案替换定制的卡片渲染器及其中央分发层，因而修订拥有那些决策的 Agent Note。是部分、而非完全：wire 词汇、`presentationMeta` 边界、通用兜底存活。其决策被本工作取代的 note 有：render-intent 联合（[2026-07-02-tool-render-intent-union.md](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)）与逐卡片记录（[2026-07-28-web-terminal-card.md](../../implemented/feature/2026-07-28-web-terminal-card.md)、[2026-07-30-web-read-card.md](../../implemented/feature/2026-07-30-web-read-card.md)、[2026-07-30-web-read-card-frontend.md](../../implemented/feature/2026-07-30-web-read-card-frontend.md)、[2026-07-30-web-search-card.md](../../implemented/feature/2026-07-30-web-search-card.md)、[2026-07-30-web-diff-card.md](../../implemented/feature/2026-07-30-web-diff-card.md)、[2026-07-30-search-render-card.md](../../implemented/feature/2026-07-30-search-render-card.md)、[2026-07-30-web-result-card.md](../../implemented/feature/2026-07-30-web-result-card.md)、[2026-07-30-web-result-card-frontend.md](../../implemented/feature/2026-07-30-web-result-card-frontend.md)、[2026-07-31-web-cards-toolrow.md](../../implemented/feature/2026-07-31-web-cards-toolrow.md)、[2026-07-30-web-tool-row-unified-expand-and-inspect.md](../../implemented/feature/2026-07-30-web-tool-row-unified-expand-and-inspect.md)、[2026-08-03-web-search-source-scroll.md](../../implemented/feature/2026-08-03-web-search-source-scroll.md)），外加[持久 PTY 会话](../../implemented/feature/2026-07-16-persistent-pty-sessions.md)里的渲染决策（不是它的 backend 或 executor 决策，指其 PTY 工具的 UI render intent）与 [pwsh 工具 bash 对齐](../../implemented/feature/2026-08-02-pwsh-tool-bash-parity.md)里的渲染决策（其 generic/terminal-card 呈现选择），以及 [Code Mode 聊天子调用行](../../implemented/feature/2026-07-26-code-mode-chat-subcall-rows.md)（`run_code` 子调用作为原生行）与[自指的 cordis 工具集](../../implemented/feature/2026-07-08-self-referential-cordis-toolset.md)（`cordis_mount` 的 generic 卡片加代码展开）里的代码变体渲染决策。每个被取代的 note 现在都带一条指向本提案的互反交叉链接、在本 PR 里加上——措辞为在本工作的迁移落地时*即将*部分取代，并在那之前指名该 note 为当前权威，所以该链接只断言一个为真的当下事实、而非一次尚未发生的取代。交叉链接与取代断言是两项分开的义务：note 契约要求在写 note 时就有链接（`.agents/notes/AGENTS.md`、README），而对每个被取代 note 的就地事实更新，在其自身的取代性迁移落地处才落地，只有合并整理才等落地——本次部分取代并不这么做。
