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

function mkOrders(tails, floorBase, canteenName) {
  const STALLS = [
    { name: '川味小炒', floor: 1 },
    { name: '砂锅米线', floor: 2 },
    { name: '煎饼果子', floor: 1 },
    { name: '麻辣烫', floor: 3 },
  ]
  return tails.map(function (t, i) {
    const st = STALLS[i % 4]
    return {
      id: 'o' + t,
      tail: t,
      room: String(floorBase + i) + '0' + (i + 1),
      floor: floorBase + i,
      canteenName: canteenName || '一食堂',
      stallName: st.name,
      stallFloor: st.floor,
      // 承诺送达时刻：40 分钟时限，逐单错开几分钟，方便看倒计时梯度
      dueAt: now + (18 + i * 6) * MINUTE,
      picked: false,
      delivered: false,
    }
  })
}


/**
 * 随机生成一批"待抢"批次，用来压测可抢单卡片的排布。
 * 刻意把参数拉散：3 个食堂、多个楼栋、三种楼层段、不同价格与紧迫度。
 */
function makePooled(n) {
  const CANTEENS = [
    { id: 'C1', name: '一食堂' },
    { id: 'C2', name: '二食堂' },
    { id: 'C3', name: '三食堂' },
  ]
  const BUILDINGS = ['1栋', '2栋', '3栋', '5栋', '6栋', '7栋', '8栋']
  const BANDS = [
    { id: 'low', from: 1, to: 3 },
    { id: 'mid', from: 4, to: 5 },
    { id: 'high', from: 6, to: 7 },
  ]

  const pickOne = function (arr) { return arr[Math.floor(Math.random() * arr.length)] }
  const out = []

  for (let i = 0; i < n; i++) {
    const c = pickOne(CANTEENS)
    const band = pickOne(BANDS)
    // 不跨楼：一批只服务一栋，取完直接走，不用分拣
    const buildings = [pickOne(BUILDINGS)]
    const maxOrders = 6
    const orderCount = 2 + Math.floor(Math.random() * (maxOrders - 1))

    const tails = []
    for (let k = 0; k < orderCount; k++) {
      tails.push(String(1000 + Math.floor(Math.random() * 9000)))
    }

    const orders = mkOrders(tails, band.from, c.name).map(function (o, idx) {
      const b = buildings[idx % buildings.length]
      // 承诺时间刻意拉开：有的只剩几分钟，有的还早
      const left = idx === 0
        ? 4 + Math.floor(Math.random() * 8)
        : 12 + Math.floor(Math.random() * 25)
      return Object.assign({}, o, {
        stallFloor: band.from + (idx % (band.to - band.from + 1)),
        buildingId: b,
        buildingName: b,
        dueAt: Date.now() + left * MINUTE,
      })
    })

    out.push({
      id: 'R' + (i + 1),
      status: 'POOLED',
      canteenId: c.id,
      canteenName: c.name,
      buildingId: buildings.join('+'),
      buildingIds: buildings,
      floorBand: band.id,
      minFloor: band.from,
      maxFloor: band.to,
      waveId: 'W2',
      crossBuilding: false,
      price: Math.round((0.9 + Math.random() * 1.0) * 100) / 100,
      walkMinutes: 4 + Math.floor(Math.random() * 9),
      orders: orders,
      orderCount: orders.length,
      claimDeadline: Date.now() + (1 + Math.floor(Math.random() * 20)) * MINUTE,
    })
  }

  return out
}

