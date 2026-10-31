/**
 * 成包器 / 巡检 / 佣金一致性 的单元测试
 *
 *   node scripts/test-engine.js
 *
 * 断言的是**不变量**而不是具体数字——算法可以重写，但硬约束不能被破坏。
 */
const assert = require('assert')
const packer = require('../cloudfunctions/packer/lib/packer')
const patrolLib = require('../cloudfunctions/packer/lib/patrol')
const commissionPacker = require('../cloudfunctions/packer/lib/commission')
const commissionApi = require('../cloudfunctions/api/lib/commission')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed++
    console.log('  ✓ ' + name)
  } catch (e) {
    failures.push({ name: name, message: e.message })
    console.log('  ✗ ' + name + '\n      ' + e.message)
  }
}

// ---------- 夹具 ----------
function mkOrder(id, o) {
  return Object.assign({
    id: id,
    buildingId: 'B3',
    canteenId: 'C1',
    waveId: 'W2',
    floor: 4,
    volume: 1,
    stallId: 'S1',
    stallName: '川味小炒',
    receiverName: '同学' + id,
    receiverPhone: '1380000' + id,
  }, o || {})
}

const fixtures = [
  // B3 × C1 × W2：主力组，12 单
  mkOrder('a1', { floor: 5 }), mkOrder('a2', { floor: 5 }), mkOrder('a3', { floor: 4 }),
  mkOrder('a4', { floor: 6 }), mkOrder('a5', { floor: 3 }), mkOrder('a6', { floor: 6 }),
  mkOrder('a7', { floor: 4 }), mkOrder('a8', { floor: 5 }), mkOrder('a9', { floor: 3 }),
  mkOrder('a10', { floor: 4 }), mkOrder('a11', { floor: 5 }), mkOrder('a12', { floor: 6 }),
  // 同一收件人的两单（必须同包）
  mkOrder('a13', { floor: 5, receiverName: '张三', receiverPhone: '13900000001' }),
  mkOrder('a14', { floor: 5, receiverName: '张三', receiverPhone: '13900000001' }),
  // 不同楼栋
  mkOrder('b1', { buildingId: 'B5', floor: 4 }),
  mkOrder('b2', { buildingId: 'B5', floor: 5 }),
  mkOrder('b3', { buildingId: 'B5', floor: 4 }),
  // 不同食堂
  mkOrder('c1', { canteenId: 'C2', floor: 4 }),
  mkOrder('c2', { canteenId: 'C2', floor: 5 }),
  mkOrder('c3', { canteenId: 'C2', floor: 4 }),
  // 不同波次
  mkOrder('d1', { waveId: 'W3', floor: 4 }),
  mkOrder('d2', { waveId: 'W3', floor: 5 }),
  mkOrder('d3', { waveId: 'W3', floor: 4 }),
  // 出餐慢档口
  mkOrder('e1', { stallId: 'S9', stallName: '慢档口' }),
  mkOrder('e2', { stallId: 'S9', stallName: '慢档口' }),
  // 孤立单，收益注定不足 2 元
  mkOrder('f1', { waveId: 'W4', floor: 1, canteenId: 'C3' }),
]

const byId = {}
fixtures.forEach(function (o) { byId[o.id] = o })

const result = packer.buildPacks(fixtures, { slowStalls: ['S9'] })
const packedIds = []
result.packs.forEach(function (p) { packedIds.push.apply(packedIds, p.orders) })

// ---------- 硬约束 ----------
test('每个包只含同一楼栋/食堂/波次', function () {
  result.packs.forEach(function (p) {
    p.orders.forEach(function (id) {
      const o = byId[id]
      assert.strictEqual(o.buildingId, p.buildingId, '楼栋混了: ' + id)
      assert.strictEqual(o.canteenId, p.canteenId, '食堂混了: ' + id)
      assert.strictEqual(o.waveId, p.waveId, '波次混了: ' + id)
    })
  })
})

test('单量不超过 6 单', function () {
  result.packs.forEach(function (p) {
    assert.ok(p.orderCount <= 6, p.orderCount + ' 单超上限')
  })
})

test('体积不超过 6 个单位', function () {
  result.packs.forEach(function (p) {
    assert.ok(p.volume <= 6, '体积 ' + p.volume + ' 超上限')
  })
})

test('包收益不低于 2.0 元', function () {
  result.packs.forEach(function (p) {
    assert.ok(p.income.subtotal >= 2.0, '收益 ' + p.income.subtotal + ' 低于下限')
  })
})

