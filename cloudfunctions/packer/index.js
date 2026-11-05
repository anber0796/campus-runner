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
const executor = require('./lib/executor')
const notify = require('./lib/notify')
const batcher = require('./lib/batcher')
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

/**
 * 巡检 + 执行（定时触发器每 2 分钟跑一次）
 *
 * 注意：这里把 packs / students / creditLogs 全量拉进内存再执行。
 * 单校规模（几十个包、上千学生）扛得住；多校扩张后要改成按 tenant + 状态分页处理。
 * 执行器内部只写回报告里列出的那几条，不会把整个集合刷一遍。
 */
async function runExecute() {
  const now = Date.now()

  const packs = await fetchAll(db.collection('packs').where({
    tenantId: config.TENANT_ID,
    status: _.in(['available', 'accepted', 'picked']),
  }))
  const students = await fetchAll(db.collection('students'))
  const creditLogs = await fetchAll(db.collection('credit_logs').where({ tenantId: config.TENANT_ID }))

  const state = { packs: packs, students: students, creditLogs: creditLogs, alerts: [] }
  const logCountBefore = state.creditLogs.length

  const actions = patrol(packs, now)
  const report = executor.execute(state, actions, { now: now })

  // 回写被改动的包
  for (const id of report.changedPacks) {
    const p = state.packs.filter(function (x) { return x._id === id || x.id === id })[0]
    if (!p) continue
    await db.collection('packs').doc(p._id).update({
      data: {
        status: p.status,
        acceptedBy: p.acceptedBy || null,
        previousAcceptedBy: p.previousAcceptedBy || null,
        fallbackAt: p.fallbackAt || null,
        fallbackReason: p.fallbackReason || null,
        updatedAt: p.updatedAt,
      },
    })
  }

  // 回写被扣分 / 被冻结的学生
  for (const key of report.changedStudents) {
    const s = state.students.filter(function (x) {
      return x.id === key || x.openid === key
    })[0]
    if (!s) continue
    await db.collection('students').doc(s._id).update({
      data: { credit: s.credit, frozenUntil: s.frozenUntil || null },
    })
  }

  // 新增的扣分流水
  const newLogs = state.creditLogs.slice(logCountBefore)
  for (const l of newLogs) {
    await db.collection('credit_logs').add({ data: Object.assign({ tenantId: config.TENANT_ID }, l) })
  }

  // 新增告警（注意 state.alerts 里装的全是本次新产生的）
  for (const a of state.alerts) {
    await db.collection('alerts').add({ data: Object.assign({ tenantId: config.TENANT_ID }, a) })
  }

  return {
    ok: true,
    actions: actions.length,
    applied: report.applied.length,
    skipped: report.skipped.length,
    details: report.applied,
  }
}

/**
 * 波次预告推送（定时触发器：每个波次前 10 分钟跑一次）
 *
 * 一次只给一个学生推一个包。理由：
 *   1. 微信一次性订阅 = 一次授权只能推一条，多发会失败
 *   2. 一次性推 3 个包会让选择成本变高，反而降低接单率
 */
async function runNotify() {
  const now = Date.now()
  const tenantId = config.TENANT_ID

  if (!config.SUBSCRIBE_TEMPLATE_ID) {
    return { ok: false, msg: '未配置 SUBSCRIBE_TEMPLATE_ID，推送已跳过' }
  }

  const packs = await fetchAll(db.collection('packs').where({ tenantId: tenantId, status: 'available' }))
  const eligible = packs.filter(function (p) { return notify.isEligiblePack(p) })
  if (!eligible.length) return { ok: true, eligible: 0, sent: 0 }

  const students = await fetchAll(db.collection('students').where({ status: 'active' }))
  const logs = await fetchAll(db.collection('notification_logs').where({ tenantId: tenantId, type: 'wave_preview' }))

  const historyBy = {}
  logs.forEach(function (l) {
    if (!historyBy[l.openid]) historyBy[l.openid] = []
    historyBy[l.openid].push({ at: l.at })
  })

  let sent = 0
  let skipped = 0
  let failed = 0
  const notified = {}

  for (const stu of students) {
    const mine = notify.matchPacks(stu, eligible).filter(function (p) { return !notified[p._id] })
    if (!mine.length) continue

    const gate = notify.canNotify(historyBy[stu.openid], now)
    if (!gate.ok) {
      skipped++
      continue
    }

    const pack = mine[0]
    try {
      await cloud.openapi.subscribeMessage.send({
        touser: stu.openid,
        templateId: config.SUBSCRIBE_TEMPLATE_ID,
        page: 'pages/index/index',
        miniprogramState: 'formal',
        data: notify.buildTemplateData(pack),
      })
      await db.collection('notification_logs').add({
        data: { tenantId: tenantId, openid: stu.openid, packId: pack._id, type: 'wave_preview', at: now },
      })
      notified[pack._id] = true
      sent++
    } catch (e) {
      failed++
      // 43101 = 用户拒收/没有订阅额度；47003 = 模板字段不匹配。两者都不该中断整批
      console.warn('[notify]', stu.openid, (e && (e.errCode || e.message)) || e)
    }
  }

  for (const id of Object.keys(notified)) {
    await db.collection('packs').doc(id).update({ data: { notifiedAt: now } })
  }

  return { ok: true, eligible: eligible.length, sent: sent, skipped: skipped, failed: failed }
}