const state = {
  token: 'mock-admin-token',
  student: {
    openid: 'mock-openid',
    name: '张同学',
    status: 'active',
    credit: 96,
    realmobile: '',
    claimsToday: 1,
    activeClaims: 0,
    // 演示用：覆盖全部楼栋，方便一次看到足够多的可抢批次
    coverageBuildings: ['1栋', '2栋', '3栋', '5栋', '6栋', '7栋', '8栋'],
  },
  batches: [
    // 待发单（草稿）
    {
      id: 'D1', status: 'DRAFT', canteenId: 'C1', canteenName: '一食堂', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'mid', minFloor: 4, maxFloor: 5, waveId: 'W2',
      orders: mkOrders(['8821', '5567', '3390'], 4), orderCount: 3,
    },
    {
      id: 'D2', status: 'DRAFT', canteenId: 'C2', canteenName: '二食堂', buildingId: '5栋', buildingIds: ['5栋'],
      floorBand: 'high', minFloor: 6, maxFloor: 7, waveId: 'W2',
      orders: mkOrders(['1102', '7743'], 6, '二食堂'), orderCount: 2,
    },
    // 已在池子里（学生可抢）
    {
      id: 'P5', status: 'DELIVERED', canteenId: 'C1', canteenName: '一食堂', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'low', minFloor: 2, maxFloor: 3, waveId: 'W2',
      price: 1.15, orders: mkOrders(['9901', '9902', '9903'], 2), orderCount: 3,
      assignedOpenid: 'mock-openid', assignedName: '张同学',
      assignedAt: now - 3 * HOUR, deliveredAt: now - 2 * HOUR,
    },
    {
      id: 'P6', status: 'PICKED', canteenId: 'C2', canteenName: '二食堂', walkMinutes: 9,
      buildingId: '5栋', buildingIds: ['5栋'],
      floorBand: 'mid', minFloor: 5, maxFloor: 6, waveId: 'W2',
      price: 1.3, orders: mkOrders(['8801', '8802'], 5, '二食堂'), orderCount: 2,
      assignedOpenid: 'mock-openid', assignedName: '张同学', assignedAt: now - 25 * MINUTE,
      pickedAt: now - 15 * MINUTE,
    },
    {
      id: 'P4', status: 'PICKED', canteenId: 'C1', canteenName: '一食堂', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'high', minFloor: 6, maxFloor: 7, waveId: 'W2',
      price: 1.9, orders: mkOrders(['6601', '6602'], 6), orderCount: 2,
      assignedOpenid: 'mock-openid', assignedName: '张同学', assignedAt: now - 20 * MINUTE,
      pickedAt: now - 10 * MINUTE,
    },
    {
      id: 'P7', status: 'ASSIGNED', canteenId: 'C1', canteenName: '一食堂', walkMinutes: 7,
      buildingId: '5栋', buildingIds: ['5栋'],
      floorBand: 'high', minFloor: 6, maxFloor: 7, waveId: 'W2',
      price: 1.7, orders: mkOrders(['7001', '7002'], 6), orderCount: 2,
      assignedOpenid: 'mock-openid', assignedName: '张同学', assignedAt: now - 10 * MINUTE,
    },
    {
      id: 'P2', status: 'ASSIGNED', canteenId: 'C1', canteenName: '一食堂', buildingId: '3栋', buildingIds: ['3栋'],
      floorBand: 'mid', minFloor: 4, maxFloor: 5, waveId: 'W2', crossBuilding: false,
      price: 1.5, orders: mkOrders(['4411', '3312', '7710', '2221'], 4), orderCount: 4,
      assignedOpenid: 'mock-openid', assignedName: '张同学', assignedAt: now - 5 * MINUTE,
    },
  ].concat(makePooled(10)),
  logs: [
    { id: 'L1', type: 'claim_income', amount: 12.5, status: 'settled', title: '3栋 1-3 层 · 3 单', createdAt: now - 30 * HOUR },
    { id: 'L2', type: 'claim_income', amount: 7.5, status: 'settled', title: '5栋 6-7 层 · 2 单', createdAt: now - 50 * HOUR },
    { id: 'L3', type: 'claim_income', amount: 4.2, status: 'pending', title: '3栋 4-5 层 · 3 单', createdAt: now - 2 * HOUR },
  ],
  inviteCode: 'K7M2QP',
  invite: { registered: 7, firstOrdered: 4, amount: 0 },
}

// 跨楼批次（P2）里，订单要各自归属到具体楼栋，否则送达时拆不开
state.batches.forEach(function (b) {
  if (b.buildingIds && b.buildingIds.length > 1) {
    b.orders.forEach(function (o, i) {
      o.buildingId = b.buildingIds[i % b.buildingIds.length]
      o.buildingName = o.buildingId
    })
  } else {
    b.orders.forEach(function (o) {
      o.buildingId = o.buildingId || b.buildingId
      o.buildingName = o.buildingName || b.buildingId
    })
  }
})

