/**
 * 新模型的本地假数据 —— 抢单大厅 / 取餐 / 邀请 / 发单 / 钱包
 *
 * 为什么单独一个文件：旧的 mock.js 是"顺路包"模型，两套模型并存期间
 * 混在一起会互相污染。这里只实现 rider.* 和 admin.* 需要的部分。
 *
 * 规则刻意复制了一份简化版（定价加价、提现校验），不 require 云端 lib ——
 * 小程序包不能引用 miniprogram 以外的目录。两边规则若不一致，
 * 以 cloudfunctions/packer/lib/ 为准。
 */
const config = require('./config')

const HOUR = 3600000
const MINUTE = 60000
const now = Date.now()

function round2(n) {
  return Math.round(n * 100) / 100
}

/** 简化版建议价：基础 1.0 + 楼层 + 积压，封顶 3.0 */
function suggest(maxFloor, backlog) {
  const floor = maxFloor >= 6 ? 0.45 : (maxFloor >= 4 ? 0.25 : 0)
  const backlogBonus = Math.min(0.4, (backlog || 0) * 0.05)
  return round2(Math.min(3.0, Math.max(0.5, 1.0 + floor + backlogBonus)))
}

function mkOrders(tails, floorBase) {
  return tails.map(function (t, i) {
    return {
      id: 'o' + t,
      tail: t,
      room: String(floorBase + i) + '0' + (i + 1),
      floor: floorBase + i,
      stallName: ['川味小炒', '砂锅米线', '煎饼果子', '麻辣烫'][i % 4],
      picked: false,
      delivered: false,
    }
  })
}

const state = {
  token: 'mock-admin-token',
  student: {
    name: '张同学',
    credit: 96,
    claimsToday: 1,
    activeClaims: 0,
    coverageBuildings: ['3栋', '5栋'],
  },
  batches: [
    // 待发单（草稿）
    {
      id: 'D1', status: 'DRAFT', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'mid', minFloor: 4, maxFloor: 5, waveId: 'W2',
      orders: mkOrders(['8821', '5567', '3390'], 4), orderCount: 3,
    },
    {
      id: 'D2', status: 'DRAFT', buildingId: '5栋', buildingIds: ['5栋'],
      floorBand: 'high', minFloor: 6, maxFloor: 7, waveId: 'W2',
      orders: mkOrders(['1102', '7743'], 6), orderCount: 2,
    },
    // 已在池子里（学生可抢）
    {
      id: 'P1', status: 'POOLED', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'low', minFloor: 1, maxFloor: 3, waveId: 'W2',
      price: 1.2, orders: mkOrders(['2205', '6698', '9012'], 1), orderCount: 3,
      claimDeadline: now + 12 * MINUTE,
    },
    {
      id: 'P2', status: 'POOLED', buildingId: '3栋+5栋', buildingIds: ['3栋', '5栋'],
      floorBand: 'mid', minFloor: 4, maxFloor: 5, waveId: 'W2', crossBuilding: true,
      price: 1.5, orders: mkOrders(['4411', '3312', '7710', '2221'], 4), orderCount: 4,
      claimDeadline: now + 9 * MINUTE,
    },
  ],
  logs: [
    { id: 'L1', type: 'claim_income', amount: 12.5, status: 'settled', title: '3栋 1-3 层 · 3 单', createdAt: now - 30 * HOUR },
    { id: 'L2', type: 'claim_income', amount: 7.5, status: 'settled', title: '5栋 6-7 层 · 2 单', createdAt: now - 50 * HOUR },
    { id: 'L3', type: 'claim_income', amount: 4.2, status: 'pending', title: '3栋 4-5 层 · 3 单', createdAt: now - 2 * HOUR },
  ],
  inviteCode: 'K7M2QP',
  invite: { registered: 7, firstOrdered: 4, amount: 0 },
}

function delay(data) {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(data) }, 100)
  })
}

function fail(msg, code) {
  const e = new Error(msg)
  e.code = code || 400
  return Promise.reject(e)
}

