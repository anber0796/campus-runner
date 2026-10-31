# 顺路 · 校园动线众包（学生端 MVP）

校内食堂外卖的**众包运力小程序**。学生下课顺路到食堂，把同楼栋、同波次的几单带回寝室门口。

> 产品方案与完整 PRD 见 `校园动线众包-产品方案与PRD.md`（v3.4）。本仓库只实现 **7.1 学生端 P0**。

---

## 两条命令跑起来

**运营后台**（看整条链路怎么运转的，最直观）：

```bash
node admin/server.js
# 打开 http://127.0.0.1:8787
```

点「生成演示订单」→「运行成包」→ 看包均单量 → 「模拟 10 分钟过去」看兜底回落。

**跑测试**（不依赖任何环境）：

```bash
npm test
```

- `scripts/test-engine.js` —— 成包器 + 巡检 + 兜底执行器的 28 项不变量断言
- `scripts/smoke.js` —— 学生端 13 项链路断言

**小程序**：微信开发者工具导入 `campus-runner` 目录即可，默认 `USE_MOCK = true`，不需要云开发环境、不需要 AppID（测试号也行）。

---

## 目录结构

```
campus-runner/
├── miniprogram/
│   ├── app.js / app.json / app.wxss
│   ├── pages/
│   │   ├── index/      顺路包列表（波次预告 + 包卡片）
│   │   ├── pack/       包详情（尾号、收益明细、接单）
│   │   ├── deliver/    履约（逐档口核销 → 拍照 → 送达）
│   │   ├── order/      我的单（进行中 / 已完成）
│   │   ├── wallet/     钱包（待结算 / 已结算 / 流水）
│   │   ├── me/         我的（动线档案、信用分、合规状态）
│   │   └── register/   认证（实名 + 资质 + 动线）
│   └── utils/
│       ├── config.js       USE_MOCK 开关、云环境 ID
│       ├── api.js          数据访问层（页面只调它）
│       ├── mock.js         本地假数据（与云端返回同构）
│       ├── commission.js   佣金计算（与云端同规则）
│       ├── waves.js        下课波次表
│       └── format.js       格式化
├── cloudfunctions/
│   ├── api/                学生端接口
│   │   ├── index.js        action 路由入口
│   │   ├── handlers/       student / packs / deliver / wallet / orders
│   │   └── lib/            commission / waves / statemachine / guard / errors
│   └── packer/             成包器（纯函数，可单测）
│       ├── index.js        云函数入口
│       └── lib/            packer（成包）/ patrol（巡检）/ executor（执行）/ commission
├── admin/                  运营后台（本地，零依赖）
│   ├── server.js           HTTP 服务 + 业务动作
│   ├── data.json           运行时数据（已 gitignore，删掉即重置）
│   └── public/             中文界面
├── db/schema.md            集合、索引、安全规则
└── scripts/
    ├── test-engine.js      成包器单元测试
    └── smoke.js            学生端链路冒烟测试
```

---

## 两种运行模式

| 模式 | 改哪里 | 用途 |
|---|---|---|
| **假数据**（默认） | `utils/config.js` → `USE_MOCK: true` | 调 UI、给人演示、跑冒烟测试 |
| **云开发** | `USE_MOCK: false` + 填 `CLOUD_ENV` | 真机联调、试点 |

页面代码不用改，因为 `utils/api.js` 是唯一的数据出口。

### 接云开发的步骤

1. 开发者工具 → 云开发 → 开通 → 复制**环境 ID**
2. 填进 `miniprogram/utils/config.js` 的 `CLOUD_ENV`，把 `USE_MOCK` 改成 `false`
3. `cloudfunctions/api` 右键 → **上传并部署：云端安装依赖**
4. 云开发控制台建集合：`students` `packs` `orders` `wallet_logs` `events` `dispatches`
5. 按 `db/schema.md` 建索引、配权限
6. 造数据：往 `packs` 里插一条文档（字段见 `db/schema.md`），或在 `mock.js` 里照着结构抄

---

## 成包器：订单怎么变成顺路包

`cloudfunctions/packer/lib/packer.js` 是纯函数，不碰数据库，所以能单测。

**约束条件**（违反任何一条，包就不成立）：

| 类型 | 条件 | 来源 |
|---|---|---|
| 硬约束 | 同一楼栋 | 一人一楼 |
| 硬约束 | 同一食堂 | 跨食堂必绕路 |
| 硬约束 | 同一波次 | 下课时刻表对齐 |
| 容量 | ≤6 单、≤6 体积单位（汤粉记 2） | 手提保温袋 |
| 收益 | 包收益 < ¥2.0 不生成 | PRD 3.4 |
| 排除 | 出餐慢档口的单不进包 | PRD 4.3 |

**算法四步**：

1. 按收件人聚成「块」——同一收件人的多单**强制同包**，绝不拆
2. 按「楼栋 × 食堂 × 波次」分组
3. 首次适应递减装箱：大块、高楼层优先放，尽量把包塞满
4. 收益不足的包先两两合并，合并后仍不达标才丢弃，并记录原因

输出三类东西：`packs`（成包）、`dropped`（丢弃 + 原因）、`stats`（含**包均单量**这个命门指标）。

> 实测：66 单 → 13 个包、53 单成包、**包均 4.08**、13 单丢弃（慢档口 11 单 + 收益不足 2 单）。

## 运营后台

本地零依赖，`node admin/server.js` 就能跑。**为什么先做本地版**：运营后台不需要等云开发环境，先把「订单入库 → 成包 → 巡检回落」整条链路跑通，比先搭登录鉴权有价值；成包器是纯函数，将来搬进云函数只是一行 `require`。

