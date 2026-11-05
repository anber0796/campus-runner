/**
 * 批次生成单元测试
 *
 *   node scripts/test-batcher.js
 *
 * 批次是竞价和结算的最小单位，这里错了就是"钱和餐对不上"，
 * 所以断言的全是不变量：批内同一楼、同一收件人不拆、订单守恒。
 */
const assert = require('assert')
const batcher = require('../cloudfunctions/packer/lib/batcher')

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

function mkOrder(id, o) {
  return Object.assign({
    id: id,
    canteenId: 'C1',
    buildingId: 'B3',
    waveId: 'W2',
    floor: 4,
    volume: 1,
    stallId: 'S1',
    stallName: '川味小炒',
    receiverName: '同学' + id,
    receiverPhone: '1380000' + id,
  }, o || {})
}

function seq(prefix, n, extra) {
  const out = []
  for (let i = 1; i <= n; i++) out.push(mkOrder(prefix + i, extra))
  return out
}

function batchOf(id) {
  return { orderId: id }
}

// ---------- 分组 ----------

test('同食堂同楼同波次 → 合成一批', function () {
  const r = batcher.buildBatches(seq('a', 3))
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].orderCount, 3)
})

test('不同楼栋 → 分开成批', function () {
  const orders = seq('a', 2).concat(seq('b', 2, { buildingId: 'B5' }))
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 2)
})

test('不同食堂 → 分开成批', function () {
  const orders = seq('a', 2).concat(seq('b', 2, { canteenId: 'C2' }))
  assert.strictEqual(batcher.buildBatches(orders).batches.length, 2)
})

test('不同波次 → 分开成批', function () {
  const orders = seq('a', 2).concat(seq('b', 2, { waveId: 'W6' }))
  assert.strictEqual(batcher.buildBatches(orders).batches.length, 2)
})

// ---------- 容量 ----------

test('单量上限 6：7 单拆成 6 + 1，多出的留在池子', function () {
  const r = batcher.buildBatches(seq('a', 7))
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].orderCount, 6)
  assert.strictEqual(r.leftover.length, 1)
  assert.strictEqual(r.leftover[0].reason, 'below_min_orders')
})

test('不足 2 单不成批，留在池子里不丢', function () {
  const r = batcher.buildBatches(seq('a', 1))
  assert.strictEqual(r.batches.length, 0)
  assert.strictEqual(r.leftover.length, 1)
  assert.strictEqual(r.leftover[0].reason, 'below_min_orders')
})

test('同一收件人的 7 单整块超限 → 整块留下，不拆给两个人', function () {
  const orders = []
  for (let i = 1; i <= 7; i++) {
    orders.push(mkOrder('x' + i, { receiverPhone: '13900000001', receiverName: '张三' }))
  }
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 0)
  assert.strictEqual(r.leftover.length, 7)
  assert.ok(r.leftover.every(function (l) { return l.reason === 'oversize' }))
})

// ---------- 不变量 ----------

test('批内订单全部同楼栋/食堂/波次', function () {
  const orders = seq('a', 4).concat(seq('b', 3, { buildingId: 'B5' }))
  const byId = {}
  orders.forEach(function (o) { byId[o.id] = o })

  batcher.buildBatches(orders).batches.forEach(function (b) {
    b.orders.forEach(function (id) {
      const o = byId[id]
      assert.strictEqual(o.buildingId, b.buildingId, '楼栋混了: ' + id)
      assert.strictEqual(o.canteenId, b.canteenId, '食堂混了: ' + id)
      assert.strictEqual(o.waveId, b.waveId, '波次混了: ' + id)
    })
  })
})

test('同一收件人的 2 单落在同一批', function () {
  const orders = [
    mkOrder('p1', { receiverPhone: '13900001111', receiverName: '李四' }),
    mkOrder('p2', { receiverPhone: '13900001111', receiverName: '李四' }),
    mkOrder('p3'),
    mkOrder('p4'),
  ]
  const batches = batcher.buildBatches(orders).batches
  const hit = batches.filter(function (b) {
    return b.orders.indexOf('p1') >= 0 || b.orders.indexOf('p2') >= 0
  })
  assert.strictEqual(hit.length, 1, '拆到了 ' + hit.length + ' 批')
  assert.ok(hit[0].orders.indexOf('p1') >= 0 && hit[0].orders.indexOf('p2') >= 0)
})

test('订单守恒：成批 + 留下 = 输入', function () {
  const orders = seq('a', 7).concat(seq('b', 1, { buildingId: 'B5' }))
  const r = batcher.buildBatches(orders)
  const packed = r.batches.reduce(function (s, b) { return s + b.orderCount }, 0)
  assert.strictEqual(packed + r.leftover.length, orders.length)
})

test('没有订单同时出现在两批里', function () {
  const seen = new Set()
  batcher.buildBatches(seq('a', 9)).batches.forEach(function (b) {
    b.orders.forEach(function (id) {
      assert.ok(!seen.has(id), id + ' 重复出现')
      seen.add(id)
    })
  })
})

test('同输入两次运行结果一致（确定性）', function () {
  const orders = seq('a', 9).concat(seq('b', 4, { buildingId: 'B5' }))
  const a = batcher.buildBatches(orders)
  const b = batcher.buildBatches(orders)
  assert.deepStrictEqual(a.batches.map(function (x) { return x.orders }), b.batches.map(function (x) { return x.orders }))
})

