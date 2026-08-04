# Agent Note: 统一工具渲染为 List-of-Blocks

Status: proposed

[English](2026-08-03-unified-list-of-blocks-tool-render.md) | 中文

## Problem

web UI 里每一张工具结果卡片都是一个各自独立的 primitive：自己的数据形状、自己的 CSS 几何、以及在一条人工维护的分发链里自己的一处分支。一共六张——`TerminalBlock`、`ReadBlock`、`DiffBlock`、`SearchBlock`、`WebBlock`、`CodeBlock`——它们在结构上没有任何一致之处：

- **状态分散在六处以上。** 只有 `TerminalBlock` 在卡片*内部*带运行状态指示（[TerminalBlock.tsx:240](../../../packages/client/ui-primitives/src/TerminalBlock.tsx#L240) 处每行提示符一个 `StateDot`，外加一个表示 exit code/signal 的 `Pill`）。另外五张都没有；它们的成功、失败和被中止状态由外层行的 chrome 绘制。这些推导没有共同来源：`ToolRowState`（[tool-call-model.ts:23](../../../packages/client/ui-conversation/src/client/contract/tool-call-model.ts#L23)）、`terminalFailed`（[terminal-card-model.ts:71](../../../packages/client/ui-conversation/src/client/contract/terminal-card-model.ts#L71)，之所以需要它，是因为失败的 bash 命令结算时 `isError: false`）、`StateDotState` 的四个取值，以及 `TerminalBlock` 内部自己的 running/exit/signal 映射，是同一个概念的四套彼此独立的编码。

- **「输入」没有共享表示。** 只有 `terminal`（command/cwd/description）和 `diff`（`FileDiff[]`）声明了结构化的调用视图。`read`、`grep`、`glob`、`web_search`、`web_fetch` 把整个多字段输入压成一个英文 `title` 字符串加一个 `rawInput` 字符串；grep 的 `path`/`include` 只以 `"Grep X in Y (Z)"` 的子串形式留存。今天唯一真正渲染出 IN/OUT segment 对的地方是通用兜底的 `div.ioCard`（[ToolRow.tsx:279](../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L279)），它硬编码在 `ToolRow` 内部，只支持恰好两个 segment，既不能嵌套也不能复用。

- **结构靠约定重复，而不是靠代码共享。** 不存在 `CardShell`（`grep -rn CardShell` 的结果是 0）。五个 CSS module 各自声明一个 `.block` 根节点，重复同样的四条属性，并各自定义自己的 `--dsl-<name>-radius: 12px` / `--dsl-<name>-line-height: 22px`。`headTailCap` 和 `useCopyFeedback` 各自恰好只有两个调用方；另外三个 block 内联了完全相同的算术和完全相同的 1000 ms 复制超时，并硬编码中文字面量。四个 `CHAT_*_MAX_LINES = 8` 常量重复着同一句「primitive 默认值的一半」注释。wire→props 的分发是一段六分支三元表达式，在 [ToolRow.tsx:240](../../../packages/client/ui-conversation/src/client/chat/ToolRow.tsx#L240) 写了一遍，又在 [DetailsPanel.tsx:150](../../../packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx#L150) 以不同的顺序写了一遍。

- **i18n 不对称。** 只有 `TerminalBlock` 具备完整的 `TerminalBlockLabels` 表层；另外四张内联中文字面量，这个缺口已记录在 [ui-primitives/README.md](../../../packages/client/ui-primitives/README.md) 中。

直接触发这项工作的需求是交互式、多命令的 bash：一次 bash 调用会运行多条命令，而持久/交互式会话（REPL、PTY）会分多轮交换 stdin/stdout。两者都不适配 `TerminalBlock` 那种「一张卡片、一条命令横幅、一个输出框、一个状态」的扁平形状。只扩展 bash 会新增第七个各自独立的变体。交互式 bash 所需要的 List-of-Blocks 结构，正是能统一全部六张卡片的结构，因此这个基础值得为全部卡片一次性铺好，而不是只给 bash 单独加一个专用的多命令模式。

## Proposal

引入一个共享的渲染骨架，采用三层结构，并把现有六张卡片——以及交互式/多命令 bash——都表达为它的实例。骨架拥有所有共性部分（布局、状态灯、对齐 gutter、逐 segment 滚动、复制、全屏）；每个工具只提供自己的输入和输出如何渲染。

一个验证本设计的交互式原型（覆盖所有工具形态、压测用例、以及盲区的 render kind）放在孤儿 assets 分支上，不在主干树里：[`unified-list-of-blocks-mock.html`](https://github.com/deepseek-harness/deepseek-harness/blob/list-of-blocks-assets/unified-list-of-blocks-mock.html)。它是一次性设计工件——以本文文字为准，而非原型，来决定最终交付什么。

### 三个层级：Block / Turn / Segment

```
Block    整卡 — one tool call's whole card
 └─ Turn  一对 IN/OUT + one lamp — bash: one per command; REPL: one per round
     ├─ Segment (IN)  — this operation's input representation
     └─ Segment (OUT) — its output; a tool may emit more than one (grep: matches
                        + recovery locator; web_fetch: status line + body)
```

`Block` *不是*一个列表；它是持有一组 `Turn` 的卡片对象；每个 `Turn` 持有它自己的 `Segment`。UI 中外层的 List-of-Blocks 是每次工具调用一个 `Block`。

词汇刻意保持工具中立：字段名**不是** shell 词汇（`command`/`cwd`/`exitCode`），因为同一套骨架还要承载一次文件读取、一份 diff、一个搜索查询和一个被抓取的 URL。每个工具为自己的 IN 载荷和 OUT 载荷提供渲染器；骨架只知道 `Segment`、`role: 'in' | 'out'`、一个可选的 `lamp`，以及工具提供的渲染。

### 状态灯：一套基于可观测量的推导

今天的四套状态推导收敛成一个函数，输入只有 harness 能观测到的东西，挂在 `Turn` 层（渲染在 IN segment 的 gutter 里）：

- **`isError === false` → 绿色（done）。** 操作无错误地完成——完成本身就是那个可观测信号。这是*每一个*工具的基础规则：一次读取、一次写入、一次单纯成功的搜索都是绿色。除了「它结束了且没有报错」之外，不制造额外的「成功」含义。
- **error → 红色。** 工具报告了 `isError`。
- **running → 蓝色**（`ongoing` 的 pixel-chase 点）。
- **bash 可以进一步细分**，因为它有其他工具没有的 exit code：`timedOut`/`aborted` → **琥珀色（warn）**（harness 因为限额或取消而终止了它——命令没有选择余地）；不是来自我们的 timeout/abort 的终止 `signal` → **红色**（崩溃的 `SIGSEGV`，或外部的 `SIGTERM`；我们为超时发出的 `SIGTERM` 已经被琥珀色规则覆盖，所以能走到这里的 signal 都来自外部）；其余情况由 exit code 决定。
- **灰色（neutral）** 只用在结果确实无法观测的场合——例如一个 REPL turn（`>>> 2+2`）没有 shell exit code，所以是灰色。骨架绝不去解析 Traceback，从而为一个它无法观测的结果编造出红灯。

`warn`（琥珀色）是相对当前 `StateDot` 三状态用法唯一新增的状态；对应的 token 已经存在（[StateDot.module.css](../../../packages/client/ui-primitives/src/StateDot.module.css)）。信号归因只使用 harness 自己的布尔量（`timedOut`/`aborted`），绝不猜测信号由谁发出，因为操作系统不报告发送方。

### 卡片内部不放动词标签

一个 segment 的 IN 渲染工具真实的输入（bash：提示符行；read：路径 + 行范围；write/edit：路径；grep：查询 + 范围；web：查询/url；generic：args JSON）。它**不带** `READ`/`WRITE`/`GREP` 动词徽标——外层的工具行已经显示了工具图标和标题，在卡片内部再重复一遍是冗余。

### 对齐 gutter：状态灯和行号共用一列，互斥

每个 Segment 都是一个两列网格 `[gutter][body]`。gutter 的内容**按 role 互斥**：

- IN segment → **状态灯**（左对齐，固定在最左侧）。IN segment **永远不带行号**，即便它有很多行（heredoc 运行整个脚本、大段 `write` content、大 args JSON）：它的每一行是操作的输入，不是文件内容，所以没有「第 N 行」。只有状态灯占据它首行的 gutter，其余每一 IN 行的 gutter 都留空。
- OUT segment → **行号**（右对齐，紧贴 body 行），只供展示*文件内容*的 OUT 使用：read（文件行号）、grep（命中文件的行号）、diff（真实的旧/新行号——gutter 显示真实行号，**不是** `+`/`-` 标记；删除为红、新增为绿，同时给行号和 body 上色；被删除的行和它的替换行可能显示同一个行号，这种并排重复是可接受的，而不引入旧/新两列 gutter）。非文件 OUT（bash 输出、web 正文、args JSON、自定义工具的文本）没有行号，让 gutter 留空。

因为状态灯在 IN segment 上、行号在 OUT segment 上，「一列、互斥」自然成立——任何一个 segment 的 gutter 都只有一种内容。

**每个 Block 一个 gutter 宽度，计算后对齐全部 Turn。** gutter 列宽是 `max(lamp-min, 本 Block 内最宽的行号)`；卡片内所有 IN 和 OUT segment 共用这个宽度，因此 IN 的命令、OUT 的文本和带行号的行都从同一条 body 起始线开始。宽度是自适应的（6 位行号会加宽 gutter 并推移 body 起始线；状态灯仍固定在最左）。原型里这个宽度在 JS 中测量；交付的组件用同样的方式计算（测量最宽的 gutter 内容，设置一个 CSS 变量）。行号始终可见——绝不藏在 hover 之后。

字号与现有卡片持平（设计评审要求）：骨架使用现有 block 所用的同一批 `--dsw-font-*` token（segment body 用 13px/22px 的代码块字体），因此统一后的卡片与今天的 `TerminalBlock`/`CodeBlock` 读起来是同一字号。

### 逐 segment 滚动：行号随 body 滚动，状态灯不动

超过高度上限的 Segment 会变成固定高度的内部滚动区。在其中，**行号随 body 一起滚动**（它们属于内容）；**状态灯不滚动**（它属于该 Turn 的状态）。短的 IN segment 只有一行、不会滚动，所以状态灯自然是静止的；但大的 IN（heredoc 脚本、大段 `write` content、大 args JSON）*确实*会滚动，那时状态灯必须**钉在该 segment 不滚动的外壳上**（锚定左上角，位于滚动区之外），从而在输入内容在下方滚动时保持可见。过长的单行以水平滚动区横向溢出；缩进属于内容，绝不折叠。

滚动条是**自绘的 overlay**，不是浏览器原生滚动条：原生滚动条被隐藏（`scrollbar-width: none` + `::-webkit-scrollbar { display:none }`），改为按卡片的设计语言绘制一个 DOM 滑块（细、圆角、半透明、hover 变亮）。它在滚动过程中以及 segment hover 时显示，滚动停止约 900 ms 后淡出；垂直和水平的行为一致。定位使用 `transform`（合成层），更新经 `requestAnimationFrame` 节流并把读与写分离，因此快速滚动不会造成布局抖动。**实现说明：** 交付的组件应优先采用一个有维护的 overlay-scrollbar 依赖（依照 dependencies-over-hand-rolling 政策），而不是这个手写滑块——手写滑块的边界情况很多（触控板惯性、缩放、RTL、a11y）；原型只作为行为/样式参考。

### 逐 segment 控件：本期复制，展开后续

每个 Segment 都带自己的控件组，锚定在 segment 外壳的右上角（即不滚动的包裹层，因此内容滚动时它保持不动），只在 segment hover 时显示。复制是**逐 segment 的**（IN 和 OUT 各有一个）——复制命令和复制输出是两个独立动作；Block 没有整卡复制按钮。**在骨架 PR 中控件组只有复制。**

`⤢` 展开按钮以及它打开的全屏查看器**拆分成各自的后续 PR**（见「迁移形态」）。这里为完整设计一并描述：展开会在一个**充满整个视口的 VSCode 风格全屏查看器**中打开该 segment（不是居中的 modal 浮层）：标题栏显示该 segment 的上下文（工具 + IN 的命令/路径/查询）以及一个关闭控件；行号列；行 hover；语法高亮。打开时锁定 body 滚动（`fs-lock`），使底层页面既不滚动也不显示原生滚动条；查看器自身的滚动使用同一套自绘 overlay。Escape 或关闭控件退出。当内容连视口都装不下时，查看器自身滚动。**实现说明：** 高亮应复用仓库已有的 shiki 集成（如同 `CodeBlock` 那样），而不是手写 tokenizer。

### 空的 / 无输入的 segment 对称折叠

- **空输出**（OUT segment 的文本为空白或只含不可见字符）：命令行连同它的分隔线照常渲染，但输出行的高度折叠为零并保留边框，于是两条边框叠成一对相邻的分隔线——表示「存在一个输出区域且它是空的」——而不留下一个空白行。
- **无输入的输出**（OUT segment 前面没有 IN）：相反的情形——没有命令行；OUT segment 自己承载状态灯。非 shell 工具在没有命令行输入时的输出就是这个形状，`generic` 兜底的 console dump 也是这个形状。

### 六张卡片（以及 generic）作为 Block 实例

要点在于这些不是新的渲染器，而是一个骨架加上各工具专属的 IN 和 OUT 渲染器；原型验证了十种工具形状加一套压力用例。

| 工具 | IN 渲染 | OUT 渲染 | 状态灯 |
|---|---|---|---|
| bash（1 条命令） | 提示符行：cwd + command | 输出文本（无行号） | exit/signal/timeout/abort |
| bash（N 条命令） | 每条命令一个 Turn | 每条命令各自的输出 | 逐 Turn |
| bash（REPL） | 每轮 stdin 一个 Turn，`>>>` 提示符 | 该轮的输出 | 中间轮灰色，活动轮蓝色 |
| read | 路径 + 行范围 | 带行号的文件行 | done/error |
| write | `path` | 应用后的 diff，真实的新行号 | done/error |
| edit | `path` | 应用后的 diff，真实的旧/新行号 | done/error |
| grep | 查询 + 范围 | 匹配分组（行号）**+ 恢复定位器（第 2 个 OUT）** | done/error |
| web_search | 查询 | 答案 + 带编号的来源列表（可点击链接） | done/error |
| web_fetch | url（链接） | 状态行（第 1 个 OUT）**+ 抓取到的正文（第 2 个 OUT）** | done/error |
| generic | args JSON | 结果文本 | done/error |

来源列表和抓取正文是一等的多 OUT segment 用例，取代今天「一张卡片外加一个兄弟 div」的做法。web 来源渲染为真正的仅 `http(s)` 链接（复用 `WebBlock` 的 `SafeLink` 安全处理）。

### 数据来源：可从文本重建的那条边界得以保留

卡片之间真正的分界在于：结构化载荷能否从面向模型的结果文本无损重建。bash 可以（`command`/`cwd` 来自 args，exit 标记可从输出解析出来），这也是它成为今天唯一**不**使用 `presentationMeta` 的卡片的原因。read 的行号、search 的分组和 web 的来源在文本中是有损的，所以它们通过 `presentationMeta` 承载——那是唯一能在回放中留存的结构化通道，因为 `ToolEventView` 从不被持久化（[api/events.ts](../../../packages/host/apiproxy/src/api/events.ts)）。

统一抽象不改变这条边界。面向模型的文本仍然是扁平化的、仅供模型的编码；骨架的结构化 segment 由各工具已有的 `presentationMeta` 承载（bash 新增一个，取代它的 `parseExitStatus` 文本往返）。不变式 **Model-visible ⟺ logged**（[AGENTS.md:101](../../../AGENTS.md#L101)）得以保留：模型看到扁平文本，UI 看到结构化 meta，两者由同一次执行产出。

### 可扩展的 render kind 与自定义工具——预留，大部分推迟

`Segment.render` 是一个可扩展的 render kind tagged union。设想的完整词汇表是 `prompt` / `text` / `lines` / `diff` / `kv` / `link` / `json` / `table` / `image` / `notice`，使得一个 segment 的载荷由数据描述，而不是由每个工具各自的组件描述。这正是让自定义工具以三档接入骨架的机制：

1. **兜底（零代码）。** 没有 presenter 的工具落到 generic：IN = args JSON、OUT = 结果文本，作为普通 segment 渲染——于是它免费获得状态灯、复制、全屏和滚动，而不是今天那个功能贫瘠的 `ioCard`。
2. **声明式（`presentationMeta` 返回一份 render kind 描述，不写 React）。** 工具通过选取 render kind（比如 `kv` + `text` + `link`）来描述自己的 IN/OUT segment；骨架从共享词汇表把它们画出来。内置工具就是同一套机制——每个只是一组固定的 kind 选择。
3. **自定义 React 渲染器。** 需要词汇表之外形状的工具，把自己的组件注册到现有的 `conversation.chat.toolview` slot 上，绕过骨架。这是逃生阀，不是常规路径。

**本 PR 的范围刻意收窄。** 只有第 1 档（兜底）和内置 bash/read/（再一个）实际用到的 render kind（`prompt`/`text`/`lines`/`diff`）现在交付。其余 kind（`kv`/`link`/`json`/`table`/`image`/`notice`）、作为公开契约的第 2 档声明式、以及第 3 档接线都**在类型中预留并推迟**——和递归后门一样，它们标出扩展在哪里接入而不改数据形状，但不在这里实现。原型验证了它们能在骨架内组合（一个自定义 `deploy` 工具用 `kv`+`text`+`link`；image、table、JSON 树作为 OUT kind），这是扩展点足够用的证据——而不是在本 PR 交付它们的承诺。

同样，原型演练过的运行时状态形态——流式追加（蓝灯、OUT 增长）、后台任务（taskId + 一个 `notice` 提示轮询）、中途取消（琥珀色 + 部分输出）、sandbox denial（红色 + `notice`）、需审批的工具（一个 `notice` + 批准/拒绝控件）、以及纯 IN 副作用 Turn（一个只有 IN、完全没有 OUT segment 的 Turn，区别于空 OUT）——都是 seam 必须不阻断的真实形态，但它们的渲染推迟到添加各自行为的 PR。第一个 PR 只保证类型和 seam 不挡住它们。

### 递归推迟（只留类型接入点）

`Turn`/`Block` 的递归——一组命令折叠成一个可展开单元并带一个聚合状态灯——在这里只保留为一个有类型的字段，**不实现**：没有聚合规则，没有递归渲染器，没有分组摘要。它标出分组功能将来接入的位置，从而不需要再改一次数据形状。现在就实现它，需要定义四种灯色之间的状态聚合、一个 bash 本身并不提供的分组标题来源，以及一份本地化的折叠摘要——而当前的驱动需求（多命令、交互式）都不需要这些。

### 迁移形态

**PR 1 — 骨架 + bash + 一个工具（验证抽象）。** 交付为一个四层 PR 栈（每步基于上一步，用官方 stacked-PR 机制），因为这些步骤有硬依赖顺序、每步是单一关注点、约 400–700 行：

1. **类型 + presentation 契约。** 共享的 `Block`/`Turn`/`Segment` 类型和扩展后的 `ToolResultView`，含可扩展的 render kind union（只实现 `prompt`/`text`/`lines`/`diff`）。纯类型；只有 unit 测试——此时还没有组装后 transcript 快照，因为在 1c 之前没有工具产出它。
2. **骨架组件**（`ui-primitives` 中，即六张卡片一直预期存在的那个 `CardShell`）：统一的状态灯推导、自适应 gutter、逐 segment 滚动 + overlay 滚动条、逐 segment 复制（控件组**只带复制**）。组件 unit + 渲染快照。
3. **bash** 迁移，包括交互式/多命令的 Turn，以及一个承载结构化轮次的新 bash `presentationMeta`。第一个真实工具——需要真实工具数据的 snapshot/e2e 覆盖落在这里。
4. **再迁移一个工具**（read 或 search），在批量迁移前证明这个抽象确实是工具中立的，而不是围绕 bash 成形的；带它自己的 snapshot/e2e。

snapshot 和 e2e 覆盖集中在 1c/1d（首批有真实工具产出组装后 transcript 的 PR）；1a/1b 带它们能带的测试（类型、组件 unit），而不是在工具存在之前强行要求组装后 transcript 快照。

**PR 2 — 迁移其余工具（优先级高于全屏）。** 抽象验证过后，把其余所有工具（write/edit、grep/glob、web_search/web_fetch，以及 generic 兜底）迁进骨架；收敛 `ToolRow`/`DetailsPanel` 中的六分支 wire→props 分发；下线已不再使用的各 block `.block` 几何、六个 `*-card-model`、以及重复的截断/复制代码；统一 `CHAT_*` 常量；把 i18n 收进一个 labels 表层。这一步承载产品价值（所有卡片统一到一套骨架），所以排在全屏增强之前。单个约 8–10k 行的 PR 无法 review 且风险集中，因此 PR 2 用仓库的官方 stacked-PR 机制交付为一叠更小的按工具组拆分的 PR（例如 write/edit；grep/glob；web），每个约 500–800 行。

**PR 3 — 全屏查看器。** VSCode 风格全屏查看器*以及*打开它的 `⤢` 展开按钮，是一个独立的、优先级更低的增强，放在各自的 PR、依赖骨架 PR。它在一个全视口容器里复用骨架的 Segment 渲染（标题栏取自该 Turn 的 IN 上下文、行号列、overlay 滚动条），锁定 body，并通过仓库的 shiki 集成加语法高亮。骨架 PR 既不渲染也不引用它；展开按钮只在这个 PR 里出现。

**后续** — 推迟的扩展点（声明式 render kind 第 2 档、非文件 render kind `kv`/`link`/`json`/`table`/`image`/`notice`、第 3 档自定义渲染器、`Turn`/`Block` 递归，以及各行为对应的状态形态）在其服务的行为被构建时，作为各自的 PR 落地。

本文对应的工作是 PR 1，它本身是一个四层 PR 栈（1a–1d）；PR 2（全量迁移，一叠按工具组拆分的 PR）先于 PR 3（全屏）。

## Alternatives considered

- **只把 bash 扩展成多命令，其余五张卡片不动。** 否决：交互式 bash 无论如何都需要 List-of-Blocks，而且「输入是一个 title 字符串」「状态在卡片之外」「OUT 本来就是两部分」这些模式是跨工具共有的，不是 bash 独有的。

- **扁平的 segment 流（没有 Turn 容器）。** `List = Segment[]`，IN/OUT 交错，状态灯挂在 IN segment 上。否决：这会把「哪些 segment 属于同一次执行」从数据里删掉，迫使渲染器从「下一个 IN 开启一个新单元」去推断分组。这样交互式会话（一个进程、多轮 stdin）就无法与彼此独立的命令区分开。

- **整次调用只有一个状态灯（状态继续留在行 chrome 里）。** 否决：一批命令和一个交互式会话都需要逐轮的结果，而单个调用级状态灯无法表达。状态灯挂在 Turn 层。

- **保留 shell 词汇，其他工具走特例。** 否决：这个抽象存在的意义就是承载非 shell 的输入；shell 字段名会迫使其他每个工具都经过一层转换垫片。

- **状态灯和行号分成固定列与滚动列两列。** 因过度设计而否决：既然状态灯在 IN segment 上、行号在 OUT segment 上，一个内容互斥的共享 gutter 列就足够了，而且 IN segment 很少滚动，状态灯自然就是固定的。

- **展开做成居中 modal / 「显示另外 N 行」按钮。** 否决，改为全视口的 VSCode 风格查看器（应对长内容）加逐 segment 滚动（应对快速浏览）；两者合起来覆盖两种阅读方式。

- **用 `::-webkit-scrollbar` 给原生滚动条设样式。** 否决：只在 webkit 生效，在 headless/其他引擎中缺失，会占用宽度，而且无法与卡片设计保持一致。自绘 overlay 与引擎无关——不过交付版本应使用有维护的依赖，而不是原型里的那个手写滑块。

- **现在就实现递归。** 推迟而非否决：保留为一个有类型的接入点，使将来的分组功能不需要第二次数据形状迁移。

## Acceptance criteria

- `ui-primitives` 中存在唯一一套 `Block`/`Turn`/`Segment` 类型和骨架组件；bash 和另一个工具通过它渲染；对这两个工具，当前的四套状态推导被那一个状态灯函数取代。
- bash 通过 `presentationMeta` 承载结构化轮次；它的 `parseExitStatus` 文本往返被移除；面向模型的 bash 文本保持不变（快照）。
- 多命令和交互式（多轮）bash 渲染为多个 Turn/Segment，每个 Turn 带自己的状态灯；单命令情形在视觉上与今天的 `TerminalBlock` 等价（快照）。
- 每个 Block 一个 gutter 宽度，能对齐每个 Turn 的 body 起始线；行号始终可见；空输出和无输入的 segment 按上述规则折叠。
- 逐 segment 的 IN/OUT 复制可用（本 PR 控件组只带复制；展开按钮和全屏查看器是独立 PR）；`Turn`/`Block` 递归存在于类型中且运行时未被使用。
- 完整的六类测试矩阵在同一个 PR 中交付（unit per-file 100%、e2e、snapshot、smoke、CI gates、sandbox），其中包含一条通过真实可运行示例、断言组装后 transcript 的 keyless 快照。

## Risks

- **范围。** 这会触及 presentation 契约（[presentation.ts](../../../packages/core/tools/src/presentation.ts)）、card-model 推导层、`ui-primitives`，以及 host→client 的视图流。它被分阶段执行（现在只做 bash + 一个工具），以约束第一个 PR 的规模，同时验证通用性。
- **wire 数据不可信。** `sessions.schema.ts` 只校验 `for` 和 `card: string`；现有的每个 card-model 都会再做一次防御性收窄。统一后的 wire→props 层**必须**保留逐工具的收窄，否则一个畸形载荷会让某一行或详情面板崩溃。
- **回放纯度。** presenter 同时运行在实时路径和回放路径上，必须保持为 args（+ result meta）的纯函数，不做 I/O、不读时钟、不读会话状态（[adding-a-tool.md](../../../docs/cookbook/adding-a-tool.md)）。状态灯推导和 segment 构造器必须遵守这一点。
- **手写的 UI 机制。** 原型手绘了 overlay 滚动条、手写了高亮的 tokenizer；交付的组件必须改用有维护的滚动条依赖和仓库自己的 shiki 集成，否则就会重新引入本文所警告的那些边界情况负担。
- **放弃了什么。** 状态统一意味着今天在卡片内*不*显示状态的那五张卡片会获得一个状态灯；对确实无法观测的结果，诚实的取值是灰色——抽象不得为它无法观测的东西制造出绿色的「成功」（这与状态灯和 gutter 共同遵循的「可观测才显示，否则省略」原则一致）。
- **AGENTS.md 已经过时。** [AGENTS.md:117](../../../AGENTS.md#L117) 仍然列着三种卡片类型；render-intent 联合类型已经有六种。这项工作应在同一个 PR 中更新那一行以及 render-intent 的设计说明。