| 接口 | 作用 |
|---|---|
| `POST /api/seed` | 生成 66 条演示订单（跨 5 个楼栋×食堂×波次组合） |
| `POST /api/import` | 小票扫码入库，按 `channel + channelOrderNo` 去重 |
| `POST /api/pack` | 运行成包器 |
| `POST /api/assign` | 把包定向指派给学生 |
| `POST /api/simulate` | 时间快进 N 分钟，触发兜底巡检 |
| `POST /api/reset` | 清空 |

界面四个页签：**概览**（单量、包数、包均是否过 3.5 命门）、**订单池**、**顺路包**（含指派）、**调度台**（回落告警）。

演示路径：生成订单 → 运行成包 → 看包均 4.08 → 指派几个包 → 模拟 10 分钟 → 调度台点「巡检并执行」→ 看包回落、学生扣分。

## 兜底闭环：从"该回落了"到"真的回落了"

`patrol()` 只负责判断，`executor.js` 负责执行——分开是为了让规则可单测、也让"连点两次"不会重复扣分。

| 触发 | 执行器的动作 | 信用分 |
|---|---|---|
| 推出 **8 分钟**无人接 | 包状态 → `fallback`，生成 high 告警，交回自有运力 | **不扣**（没人接不是学生的错） |
| 接单 **12 分钟**未到店 | 回收 + 回落，清空接单人，记下 `previousAcceptedBy` | **−5 分** |
| 当日累计 **3 次**回收 | 冻结接单 24 小时，只推一条告警 | — |
| 取餐后 **20 分钟**未送达 | 只告警，不动状态（学生可能只是路上堵） | — |
| 调度点「重派回池」 | `fallback` → `available`，刷新 `offeredAt`，相关告警标记已处理 | — |

**幂等靠状态校验**：每个动作先检查包的当前状态，不符就跳过并记 `status_changed`。所以两个调度员同时点、或者定时器连跑两次，都不会重复扣分、重复回落——实测第二次执行 `applied = 0`。

**为什么"无人接"不扣分**：没人接说明运力不足或定价太低，是运营的问题，不是学生的。扣分只会让运力池更干。

## 与 PRD 的对应关系
| PRD 条目 | 落地位置 |
|---|---|
| 3.3 顺路包定义 | `packs` 集合 + `handlers/packs.js` 的过滤条件 |
| 3.4 佣金模型（阶梯/楼层/时效/下限 2 元） | `utils/commission.js` + `lib/commission.js` |
| 6.1 下课波次 | `utils/waves.js` + `lib/waves.js` |
| 6.2 动线档案（不打 GPS，靠扫码 + 行为） | `register` 页 + `deliver.pickup` |
| 5.2 人不在寝室的兜底 | `deliver` 页的拍照留证 |
| 5.3 异常兜底（8 分钟回落 / 12 分钟回收 / 信用分冻结） | `lib/patrol.js` 判定 + `lib/executor.js` 执行 |
| 8.3 小票扫码入库 | `handlers/orders.js` → `orders.ingest` |
| 8.7 三层唯一约束 | `lib/guard.js` + `orders.ingest` 的幂等处理 |
| 8.7 旧状态覆盖新状态 | `lib/statemachine.js` 版本号条件更新 |
| 7.1 学生端 P0 | 全部 7 个页面 |

---

## 还没做的（按优先级）

| 项 | 说明 |
|---|---|
| **运营后台搬到云上** | 现在是本地版。上云要做管理员登录鉴权（token）、静态托管，以及把 `server.js` 的逻辑改成 `cloudfunctions/admin` |
| **成包器接入定时触发** | 云函数入口写好了，但还没配定时触发器；现在是后台手动点「运行成包」 |
| **回落后的通知** | 执行器会发告警，但还没接订阅消息/sms 真正通知调度员 |
| **驻点批量指派台** | PRD 7.3 的 P0，目前只有单包指派，没有按波次批量生成指派清单 |
| **订阅消息** | 波次预告推送，PRD 7.1「双通道通知」 |
| **健康证审核流** | 现在 `student.save` 直接置 `active`，生产环境要先 `pending` 再人工核 |
| **提现** | 现在只展示，没接支付 |
| **信用分** | 字段已留，扣分/申诉逻辑未实现 |
| **校方监管视图** | PRD 7.3 的 P1，续签材料，还没做 |

---

## 上线前必须解决的三件事

这些不是代码问题，是能不能上架的问题：

1. **类目与资质**：外卖餐食类目要《食品经营许可证》＋企业主体＋微信认证（300 元/年）＋ICP 备案。**定位成「勤工俭学代取服务」走生活服务类目，比定位成「外卖平台」门槛低一个量级** —— 注册前先去微信公众平台核对目标类目的资质清单。
2. **平台派单权**（PRD 8.5）：平台后台能不能把这 3 单指派给这个学生。**不能的话，本仓库的「调度」可以整体降级成「运营工具」，表结构不用改，`packs.list` 换个数据源即可。**
3. **校方书面口径**：本楼在籍学生为本楼同学代取，属同学互助/勤工俭学；需取得后勤或学工的口径或备案（PRD 2 / 14）。

---

## 推送到 GitHub

仓库已在本地初始化（`main` 分支），只差 remote：

```bash
cd campus-runner
git remote add origin https://github.com/<你的用户名>/campus-runner.git
git push -u origin main
```

或者用 GitHub Desktop：`File → Add local repository` 选中 `campus-runner`，再 `Publish repository`。