test('缺字段的订单单独归类，不会混进批次', function () {
  const r = batcher.buildBatches([mkOrder('z1', { buildingId: '' }), mkOrder('z2'), mkOrder('z3')])
  assert.strictEqual(r.leftover[0].reason, 'missing_fields')
  assert.strictEqual(r.batches[0].orders.indexOf('z1'), -1)
})

// ---------- 封顶价 ----------

test('3 层封顶 1.6 元/单', function () {
  const r = batcher.buildBatches(seq('a', 3, { floor: 3 }))
  assert.strictEqual(r.batches[0].ceiling, 1.6)
})

test('5 层封顶 1.75 元/单（+0.15）', function () {
  const r = batcher.buildBatches(seq('a', 3, { floor: 5 }))
  assert.strictEqual(r.batches[0].ceiling, 1.75)
})

test('7 层封顶 1.9 元/单（+0.3）', function () {
  const r = batcher.buildBatches(seq('a', 3, { floor: 7 }))
  assert.strictEqual(r.batches[0].ceiling, 1.9)
})

test('批次按最高层计价（6 楼和 7 楼同段，按 7 楼算）', function () {
  const orders = [mkOrder('f1', { floor: 6 }), mkOrder('f2', { floor: 7 })]
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].maxFloor, 7)
  assert.strictEqual(r.batches[0].ceiling, 1.9)
})

test('2 楼和 7 楼不在同一段 → 分开成批，避免上下折返', function () {
  const orders = [mkOrder('g1', { floor: 2 }), mkOrder('g2', { floor: 7 })]
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 0, '两批各只有 1 单，都不够 2 单')
  assert.strictEqual(r.leftover.length, 2)
})

test('同段内凑得齐 → 成批；跨段的凑不齐也不强行合并', function () {
  // 3 单在 5 楼（中段），1 单在 7 楼（高段）
  const orders = [mkOrder('h1', { floor: 5 }), mkOrder('h2', { floor: 5 }), mkOrder('h3', { floor: 5 }), mkOrder('h4', { floor: 7 })]
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].floorBand, 'mid')
  assert.strictEqual(r.batches[0].orderCount, 3)
  assert.strictEqual(r.leftover.length, 1)
})

test('最高几层合成一段：6 层以上都进 high 段', function () {
  const orders = [mkOrder('k1', { floor: 6 }), mkOrder('k2', { floor: 7 }), mkOrder('k3', { floor: 8 })]
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].floorBand, 'high')
  assert.strictEqual(r.batches[0].orderCount, 3)
})

// ---------- 跨楼凑批 ----------

test('默认不跨楼：两栋各 1 单 → 都留在池子里', function () {
  const orders = [mkOrder('c1'), mkOrder('c2', { buildingId: 'B5' })]
  const r = batcher.buildBatches(orders)
  assert.strictEqual(r.batches.length, 0)
  assert.strictEqual(r.leftover.length, 2)
})

test('开启跨楼凑批：两栋各 1 单 → 合成 1 批并标记', function () {
  const orders = [mkOrder('c1'), mkOrder('c2', { buildingId: 'B5' })]
  const r = batcher.buildBatches(orders, { allowCrossBuilding: true })
  assert.strictEqual(r.batches.length, 1)
  assert.strictEqual(r.batches[0].crossBuilding, true)
  assert.strictEqual(r.batches[0].buildingId, 'B3+B5')
})

// ---------- 学生自选楼栋组合 ----------

test('学生选 3栋+5栋 → 同段批次合并成一批', function () {
  const orders = seq('m', 2).concat(seq('n', 2, { buildingId: 'B5' }))
  const built = batcher.buildBatches(orders)
  assert.strictEqual(built.batches.length, 2)

  const r = batcher.combineForBuildings(built.batches, ['B3', 'B5'])
  assert.strictEqual(r.combined.length, 1)
  assert.strictEqual(r.combined[0].orderCount, 4)
  assert.deepStrictEqual(r.combined[0].buildingIds, ['B3', 'B5'])
  assert.strictEqual(r.combined[0].crossBuilding, true)
})

test('合并后超过 6 单 → 不合并，保持两批', function () {
  const orders = seq('m', 4).concat(seq('n', 4, { buildingId: 'B5' }))
  const built = batcher.buildBatches(orders)
  const r = batcher.combineForBuildings(built.batches, ['B3', 'B5'])
  assert.strictEqual(r.combined.length, 2)
  assert.strictEqual(r.combined[0].crossBuilding, undefined)
})

test('没选中的楼栋不参与合并，进 rest', function () {
  const orders = seq('m', 2).concat(seq('n', 2, { buildingId: 'B5' })).concat(seq('o', 2, { buildingId: 'B7' }))
  const built = batcher.buildBatches(orders)
  const r = batcher.combineForBuildings(built.batches, ['B3'])
  assert.strictEqual(r.combined.length, 1, '只有 3 栋的被选中')
  assert.strictEqual(r.combined[0].buildingId, 'B3')
  assert.strictEqual(r.rest.length, 2, '5栋和7栋应进 rest')
})

test('合并后封顶价按合并批的最高层重算', function () {
  const orders = [
    mkOrder('m1', { floor: 2 }), mkOrder('m2', { floor: 2 }),
    mkOrder('n1', { floor: 7, buildingId: 'B5' }), mkOrder('n2', { floor: 7, buildingId: 'B5' }),
  ]
  const built = batcher.buildBatches(orders)
  const r = batcher.combineForBuildings(built.batches, ['B3', 'B5'])
  // 2 楼在 low 段、7 楼在 high 段，不同段不会被合并
  assert.ok(r.combined.length >= 2)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
