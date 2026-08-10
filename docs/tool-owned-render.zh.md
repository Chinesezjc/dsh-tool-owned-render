# Agent Note: 渲染归工具所有、基于 ui-tool 的增量——layout 零件、一套统一灯、以及结构化的 bash 结果

Status: proposed

[English](2026-08-03-unified-list-of-blocks-tool-render.md) | 中文

## 问题

[Client Tool 呈现所有权](../../implemented/architecture/2026-08-08-client-tool-presentation-ownership.md) 的决策落地了 `@deepseek-ai/dsh-client-ui-tool`：[ToolCallTree](../../../../packages/client/ui-tool/src/client/tool/ToolCallTree.tsx) 递归组合 root/subcall，每个原子工具经以 wire 工具名分发的 keyed `tool.call.toolview` slot 渲染，[GenericToolCard](../../../../packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx) 是兜底，逐工具的 card model 就在它们旁边。那个所有权边界在这里不在讨论之列；本 note 是它之上的一个增量。原子工具视图内部仍有四件事未解决：

- **状态被推导了两次，`*_ABORTED` 族被读成失败。** `toolRowModel` 推导行态（[tool-call-model.ts:199-201](../../../../packages/client/ui-tool/src/client/tool/models/tool-call-model.ts#L199)），随后 [GenericToolCard.tsx:45](../../../../packages/client/ui-tool/src/client/tool/toolviews/GenericToolCard.tsx#L45) 和 [bash-sample.tsx:64](../../../../packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx#L64) 又在其上各自重推导一遍同样的终端失败覆盖（[terminalFailed](../../../../packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts#L72)）——同一套两步推导写了两遍。`ToolRowState` 只把 `interrupted` 映射到琥珀（[tool-call-model.ts:20](../../../../packages/client/ui-tool/src/client/tool/models/tool-call-model.ts#L20)）；一个被取消的工具以其自有的 `*_ABORTED` code 落定（`TOOL_ABORTED` 来自 [tools/index.ts:1761](../../../../packages/core/tools/src/index.ts#L1761)，还有 `FS_ABORTED`、`WEB_ABORTED`、…）则落到 `isError: true` → 红，与一次崩溃无法区分，而一条超时的 bash 命令以非零退出落定、同样显红（`timedOut` 根本到不了灯）。

- **没有共享的卡片外壳。** 每个 registrant 手搓自己的行：[bash-sample.tsx](../../../../packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx) 自带 CSS module 和一个硬编码的 IN/OUT `ioCard`（:134-152）；read/search/web registrant 驱动共享的 [ToolRow](../../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx) chrome，但展开体仍是 ToolRow 的单卡种链（:159-160）加一个硬编码的文本 `ioCard`（:271-289）。没有一个可复用的 `Segment`，所以一个想要灯、行号、逐段滚动或逐段复制的工具就得各自重实现。`grep -rn CardShell` 仍是 0。

- **注册是七遍样板。** 每个内建 registrant 都写同一段 `ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ ... }, Component))` 句式，[`toolviews/`](../../../../packages/client/ui-tool/src/client/tool/toolviews/) 里七个 row 模块各一段——例如 [bash-sample.tsx:178](../../../../packages/client/ui-tool/src/client/tool/toolviews/bash-sample.tsx#L178)。toolview 溶解那篇 note 的 regret clause——registrant 涨到三个到五个、或出现批量注册形态时就建 facade——已经触发：现在有七个，而且交互 registrant 需要的那种有目标 fan-out（`ask_user_question`/`todo_write` 只在聊天里渲染一段 transcript 摘要、不渲染 details/preview 卡片）无法用原始句式表达。

- **bash 仍把它的退出状态经文本往返。** `presentBashResult` 对渲染后的结果调用 `parseExitStatus`，把 `[exit code: N]` / `[killed by signal: X]` 记号再拆出来（[tool-bash/index.ts:124-136](../../../../packages/bash/tool-bash/src/index.ts#L124)），所以终端结果视图携带 `exitCode`/`signal`、却不带 `timedOut`——canonical bash result 确实携带它（[index.ts:168](../../../../packages/bash/tool-bash/src/index.ts#L168)），但那是执行局部的规范值、不是视图。因此一条超时的命令在灯或退出码 pill 读视图的每一处都与崩溃无法区分。

促发这项需求的核心仍是本 note 早期草案命名的交互式、多命令 bash：一次 bash 调用跑好几条命令，而一个持久/交互会话在多个回合里交换 stdin/stdout。今天每一种这样的形状都是一块全新的定制变体（bash registrant 的 `ioCard`、持久 shell 的无 meta 文本路径），而非共享零件的组合。

## 提案

这是已实现 ui-tool 边界之上的一个增量，不是对它的替换。ui-tool 保留 `ToolCallTree` 递归、keyed `tool.call.toolview` 分发、作为渲染点兜底的 `GenericToolCard`、card model、以及 details 输出——[08-08 所有权表](../../implemented/architecture/2026-08-08-client-tool-presentation-ownership.md) 不变。本 note 加的是原子视图*底下*的共享层、外加需要它的两处工具改动：

1. **`registerToolView(ctx, { key, locale, inject?, views? }, component)`**——[toolview 溶解那篇 note](../../implemented/architecture/2026-07-23-toolview-dissolution.md) 带 regret clause 延后的 facade，现因 ui-tool 的七个 registrant 是它的天然用户而建。它转发 `slots.register` 的选项（`locale` seat 和可选的 `inject` 工厂），并把一个组件 fan-out 到 `views` 里点名的那些 toolview slot（默认：所有已声明的 per-view slot——chat、details、以及 PR 3 的 preview；fan-out 在 slot 被声明时重算，所以 PR 2 与 PR 3 的 slot 会随落地被覆盖）。一个 chat row 只是 transcript 摘要的交互 registrant 设 `views: ['chat']`。它仍是 `slots.register` 之上的糖——slot-name 收窄、tool→key 词汇、props 预组合、有目标的 fan-out——不引入平行注册表，遵守那篇 note 的「一个注册模型」决策。
2. **Layout 零件 `ToolCard` / `Segment`（`Group` 延后）**，供工具组合，替换每个 registrant 手搓的行、以及 ToolRow 硬编码的卡链和 `ioCard`。
3. **一套统一灯 helper**——每个 registrant 都喂它的、唯一的可观察状态推导，替换 `toolRowModel.state` + `terminalFailed` 那套两步重复。
4. **结构化的 bash `presentationMeta`**，让 `presentBashResult` 不再从渲染文本里解析 `[exit code: N]` 记号、且灯能看到 `timedOut`。

增量 2 和 3 住在一个新包里，`@deepseek-ai/dsh-client-tool-render`，一个 **plain platform lib**（shell-bundled、无逐 fiber HMR——`ui-primitives` 今天就是这个待遇，也是工具中立、无产品行为的叶子代码的正确待遇），登记在平台模块 seed 表里（[platform.ts `PLATFORM_MODULES`](../../../../packages/client/web/src/platform.ts#L8)），所以它的导出可被 `ui-tool` 和第三方 registrant 一样地静态值导入。增量 1（`registerToolView`）住在 `ui-tool`、紧挨它糖化的 `tool.call.toolview` slot 声明：它必须操作那个 slot 的类型化 props，而 platform lib 绝不能依赖 graph plugin 的 slot types。消费 facade 的内建 registrant 留在原地、在 `ui-tool`（一个 `dshClient` graph plugin）里，因为一个 registrant 携带产品行为、必须是 graph row 才能进 boot graph 并逐 fiber 热更。`ui-tool` 保留 card model 和原子视图；它给 render 包加一个依赖、并把每个内建 registrant 重写成经 facade 组合零件。

**仍然没有中央渲染分发、也没有客户端 render-kind 联合。** 每个视图里，该视图的 keyed toolview slot *就是*分发——ui-tool 已实现的安排，不变。registrant 注册表经 `registerToolView` 在各 per-view slot 间共享，所以聊天流、详情面板、PR 3 的预览面板都通过同一个 registrant 渲染一个工具。隔离承诺与早期草案相同、且现在在原子视图内部成立：**改**一个已有工具的渲染只编辑该工具的 registrant 模块（它的组件和 wire→props，只依赖 render 包的零件，不触及任何中央 switch、也不触及其它工具）；一个**第三方**工具发自己的 `dshClient` plugin、经原始 slot 句式挂自己的 registrant（`ctx.slots.inject('tool.call.toolview', …)` 加 `ctx.slots.register`，正是内建们今天写的那种形态），对每个想要覆盖的 per-view slot 各挂一次——聊天流的 `tool.call.toolview`、详情面板的 slot、预览的 slot 各不相同，所以只挂了 chat slot 的 registrant 在那里保持自己的呈现、在其它面板退回渲染点兜底——facade 是 ui-tool 自己 registrant 的糖，而第三方 plugin 在客户端 bundle purity gate 下不能 value-import 兄弟 plugin 的导出，所以 facade 在它够不到的地方、底下的 slot 注册对所有人仍是那个唯一注册模型；**新增一个内建**是装配器里一次 `registerToolView` 调用。

host 侧的视图词汇不动。`presentCall`/`presentResult` 仍返回 [presentation.ts](../../../../packages/core/tools/src/presentation.ts) 里闭合的 `ToolCallView`/`ToolResultView` 联合——那是实时和回放两条路上都在的、唯一的 host→client 投影。数据能装进某个已有 view 变体的工具无需中央改动；一个需要真正全新结构化载荷的工具扩那个闭合联合、和今天一模一样。`presentationMeta` 通道同样不动；增量 4 只是让 bash *用*它，不扩它。具体的联合改动有两处，走的都是本段已经允许的闭联合扩展路径。**`timedOut` 投影**：今天 `TerminalResultView` 只带 `output`/`exitCode`/`signal`，一条超时的命令无法经视图到达灯；PR 1b 给 `TerminalResultView` 加一个 `timedOut` 字段，由 `presentResult` 从结构化 meta 投影出来，这样灯从视图、而不是从原始 meta 读它。**`FileDiff` 起始行号扩展**：落定 diff 的真实旧/新行号要求 `FileDiff` 携带 `oldStart`/`newStart`，而今天 hunk 计算丢掉了它们；PR 2 把该扩展和 write/edit 迁移一起落地（见下方 diff gutter）。

一个验证视觉形态的交互原型（所有工具形态、各种压力用例）放在孤立的 assets 分支 `list-of-blocks-assets` 上、不进代码树，即 `unified-list-of-blocks-mock.html`。它是一次性的设计产物——以本 note 文本、而非原型，作为最终交付内容的权威。

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
- `Group` 只在一个工具的单次调用里确实含多个执行单元时才用。它为那个单元承载灯；嵌套 `Group`（一种递归）延后（见 §递归整体延后）。PR 1–3 里没有任何生产方发出 `Group`——多命令调用直接组合 Segment、每个交互回合各自成卡——所以 `Group` 零件本身**延后到它的首个生产方**（Later 的逐命令捕获 / 回合分组），随它服务的行为一起落地，而不是先发布一个还没人喂的抽象。它留在这里的词汇中，好让类型和布局在那个生产方到来前先设计好。
- `ToolCard` 是框。想重构整行的工具用 `ToolCard` 画自己的框（或替换它）；想要标准行的工具用默认组合 helper。行框在工具间的一致性是内建们遵循的约定，不是锁。

这些名字刻意避开早期草案撞上的两个冲突：它们**不是** `*Block` 叶子家族（`TerminalBlock`、`ReadBlock`、… 仍是 Segment 可内嵌的内容渲染器），而 `Group` **不是**会话模型的 `Turn`（`turn/start`/`turn/end`）。

词汇对工具中立：零件只认识 `Segment`、`role: 'in' | 'out'`、一个可选的灯、以及工具提供的内容——不认识 shell 词汇（`command`/`cwd`/`exitCode`），因为同一套零件必须承载一次文件读取、一个 diff、一次搜索查询、一个抓取的 URL。

### 灯：一套观察式推导，作为 helper 提供

包导出一个灯态函数，基于 harness 能观察到的东西；工具的 registrant 把结果喂给它、再把状态交给 `Segment` 或 `Group`。它替换 `GenericToolCard`/`bash-sample` 里的两步重复（问题陈述总共数到五套编码——ui-skill 的 `SkillRowState` 是第五套——但它是技能交互行的行级状态，按设计工具自有，不由灯 helper 替换）。工具可以传自己的状态，但共享 helper 才是让每个工具达成一致的东西。helper 按顺序检查——具体信号*先于*通用 `isError` 规则，因为被取消的结果和失败的终端命令都带着一个通用规则会误读的 `isError` 值：

- **取消或 interrupted → 琥珀（warn）。** 取消有两条路，都归琥珀。一是 registry 铸的 dispatch 级中止——`error.info.code` = `ABORTED`（一个已启动、抛出通用中止的 body，如 bash 的 `TOOL_ABORTED`）或 `ABORTED_BEFORE_DISPATCH`（[tools/index.ts:1761/:1775](../../../../packages/core/tools/src/index.ts#L1761)）。二是**工具自有的 abort 码**——一个协作式取消的工具把它作为自己的 `isError` 结果 return，registry 保留它、而非改写成 `ABORTED`：`FS_ABORTED`（read/write/edit）、`SEARCH_ABORTED`（grep/glob）、`WEB_ABORTED`（web）、`ASK_ABORTED`、`SESSION_QUERY_ABORTED`。helper 匹配整个 `*_ABORTED` 族，外加 `stopped` 行态读取的、客户端合成的 `interrupted` code（[history-fold.ts:266](../../../../packages/client/runtime/src/client/session-history/history-fold.ts#L266)），所以被取消的 read、grep、web、bash 都映射到琥珀。它跑在客户端节点上——`appendToolResult` 已把服务端的 `error.info` 扁平化到事件的 `error`——所以它读的 code 在 `block.error.code`，不是服务端的 `error.info.code`。最先检查，因为被取消/中断的结果会以 `isError: true` 落定*并且*带着这个 code——下面的通用 error 规则会把它误映成红。
- **终端类卡片工具按退出信号细分**（bash，以及 Windows 上的 `tool-pwsh`，它们带同样的退出/信号/超时字段、且以 `isError: false` 落定一个非零退出）：`timedOut` → 琥珀；一个非源于我们超时/中止的终止 `signal` → 红（一次崩溃的 `SIGSEGV`，或一个外部 `SIGTERM`）；否则由退出码决定（`0` → 绿，非零 → 红）。在通用成功规则之前检查，因为一个非零退出以 `isError: false` 落定、否则会被读成绿。`timedOut` 臂依赖增量 4：今天 `timedOut` 到不了客户端视图，所以在 bash 的结构化结果落地前，一条超时的命令读作信号/退出红——一个有据可查的有界缺口，由 PR 1b 收口。
- **running → 蓝**（`ongoing` 那个像素追逐点）。
- **通用——其它每个工具：`isError === false` → 绿（done），否则 → 红。** 完成本身就是可观察的信号；这是基线规则，只在上面那些具体检查之后才到达。
- **灰（neutral）** 只用在结果确实无法观察之处——一个交互 shell 回合、其结果尚无结构化通道（见下）。helper 绝不去解析一段 Traceback、为它观察不到的东西凭空造一个红灯。

归因只用 harness 自己的信号，绝不猜是谁发了某个 OS 信号。一条单 shell 的 bash 命令在跑到一半被中止时持久化 `ABORTED`——工具抛出 `HarnessError('tool call aborted', TOOL_ABORTED)`（[tool-bash/index.ts:385](../../../../packages/bash/tool-bash/src/index.ts#L385)，dispatch 前的臂在 :360）——所以它在回放时是琥珀，无需延后改动。客户端合成的 `interrupted` code 也映射到琥珀。还有三种已落定的中止形状仍无 code、在各自的 PR 落地前渲染成红：一次持久 shell 回合的中止（[tool-bash-persistent/index.ts:322-323](../../../../packages/pty/tool-bash-persistent/src/index.ts#L322)）、一次原始 PTY send 的中止（[tool-pty/index.ts:279](../../../../packages/pty/tool-pty/src/index.ts#L279)）、以及持久 shell 排队后、执行前的那次 caller 中止（[tool-bash-persistent/index.ts:393](../../../../packages/pty/tool-bash-persistent/src/index.ts#L393)）——`exec.signal.throwIfAborted()` 抛出一个裸 `DOMException` `AbortError`，被 `toolErrorResult`（[tools/index.ts:1705-1713](../../../../packages/core/tools/src/index.ts#L1705)）转成无 `info` code 的结果，所以它同样以无可区分 code 的方式渲染成红；要让它们变琥珀，需各自持久化一个可区分的 code。

`neutral`（灰）是相对今天 `StateDot` 成员新增的唯一一个态：`warning`（琥珀）今天已是 `StateDotState` 成员并有 CSS 规则（`stopped` 行在用），所以 helper 返回现有的 `warning`；只有灰需要新增成员和规则。灯是纯颜色且 `aria-hidden`；每个都配一段对应的无障碍状态文本（沿用行的 `stateStatus` 模式），所以 done/error/running/warn/neutral 在无颜色时也能存活。

### 一个 Segment 给工具什么

一个 `Segment` 是一个 `[gutter][body]` 网格；工具提供 body，零件提供共享机制，让任何工具都不必重实现它们：

- **gutter，按 role 互斥。** 一个 IN segment 的 gutter 承载**灯**（最左、仅第一行）；一个 IN segment **永不承载行号**，即便有很多行（一段 heredoc 脚本、一个 `run_code` 程序体、一大坨 args JSON）——那些行是输入，不是文件内容。一个 OUT segment 的 gutter 只为展示*文件内容*的 OUT（read、grep、diff）承载**行号**（右对齐）；一个 diff 的 gutter 展示真实的旧/新行号，**不是** `+`/`-` 记号（红删/绿增给号和 body 上色；一行被删除和它的替换行可能显示同一个号）。diff 的真实旧/新行号要求 `FileDiff` 载荷携带它们——今天它只有 `path`/`oldText`/`newText`、hunk 计算丢弃 `oldStart`/`newStart`——这是一项随 PR 2 write/edit 迁移一起暂存的 presentation 契约扩展。非文件 OUT（bash 输出、web body、args JSON）让 gutter 留空。
- **每个 `ToolCard` 一个 gutter 宽**，`max(灯最小宽, 最宽行号)`，让每个 Segment 的 body 从同一列起始；对一个 6 位数自适应。行号始终可见，绝不 hover 才显。
- **逐 segment 滚动**：一个超过高度上限的 Segment 变成定高滚动区；行号随 body 滚动，灯钉在不滚动的外壳上。长行水平溢出；缩进绝不折叠。滚动条复用 ui-theme 的主题化滚动条 token 对（`--dsh-scrollbar-thumb`/`-hover`），而非自绘覆盖层，遵循[指针显隐滚动条那篇 note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md)：静止时 `transparent`，被指向时用该表面的 l2 对，画在预留的 gutter 上（[预留 gutter 那篇 note](../../implemented/bug-fix/2026-07-28-themed-scrollbars-and-reserved-gutter.md)）所以什么都不位移。一个画在抬升表面上的 thumb 用 l2 对；一个静止的 `transparent` thumb 什么都不画、因而不欠 l2——即*隐藏不再算作抬升*那一条。
- **逐 segment 复制**（IN 和 OUT 各一个——复制命令和复制输出是分开的；没有整卡复制）。控件锚定在 segment 不滚动的右上角，hover / `:focus-within` / 触摸时显现。
- **字号**沿用现有卡片（13px/22px 的 `--dsw-font-*` 代码块 token），依设计评审。
- 一个 segment **不**渲染动词徽标（`READ`/`WRITE`）：工具行的图标和标题已经命名了工具。

空的和无输入的 segment 对称折叠：一个空的 OUT 把高度折到零但保留边框（两条相邻分隔线——「输出区，空」）；一个无输入的 OUT（一坨通用控制台转储）在它的第一行自己承载灯、且没有命令行。

### 每个工具作为一个 registrant

每个内建工具都是一个自足的 registrant 模块：一个组合零件的 React 组件、做自己的 wire→props，经 facade 注册。下表是每个工具的组件渲染*什么*——不是一套中央的「kinds」：

| 工具 | IN | OUT | 灯 |
|---|---|---|---|
| bash（1 条命令） | prompt 行：cwd + command | 输出文本（无行号） | 退出/信号/超时/中止 |
| bash（N 条命令） | 原始 `command` 作为一条 prompt 行（单个 `command`；逐命令拆分是延后的 executor 改动） | 合并输出 | 今天不用 `Group`——一个可观察结果、一个灯、直接组合 Segment；逐命令 `Group` 需延后的 executor 改动 |
| bash（交互式） | 该回合的 prompt 行 | 回合输出 | 每个回合是它自己的 `bash` 调用；逐回合 done/error 需持久 shell 工具的规范值先保留回合退出码（今天它只作为非零 `[exit code: N]` 记号进入持久化数据，而 `tool-bash-persistent` 没有结构化结果）——延后；在此之前灰 |
| read | 路径 + 行范围 | 带号文件行 | done/error |
| write / edit | `path` | 应用后的 diff，真实的（旧/）新行号 | done/error |
| grep | 查询 + 范围 | 匹配组（行号）+ 恢复定位（第 2 个 OUT） | done/error |
| web_search | 查询 | 答案 + 带号来源列表（可点的仅 `http(s)` 链接，复用 `SafeLink`） | done/error |
| web_fetch | url | 状态行（第 1 个 OUT）+ 抓取正文（第 2 个 OUT） | done/error |
| generic（兜底） | args JSON | 结果文本 | done/error |

一次**运行中**的调用渲染为一个 pending OUT 和一个蓝灯；IN 来自工具的 call view（`terminal` 的 command/cwd、`diff` 的 `FileDiff`、`read` 的 `kind`/`locations`）。一个只带 `title` 的 call view 把该 title 渲染为运行中的 IN——一个有界的降保真情形，各工具靠丰富自己的 `presentCall` 收口，而非新增一个 view。write/edit 保留运行态的调用时 diff（在途时把意图改动作为 OUT，落定时换成应用后的 diff）；运行态的 diff **不承载行号**——`oldStart`/`newStart` 只存在于已执行 hunk 的元数据里，`presentCall` 无从得知，所以真实的旧/新 gutter 只在落定时出现（落定 diff 的行号来自该迁移扩展后的 `FileDiff` 载荷）。代码变体的程序体（`run_code`、`cordis_mount`）渲染为一个等宽 IN segment（无行号），复用仓库的 code block。今天 ToolRow 用 `CodeBlock`、硬编码 `lang="typescript"` 渲染这个 body（[ToolRow.tsx:265-267](../../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx#L265)，code 变体的 body 是 `args.code`，[tool-call-model.ts:181-184](../../../../packages/client/ui-tool/src/client/tool/models/tool-call-model.ts#L181)）——这个 grammar 对 Python flavor 是错的，因为 flavor 在 schema 发射时从 mounted runtime 解析、绝不在 args 里。registrant 改为渲染纯等宽文本，**刻意放弃**那个硬编码 grammar——一个有界的视觉回归，按其他 bounded gap 的写法标记：code 卡失去今天的高亮，而那高亮本就把 Python 错高亮成 TypeScript。view 里无从推导 Shiki grammar：`run_code` 的 `presentCall` 只带 `title`/`kind`/`rawInput`、没有语言提示（[code-mode.ts:643-648](../../../../packages/core/tools/src/code-mode.ts#L643)），且 `kind` 是操作类别（两个 flavor 下都是 `'execute'`），绝不是语言。命名语言是 host 侧契约改动，args-only presenter 拿不到——flavor 是 host 运行时状态，在 schema 发射时经 `resolveFlavor(peekRuntime)` 解析——所以等宽渲染一直保持，直到语言到达 call view。

### 一个工具的两条路，没有声明式中间层

一个工具抵达 UI 恰好有两条路：

1. **写一个组件（主路）。** 工具的 registrant 组合零件——完全掌控、可孤立重构。内建工具走这条；想要便利的工具组合默认 helper；想重构一切的工具用 `ToolCard` 画自己的框。
2. **通用兜底（零代码）。** 一个没有 registrant 的工具渲染为 IN = args JSON、OUT = 结果文本，经 slot outlet 的 `fallback`（装配器把 `GenericToolCard` 作为 `opts.fallback` 传入；keyed 注册强制要一个具体 `key`，所以通用路径是渲染点 fallback、不是一个已注册组件）——所以它依然拿到灯、gutter、滚动、复制，而不是今天那个寒酸的 `ioCard`。

**没有中央 render-kind 联合，也没有声明式中间档。** 一个带中央 `assertNever` switch 的封闭 render-kind 联合曾被考虑并否决：新增一个 kind 是在共享 switch 处一处会打断编译的改动，而这恰恰就是「你无法孤立地改一个工具」。想共享内容渲染的工具，去**组合**现有的叶子组件（`ReadBlock`、`DiffBlock`、`TerminalBlock`、`CodeBlock`）到自己的 Segment 里；那是组合，不是中央 switch。

### 数据来源：可由文本重建的边界被保留

一个工具是否需要模型可见结果文本以外的结构化数据，本项工作不改变。bash 能从 args 和输出重建 `command` 和退出——`cwd` 来自 call view 的 workdir、由 bridge 按 session cwd 解析（相对或省略的 workdir 在执行器/bridge 里解析，纯 presenter 看不到）——这正是为什么它是今天唯一*不*用 `presentationMeta` 的卡片（这里它会拿到一个，替换它 `parseExitStatus` 的文本往返）。read 的行号、search 的分组、web 的来源在文本里是有损的，所以它们搭 `presentationMeta`——那是唯一在回放中存活的结构化通道，因为 `ToolEventView` 从不持久化。一个 registrant 读工具的 call/result view（客户端从不直接看到 `presentationMeta`；它是宿主侧投影的输入）。不变式 **模型可见 ⟺ 已记录**（[AGENTS.md §Conventions](../../../../AGENTS.md#conventions)）成立：模型看到拍平的文本，UI 看到结构化 view，两者出自同一次执行。`run_code` 子调用是这个通道不覆盖的一个形状：它的 `presentationMeta` 被跳过，`tool/code-dispatch` 只记录 arguments/isError/content（[code-mode.ts:508-519](../../../../packages/core/tools/src/code-mode.ts#L508)），所以客户端的子调用 view 是 null（[tool.ts:90](../../../../packages/client/ui-conversation/src/client/conversation-nodes/tool.ts#L90)）——但子调用仍然走同一个 keyed toolview slot，所以一个已注册的 key 以 null view 认领它、灯只能报告 null-view 形状暴露的东西（`isError: true` → 红）。null-view 子调用形状在 PR 1b 补上之前无人拥有；在此之前，一个被取消的子调用诚实地读红、绝不读琥珀，因为没有任何东西持久化它的 abort code。

### 递归整体延后

嵌套 `Group`——把一组执行折叠成一个可折叠单元、带一个聚合灯——**整体延后，类型里不留字段**：没有聚合规则、没有递归渲染器、没有组摘要。它需要跨五个灯态的状态聚合、一个 bash 不提供的组标题来源、一段本地化的折叠摘要——而促发的需求（多命令、交互）都不要求这些。真要做时，它作为一次会打断编译的类型扩展、连同它的消费方一起落地。

### 迁移形态

**PR 1 —— 抽包 + 零件 + bash + 一个工具。** 一个 stacked PR 序列（每步基于上一步），每步只做一件事：

1. **抽出 `@deepseek-ai/dsh-client-tool-render`。** 一个 plain platform lib，装着零件（`ToolCard`、`Segment`、延后 `Group` 的词汇、默认 helper）和灯 helper。无行为变化：还没人消费它们，ui-tool 未动。
2. **bash** 转成一个组合零件的 registrant，配一个新的 bash `presentationMeta` 承载结构化结果（command、输出、退出/信号/超时/timedOut——cwd 不进投影：`presentationMeta` 是 args 和 canonical value 的纯函数，canonical bash result 不带 cwd，解析后的 workdir 从不进入 value；cwd 从 call view 渲染，由 bridge 按 session cwd 解析）。第一个真实工具——需要真实工具数据的快照/e2e 覆盖在这里落地。一次多命令调用今天直接在一个灯下组合 Segment、不用 `Group`（逐命令 `Group` 是延后的 executor 改动）。注册一个 `bash` 组件会**对每个** `bash` 结果都压掉未注册 fallback，所以这一个 registrant 必须覆盖 bash 的全部形态、不止结构化前台那个：(a) 经新 meta 的结构化前台结果；(b) `tool-bash-persistent`——它也注册工具名 `bash`、且没有 `presentationMeta`（纯字符串输出、只有 `render`）——走**无 meta 的文本可重建路径**：command 从 args、exit 从 `[exit code: N]` 记号，但**不含 cwd**：跑过 `cd` 的持久 shell，其当前目录不在 args、输出、也不在 session cwd（那只是初始工作区）里，所以**它无法在那里被重建**，而且结构化 meta 从不携带 cwd（它是 args 和 canonical value 的纯投影），所以持久 shell 的 cwd 一律省略——registrant 绝不能渲染 bridge 的默认解析，因为省略的 workdir 会解析到会话的*初始* cwd（[terminal-card-model.ts:89](../../../../packages/client/ui-tool/src/client/tool/models/terminal-card-model.ts#L89)），在 `cd` 之后这是错的；(c) 一次 `run_in_background` 调用——它今天 call/result view 走 `generic` 带 task id、其轮询/task-id 形态 registrant 必须渲染，因为 generic fallback 不再触发；(d) `run_code` 子调用，它的 call/result view 都是 null——registrant 必须渲染 null-view 形状，使子调用行保持诚实（它还无法变琥珀：没有任何东西持久化 abort code，见 §数据来源）；以及 (e) 一次**失败的前台调用**，`presentBashResult` 把它渲染为通用错误 view（spawn、审批或执行失败——`isError` 落到 generic 卡、而非结构化 terminal 卡，[tool-bash/index.ts:124-135](../../../../packages/bash/tool-bash/src/index.ts#L124)），所以 registrant 必须自己渲染 generic 错误 view 的文本（组合 generic 呈现——渲染点兜底对已注册 key 不再触发），不能假定每条 `bash` 结果都携带结构化形状。PR 1b 五种都测。它不能假定新 meta 存在、也不能删 `parseExitStatus`——`@deepseek-ai/dsh-bash` 的 seam 导出在 PR 1b 之后继续存在，因为 `tool-pwsh` 在自己 PR 2 迁移前仍消费它（[index.ts:37](../../../../packages/bash/tool-pwsh/src/index.ts#L37)）。`tool-bash-persistent` 不是消费方——它不依赖任何 bash 包、自己写 `[exit code: N]` 记号（[index.ts:177](../../../../packages/pty/tool-bash-persistent/src/index.ts#L177)），这也正是它那条无 meta 路径要从记号文本、而非从共享 parser 重建退出的原因。
3. **ui-tool 里的 `registerToolView` + 采纳（PR 1c）**：先实现它糖化的 slot 声明旁的 facade，再把七个内建 registrant 重写经它——`ask_user_question`/`todo_write` 的有目标 fan-out（`views: ['chat']`）在这里落地。机械改动、无视觉变化；每个 registrant 的组件不变（facade 只是他们今天已写的那段原始句式的糖）。
4. **再一个工具**（read 或 search）转换，证明零件确实对工具中立、不是 bash 形状；配它自己的快照/e2e。

**PR 2 —— 转换其余工具；把零件折进通用路径。** 零件验证过后，把其余每个工具转成自组合的 registrant——read/search 的剩余部分、write/edit、grep/glob、web_search/web_fetch、代码变体 `run_code`/`cordis_mount`、以及 `tool-pwsh`（同一终端形状）；`str_replace_editor` 和 `terminal_send` 今天是没有 keyed registrant 的活视图生产方，所以在退掉 ToolRow 的单卡种链的同一变更里，每个都必须获得一个 registrant（或显式声明退化到 generic 兜底）——否则它们的行会静默退化；持久 shell 和 PTY 工具在它们拿到结构化的逐回合结果后跟上。然后**删除中央卡链**：`ToolRow` 的卡种三元（:159-160）和它硬编码的 `ioCard`（:271-289）消失——详情面板保留自己的 per-view slot、经它渲染共享的 registrant，于是每个视图内它自己的 toolview slot 是唯一分发。退掉逐 block 的 `.block` 几何和重复的 cap/copy 代码；统一 `CHAT_*` 常量；把 i18n 收进一个 labels 面。每次转换也拥有自己的 `run_code` 子调用形状：PR 1b 为 `bash` 定义了 null-view 形状（形状 d），之后每个 registrant 都通过同一个 keyed 分发认领自己的子调用，所以每次 PR 2 转换都必须以同样方式渲染（或显式拒绝）自己的 null-view 子调用行。以逐工具组的 stack（write/edit；grep/glob；web）交付，因为单个约 8–10k 行的 PR 无法评审。

**PR 3 —— 侧边预览面板。** 一个可调宽、右侧停靠、单例的预览容器（点击替换，带二级展开到真正全屏），由今天的 `DetailsPanel` Output 面演化而来，由逐 segment 的 `⤢` 按钮打开。它声明自己的 per-view toolview slot、经它渲染工具自己的 registrant（不是另一套分发），因而免费继承每个工具的呈现。独立、优先级更低；前面的 PR 既不渲染也不引用它。

**以后** —— 一次联合多命令调用的逐命令 `Group` 捕获、持久/PTY 工具的结构化逐回合结果（两者都是 executor/backend 改动、零件已经容纳——一个生产方多发几个 `Group` / 一个值保留退出码）、嵌套 `Group` 递归、逐行为的状态形状（流式、后台任务、需审批、沙箱拒绝——新字段，各自作为一次会打断编译的扩展、连同其消费方一起）、给当前仍无 code 的中止形状补上 code（补上后能让持久/PTY 中止变琥珀）、以及 `run_code` 子调用的持久化 abort code（补上后能让被取消的子调用变琥珀）。每一项都随它服务的行为一起落地。

本 note 拥有的工作是 PR 1；PR 2（完整转换 + 删除中央卡链）先于 PR 3（侧边预览面板）。

## 曾考虑的替代方案

- **一个拥有渲染的中央骨架，工具提供声明式 render kinds。** 这是早期草案：一个 `Block`/`Turn`/`Segment` 骨架、一个封闭 render-kind 联合、一个穷尽的 `assertNever` switch；工具靠挑 kind 来描述自己的 segment。依隔离承诺否决：新增或改一个 kind 是在共享中央 switch 处一处会打断编译的改动，所以一个工具的呈现无法被孤立地改动。归工具所有的模型保住了同样的*视觉*结果（组合零件）而没有那份中央耦合。

- **把零件和灯直接折进 `ui-tool`，不建新包。** 否决：ui-tool 是一个 `dshClient` graph plugin（逐 fiber HMR、boot graph），是携带产品行为的 registrant 的正确家园，却是工具中立叶子代码的错误家园——一个 shell-bundled 的 platform lib 随 shell 重建更新、且可被第三方 registrant 静态值导入，无需加入 plugin graph。`ui-primitives` 已经建模的平台/plugin 划分保持。

- **只把 bash 扩到多命令，另外的卡片不动。** 否决：「状态住在卡片外」「没有共享 IN/OUT」「注册样板」这些问题是跨工具共享的、不是 bash 专属。

- **一个扁平的 `Segment[]` 流，没有 `Group`。** 否决：它把「哪些 segment 属于同一次执行」从数据里删掉了，逼渲染器去推断分组；交互会话（一个进程、多个回合）就无法与相互独立的命令区分开。`Group` 是可选的，但在场时承载那个事实。

- **一个工具必须往里塞的强制中央卡壳（chrome 完全中央拥有）。** 否决：它把工具约束到外壳的排布里。包改为导出工具组合的零件、并给常见情形一个默认 helper——一致性靠约定，不靠锁。

- **逐工具的姊妹包（每个工具发布自己的渲染包）。** 因太重否决：后端工具包不能 import React，所以每个都要一个姊妹 client 包。一个 render 包、加上住在 ui-tool 里的逐工具 registrant 模块，以包数量的零头给到同样的隔离（改一个模块）。

- **一个面板直接查询的全局 registrant 注册表（旁路查找）。** 否决：那会让详情/预览面板绕开 slot 系统、按工具名解析组件——绕过注册即 effect、disposal、session scope，还招来 slot 契约禁止的跨插件 import 组件 / 传 `ReactNode`。per-view toolview slot 家族加 `registerToolView` 让每个面板拿到同一批 registrant 而仍待在契约内；注册表*就是* slot，经每个视图自己的渲染点查询。

- **展开为一个居中模态 / 全屏接管。** 否决，改用可调宽、右侧停靠的侧边预览面板（单例、点击替换、可选二级全屏）加逐 segment 滚动；该面板保持会话可见、并复用每个工具的 registrant。

- **自绘覆盖层滚动条。** 否决——与[指针显隐滚动条那篇 note](../../implemented/feature/2026-08-04-pointer-revealed-sidebar-scrollbars.md) 同样的判断：它为一点装饰性收益，付出命中测试、拖拽、滚轮、惯性、以及两套调色板的 hover 态。零件改为复用 ui-theme 的 token 间接层。

## 验收标准

- `@deepseek-ai/dsh-client-tool-render` 存在，装着 `ToolCard` 和 `Segment` 零件 + 默认 helper（`Group` 零件随它的首个生产方落地）和灯 helper；`ui-tool` 依赖它、并像今天一样挂载 toolview slot。抽包（PR 1a）不改行为、不改像素（快照不变）。
- bash 和另一个工具渲染为组合零件的 registrant；对这两个工具，`GenericToolCard` 和 `bash-sample` 里的两步状态推导被替换为一套灯 helper（ui-skill 的 `SkillRowState` 保持工具自有——问题陈述把它计为第五套编码，但灯 helper 不取代它）。
- bash 经 `presentationMeta` 承载它的结构化结果（command、输出、退出/信号/超时/timedOut——cwd 不进投影：`presentationMeta` 是 args 和 canonical value 的纯函数，canonical bash result 不带 cwd，解析后的 workdir 从不进入 value；cwd 从 call view 渲染，由 bridge 按 session cwd 解析）；它的 `parseExitStatus` 文本往返消失；模型可见的 bash 文本不变（快照）。一次单命令调用渲染为一个灯；一次联合多命令调用直接在一个灯下组合 Segment、不用 `Group`（逐命令 `Group` 是延后的 executor 改动）；单命令情形与今天的 `TerminalBlock` 视觉等价（快照）。
- 七个内建 registrant 经 `registerToolView` 注册；`ask_user_question` 和 `todo_write` 设 `views: ['chat']`（快照不变）。
- 每个 `ToolCard` 一个 gutter 宽对齐每个 Segment 的 body；行号始终可见；空的和无输入的 segment 按规则折叠；逐 segment 的 IN/OUT 复制可用。
- 改一个已转换工具的渲染只触及那个工具的 registrant 模块（由 1d 不触及任何 bash 文件来演示）；PR 2 后不存在中央渲染分发、也不存在客户端 render-kind 联合（host 侧的 `ToolCallView`/`ToolResultView` 联合和 ui-tool 的 keyed slot 分发保留，依提案对增量的范围限定）。
- 交付完整测试矩阵（unit per-file 100%、real-API e2e、keyless 快照、适用面上的 web 浏览器快照、smoke、CI gates、sandbox），含一个经真实可运行示例、断言组装后 transcript 的 keyless 快照。覆盖集中在含真实工具、能产出 transcript 的 PR 里。

## 风险

- **范围。** 这新增一个包、把每个 registrant 重写经一个 facade 和零件、并退掉 ToolRow 的卡链。它分阶段（抽包 → bash → facade 采纳 → 一个工具 → 其余）以约束每个 PR，且 PR 1a（抽包）行为与像素中立以降风险。
- **wire 不可信。** `sessions.schema.ts` 只校验 `for` + `card: string`；每个 registrant 都必须防御性地重新收窄自己的 view，否则一个畸形 payload 会让它那一行崩——这正是 card model 今天保持的纪律，现在住进每个 registrant 里。
- **一个 key、两个生产方。** `bash` key 由 `tool-bash` 与 `tool-bash-persistent` 共享（部署挂哪个是哪个），所以 `bash` registrant 从 PR 1b 起就同时渲染两者——它没法等持久工具那份延后的结构化结果。它的无 meta 文本可重建路径不是可选的润色，而是持久生产方所依赖的兼容形态；PR 1b 负责测它。（`tool-pwsh` 今天没有 keyed `pwsh` registrant、到自己的 PR 2 迁移前保持自己的宿主侧 presenter，所以 `bash` registrant 绝不渲染它——keyed 分发按 wire 工具名、`pwsh` ≠ `bash`，而它消费的共享 `parseExitStatus` seam 是代码、不是渲染路径。）
- **回放窗口里 call 落在窗外。** 一个分页回放窗口可能从一个 `tool/result` 开始、而它的 `tool/call` 落在窗外；Host 跳过 `presentResult`、客户端节点 `call: null`，所以通用 fallback 没有 args JSON、bash 的 no-meta 路径也没有 `command` 可重建。两者对该节点降级为只渲染结果文本（无 IN 段），直到向上翻页把 call 带进来——一个有界、自愈的降级，不是错误渲染。
- **回放纯度。** presentation 方法和灯 helper 跑在实时和回放两条路上，必须是显式传入输入的纯函数——无 I/O、时钟、会话状态（纯度契约覆盖 presentation 方法，[AGENTS.md §Conventions](../../../../AGENTS.md#conventions)，[adding-a-tool.md](../../../../docs/cookbook/adding-a-tool.md)）。两种输入不同：**presenter** 保持为 view（args + result meta）的纯函数；**灯 helper** 是客户端冻结 `ToolCallBlock` 的纯函数——从它抽出的最小状态记录，因为它的通用失败和取消分支读 `ToolResultNode.isError` 和 `block.error.code`，二者都不在 `ToolResultView`、也不在 args/meta 里（见数据来源一节）。registrant 是消费显式传入快照的 UI adapter。
- **一致性靠约定。** 因为一个工具可以重构整行，行到行的视觉一致性依赖内建们遵循默认 helper、而非一个中央锁；快照套件是抓住漂移行的东西。
- **放弃了什么。** 统一状态意味着今天*不*显示卡内状态的工具行会拿到一个灯；对确实无法观察的结果，诚实的值是灰、绝不是伪造的绿。四样东西延后：一次联合多命令调用的逐命令 `Group`；一个结构化的逐回合结果、好让一次*成功*的持久/PTY 回合能读作 done（今天一次零退出的回合不留记号、且这些工具不带结构化结果，所以一个纯呈现器只能重建一次失败的持久 shell 回合、原始 PTY 回合一个都重建不了）；嵌套 `Group` 递归；以及 `run_code` 子调用的持久化 abort code，所以一个被取消的子调用保持诚实显红、而非琥珀。在它们落地前，一次多命令调用直接在一个灯下组合 Segment（不用 `Group`），每个交互回合是它自己的卡片、非零退出显红、成功显灰，一条超时的命令在 PR 1b 的结构化 bash 结果把 `timedOut` 喂进灯之前读作信号/退出红。
- **AGENTS.md 漂移。** [AGENTS.md §Conventions](../../../../AGENTS.md#conventions) 仍列三种卡片 kind；render-intent 联合已经更多。本工作应在同一个 PR 里更新那一行和 render-intent 设计 note。

## 取代

本提案是已实现 ui-tool 边界之上的一个增量，所以它修订而非替换拥有它构建于其上的那些零件的 note。[Client Tool 呈现所有权](../../implemented/architecture/2026-08-08-client-tool-presentation-ownership.md) 和 [Client Conversation business-node 组装](../../implemented/architecture/2026-08-09-client-conversation-node-assembly.md) 的决策保持为分发、兜底、card model、以及节点组装的当前权威；本 note 不复述、也不替换它们的所有权表。在原子视图内部，它对既有决策做两件事：

- 它**构建**了 [toolview 溶解那篇 note](../../implemented/architecture/2026-07-23-toolview-dissolution.md) 带 regret clause 延后的 `registerToolView` facade（一旦 registrant 涨到三个到五个、或出现批量注册形态），遵守那篇 note 的「一个注册模型」决策——ui-tool 的七个 registrant 触发那条。它不取代那篇 note 的 slot 注册模型；facade 是 `slots.register` 之上的糖。
- 它**修订 render-intent 记录的实现**，不改它们的 wire view：render-intent 联合（[2026-07-02-tool-render-intent-union.md](../../implemented/architecture/2026-07-02-tool-render-intent-union.md)）和逐卡片记录保留它们的 `card` 标签、`presentationMeta` 通道、以及兜底语义——那是本提案明确保留的 host 侧边界。变的是这些 view 的*客户端*渲染：现在重复在 `GenericToolCard` 和 `bash-sample` 里的两步状态推导（ui-tool card model 里的 `ToolRowState`/`terminalFailed` 对）被灯 helper 替换，bash 的 `parseExitStatus` 文本往返（[render-intent 联合](../../implemented/architecture/2026-07-02-tool-render-intent-union.md) 记录、并由 [pwsh UI 呈现对齐 bash](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md) 细化）被 bash 自己结果的、结构化 `presentationMeta` 替换，而 `@deepseek-ai/dsh-bash` 的 seam 为 `tool-pwsh` 保持存活。

因为这是一个取代被限定在客户端渲染路径、且不重写任何 note 决策的增量，本 PR 里新增的互反交叉链接只限定于那次修订，而非早期草案断言过的更宽取代关系。本提案改动其*实现*的 render-intent 记录——[render-intent 联合](../../implemented/architecture/2026-07-02-tool-render-intent-union.md) 和 [pwsh UI 呈现对齐 bash](../../implemented/feature/2026-08-05-pwsh-ui-bash-parity.md)——各自带一条点名本提案的互反链接（Status 行下的 blockquote，与联合已用于其 ACP 取代的同一形状），本节点名它们作为回报。本 note 构建于其上的所有权决策保持权威、不带链接，已封存的 web-cards-toolrow note 也不带（冻结的产物不承担取代簿记）。这段关系在每处迁移落地时就地更新。
