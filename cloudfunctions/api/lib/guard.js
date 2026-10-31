/**
 * PRD 8.7 的三层唯一约束 —— 上线第一天最容易出事的地方。
 *
 * 1) 渠道订单自然键唯一：tenantId + channel + channelOrderNo  → 同一份餐不会被入库两次
 * 2) 回调事件唯一：externalEventId                             → 平台重推不会重复处理
 * 3) 派单幂等键唯一：dispatch:{orderId}                        → 同一单不会被派给两个学生
 *
 * 云数据库没有唯一索引，所以用「先查后写 + 冲突时以已存在记录为准」实现，
 * 并在 db/schema.md 里列了真实数据库（MySQL/Postgres）应该建的唯一索引。
 */
const { AppError } = require('./errors')

/** 订单入库去重 */
async function findExistingOrder(db, key) {
  const res = await db.collection('orders').where({
    tenantId: key.tenantId,
    channel: key.channel,
    channelOrderNo: key.channelOrderNo,
  }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 事件去重 */
async function findExistingEvent(db, externalEventId) {
  const res = await db.collection('events').where({ externalEventId: externalEventId }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

/** 派单幂等：同一 orderId 已经派出去过就返回原包 */
async function findDispatch(db, orderId) {
  const res = await db.collection('dispatches').where({ orderId: orderId }).limit(1).get()
  return res.data && res.data[0] ? res.data[0] : null
}

module.exports = {
  findExistingOrder: findExistingOrder,
  findExistingEvent: findExistingEvent,
  findDispatch: findDispatch,
  AppError: AppError,
}
