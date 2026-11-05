/**
 * 运营后台鉴权的单元测试
 *
 *   node scripts/test-admin.js
 *
 * 鉴权这块没法"跑一遍看看"，只能用断言锁住：密码不可逆、token 不可预测、
 * 过期必须失效、改一个字节就该验不过。
 */
const assert = require('assert')
const auth = require('../cloudfunctions/packer/lib/auth')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

// ---------- 密码 ----------

test('密码哈希不是明文，也不包含明文', function () {
  const r = auth.hashPassword('MySecret123')
  assert.notStrictEqual(r.hash, 'MySecret123')
  assert.ok(r.hash.indexOf('MySecret123') < 0)
  assert.strictEqual(r.hash.length, 64, '应为 32 字节 hex')
})

test('同一个密码加不同盐 → 不同哈希（防彩虹表）', function () {
  const a = auth.hashPassword('MySecret123')
  const b = auth.hashPassword('MySecret123')
  assert.notStrictEqual(a.hash, b.hash, '两次哈希相同说明没加盐')
  assert.notStrictEqual(a.salt, b.salt)
})

test('正确密码能验过', function () {
  const r = auth.hashPassword('MySecret123')
  assert.strictEqual(auth.verifyPassword('MySecret123', r.salt, r.hash), true)
})

test('错误密码验不过', function () {
  const r = auth.hashPassword('MySecret123')
  assert.strictEqual(auth.verifyPassword('MySecret124', r.salt, r.hash), false)
  assert.strictEqual(auth.verifyPassword('', r.salt, r.hash), false)
  assert.strictEqual(auth.verifyPassword('mysecret123', r.salt, r.hash), false)
})

test('哈希被改一个字符就验不过', function () {
  const r = auth.hashPassword('MySecret123')
  const tampered = (r.hash[0] === 'a' ? 'b' : 'a') + r.hash.slice(1)
  assert.strictEqual(auth.verifyPassword('MySecret123', r.salt, tampered), false)
})

test('缺盐或缺哈希时安全返回 false 而不是抛异常', function () {
  assert.strictEqual(auth.verifyPassword('x', '', 'abc'), false)
  assert.strictEqual(auth.verifyPassword('x', 'salt', ''), false)
  assert.strictEqual(auth.verifyPassword('x', null, null), false)
})

// ---------- token ----------

test('token 长度足够且不可预测', function () {
  const a = auth.issueToken()
  const b = auth.issueToken()
  assert.strictEqual(a.length, 48, '24 字节应转成 48 位 hex')
  assert.notStrictEqual(a, b)
})

test('连续签发 1000 个 token 无重复', function () {
  const seen = new Set()
  for (let i = 0; i < 1000; i++) seen.add(auth.issueToken())
  assert.strictEqual(seen.size, 1000)
})

// ---------- 过期 ----------

test('未过期的会话判定为有效', function () {
  const now = 1000000
  const session = { expiresAt: auth.expiresAt(now) }
  assert.strictEqual(auth.isExpired(session, now), false)
  assert.strictEqual(auth.isExpired(session, now + 11 * 3600 * 1000), false)
})

test('超过 12 小时判定为过期', function () {
  const now = 1000000
  const session = { expiresAt: auth.expiresAt(now) }
  assert.strictEqual(auth.isExpired(session, now + 13 * 3600 * 1000), true)
})

test('空会话 / 无过期字段一律视为过期', function () {
  assert.strictEqual(auth.isExpired(null), true)
  assert.strictEqual(auth.isExpired({}), true)
})


// ---------- 鉴权门（用假数据库跑真实的 route()） ----------
const adminRouter = require('../cloudfunctions/packer/handlers/admin')

function makeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed || {}))
  let seq = 0

  function coll(name) {
    store[name] = store[name] || []
    const api = {
      _q: null,
      _limit: null,
      where: function (q) { api._q = q; return api },
      limit: function (n) { api._limit = n; return api },
      skip: function () { return api },
      orderBy: function () { return api },
      get: function () {
        let rows = store[name].slice()
        if (api._q) {
          rows = rows.filter(function (r) {
            return Object.keys(api._q).every(function (k) { return r[k] === api._q[k] })
          })
        }
        if (api._limit) rows = rows.slice(0, api._limit)
        return Promise.resolve({ data: rows })
      },
      count: function () {
        return Promise.resolve({ total: store[name].length })
      },
      update: function (arg) {
        let rows = store[name].slice()
        if (api._q) {
          rows = rows.filter(function (r) {
            return Object.keys(api._q).every(function (k) { return r[k] === api._q[k] })
          })
        }
        rows.forEach(function (r) { Object.assign(r, arg.data) })
        return Promise.resolve({ stats: { updated: rows.length } })
      },
      add: function (arg) {
        seq += 1
        const id = 'id' + seq
        store[name].push(Object.assign({ _id: id }, arg.data))
        return Promise.resolve({ _id: id })
      },
      doc: function (id) {
        return {
          get: function () {
            return Promise.resolve({
              data: store[name].filter(function (r) { return r._id === id })[0] || null,
            })
          },
          remove: function () {
            store[name] = store[name].filter(function (r) { return r._id !== id })
            return Promise.resolve({})
          },
          update: function () { return Promise.resolve({ stats: { updated: 1 } }) },
        }
      },
    }
    return api
  }

  return {
    collection: coll,
    command: {
      in: function (v) { return v },
      inc: function (n) { return n },
      aggregate: {},
    },
    _store: store,
  }
}

const KNOWN_PASSWORD = 'Campus2026!'
const pw = auth.hashPassword(KNOWN_PASSWORD)

function seededDb() {
  return makeDb({
    admins: [{ _id: 'a1', username: 'ops', salt: pw.salt, hash: pw.hash, role: 'owner' }],
    admin_sessions: [],
    packs: [],
    alerts: [],
  })
}