/**
 * 自动成批（定时触发器，建议每 5 分钟跑一次）
 *
 * 池子里的订单 → 按「食堂×楼栋×波次×楼层段」成批 → 落库为草稿态。
 * 草稿态**不发给学生**，必须由代理商定价后才进池子（POOLED）。
 * 这一步刻意不做成"自动发单"——价格由人定，是这套模式的核心。
 */
async function runGenerate() {
  const tenantId = config.TENANT_ID
  const raw = await fetchAll(db.collection('orders').where({ tenantId: tenantId, status: 'CREATED' }))

  if (!raw.length) return { ok: true, created: 0, stats: { inputOrders: 0 } }

  // batcher 用 o.id 做键，数据库文档用 _id，这里统一
  const orders = raw.map(function (o) { return Object.assign({}, o, { id: o._id }) })
  const result = batcher.buildBatches(orders, { allowCrossBuilding: false })

  let created = 0
  for (const b of result.batches) {
    await db.collection('batches').add({
      data: {
        tenantId: tenantId,
        canteenId: b.canteenId,
        buildingId: b.buildingId,
        buildingIds: b.buildingIds || [b.buildingId],
        waveId: b.waveId,
        floorBand: b.floorBand,
        orders: b.orders,
        orderCount: b.orderCount,
        volume: b.volume,
        minFloor: b.minFloor,
        maxFloor: b.maxFloor,
        status: 'DRAFT',
        version: 0,
        createdAt: Date.now(),
      },
    })
    created++

    // 订单标为已入批，避免下一轮重复成批
    await db.collection('orders')
      .where({ _id: _.in(b.orders), status: 'CREATED' })
      .update({ data: { status: 'PACKED', updatedAt: Date.now() } })
  }

  return { ok: true, created: created, stats: result.stats, leftover: result.leftover.length }
}

exports.main = async function (event) {
  const action = (event && event.action) || 'pack'

  // 骑手端接口（抢单大厅）——用 openid 认人，不需要 token
  if (String(action).indexOf('rider.') === 0) {
    const rider = require('./handlers/rider')
    const fn = rider[action]
    if (!fn) return { code: 404, msg: '未知骑手接口: ' + action }
    try {
      const data = await fn({ event: event, db: db, ctx: cloud.getWXContext() })
      return { code: 0, data: data }
    } catch (e) {
      console.error('[rider]', action, e)
      return { code: e.code || 500, msg: e.message || '服务器错误' }
    }
  }

  // 运营后台接口走独立路由（自带 token 鉴权）
  if (String(action).indexOf('admin.') === 0) {
    return require('./handlers/admin').route({
      event: event,
      db: db,
      ctx: cloud.getWXContext(),
    })
  }

  try {
    if (action === 'pack') return await runPack(event)
    if (action === 'patrol') return await runPatrol()
    if (action === 'execute') return await runExecute()
    if (action === 'notify') return await runNotify()
    if (action === 'generate') return await runGenerate()
    return { ok: false, msg: '未知 action: ' + action }
  } catch (e) {
    console.error('[packer]', action, e)
    return { ok: false, msg: e.message }
  }
}
