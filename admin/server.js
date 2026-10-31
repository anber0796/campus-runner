/**
 * 运营后台（本地开发用）—— 零依赖 HTTP 服务
 *
 *   node admin/server.js
 *   打开 http://127.0.0.1:8787
 *
 * 业务逻辑全部来自 cloudfunctions/packer/lib/（纯函数，可单测），
 * 这里只负责：拼状态 → 调纯函数 → 存盘。将来上云时替换存储层即可。
 *
 * 数据落在 admin/data.json，删掉即重置。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const { buildPacks } = require('../cloudfunctions/packer/lib/packer')
const { patrol } = require('../cloudfunctions/packer/lib/patrol')
const executor = require('../cloudfunctions/packer/lib/executor')

const PORT = process.env.PORT || 8787
const DATA_FILE = path.join(__dirname, 'data.json')
const PUBLIC_DIR = path.join(__dirname, 'public')

const BUILDINGS = { B1: '1栋', B3: '3栋', B5: '5栋', B7: '7栋' }
const CANTEENS = { C1: '一食堂', C2: '二食堂' }
const WAVES = { W2: '11:50 波次', W3: '12:05 波次', W6: '17:35 波次', W7: '17:50 波次' }
const STALLS = [
  { id: 'S1', name: '川味小炒' },
  { id: 'S2', name: '砂锅米线' },
  { id: 'S3', name: '煎饼果子' },
  { id: 'S4', name: '麻辣烫' },
  { id: 'S5', name: '黄焖鸡' },
  { id: 'S9', name: '出餐慢的档口' },
]

const STUDENTS = [
  { id: 'S1', openid: 'u1', name: '张三', buildingId: 'B3', credit: 100 },
  { id: 'S2', openid: 'u2', name: '李四', buildingId: 'B3', credit: 100 },
  { id: 'S3', openid: 'u3', name: '王五', buildingId: 'B5', credit: 100 },
  { id: 'S4', openid: 'u4', name: '赵六', buildingId: 'B1', credit: 88 },
]

// ---------------------------------------------------------------- 存储

function blank() {
  return { orders: [], packs: [], students: [], creditLogs: [], alerts: [], seq: 0 }
}

function load() {
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (e) {
    return blank()
  }
  // 兼容旧数据文件
  return Object.assign(blank(), raw)
}

function save(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2))
}

function nextId(state, prefix) {
  state.seq += 1
  return prefix + String(state.seq).padStart(4, '0')
}

// ---------------------------------------------------------------- 演示数据

function seedOrders() {
  const out = []
  const plans = [
    { buildingId: 'B3', canteenId: 'C1', waveId: 'W2', n: 26 },
    { buildingId: 'B5', canteenId: 'C1', waveId: 'W2', n: 14 },
    { buildingId: 'B3', canteenId: 'C2', waveId: 'W2', n: 9 },
    { buildingId: 'B1', canteenId: 'C1', waveId: 'W6', n: 11 },
    { buildingId: 'B7', canteenId: 'C2', waveId: 'W6', n: 6 },
  ]
  let i = 0
  plans.forEach(function (plan) {
    for (let k = 0; k < plan.n; k++) {
      i += 1
      const stall = STALLS[i % 6]
      const floor = 2 + (i % 5)
      const room = String(floor) + String((i % 30) + 1).padStart(2, '0')
      out.push({
        id: 'O' + String(1000 + i),
        channel: i % 3 === 0 ? 'meituan' : (i % 3 === 1 ? 'taobao' : 'jd'),
        channelOrderNo: 'ORD' + String(20260000 + i),
        buildingId: plan.buildingId,
        buildingName: BUILDINGS[plan.buildingId],
        canteenId: plan.canteenId,
        canteenName: CANTEENS[plan.canteenId],
        waveId: plan.waveId,
        waveLabel: WAVES[plan.waveId],
        stallId: stall.id,
        stallName: stall.name,
        floor: floor,
        room: room,
        volume: (stall.id === 'S2' || stall.id === 'S4') ? 2 : 1,
        receiverName: '同学' + i,
        receiverPhone: '138' + String(10000000 + i).slice(-8),
        status: 'CREATED',
        createdAt: Date.now(),
      })
    }
  })
  return out
}

// ---------------------------------------------------------------- 业务

function decoratePack(pack, ordersById, studentsById) {
  const stu = pack.acceptedBy ? studentsById[pack.acceptedBy] : null
  return Object.assign({}, pack, {
    buildingName: BUILDINGS[pack.buildingId] || pack.buildingId,
    canteenName: CANTEENS[pack.canteenId] || pack.canteenId,
    waveLabel: WAVES[pack.waveId] || pack.waveId,
    assigneeName: stu ? stu.name : '',
    orderList: pack.orders.map(function (id) {
      const o = ordersById[id] || {}
      return {
        id: id,
        tail: String(o.channelOrderNo || '').slice(-4),
        stallName: o.stallName,
        floor: o.floor,
        room: o.room,
        volume: o.volume,
        channel: o.channel,
      }
    }),
  })
}

function runPacking(state) {
  const pending = state.orders.filter(function (o) { return o.status === 'CREATED' })
  const result = buildPacks(pending, { slowStalls: ['S9'] })

  const created = []
  result.packs.forEach(function (p) {
    const pack = Object.assign({}, p, {
      id: nextId(state, 'PK'),
      tenantId: 'demo-school',
      createdAt: Date.now(),
      offeredAt: Date.now(),
      status: 'available',
      version: 0,
    })
    state.packs.push(pack)
    created.push(pack)
    p.orders.forEach(function (oid) {
      const o = state.orders.filter(function (x) { return x.id === oid })[0]
      if (o) {
        o.status = 'PACKED'
        o.packId = pack.id
      }
    })
  })

  return { created: created, stats: result.stats, dropped: result.dropped }
}

function snapshot(state) {
  const ordersById = {}
  state.orders.forEach(function (o) { ordersById[o.id] = o })
  const studentsById = {}
  state.students.forEach(function (s) { studentsById[s.id] = s })

  const packs = state.packs.map(function (p) { return decoratePack(p, ordersById, studentsById) })
  const packedOrders = packs.reduce(function (s, p) { return s + p.orderCount }, 0)
  const avg = packs.length ? Math.round((packedOrders / packs.length) * 100) / 100 : 0
  const unhandled = (state.alerts || []).filter(function (a) { return !a.handled })

  return {
    orders: state.orders,
    packs: packs,
    students: state.students,
    creditLogs: (state.creditLogs || []).slice(-40).reverse(),
    alerts: unhandled.slice().reverse(),
    stats: {
      totalOrders: state.orders.length,
      pendingOrders: state.orders.filter(function (o) { return o.status === 'CREATED' }).length,
      packedOrders: packedOrders,
      packCount: packs.length,
      avgOrdersPerPack: avg,
      avgOk: avg >= 3.5,
      fallbackCount: packs.filter(function (p) { return p.status === 'fallback' }).length,
      alertCount: unhandled.length,
      patrol: patrol(state.packs, Date.now()),
    },
    config: { buildings: BUILDINGS, canteens: CANTEENS, waves: WAVES, stalls: STALLS },
  }
}

// ---------------------------------------------------------------- HTTP

function send(res, code, body, type) {
  const payload = type === 'json' ? JSON.stringify(body) : body
  res.writeHead(code, {
    'Content-Type': type === 'json'
      ? 'application/json; charset=utf-8'
      : (type || 'text/plain; charset=utf-8'),
  })
  res.end(payload)
}

function readBody(req) {
  return new Promise(function (resolve) {
    let raw = ''
    req.on('data', function (c) { raw += c })
    req.on('end', function () {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { resolve({}) }
    })
  })
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname
  const file = path.join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'forbidden')

  fs.readFile(file, function (err, buf) {
    if (err) return send(res, 404, 'not found')
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
    res.end(buf)
  })
}

const server = http.createServer(async function (req, res) {
  const parsed = url.parse(req.url, true)
  const pathname = parsed.pathname

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname)
  }

  const state = load()
  const body = req.method === 'POST' ? await readBody(req) : {}

  try {
    if (pathname === '/api/state') {
      return send(res, 200, snapshot(state), 'json')
    }

    if (pathname === '/api/seed') {
      const fresh = blank()
      fresh.orders = seedOrders()
      fresh.students = JSON.parse(JSON.stringify(STUDENTS))
      save(fresh)
      return send(res, 200, snapshot(fresh), 'json')
    }

    if (pathname === '/api/import') {
      const incoming = Array.isArray(body.orders) ? body.orders : []
      let added = 0
      let duplicated = 0
      incoming.forEach(function (o) {
        const dup = state.orders.some(function (x) {
          return x.channel === o.channel && x.channelOrderNo === o.channelOrderNo
        })
        if (dup) { duplicated++; return }
        state.seq += 1
        state.orders.push(Object.assign({
          id: 'O' + String(state.seq + 1000),
          status: 'CREATED',
          createdAt: Date.now(),
        }, o))
        added++
      })
      save(state)
      return send(res, 200, { added: added, duplicated: duplicated, state: snapshot(state) }, 'json')
    }

    if (pathname === '/api/pack') {
      const r = runPacking(state)
      save(state)
      return send(res, 200, {
        created: r.created.length,
        stats: r.stats,
        dropped: r.dropped,
        state: snapshot(state),
      }, 'json')
    }

    if (pathname === '/api/assign') {
      // 指派 = 学生接单（影子架构里真正的派驻点在平台后台，这里只记录谁接了）
      const pack = state.packs.filter(function (p) { return p.id === body.packId })[0]
      if (!pack) return send(res, 404, { error: '包不存在' }, 'json')
      if (pack.status !== 'available') {
        return send(res, 409, { error: '包当前状态是 ' + pack.status + '，不能指派' }, 'json')
      }
      const stu = state.students.filter(function (s) { return s.id === body.studentId })[0]
      if (!stu) return send(res, 404, { error: '学生不存在' }, 'json')
      if (stu.frozenUntil && stu.frozenUntil > Date.now()) {
        return send(res, 403, { error: stu.name + ' 已被冻结接单' }, 'json')
      }

      pack.status = 'accepted'
      pack.acceptedBy = stu.id
      pack.acceptedAt = Date.now()
      pack.updatedAt = Date.now()
      save(state)
      return send(res, 200, snapshot(state), 'json')
    }

    if (pathname === '/api/simulate') {
      const minutes = Number(body.minutes) || 10
      state.packs.forEach(function (p) {
        if (p.offeredAt) p.offeredAt -= minutes * 60000
        if (p.acceptedAt) p.acceptedAt -= minutes * 60000
        if (p.pickedAt) p.pickedAt -= minutes * 60000
      })
      save(state)
      const actions = patrol(state.packs, Date.now())
      return send(res, 200, { actions: actions, state: snapshot(state) }, 'json')
    }

    if (pathname === '/api/execute') {
      // 巡检 → 执行，一次到位
      const actions = patrol(state.packs, Date.now())
      const report = executor.execute(state, actions, { now: Date.now() })
      save(state)
      return send(res, 200, { actions: actions, report: report, state: snapshot(state) }, 'json')
    }

    if (pathname === '/api/republish') {
      const r = executor.republish(state, body.packId, { now: Date.now() })
      if (!r.ok) return send(res, 409, { error: r.why }, 'json')
      save(state)
      return send(res, 200, snapshot(state), 'json')
    }

    if (pathname === '/api/reset') {
      save(blank())
      return send(res, 200, snapshot(blank()), 'json')
    }

    return send(res, 404, { error: 'unknown api' }, 'json')
  } catch (e) {
    console.error(e)
    return send(res, 500, { error: e.message }, 'json')
  }
})

server.listen(PORT, '127.0.0.1', function () {
  console.log('')
  console.log('  顺路 · 运营后台')
  console.log('  http://127.0.0.1:' + PORT)
  console.log('  数据文件: ' + DATA_FILE)
  console.log('')
})