function callRoute(db, action, extra) {
  return adminRouter.route({
    db: db,
    ctx: { OPENID: 'server' },
    event: Object.assign({ action: action }, extra || {}),
  })
}

async function asyncTest(name, fn) {
  try {
    await fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push(name)
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

async function main() {
  await asyncTest('没带 token 调管理接口 → 401', async function () {
    const r = await callRoute(seededDb(), 'admin.stats')
    assert.strictEqual(r.code, 401)
    assert.ok(r.msg.indexOf('未登录') >= 0, r.msg)
  })

  await asyncTest('伪造 token → 401', async function () {
    const r = await callRoute(seededDb(), 'admin.stats', { token: 'deadbeef'.repeat(6) })
    assert.strictEqual(r.code, 401)
  })

  await asyncTest('密码错误 → 401，且不签发 token', async function () {
    const db = seededDb()
    const r = await callRoute(db, 'admin.login', { username: 'ops', password: 'wrong-pass' })
    assert.strictEqual(r.code, 401)
    assert.strictEqual(db._store.admin_sessions.length, 0, '不该留下会话')
  })

  await asyncTest('密码正确 → 签发 token，并能用 token 调接口', async function () {
    const db = seededDb()
    const login = await callRoute(db, 'admin.login', { username: 'ops', password: KNOWN_PASSWORD })
    assert.strictEqual(login.code, 0, JSON.stringify(login))
    assert.ok(login.data.token.length === 48)
    assert.strictEqual(db._store.admin_sessions.length, 1)

    const stats = await callRoute(db, 'admin.stats', { token: login.data.token })
    assert.strictEqual(stats.code, 0, JSON.stringify(stats))
    assert.ok(stats.data && typeof stats.data.avgOrdersPerPack === 'number')
  })

  await asyncTest('token 过期 → 401，并把会话删掉', async function () {
    const db = seededDb()
    const login = await callRoute(db, 'admin.login', { username: 'ops', password: KNOWN_PASSWORD })
    // 手动把会话改成已过期
    db._store.admin_sessions[0].expiresAt = Date.now() - 1000

    const r = await callRoute(db, 'admin.stats', { token: login.data.token })
    assert.strictEqual(r.code, 401)
    assert.ok(r.msg.indexOf('过期') >= 0, r.msg)
    assert.strictEqual(db._store.admin_sessions.length, 0, '过期会话应被清理')
  })

  await asyncTest('已有管理员时 bootstrap 被拒 → 403', async function () {
    const r = await callRoute(seededDb(), 'admin.bootstrap', { username: 'hacker', password: '12345678' })
    assert.strictEqual(r.code, 403)
  })

  await asyncTest('空库时 bootstrap 能建第一个管理员并直接登录', async function () {
    const db = makeDb({ admins: [], admin_sessions: [], packs: [], alerts: [] })
    const r = await callRoute(db, 'admin.bootstrap', { username: 'owner', password: 'FirstAdmin2026' })
    assert.strictEqual(r.code, 0, JSON.stringify(r))
    assert.ok(r.data.token)
    assert.strictEqual(db._store.admins.length, 1)
    assert.strictEqual(db._store.admins[0].role, 'owner')
    assert.ok(!db._store.admins[0].hash.includes('FirstAdmin2026'), '不能存明文')
  })

  await asyncTest('未知管理接口 → 404', async function () {
    const r = await callRoute(seededDb(), 'admin.deleteEverything')
    assert.strictEqual(r.code, 404)
  })

  // ---------- 发单 ----------
  function dbWithBatch(status) {
    const db = seededDb()
    db._store.batches = [{
      _id: 'b1',
      tenantId: 'demo-school',
      buildingId: 'B3',
      buildingIds: ['B3'],
      floorBand: 'mid',
      minFloor: 4,
      maxFloor: 5,
      orderCount: 3,
      status: status || 'DRAFT',
    }]
    return db
  }

  await asyncTest('草稿批次可以发单，价格写入', async function () {
    const db = dbWithBatch('DRAFT')
    const login = await callRoute(db, 'admin.login', { username: 'ops', password: KNOWN_PASSWORD })
    const r = await callRoute(db, 'admin.publishBatch', { token: login.data.token, batchId: 'b1', price: 1.25 })
    assert.strictEqual(r.code, 0, JSON.stringify(r))
    assert.strictEqual(r.data.price, 1.25)
  })

  await asyncTest('价格低于底价 → 拒绝', async function () {
    const db = dbWithBatch('DRAFT')
    const login = await callRoute(db, 'admin.login', { username: 'ops', password: KNOWN_PASSWORD })
    const r = await callRoute(db, 'admin.publishBatch', { token: login.data.token, batchId: 'b1', price: 0.1 })
    assert.strictEqual(r.code, 400)
    assert.strictEqual(r.msg, 'below_floor')
  })

  await asyncTest('已发布的批次不能重复发单', async function () {
    const db = dbWithBatch('POOLED')
    const login = await callRoute(db, 'admin.login', { username: 'ops', password: KNOWN_PASSWORD })
    const r = await callRoute(db, 'admin.publishBatch', { token: login.data.token, batchId: 'b1', price: 1.2 })
    assert.strictEqual(r.code, 409)
  })

  await asyncTest('未登录不能发单（越权保护）', async function () {
    const r = await callRoute(dbWithBatch('DRAFT'), 'admin.publishBatch', { batchId: 'b1', price: 1.2 })
    assert.strictEqual(r.code, 401)
  })

  console.log('\n通过 ' + passed + ' 项')
  if (failures.length) {
    console.log('失败 ' + failures.length + ' 项')
    process.exit(1)
  }
}

main()
