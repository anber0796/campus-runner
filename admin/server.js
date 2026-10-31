/**
 * 运营后台（本地开发用）—— 零依赖 HTTP 服务
 *
 *   node admin/server.js
 *   打开 http://127.0.0.1:8787
 *
 * 为什么先做本地版：
 *   小程序端要云开发环境，但运营后台不需要等——同一台机器上把
 *   「订单入库 → 成包 → 巡检回落」整条链路跑通，比先搭登录鉴权更有价值。
 *   成包器本身是纯函数（cloudfunctions/packer/lib/），将来搬到云函数里是一行 require。
 *
 * 数据落在 admin/data.json，删掉即重置。
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const url = require('url')

const { buildPacks } = require('../cloudfunctions/packer/lib/packer')
const { patrol } = require('../cloudfunctions/packer/lib/patrol')

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

// ---------------------------------------------------------------- 存储

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
  } catch (e) {
    return { orders: [], packs: [], seq: 0 }
  }
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
        volume: stall.id === 'S2' || stall.id === 'S4' ? 2 : 1,
        receiverName: '同学' + i,
        receiverPhone: '138' + String(10000000 + i).slice(-8),
        status: 'CREATED',
        createdAt: Date.now(),
      })
    }
  })
  return out
}

// ---------------------------------------------------------------- 业务动作

function decoratePack(pack, ordersById) {
  return Object.assign({}, pack, {
    buildingName: BUILDINGS[pack.buildingId] || pack.buildingId,
    canteenName: CANTEENS[pack.canteenId] || pack.canteenId,
    waveLabel: WAVES[pack.waveId] || pack.waveId,
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

  const packs = state.packs.map(function (p) { return decoratePack(p, ordersById) })
  const packedOrders = packs.reduce(function (s, p) { return s + p.orderCount }, 0)
  const avg = packs.length ? Math.round((packedOrders / packs.length) * 100) / 100 : 0

  const pendingOrders = state.orders.filter(function (o) { return o.status === 'CREATED' })

  return {
    orders: state.orders,
    packs: packs,
    stats: {
      totalOrders: state.orders.length,
      pendingOrders: pendingOrders.length,
      packedOrders: packedOrders,
      packCount: packs.length,
      avgOrdersPerPack: avg,
      // PRD 命门：包均 ≥3.5
      avgOk: avg >= 3.5,
      droppedOrders: state.orders.filter(function (o) { return o.status === 'CREATED' && o.everDropped }).length,
      patrol: patrol(state.packs, Date.now()),
    },
    config: { buildings: BUILDINGS, canteens: CANTEENS, waves: WAVES, stalls: STALLS },
  }
}

// ---------------------------------------------------------------- HTTP

function send(res, code, body, type) {
  const payload = type === 'json' ? JSON.stringify(body) : body
  res.writeHead(code, { 'Content-Type': type === 'json' ? 'application/json; charset=utf-8' : (type || 'text/plain; charset=utf-8') })
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
  // 防目录穿越
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
      state.orders = seedOrders()
      state.packs = []
      state.seq = 0
      save(state)
      return send(res, 200, snapshot(state), 'json')
    }

    if (pathname === '/api/import') {
      // 小票扫码 / OCR 入库：按 channel + channelOrderNo 去重
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
      return send(res, 200, { created: r.created.length, stats: r.stats, dropped: r.dropped, state: snapshot(state) }, 'json')
    }

    if (pathname === '/api/assign') {
      const pack = state.packs.filter(function (p) { return p.id === body.packId })[0]
      if (!pack) return send(res, 404, { error: '包不存在' }, 'json')
      pack.assignedTo = body.student || '未命名学生'
      pack.status = 'assigned'
      pack.assignedAt = Date.now()
      save(state)
      return send(res, 200, snapshot(state), 'json')
    }

    if (pathname === '/api/simulate') {
      // 把包的计时往前拨，用来演示「无人接回落 / 接单不动回收」
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

    if (pathname === '/api/reset') {
      save({ orders: [], packs: [], seq: 0 })
      return send(res, 200, snapshot({ orders: [], packs: [], seq: 0 }), 'json')
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