test('同一收件人的多单落在同一个包里', function () {
  const hits = result.packs.filter(function (p) {
    return p.orders.indexOf('a13') >= 0 || p.orders.indexOf('a14') >= 0
  })
  assert.strictEqual(hits.length, 1, '张三的两单被拆到了 ' + hits.length + ' 个包')
  assert.ok(hits[0].orders.indexOf('a13') >= 0 && hits[0].orders.indexOf('a14') >= 0, '两单不齐')
})

test('没有订单同时出现在两个包里', function () {
  const seen = new Set()
  packedIds.forEach(function (id) {
    assert.ok(!seen.has(id), '订单 ' + id + ' 被重复成包')
    seen.add(id)
  })
})

test('没有订单同时"已成包"又"被丢弃"', function () {
  const droppedIds = new Set(result.dropped.map(function (d) { return d.orderId }))
  packedIds.forEach(function (id) {
    assert.ok(!droppedIds.has(id), id + ' 既成包又丢弃')
  })
})

test('出餐慢档口的订单不进程', function () {
  assert.ok(packedIds.indexOf('e1') < 0 && packedIds.indexOf('e2') < 0, '慢档口订单进了包')
  const reasons = result.dropped.filter(function (d) { return d.orderId === 'e1' })
  assert.strictEqual(reasons[0].reason, 'stall_slow')
})

test('收益不足的孤立单被丢弃且原因正确', function () {
  assert.ok(packedIds.indexOf('f1') < 0, 'f1 不该成包')
  const d = result.dropped.filter(function (x) { return x.orderId === 'f1' })[0]
  assert.ok(d, 'f1 没有出现在丢弃列表')
  assert.ok(['income_below_min', 'oversize'].indexOf(d.reason) >= 0, '原因异常: ' + d.reason)
})

test('订单守恒：成包 + 丢弃 = 输入', function () {
  const total = packedIds.length + result.dropped.length
  assert.strictEqual(total, fixtures.length, total + ' != ' + fixtures.length)
})

test('包均单量达到 3.5 以上（PRD 命门指标）', function () {
  assert.ok(result.stats.avgOrdersPerPack >= 3.5,
    '包均只有 ' + result.stats.avgOrdersPerPack + ' 单，低于命门')
})

test('同输入两次运行结果一致（确定性）', function () {
  const again = packer.buildPacks(fixtures, { slowStalls: ['S9'] })
  assert.deepStrictEqual(
    again.packs.map(function (p) { return p.orders }),
    result.packs.map(function (p) { return p.orders })
  )
})

// ---------- 巡检 ----------
test('推出去 8 分钟无人接 → 回落自有运力', function () {
  const now = 1000000
  const actions = patrolLib.patrol([
    { id: 'p1', status: 'available', offeredAt: now - 9 * 60000 },
    { id: 'p2', status: 'available', offeredAt: now - 3 * 60000 },
  ], now)
  assert.strictEqual(actions.length, 1)
  assert.strictEqual(actions[0].packId, 'p1')
  assert.strictEqual(actions[0].action, 'fallback_to_fleet')
})

test('接单 12 分钟未到店 → 回收', function () {
  const now = 1000000
  const actions = patrolLib.patrol([
    { id: 'p1', status: 'accepted', acceptedAt: now - 13 * 60000, orders: [{ picked: false }] },
    { id: 'p2', status: 'accepted', acceptedAt: now - 13 * 60000, orders: [{ picked: true }] },
  ], now)
  assert.strictEqual(actions.length, 1)
  assert.strictEqual(actions[0].packId, 'p1')
  assert.strictEqual(actions[0].action, 'recycle')
})

test('取餐后超时未送达 → 告警', function () {
  const now = 1000000
  const actions = patrolLib.patrol([
    { id: 'p1', status: 'picked', pickedAt: now - 25 * 60000, orders: [{ picked: true }] },
  ], now)
  assert.strictEqual(actions[0].action, 'warn_deliver')
})

// ---------- 双副本对拍 ----------
test('两份 commission 副本输出完全一致', function () {
  const cases = [
    [{ floor: 3 }, { floor: 5 }, { floor: 6 }],
    [{ floor: 1 }],
    [{ floor: 4 }, { floor: 4 }, { floor: 4 }, { floor: 4 }, { floor: 4 }],
    [],
  ]
  cases.forEach(function (c) {
    const a = commissionPacker.calcPackIncome(c)
    const b = commissionApi.calcPackIncome(c)
    assert.deepStrictEqual(a, b, '副本算出的结果不同: ' + JSON.stringify(c))
  })
})

test('两份 commission 的 RULE 常量一致', function () {
  assert.deepStrictEqual(commissionPacker.RULE, commissionApi.RULE)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
console.log('\n成包统计: ' + JSON.stringify(result.stats))
console.log('包数 ' + result.packs.length + ' 个，'
  + result.packs.map(function (p) { return p.orderCount + '单/¥' + p.income.subtotal }).join('  '))
