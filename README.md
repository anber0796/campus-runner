# 顺路 · 校园动线众包（学生端 MVP）

校内食堂外卖的**众包运力小程序**。学生下课顺路到食堂，把同楼栋、同波次的几单带回寝室门口。

> 产品方案与完整 PRD 见 `校园动线众包-产品方案与PRD.md`（v3.4）。本仓库只实现 **7.1 学生端 P0**。

---

## 一条命令跑起来

```bash
node scripts/smoke.js
```

不开开发者工具，直接在 Node 里跑完整链路（认证 → 看包 → 接单 → 核销 → 送达 → 结算），验证业务规则是否自洽。当前 13 项断言全部通过。

在微信开发者工具里跑：**导入 `campus-runner` 目录即可**，默认 `USE_MOCK = true`，不需要云开发环境、不需要 AppID（用测试号也行）。

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
├── cloudfunctions/api/
│   ├── index.js            action 路由入口
│   ├── handlers/           student / packs / deliver / wallet / orders
│   └── lib/                commission / waves / statemachine / guard / errors
├── db/schema.md            集合、索引、安全规则
└── scripts/smoke.js        冒烟测试
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

## 与 PRD 的对应关系

| PRD 条目 | 落地位置 |
|---|---|
| 3.3 顺路包定义 | `packs` 集合 + `handlers/packs.js` 的过滤条件 |
| 3.4 佣金模型（阶梯/楼层/时效/下限 2 元） | `utils/commission.js` + `lib/commission.js` |
| 6.1 下课波次 | `utils/waves.js` + `lib/waves.js` |
| 6.2 动线档案（不打 GPS，靠扫码 + 行为） | `register` 页 + `deliver.pickup` |
| 5.2 人不在寝室的兜底 | `deliver` 页的拍照留证 |
| 8.3 小票扫码入库 | `handlers/orders.js` → `orders.ingest` |
| 8.7 三层唯一约束 | `lib/guard.js` + `orders.ingest` 的幂等处理 |
| 8.7 旧状态覆盖新状态 | `lib/statemachine.js` 版本号条件更新 |
| 7.1 学生端 P0 | 全部 7 个页面 |

---

## 还没做的（按优先级）

| 项 | 说明 |
|---|---|
| **运营后台** | PRD 7.3 整块，包括驻点批量指派台。没有它，包只能手工往库里插 |
| **成包器** | 目前包是预置的。真正的 `楼栋 × 食堂 × 波次` 装箱逻辑还没写 |
| **派单 / 回落** | 8 分钟无人接自动回落自有运力，PRD 5.3 |
| **订阅消息** | 波次预告推送，PRD 7.1「双通道通知」 |
| **健康证审核流** | 现在 `student.save` 直接置 `active`，生产环境要先 `pending` 再人工核 |
| **提现** | 现在只展示，没接支付 |
| **信用分** | 字段已留，扣分/申诉逻辑未实现 |

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