// 已取餐的批次，订单要标成已取——否则「待送达」页里点不出送达按钮
state.batches.forEach(function (b) {
  if (b.status === 'PICKED') {
    b.orders.forEach(function (o) { o.picked = true })
  }
  if (b.status === 'DELIVERED') {
    b.orders.forEach(function (o) {
      o.picked = true
      o.delivered = true
      // 比承诺时间早到 4 分钟，示例数据里显示为"准时"
      o.deliveredAt = (o.dueAt || Date.now()) - 4 * MINUTE
    })
  }
})

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
    canteenId: b.canteenId,
    canteenName: b.canteenName || '食堂',
    walkMinutes: b.walkMinutes || 0,
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
        buildingId: o.buildingId || b.buildingId,
        buildingName: o.buildingName || '',
        canteenName: o.canteenName || '一食堂',
        stallName: o.stallName,
        stallFloor: o.stallFloor || 1,
        dueAt: o.dueAt || 0,
        picked: !!o.picked,
        delivered: !!o.delivered,
        deliveredAt: o.deliveredAt || 0,
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

/**
 * 与 cloudfunctions/packer/lib/claim.js 保持一致的准入规则。
 * mock 里曾经恒返回 ok，导致调试时以为能抢、上线才发现被锁。
 */
function canClaimMock(batch) {
  const s = state.student

  if (!s) return { ok: false, reason: 'no_student' }
  if (s.status !== 'active') return { ok: false, reason: 'not_certified' }
  if (s.punishUntil && s.punishUntil > Date.now()) return { ok: false, reason: 'punished' }
  if ((s.credit || 0) < 80) return { ok: false, reason: 'credit_too_low' }
  if ((s.claimsToday || 0) >= 6) return { ok: false, reason: 'daily_limit' }
  if ((s.activeClaims || 0) >= 2) return { ok: false, reason: 'active_limit' }

  if (batch) {
    if (batch.status !== 'POOLED') return { ok: false, reason: 'already_taken' }
    if (!(batch.price > 0)) return { ok: false, reason: 'no_price' }
    const need = batch.buildingIds || [batch.buildingId]
    const cover = s.coverageBuildings || []
    for (let i = 0; i < need.length; i++) {
      if (cover.indexOf(need[i]) < 0) return { ok: false, reason: 'building_not_covered' }
    }
  }

  return { ok: true }
}

