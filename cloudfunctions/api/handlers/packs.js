const waves = require('../lib/waves')
const commission = require('../lib/commission')
const studentLib = require('../lib/student')
const { AppError } = require('../lib/errors')
const config = require('../lib/config')

function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 给包补上展示字段：单量、收益、楼层区间、"这一趟"文案 */
function decorate(pack) {
  const income = commission.calcPackIncome(pack.orders || [])
  const floors = (pack.orders || []).map(function (o) { return o.floor || 1 })
  return Object.assign({}, pack, {
    orderCount: (pack.orders || []).length,
    income: income,
    pickedCount: (pack.orders || []).filter(function (o) { return o.picked }).length,
    minFloor: floors.length ? Math.min.apply(null, floors) : 0,
    maxFloor: floors.length ? Math.max.apply(null, floors) : 0,
    caption: '这一趟 ¥' + income.total + ' · 顺路 ' + (pack.walkMinutes || 0) + ' 分钟 · 帮 ' +
      (pack.orders || []).length + ' 位同学带饭回 ' + pack.buildingName,
  })
}

module.exports = {
  // 首页：只返回本楼、本波次、收益达标的包
  'packs.list': async function (args) {
    const db = args.db
    const s = await studentLib.getStudent(db, args.ctx.OPENID)
    if (!studentLib.isCertified(s)) {
      throw AppError(403, '请先完成认证')
    }

    const _ = db.command
    const res = await db.collection('packs').where({
      tenantId: config.TENANT_ID,
      buildingId: s.buildingId,
      status: 'available',
      waveId: _.in(s.waveIds || []),
    }).orderBy('createdAt', 'asc').limit(20).get()

    const list = (res.data || [])
      .map(decorate)
      // PRD 3.4：包预估收益 < 2.0 不推送，避免消耗推送额度、损伤信任
      .filter(function (p) { return p.income.pushable })

    return { packs: list, wave: waves.nextWave(new Date()) }
  },

  'packs.detail': async function (args) {
    const db = args.db
    const id = args.event.id
    const res = await db.collection('packs').doc(id).get()
    if (!res.data) throw AppError(404, '包不存在')
    return decorate(res.data)
  },

  'packs.accept': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const id = args.event.id
    const _ = db.command

    const s = await studentLib.getStudent(db, openid)
    if (!studentLib.isCertified(s)) {
      throw AppError(403, '请先完成认证')
    }

    // 单人日接单上限
    const todayStart = startOfToday()
    const todayCount = await db.collection('packs').where({
      acceptedBy: openid,
      acceptedAt: _.gte(todayStart),
    }).count()
    if (todayCount.total >= config.MAX_PACKS_PER_DAY) {
      throw AppError(429, '今日接单已达上限（' + config.MAX_PACKS_PER_DAY + ' 包）')
    }

    // 条件更新：只有仍处于 available 才能被抢到，天然防止两个人同时接走同一单
    const r = await db.collection('packs').where({ _id: id, status: 'available' }).update({
      data: {
        status: 'accepted',
        acceptedBy: openid,
        acceptedAt: Date.now(),
        updatedAt: Date.now(),
        version: _.inc(1),
      },
    })

    const updated = r && r.stats ? r.stats.updated : 0
    if (updated !== 1) {
      throw AppError(409, '手慢了，这个包已被接走')
    }

    const fresh = await db.collection('packs').doc(id).get()
    return decorate(fresh.data)
  },

  'orders.my': async function (args) {
    const db = args.db
    const openid = args.ctx.OPENID
    const res = await db.collection('packs')
      .where({ acceptedBy: openid })
      .orderBy('acceptedAt', 'desc')
      .limit(30)
      .get()

    const list = (res.data || []).map(decorate)
    return {
      active: list.filter(function (p) { return p.status !== 'delivered' }),
      finished: list.filter(function (p) { return p.status === 'delivered' }),
    }
  },
}

module.exports.decorate = decorate