function shapeBatch(b) {
  const count = b.orderCount
  const price = b.price || 0
  return {
    id: b.id,
    buildingId: b.buildingId,
    buildingIds: b.buildingIds,
    floorBand: b.floorBand,
    floorRange: b.minFloor + '-' + b.maxFloor + ' 层',
    crossBuilding: !!b.crossBuilding,
    orderCount: count,
    price: price,
    earn: round2(price * count),
    status: b.status,
    waveId: b.waveId,
    tails: b.orders.map(function (o) { return o.tail }),
    claimDeadline: b.claimDeadline || 0,
    orderList: b.orders.map(function (o) {
      return {
        id: o.id,
        tail: o.tail,
        room: o.room,
        floor: o.floor,
        stallName: o.stallName,
        picked: !!o.picked,
        delivered: !!o.delivered,
      }
    }),
  }
}

function balance() {
  let settled = 0
  let pending = 0
  let withdrawn = 0
  state.logs.forEach(function (l) {
    if (l.type === 'claim_income') {
      if (l.status === 'settled' || l.status === 'withdrawn') settled += l.amount
      if (l.status === 'pending') pending += l.amount
    }
    if (l.type === 'withdraw') withdrawn += Math.abs(l.amount)
  })
  return {
    pending: round2(pending),
    settled: round2(settled),
    withdrawing: round2(withdrawn),
    available: round2(Math.max(0, settled - withdrawn)),
  }
}

