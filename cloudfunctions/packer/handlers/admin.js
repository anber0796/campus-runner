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
  const _ = db.command
  const tenantId = config.TENANT_ID

  const [packs, alerts] = await Promise.all([
    fetchAll(db.collection('packs').where({ tenantId: tenantId })),
    fetchAll(db.collection('alerts').where({ tenantId: tenantId, handled: false })),
  ])

  const packedOrders = packs.reduce(function (s, p) { return s + (p.orderCount || 0) }, 0)
  const avg = packs.length ? Math.round((packedOrders / packs.length) * 100) / 100 : 0

  return {
    packCount: packs.length,
    packedOrders: packedOrders,
    avgOrdersPerPack: avg,
    avgOk: avg >= 3.5,
    fallbackCount: packs.filter(function (p) { return p.status === 'fallback' }).length,
    alertCount: alerts.length,
    alerts: alerts.slice(-30).reverse(),
    packs: packs
      .filter(function (p) { return p.status !== 'delivered' })
      .slice(0, 50)
      .map(function (p) {
        return {
          id: p._id,
          buildingId: p.buildingId,
          canteenId: p.canteenId,
          waveId: p.waveId,
          orderCount: p.orderCount,
          status: p.status,
          income: p.income ? p.income.total : 0,
          acceptedBy: p.acceptedBy || '',
          fallbackReason: p.fallbackReason || '',
          tails: (p.orders || []).map(function (o) { return o.tail }),
        }
      }),
    patrol: patrol(packs, Date.now()).length,
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

// ---------------------------------------------------------------- 路由表

const HANDLERS = {
  'admin.bootstrap': { fn: doBootstrap, public: true },
  'admin.login': { fn: doLogin, public: true },
  'admin.stats': { fn: stats },
  'admin.execute': { fn: executeAll },
  'admin.assign': { fn: assign },
  'admin.republish': { fn: republish },
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