const handlers = {
  // ---------------- 学生档案 ----------------
  'student.get': function () {
    return delay({ student: state.student, missing: [] })
  },

  'student.save': function (p) {
    state.student = Object.assign({}, state.student, p.profile || {}, {
      // 只填了基础信息 → pending；补齐资质 → active
      status: p.partial ? 'pending' : 'active',
      needRegister: false,
    })
    return delay({ student: state.student })
  },

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
      canClaim: canClaimMock(list[0]),
      batches: list,
    })
  },

  'rider.grab': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)

    const gate = canClaimMock(b)
    if (!gate.ok) {
      if (gate.reason === 'already_taken') return fail('手慢了，这批已被抢走', 409)
      return fail(gate.reason, 409)
    }

    b.status = 'CLAIMED'
    b.claimedAt = Date.now()
    b.claimedBy = state.student.openid
    state.student.activeClaims += 1
    state.student.claimsToday = (state.student.claimsToday || 0) + 1
    return delay({ ok: true, batch: shapeBatch(b) })
  },

  'rider.release': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    if (b.status !== 'CLAIMED') return fail('只有已抢未取的单可以放弃', 409)

    b.status = 'POOLED'
    b.claimedAt = null
    b.claimedBy = null
    state.student.activeClaims = Math.max(0, state.student.activeClaims - 1)
    return delay({ ok: true })
  },

  'rider.myBatches': function () {
    const mine = state.batches.filter(function (b) {
      return b.status === 'ASSIGNED' || b.status === 'CLAIMED' ||
        b.status === 'PICKED' || b.status === 'DELIVERED'
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
      if (p.orderId) return o.id === p.orderId
      return o.tail === no || o.id === no
    })[0]
    if (!hit) return fail(p.orderId ? '这一单不在批次里' : '这批里没有这个运单号', 404)

    hit.picked = true
    if (b.orders.every(function (o) { return o.picked })) b.status = 'PICKED'
    return delay({ ok: true, allPicked: b.status === 'PICKED' })
  },

  'rider.unpick': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    const o = b.orders.filter(function (x) { return x.id === p.orderId })[0]
    if (!o) return fail('这一单不在批次里', 404)
    if (o.delivered) return fail('已送达的不能撤销', 409)
    o.picked = false
    if (b.status === 'PICKED') b.status = 'CLAIMED'
    return delay({ ok: true })
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
      bound: false,
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

  'admin.checklist': function () {
    const pooled = state.batches.filter(function (b) { return b.status === 'POOLED' })
    const items = pooled.map(function (b) {
      return {
        batchId: b.id,
        buildingText: b.buildingIds.join('+'),
        floorRange: b.minFloor + '-' + b.maxFloor + ' 层',
        orderCount: b.orderCount,
        price: b.price,
        cost: round2(b.price * b.orderCount),
        tails: b.orders.map(function (o) { return o.tail }),
        assignee: '张同学',
        phone: '138****0001',
        studentId: 'S1',
        missingCandidate: false,
      }
    })

    const totalOrders = items.reduce(function (s, x) { return s + x.orderCount }, 0)
    const totalCost = round2(items.reduce(function (s, x) { return s + x.cost }, 0))

    const lines = ['【顺路 · 指派清单】演示', '共 ' + items.length + ' 包 / ' + totalOrders + ' 单 / 成本 ¥' + totalCost, '']
    items.forEach(function (x, i) {
      lines.push((i + 1) + '. ' + x.batchId + '  ' + x.buildingText + ' ' + x.floorRange)
      lines.push('   骑手 ' + x.assignee + '  ' + x.phone)
      lines.push('   尾号 ' + x.tails.join(' / '))
      lines.push('   □ 已指派')
      lines.push('')
    })
    lines.push('操作：平台后台 → 按尾号搜索 → 指派 → 打勾')

    return delay({
      items: items,
      text: lines.join('\n'),
      summary: { count: items.length, totalOrders: totalOrders, totalCost: totalCost, missing: 0 },
    })
  },

  'admin.assignBatch': function (p) {
    const b = state.batches.filter(function (x) { return x.id === p.batchId })[0]
    if (!b) return fail('批次不存在', 404)
    b.status = 'ASSIGNED'
    b.assignedTo = p.studentId
    b.assignedName = '张同学'
    return delay({ ok: true })
  },

  'admin.assignAll': function () {
    const pooled = state.batches.filter(function (b) { return b.status === 'POOLED' })
    pooled.forEach(function (b) {
      b.status = 'ASSIGNED'
      b.assignedTo = 'S1'
      b.assignedName = '张同学'
    })
    return delay({ assigned: pooled.length, skipped: 0, total: pooled.length })
  },

  'admin.settle': function () {
    return delay({ ok: true, settled: 0, inviteIssued: 0 })
  },

  'admin.withdrawals': function () {
    const list = state.logs.filter(function (l) {
      return l.type === 'withdraw' && l.status === 'pending'
    })
    const total = list.reduce(function (sum, l) { return sum + Math.abs(l.amount || 0) }, 0)
    return delay({
      count: list.length,
      total: round2(total),
      items: list.map(function (l) {
        return { id: l.id, amount: Math.abs(l.amount || 0), createdAt: l.createdAt }
      }),
    })
  },

  'admin.markWithdrawn': function (p) {
    const ids = Array.isArray(p.ids) ? p.ids : []
    let updated = 0
    state.logs.forEach(function (l) {
      if (ids.indexOf(l.id) >= 0 && l.type === 'withdraw') {
        l.status = 'paid'
        updated++
      }
    })
    return delay({ ok: true, updated: updated, total: ids.length })
  },

  'admin.stats': function () {
    const counts = { DRAFT: 0, POOLED: 0, ASSIGNED: 0, CLAIMED: 0, PICKED: 0, DELIVERED: 0 }
    let pooledOrders = 0
    let activeOrders = 0
    let todayCost = 0
    let deliveredToday = 0
    let noTaker = 0

    state.batches.forEach(function (b) {
      counts[b.status] = (counts[b.status] || 0) + 1
      const n = b.orderCount || 0
      if (b.status === 'POOLED') {
        pooledOrders += n
        if (b.claimDeadline && Date.now() > b.claimDeadline) noTaker++
      }
      if (b.status === 'ASSIGNED' || b.status === 'CLAIMED' || b.status === 'PICKED') activeOrders += n
      if (b.status === 'DELIVERED') {
        deliveredToday += n
        todayCost += (b.price || 0) * n
      }
    })

    return delay({
      counts: counts,
      draftCount: counts.DRAFT,
      pooledCount: counts.POOLED,
      pooledOrders: pooledOrders,
      activeOrders: activeOrders,
      deliveredToday: deliveredToday,
      todayCost: round2(todayCost),
      noTaker: noTaker,
      staleClaims: 0,
      alertCount: 0,
      alerts: [],
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
