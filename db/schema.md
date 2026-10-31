# 数据模型与索引

云开发（MongoDB 语义）没有唯一索引约束，所以**唯一性必须在应用层保证**（见 `lib/guard.js`）。
如果将来迁移到 MySQL / Postgres，下表最后一列就是应该建的唯一索引。

---

## students —— 学生（运力）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 主键 |
| `openid` | string | 微信 openid，一人一条 |
| `name` / `studentNo` / `phone` | string | 实名信息 |
| `buildingId` / `buildingName` | string | 宿舍楼，**成包硬约束，一人一楼** |
| `room` | string | 寝室号 |
| `canteenIds` / `canteenNames` | array | 常去食堂（1～2 个），**单一食堂约束** |
| `waveIds` | array | 下课波次，最多 3 个 |
| `platformRiderId` | string | 平台骑手账号 ID，驻点批量指派时用（PRD 7.3） |
| `credit` | number | 信用分，默认 100 |
| `status` | string | `none` / `pending` / `active` / `frozen` |
| `healthExpire` | string | 健康证到期日，到期即拦截接单 |

**索引**：`openid`（唯一）

---

## packs —— 顺路包（接单与结算的最小单位）

| 字段 | 类型 | 说明 |
|---|---|---|
| `_id` | string | 主键 |
| `tenantId` | string | 校区隔离 |
| `buildingId` / `buildingName` | string | 目标楼栋 |
| `canteenId` / `canteenName` | string | 单一食堂 |
| `waveId` / `waveLabel` | string | 波次 |
| `orders` | array | 包内订单快照，见下 |
| `status` | string | `available` → `accepted` → `picked` → `delivered`；异常走 `cancelled` |
| `acceptedBy` | string | 接单学生 openid |
| `acceptedAt` / `pickedAt` / `deliveredAt` | number | 时间戳，用于时效奖励与超时回收 |
| `photo` | string | 送达留证（云存储 fileID） |
| `income` | object | 结算时固化的收益快照，**不要每次重算** |
| `version` | number | 状态机版本号 |
| `walkMinutes` / `distanceMeters` | number | 步行时间与距离 |

`orders[]` 元素：

```json
{
  "id": "O1",
  "tail": "8821",
  "stall": "川味小炒",
  "floor": 5,
  "room": "512",
  "receiver": "李同学",
  "volume": 1,
  "picked": false
}
```

**索引**：`(tenantId, buildingId, waveId, status)` 复合索引 —— 首页查询走这条

---

## orders —— 影子订单（来自档口小票）

| 字段 | 类型 | 说明 |
|---|---|---|
| `tenantId` / `channel` / `channelOrderNo` | string | **渠道订单自然键，唯一** |
| `receiverName` / `receiverPhone` | string | 小票上的收件人 |
| `buildingId` / `room` / `floor` | — | 成包必需 |
| `stallId` / `stallName` / `canteenId` | string | 档口 |
| `volume` | number | 体积单位，汤粉类记 2 |
| `waveId` | string | 归属波次 |
| `source` | string | `scan` / `ocr` / `manual` |
| `status` | string | `CREATED → ACCEPTED → PACKED → DISPATCHED → PICKED → DELIVERED` |
| `version` | number | 条件更新用 |

**唯一索引**：`unique(tenantId, channel, channelOrderNo)`

> 合规：网络餐饮订单信息自交易完成起保存不少于三年（PRD 8.7）。

---

## wallet_logs —— 结算流水

| 字段 | 类型 | 说明 |
|---|---|---|
| `openid` | string | 收款学生 |
| `packId` | string | 关联包 |
| `type` | string | `delivery_income` / `bonus` / `withdraw` |
| `amount` | number | 金额（元） |
| `status` | string | `pending` / `settled` / `paid` |
| `title` | string | 展示文案 |

**索引**：`openid`、`(openid, status)`

---

## events / dispatches —— 幂等与防重

| 集合 | 唯一索引 | 防什么 |
|---|---|---|
| `events` | `externalEventId` | 平台回调重推，重复处理 |
| `dispatches` | `orderId` | 同一单被派给两个学生 |

---

## 云开发安全规则建议

| 集合 | 权限 |
|---|---|
| `students` | 仅创建者可读写 |
| `packs` | 仅管理员可写；读走云函数（不要在客户端直连，否则能绕过楼栋过滤看到别人的包） |
| `orders` / `wallet_logs` | 仅管理员可读写 |

> 所有查询都走云函数，客户端不直连数据库 —— 这是 `packs.list` 里楼栋/波次过滤不被绕过的前提。
