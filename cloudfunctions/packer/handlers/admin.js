/**
 * 运营后台接口（admin.*）—— 挂在 packer 云函数下
 *
 * 为什么和成包器同一个函数：它们共享 packer / patrol / executor / commission 四份引擎。
 * 拆成两个云函数就得把引擎复制两份，改一处忘一处，两边算出的钱不一样——这是最危险的事故。
 * 云函数内按 action 前缀路由，逻辑上仍是分开的两组接口。
 *
 * 除 admin.login / admin.bootstrap 外，所有 action 都要求有效 token。
 */
const auth = require('../lib/auth')
const { AppError } = require('../lib/errors')
const config = require('../lib/config')
const executor = require('../lib/executor')
const pricing = require('../lib/pricing')
const settlement = require('../lib/settlement')
const assignEngine = require('../lib/assign')
const invite = require('../lib/invite')
const { patrol } = require('../lib/patrol')

const SESSION = 'admin_sessions'
const ADMINS = 'admins'

// ---------------------------------------------------------------- 鉴权

async function requireAdmin(db, event) {
  const token = (event && event.token) || ''
  if (!token) throw AppError(401, '未登录')

  const res = await db.collection(SESSION).where({ token: token }).limit(1).get()
  const session = res.data && res.data[0]
  if (!session) throw AppError(401, '登录已失效，请重新登录')

  if (auth.isExpired(session, Date.now())) {
    await db.collection(SESSION).doc(session._id).remove()
    throw AppError(401, '登录已过期，请重新登录')
  }

  return session
}

async function doLogin(args) {
  const db = args.db
  const event = args.event
  const username = String(event.username || '').trim()
  const password = String(event.password || '')

  if (!username || !password) throw AppError(400, '请输入账号和密码')

  const res = await db.collection(ADMINS).where({ username: username }).limit(1).get()
  const admin = res.data && res.data[0]
  if (!admin) throw AppError(401, '账号或密码错误')

  if (!auth.verifyPassword(password, admin.salt, admin.hash)) {
    throw AppError(401, '账号或密码错误')
  }

  const token = auth.issueToken()
  await db.collection(SESSION).add({
    data: {
      token: token,
      adminId: admin._id,
      username: admin.username,
      role: admin.role || 'operator',
      createdAt: Date.now(),
      expiresAt: auth.expiresAt(Date.now()),
    },
  })

  return {
    token: token,
    username: admin.username,
    role: admin.role || 'operator',
    expiresAt: auth.expiresAt(Date.now()),
  }
}

/**
 * 首次初始化管理员。
 * 只在 admins 集合为空时可用——否则任何人都能凭空造一个管理员账号。
 * 上线前请用后台控制台手动建好账号，然后忽略这个接口。
 */
async function doBootstrap(args) {
  const db = args.db
  const event = args.event

  const count = await db.collection(ADMINS).count()
  if (count.total > 0) throw AppError(403, '管理员已存在，不能用这个接口')

  const username = String(event.username || '').trim()
  const password = String(event.password || '')
  if (username.length < 3) throw AppError(400, '账号至少 3 位')
  if (password.length < 8) throw AppError(400, '密码至少 8 位')

  const pw = auth.hashPassword(password)
  await db.collection(ADMINS).add({
    data: {
      username: username,
      salt: pw.salt,
      hash: pw.hash,
      role: 'owner',
      createdAt: Date.now(),
    },
  })

  return doLogin(args)
}

// ---------------------------------------------------------------- 数据

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
    if (skip > 5000) break
  }
  return out
}

