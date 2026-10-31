/**
 * 成包器云函数
 *
 * 两个 action：
 *   { action: 'pack',   waveId?: 'W2' }  → 把待成包订单跑成顺路包
 *   { action: 'patrol' }                 → 只返回兜底判定，不改数据
 *
 * 建议配定时触发器：波次前 15 分钟跑一次 pack，每 2 分钟跑一次 patrol。
 * 腾讯云 SCF 的 cron 是 7 段且按北京时间，例如每 2 分钟一次：0 *\/2 * * * * *
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { buildPacks } = require('./lib/packer')
const { patrol } = require('./lib/patrol')
const config = require('./lib/config')

/**
 * 云数据库单次 get 最多 100 条，必须分页拉全量。
 * 漏拉会直接导致"有些单永远成不了包"——这种 bug 在高峰期最难查。
 */
async function fetchAll(query, pageSize) {
  const size = pageSize || 100
  const out = []
  let skip = 0

  for (;;) {
    const res = await query.skip(skip).limit(size).get()
    const batch = res.data || []
    out.push.apply(out, batch)
    if (batch.length < size) break
    skip += size
    if (skip > 5000) break // 兜底，防止死循环
  }
  return out
}

async function runPack(event) {
  const where = { tenantId: config.TENANT_ID, status: 'CREATED' }
  if (event && event.waveId) where.waveId = event.waveId

  const orders = await fetchAll(db.collection('orders').where(where))

  if (!orders.length) {
    return { ok: true, created: 0, stats: { inputOrders: 0, packCount: 0 } }
  }

  const result = buildPacks(orders, {
    slowStalls: config.SLOW_STALLS || [],
  })

  // 包名 → 真实 _id，供订单回写
  const created = []
  for (const p of result.packs) {
    const doc = {
      tenantId: config.TENANT_ID,
      buildingId: p.buildingId,
      canteenId: p.canteenId,
      waveId: p.waveId,
      orders: p.orders.map(function (id) {
        const o = orders.filter(function (x) { return x.id === id })[0] || {}
        return {
          id: id,
          tail: String(o.channelOrderNo || '').slice(-4),
          stallId: o.stallId || '',
          stallName: o.stallName || '',
          floor: o.floor || 1,
          room: o.room || '',
          volume: o.volume || 1,
          picked: false,
        }
      }),
      orderCount: p.orderCount,
      volume: p.volume,
      minFloor: p.minFloor,
      maxFloor: p.maxFloor,
      income: p.income,
      walkMinutes: p.walkMinutes || 9,
      status: 'available',
      version: 0,
      createdAt: Date.now(),
      offeredAt: Date.now(),
    }
    const r = await db.collection('packs').add({ data: doc })
    created.push({ _id: r._id, orderIds: p.orders })
  }

  // 订单回写为 PACKED：条件更新，避免和别的成包任务抢同一单
  for (const c of created) {
    await db.collection('orders')
      .where({ _id: _.in(c.orderIds), status: 'CREATED', tenantId: config.TENANT_ID })
      .update({ data: { status: 'PACKED', packId: c._id, updatedAt: Date.now() } })
  }

  return {
    ok: true,
    created: created.length,
    stats: result.stats,
    dropped: result.dropped.length,
  }
}

async function runPatrol() {
  const packs = await fetchAll(db.collection('packs').where({
    tenantId: config.TENANT_ID,
    status: _.in(['available', 'accepted', 'picked']),
  }))
  return { ok: true, actions: patrol(packs, Date.now()) }
}

exports.main = async function (event) {
  const action = (event && event.action) || 'pack'
  try {
    if (action === 'pack') return await runPack(event)
    if (action === 'patrol') return await runPatrol()
    return { ok: false, msg: '未知 action: ' + action }
  } catch (e) {
    console.error('[packer]', action, e)
    return { ok: false, msg: e.message }
  }
}