const handlers = {
  // ---------------- 骑手 ----------------
  'rider.home': function () {
    const cover = state.student.coverageBuildings
    const list = state.batches
      .filter(function (b) {
        if (b.status !== 'POOLED') return false
        return b.buildingIds.every(function (x) { return cover.indexOf(x) >= 0 })
      })
      .map(shapeBatch)
      .sort(function (a, b) { return b.earn - a.earn })

    return delay({
      student: state.student,
      canClaim: { ok: true },
      batches: list,
    })
  },

  'rider.grab': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    if (b.status !== 'POOLED') return fail('手慢了，这批已被抢走', 409)

    b.status = 'CLAIMED'
    b.claimedAt = Date.now()
    state.student.activeClaims += 1
    return delay({ ok: true, batch: shapeBatch(b) })
  },

  'rider.myBatches': function () {
    const mine = state.batches.filter(function (b) {
      return b.status === 'CLAIMED' || b.status === 'PICKED' || b.status === 'DELIVERED'
    }).map(shapeBatch)
    return delay({
      active: mine.filter(function (b) { return b.status !== 'DELIVERED' }),
      finished: mine.filter(function (b) { return b.status === 'DELIVERED' }),
    })
  },

  'rider.pickup': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    const no = String(p.orderNo || '').trim()
    const hit = b.orders.filter(function (o) {
      return o.tail === no || o.id === no
    })[0]
    if (!hit) return fail('这批里没有这个运单号', 404)

    hit.picked = true
    if (b.orders.every(function (o) { return o.picked })) b.status = 'PICKED'
    return delay({ ok: true, allPicked: b.status === 'PICKED' })
  },

  'rider.deliver': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    if (!p.photo) return fail('请先上传送达照片', 400)

    const o = b.orders.filter(function (x) { return x.id === p.orderId })[0]
    if (!o) return fail('这一单不在批次里', 404)
    o.delivered = true

    if (b.orders.every(function (x) { return x.delivered })) {
      b.status = 'DELIVERED'
      state.student.activeClaims = Math.max(0, state.student.activeClaims - 1)
      state.logs.unshift({
        id: 'L' + (state.logs.length + 1),
        type: 'claim_income',
        amount: round2(b.price * b.orderCount),
        status: 'pending',
        title: b.buildingId + ' · ' + b.orderCount + ' 单',
        createdAt: Date.now(),
      })
    }
    return delay({ ok: true, allDone: b.status === 'DELIVERED' })
  },

  'rider.invite': function () {
    return delay({
      code: state.inviteCode,
      amount: state.invite.amount,
      registered: state.invite.registered,
      firstOrdered: state.invite.firstOrdered,
      nextRegisterGap: 10 - (state.invite.registered % 10),
      nextOrderGap: 10 - (state.invite.firstOrdered % 10),
    })
  },

  'rider.bindInvite': function () {
    return delay({ ok: true })
  },

  // ---------------- 钱包 ----------------
  'rider.wallet': function () {
    return delay({
      balance: balance(),
      logs: state.logs.slice(0, 20),
      todayWithdrawals: 0,
    })
  },

  'rider.withdraw': function (p) {
    const amount = Number(p.amount)
    const b = balance()
    if (amount < 10) return fail('最低提现 10 元', 400)
    if (amount > b.available) return fail('可提现余额不足', 400)

    state.logs.unshift({
      id: 'W' + (state.logs.length + 1),
      type: 'withdraw',
      amount: -round2(amount),
      status: 'pending',
      title: '提现',
      createdAt: Date.now(),
    })
    return delay({ ok: true, balance: balance() })
  },

  // ---------------- 运营 ----------------
  'admin.login': function () {
    return delay({ token: state.token, username: 'demo', role: 'owner' })
  },

  'admin.pendingBatches': function () {
    const drafts = state.batches.filter(function (b) { return b.status === 'DRAFT' })
    const backlog = drafts.length
    const list = drafts.map(function (b) {
      const price = suggest(b.maxFloor, backlog)
      return {
        id: b.id,
        buildingIds: b.buildingIds,
        floorBand: b.floorBand,
        floorRange: b.minFloor + '-' + b.maxFloor + ' 层',
        orderCount: b.orderCount,
        suggestedPrice: price,
        breakdown: {
          base: 1.0,
          floor: b.maxFloor >= 6 ? 0.45 : 0.25,
          backlog: round2(Math.min(0.4, backlog * 0.05)),
        },
        cost: round2(price * b.orderCount),
      }
    })
    return delay({
      batches: list,
      summary: {
        count: list.length,
        totalOrders: list.reduce(function (s, b) { return s + b.orderCount }, 0),
        totalCost: round2(list.reduce(function (s, b) { return s + b.cost }, 0)),
        backlog: backlog,
      },
    })
  },

  'admin.publishBatch': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    if (b.status !== 'DRAFT') return fail('批次状态是 ' + b.status + '，不能发单', 409)

    const price = Number(p.price)
    if (!(price >= 0.5 && price <= 3.0)) return fail('价格超出范围', 400)

    b.status = 'POOLED'
    b.price = round2(price)
    b.claimDeadline = Date.now() + 15 * MINUTE
    return delay({ ok: true, price: b.price })
  },

  'admin.publishAll': function () {
    const drafts = state.batches.filter(function (b) { return b.status === 'DRAFT' })
    drafts.forEach(function (b) {
      b.status = 'POOLED'
      b.price = suggest(b.maxFloor, drafts.length)
      b.claimDeadline = Date.now() + 15 * MINUTE
    })
    return delay({ published: drafts.length, total: drafts.length })
  },

  'admin.stats': function () {
    const pooled = state.batches.filter(function (b) { return b.status === 'POOLED' }).length
    return delay({
      packCount: state.batches.length,
      packedOrders: state.batches.reduce(function (s, b) { return s + b.orderCount }, 0),
      avgOrdersPerPack: 3.2,
      avgOk: false,
      fallbackCount: 0,
      alertCount: 0,
      alerts: [],
      packs: [],
      patrol: 0,
      pooled: pooled,
    })
  },
}

function handle(action, payload) {
  if (action === 'admin.bootstrap' || action === 'admin.login') {
    return handlers['admin.login'](payload || {})
  }
  const fn = handlers[action]
  if (!fn) return fail('未知接口: ' + action, 404)
  return fn(payload || {})
}

module.exports = { handle: handle, state: state }