async function stats(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const now = Date.now()

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [batches, alerts] = await Promise.all([
    fetchAll(db.collection('batches').where({ tenantId: tenantId })),
    fetchAll(db.collection('alerts').where({ tenantId: tenantId, handled: false })),
  ])

  const counts = { DRAFT: 0, POOLED: 0, ASSIGNED: 0, CLAIMED: 0, PICKED: 0, DELIVERED: 0 }
  let pooledOrders = 0
  let activeOrders = 0
  let deliveredToday = 0
  let todayCost = 0
  let noTaker = 0
  let staleClaims = 0

  batches.forEach(function (b) {
    counts[b.status] = (counts[b.status] || 0) + 1
    const n = b.orderCount || 0

    if (b.status === 'POOLED') {
      pooledOrders += n
      // 过了抢单截止还没人抢：最该被运营看见的一类
      if (b.claimDeadline && now > b.claimDeadline) noTaker++
    }
    if (b.status === 'ASSIGNED' || b.status === 'CLAIMED' || b.status === 'PICKED') activeOrders += n
    if (b.status === 'CLAIMED' && b.claimedAt && (now - b.claimedAt) > 15 * 60000) staleClaims++

    if (b.status === 'DELIVERED' && (b.deliveredAt || 0) >= todayStart.getTime()) {
      deliveredToday += n
      todayCost += (Number(b.price) || 0) * n
    }
  })

  return {
    counts: counts,
    draftCount: counts.DRAFT,
    pooledCount: counts.POOLED,
    pooledOrders: pooledOrders,
    activeOrders: activeOrders,
    deliveredToday: deliveredToday,
    todayCost: Math.round(todayCost * 100) / 100,
    noTaker: noTaker,
    staleClaims: staleClaims,
    alertCount: alerts.length,
    alerts: alerts.slice(-30).reverse(),
  }
}

