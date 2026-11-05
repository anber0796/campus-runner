/**
 * 定价引擎测试
 *
 *   node scripts/test-pricing.js
 *
 * 建议价算错的后果：定低了没人抢、定高了代理商亏。所以每个加价项都要能对上账。
 */
const assert = require('assert')
const pricing = require('../cloudfunctions/packer/lib/pricing')

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

// ---------- 建议价 ----------

test('低楼层、近距离：基础价 1.0', function () {
  const r = pricing.suggestPrice({ maxFloor: 2, distanceMeters: 0 })
  assert.strictEqual(r.price, 1.0)
})

test('5 楼加 0.25', function () {
  assert.strictEqual(pricing.suggestPrice({ maxFloor: 5, distanceMeters: 0 }).price, 1.25)
})

test('7 楼加 0.45', function () {
  assert.strictEqual(pricing.suggestPrice({ maxFloor: 7, distanceMeters: 0 }).price, 1.45)
})

test('距离每 100 米 +0.05', function () {
  const r = pricing.suggestPrice({ maxFloor: 2, distanceMeters: 600 })
  assert.strictEqual(r.price, 1.3) // 1.0 + 0 + 0.3
  assert.strictEqual(r.breakdown.distance, 0.3)
})

test('距离加价封顶 0.4（2 公里以上不再涨）', function () {
  const a = pricing.suggestPrice({ maxFloor: 2, distanceMeters: 800 })
  const b = pricing.suggestPrice({ maxFloor: 2, distanceMeters: 5000 })
  assert.strictEqual(a.breakdown.distance, 0.4)
  assert.strictEqual(b.breakdown.distance, 0.4)
})

test('高峰时段 +0.2', function () {
  const rush = pricing.suggestPrice({ maxFloor: 2, distanceMeters: 0, isRush: true })
  // 不要直接比 float 差值（1.2 - 1.0 = 0.19999...），看明细
  assert.strictEqual(rush.breakdown.rush, 0.2)
  assert.strictEqual(rush.price, 1.2)
})

test('池子积压 1 单 +0.05，封顶 0.4', function () {
  assert.strictEqual(pricing.suggestPrice({ maxFloor: 2, distanceMeters: 0, backlog: 1 }).price, 1.05)
  assert.strictEqual(pricing.suggestPrice({ maxFloor: 2, distanceMeters: 0, backlog: 20 }).price, 1.4)
})

test('所有加价叠满：7 楼 + 远距离 + 高峰 + 积压 = 2.45 元', function () {
  const r = pricing.suggestPrice({
    maxFloor: 7, distanceMeters: 3000, isRush: true, backlog: 20,
  })
  assert.strictEqual(r.price, 2.45)
  assert.strictEqual(r.breakdown.capped, false)
})

test('基础价被调高时，触发封顶并标记 capped', function () {
  const r = pricing.suggestPrice(
    { maxFloor: 7, distanceMeters: 3000, isRush: true, backlog: 20 },
    { base: 2.8 }
  )
  assert.strictEqual(r.price, 3.0)
  assert.strictEqual(r.breakdown.capped, true)
})

test('同样的输入永远给同样的建议价（确定性）', function () {
  const p = { maxFloor: 6, distanceMeters: 700, isRush: true, backlog: 3 }
  assert.strictEqual(pricing.suggestPrice(p).price, pricing.suggestPrice(p).price)
})

// ---------- 校验代理商填的价格 ----------

test('低于底价被拒', function () {
  assert.strictEqual(pricing.validatePostPrice(0.4).reason, 'below_floor')
})

test('高于封顶被拒', function () {
  assert.strictEqual(pricing.validatePostPrice(3.1).reason, 'above_ceiling')
})

test('底价和封顶是闭区间', function () {
  assert.strictEqual(pricing.validatePostPrice(0.5).ok, true)
  assert.strictEqual(pricing.validatePostPrice(3.0).ok, true)
})

test('非法价格一律拒绝', function () {
  ;[0, -1, NaN, Infinity, 'abc', null, undefined].forEach(function (p) {
    assert.strictEqual(pricing.validatePostPrice(p).ok, false, '价格 ' + p)
  })
})

// ---------- 成本 ----------

test('整批成本 = 单价 × 单数', function () {
  assert.strictEqual(pricing.batchCost(1.25, 4), 5)
})

test('浮点不产生尾巴', function () {
  assert.strictEqual(pricing.batchCost(0.87, 3), 2.61)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
