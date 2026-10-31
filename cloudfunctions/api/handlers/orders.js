/**
 * 订单入库 —— PRD 8.3 的小票扫码 / OCR 入口。
 *
 * 这是整条链路唯一零依赖的数据来源：不申请 ISV、不要求档口改签服务包、
 * 不碰平台接口。小票上本来就印着订单号、收件人、楼栋寝室号。
 *
 * 幂等的关键：同一张小票被扫两次（手抖、网络重试、两个档口都扫了）绝不能变成两单，
 * 否则同一个学生可能把同一份餐送两次，或者两个学生抢同一份餐。
 */
const { findExistingOrder } = require('../lib/guard')
const { AppError } = require('../lib/errors')
const config = require('../lib/config')

const REQUIRED = ['channel', 'channelOrderNo', 'buildingId', 'room', 'stallName', 'floor']

module.exports = {
  'orders.ingest': async function (args) {
    const db = args.db
    const o = args.event.order || {}

    const lack = REQUIRED.filter(function (k) {
      return o[k] === undefined || o[k] === null || o[k] === ''
    })
    if (lack.length) {
      throw AppError(400, '缺少字段: ' + lack.join(', '))
    }

    const key = {
      tenantId: config.TENANT_ID,
      channel: o.channel,
      channelOrderNo: String(o.channelOrderNo),
    }

    // 第一层唯一约束：渠道订单自然键
    const dup = await findExistingOrder(db, key)
    if (dup) {
      return { duplicated: true, orderId: dup._id }
    }

    const doc = {
      tenantId: key.tenantId,
      channel: key.channel,
      channelOrderNo: key.channelOrderNo,
      receiverName: o.receiverName || '',
      receiverPhone: o.receiverPhone || '',
      buildingId: o.buildingId,
      buildingName: o.buildingName || '',
      room: o.room,
      floor: Number(o.floor) || 1,
      stallId: o.stallId || '',
      stallName: o.stallName,
      canteenId: o.canteenId || '',
      volume: Number(o.volume) || 1,
      waveId: o.waveId || '',
      source: o.source || 'scan',
      status: 'CREATED',
      version: 0,
      createdAt: Date.now(),
    }

    try {
      const r = await db.collection('orders').add({ data: doc })
      return { duplicated: false, orderId: r._id }
    } catch (e) {
      // 并发下仍可能撞车：回查一次，以已存在的为准，绝不生成第二单
      const again = await findExistingOrder(db, key)
      if (again) return { duplicated: true, orderId: again._id }
      throw e
    }
  },
}