async function executeAll(args) {
  const db = args.db
  const _ = db.command
  const tenantId = config.TENANT_ID
  const now = Date.now()

  const packs = await fetchAll(db.collection('packs').where({
    tenantId: tenantId,
    status: _.in(['available', 'accepted', 'picked']),
  }))
  const students = await fetchAll(db.collection('students'))
  const creditLogs = await fetchAll(db.collection('credit_logs').where({ tenantId: tenantId }))

  const state = { packs: packs, students: students, creditLogs: creditLogs, alerts: [] }
  const logCountBefore = state.creditLogs.length

  const actions = patrol(packs, now)
  const report = executor.execute(state, actions, { now: now })

  for (const id of report.changedPacks) {
    const p = state.packs.filter(function (x) { return x._id === id })[0]
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

  for (const key of report.changedStudents) {
    const s = state.students.filter(function (x) {
      return x.id === key || x.openid === key
    })[0]
    if (!s) continue
    await db.collection('students').doc(s._id).update({
      data: { credit: s.credit, frozenUntil: s.frozenUntil || null },
    })
  }

  for (const l of state.creditLogs.slice(logCountBefore)) {
    await db.collection('credit_logs').add({ data: Object.assign({ tenantId: tenantId }, l) })
  }
  for (const a of state.alerts) {
    await db.collection('alerts').add({ data: Object.assign({ tenantId: tenantId }, a) })
  }

  return {
    actions: actions.length,
    applied: report.applied.length,
    skipped: report.skipped.length,
    details: report.applied,
  }
}

async function republish(args) {
  const db = args.db
  const packId = args.event.packId
  const res = await db.collection('packs').doc(packId).get()
  const pack = res.data
  if (!pack) throw AppError(404, '包不存在')

  const state = { packs: [pack], students: [], creditLogs: [], alerts: [] }
  const r = executor.republish(state, packId, { now: Date.now() })
  if (!r.ok) throw AppError(409, r.why)

  await db.collection('packs').doc(packId).update({
    data: {
      status: 'available',
      offeredAt: r.pack.offeredAt,
      fallbackAt: null,
      fallbackReason: null,
      republishedAt: r.pack.republishedAt,
      republishCount: r.pack.republishCount,
      updatedAt: r.pack.updatedAt,
    },
  })

  // 相关告警标记已处理
  const alerts = await db.collection('alerts').where({ packId: packId, handled: false }).get()
  for (const a of alerts.data || []) {
    await db.collection('alerts').doc(a._id).update({ data: { handled: true } })
  }

  return { ok: true }
}

async function assign(args) {
  const db = args.db
  const event = args.event
  const packId = event.packId
  const studentId = event.studentId

  const packRes = await db.collection('packs').doc(packId).get()
  const pack = packRes.data
  if (!pack) throw AppError(404, '包不存在')
  if (pack.status !== 'available') throw AppError(409, '包当前状态是 ' + pack.status)

  const stuRes = await db.collection('students').doc(studentId).get()
  const stu = stuRes.data
  if (!stu) throw AppError(404, '学生不存在')
  if (stu.frozenUntil && stu.frozenUntil > Date.now()) {
    throw AppError(403, (stu.name || '该学生') + ' 已被冻结接单')
  }

  // 条件更新：防止两个人同时指派同一个包
  const r = await db.collection('packs')
    .where({ _id: packId, status: 'available' })
    .update({
      data: {
        status: 'accepted',
        acceptedBy: studentId,
        acceptedAt: Date.now(),
        updatedAt: Date.now(),
        version: db.command.inc(1),
      },
    })

  const updated = r && r.stats ? r.stats.updated : 0
  if (updated !== 1) throw AppError(409, '包已被别人接走')

  return { ok: true }
}


// ---------------------------------------------------------------- 发单

/**
 * 待发单的批次（草稿态）+ 建议价
 * 代理商看到的是"这一批建议多少、总共要花多少"，而不是一堆原始数字。
 */
async function pendingBatches(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const list = await fetchAll(db.collection('batches').where({ tenantId: tenantId, status: 'DRAFT' }))
  const backlog = list.length

  const batches = list.map(function (b) {
    const s = pricing.suggestPrice({
      maxFloor: b.maxFloor,
      distanceMeters: b.distanceMeters || 0,
      isRush: !!b.isRush,
      backlog: backlog,
    })
    return {
      id: b._id,
      buildingId: b.buildingId,
      buildingIds: b.buildingIds || [b.buildingId],
      floorBand: b.floorBand,
      floorRange: (b.minFloor || 1) + '-' + (b.maxFloor || 1) + ' 层',
      orderCount: b.orderCount,
      suggestedPrice: s.price,
      breakdown: s.breakdown,
      cost: pricing.batchCost(s.price, b.orderCount),
    }
  })

  const totalCost = Math.round(
    batches.reduce(function (s, b) { return s + b.cost }, 0) * 100
  ) / 100

  return {
    batches: batches,
    summary: {
      count: batches.length,
      totalOrders: batches.reduce(function (s, b) { return s + b.orderCount }, 0),
      totalCost: totalCost,
      backlog: backlog,
    },
  }
}

/** 发单：给一个草稿批次定价，放进抢单池 */
async function publishBatch(args) {
  const db = args.db
  const event = args.event
  const batchId = event.batchId

  const res = await db.collection('batches').doc(batchId).get()
  const batch = res.data
  if (!batch) throw AppError(404, '批次不存在')
  if (batch.status !== 'DRAFT') throw AppError(409, '批次状态是 ' + batch.status + '，不能发单')

  const check = pricing.validatePostPrice(event.price)
  if (!check.ok) throw AppError(400, check.reason)

  const r = await db.collection('batches')
    .where({ _id: batchId, status: 'DRAFT' })
    .update({
      data: {
        status: 'POOLED',
        price: check.value,
        publishedAt: Date.now(),
        claimDeadline: Date.now() + config.CLAIM_WINDOW_MIN * 60000,
        updatedAt: Date.now(),
        version: db.command.inc(1),
      },
    })

  const updated = r && r.stats ? r.stats.updated : 0
  if (updated !== 1) throw AppError(409, '这批已被发布')

  return { ok: true, price: check.value }
}

/** 一键按建议价发布全部草稿 */
async function publishAll(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const list = await fetchAll(db.collection('batches').where({ tenantId: tenantId, status: 'DRAFT' }))
  let published = 0

  for (const b of list) {
    const s = pricing.suggestPrice({ maxFloor: b.maxFloor, backlog: list.length })
    try {
      await publishBatch({ db: db, event: { batchId: b._id, price: s.price } })
      published++
    } catch (e) {
      console.warn('[publishAll]', b._id, e.message)
    }
  }

  return { published: published, total: list.length }
}

/**
 * 结算：把到期（T+1）的待结算收入转成可提现。
 * 建议配每日定时触发器，例如凌晨 3 点：0 0 3 * * * *
 */
async function settleWallets(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const pending = await fetchAll(db.collection('wallet_logs').where({
    tenantId: tenantId,
    type: 'claim_income',
    status: 'pending',
  }))

  const result = settlement.settleDue(pending, Date.now())
  let updated = 0

  for (const log of result.logs) {
    if (log.status !== 'settled') continue
    await db.collection('wallet_logs').doc(log._id).update({
      data: { status: 'settled', settledAt: log.settledAt },
    })
    updated++
  }

  // ---- 邀请奖励入账（幂等：按组编号，发过不再发）----
  const students = await fetchAll(db.collection('students'))
  let inviteIssued = 0

  for (const stu of students) {
    if (!stu.inviteCode || !stu.openid) continue

    const invitees = await fetchAll(db.collection('students').where({ invitedBy: stu.openid }))
    if (!invitees.length) continue

    const done = await fetchAll(db.collection('invite_rewards').where({ inviterId: stu._id }))
    const due = invite.dueRewards(
      invitees.map(function (x) {
        return { registeredAt: x.createdAt || 0, firstOrderAt: x.firstOrderAt || null }
      }),
      done.map(function (d) { return d.key })
    )

    for (const d of due) {
      // 先落发放记录，再记钱包流水，顺序反了会出现"有钱没记录"
      await db.collection('invite_rewards').add({
        data: {
          tenantId: tenantId,
          inviterId: stu._id,
          openid: stu.openid,
          key: d.key,
          type: d.type,
          amount: d.amount,
          at: Date.now(),
        },
      })
      await db.collection('wallet_logs').add({
        data: {
          tenantId: tenantId,
          openid: stu.openid,
          type: 'invite_reward',
          amount: d.amount,
          status: 'pending',
          title: '邀请奖励 · ' + d.key,
          createdAt: Date.now(),
        },
      })
      inviteIssued++
    }
  }

  return {
    ok: true,
    scanned: pending.length,
    settled: updated,
    amount: result.settledAmount,
    inviteIssued: inviteIssued,
  }
}

// ---------------------------------------------------------------- 指派（L2）

function mmdd(ts) {
  const d = new Date(ts || Date.now())
  return (d.getMonth() + 1) + '-' + String(d.getDate()).padStart(2, '0')
}

/**
 * 生成指派清单：哪一包、派给谁、尾号是什么、驻点照着在哪打勾。
 * 这是 L2 形态的核心交付物——派单动作仍在平台后台，我们负责把人工操作压到最短。
 */
async function buildAssignList(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const now = Date.now()

  const batches = await fetchAll(db.collection('batches').where({
    tenantId: tenantId,
    status: 'POOLED',
  }))
  const students = await fetchAll(db.collection('students').where({ status: 'active' }))

  const items = batches.map(function (b) {
    const pick = assignEngine.pickBest(students, b, now)
    const s = pick.student
    return {
      batchId: b._id,
      buildingText: (b.buildingIds || [b.buildingId]).join('+'),
      floorRange: (b.minFloor || 1) + '-' + (b.maxFloor || 1) + ' 层',
      orderCount: b.orderCount,
      price: b.price,
      cost: pricing.batchCost(b.price, b.orderCount),
      tails: (b.orders || []).map(function (o) {
        return typeof o === 'string' ? o.slice(-4) : (o.tail || '')
      }),
      assignee: s ? s.name : '',
      phone: s ? s.phone : '',
      studentId: s ? s._id : '',
      reason: pick.reason,
      missingCandidate: !s,
    }
  })

  const text = assignEngine.buildChecklist(items, {
    date: mmdd(now),
    wave: items.length ? (batches[0].waveId || '') : '',
  })

  return {
    items: items,
    text: text,
    summary: {
      count: items.length,
      totalOrders: items.reduce(function (s, x) { return s + x.orderCount }, 0),
      totalCost: Math.round(items.reduce(function (s, x) { return s + (x.cost || 0) }, 0) * 100) / 100,
      missing: items.filter(function (x) { return x.missingCandidate }).length,
    },
  }
}

/** 手动改派：把某一包指派给指定学生 */
async function assignOne(args) {
  const db = args.db
  const event = args.event

  const batchRes = await db.collection('batches').doc(event.batchId).get()
  const batch = batchRes.data
  if (!batch) throw AppError(404, '批次不存在')
  if (batch.status !== 'POOLED' && batch.status !== 'ASSIGNED') {
    throw AppError(409, '批次状态是 ' + batch.status + '，不能指派')
  }

  const stuRes = await db.collection('students').doc(event.studentId).get()
  const student = stuRes.data
  if (!student) throw AppError(404, '学生不存在')

  const check = assignEngine.canAssign(student, batch, Date.now())
  if (!check.ok) throw AppError(409, check.reason)

  await db.collection('batches').doc(event.batchId).update({
    data: {
      status: 'ASSIGNED',
      assignedTo: event.studentId,
      // 同时记 openid：指派（admin 用 _id）和抢单（用 openid）两种来源要能查到同一批
      assignedOpenid: student.openid || event.studentId,
      assignedName: student.name || '',
      assignedAt: Date.now(),
      updatedAt: Date.now(),
      version: db.command.inc(1),
    },
  })
  await db.collection('students').doc(event.studentId).update({
    data: { claimsToday: db.command.inc(1), activeClaims: db.command.inc(1) },
  })

  return { ok: true }
}

/** 一键按推荐指派全部 */
async function assignAll(args) {
  const db = args.db
  const tenantId = config.TENANT_ID
  const now = Date.now()

  const batches = await fetchAll(db.collection('batches').where({ tenantId: tenantId, status: 'POOLED' }))
  const students = await fetchAll(db.collection('students').where({ status: 'active' }))

  let assigned = 0
  let skipped = 0

  for (const b of batches) {
    const pick = assignEngine.pickBest(students, b, now)
    if (!pick.student) { skipped++; continue }
    try {
      await assignOne({ db: db, event: { batchId: b._id, studentId: pick.student._id } })
      assigned++
    } catch (e) {
      skipped++
    }
  }

  return { assigned: assigned, skipped: skipped, total: batches.length }
}

// ---------------------------------------------------------------- 路由表


const HANDLERS = {
  'admin.bootstrap': { fn: doBootstrap, public: true },
  'admin.login': { fn: doLogin, public: true },
  'admin.stats': { fn: stats },
  'admin.execute': { fn: executeAll },
  'admin.assign': { fn: assign },
  'admin.republish': { fn: republish },
  'admin.pendingBatches': { fn: pendingBatches },
  'admin.publishBatch': { fn: publishBatch },
  'admin.publishAll': { fn: publishAll },
  'admin.settle': { fn: settleWallets },
  'admin.checklist': { fn: buildAssignList },
  'admin.assignBatch': { fn: assignOne },
  'admin.assignAll': { fn: assignAll },
}

/**
 * @returns {Promise<{code:number, data?:any, msg?:string}>}
 */
async function route(args) {
  const action = args.event.action
  const entry = HANDLERS[action]
  if (!entry) return { code: 404, msg: '未知管理接口: ' + action }

  try {
    if (!entry.public) {
      await requireAdmin(args.db, args.event)
    }
    const data = await entry.fn(args)
    return { code: 0, data: data }
  } catch (e) {
    return { code: e.code || 500, msg: e.message || '服务器错误' }
  }
}

module.exports = { route: route, HANDLERS: HANDLERS }
