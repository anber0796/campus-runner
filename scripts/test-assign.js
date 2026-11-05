/**
 * 指派引擎测试
 *
 *   node scripts/test-assign.js
 */
const assert = require('assert')
const assign = require('../cloudfunctions/packer/lib/assign')

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

const NOW = new Date('2026-11-06T11:40:00').getTime()

function mkStudent(o) {
  return Object.assign({
    id: 'S1',
    name: '张三',
    phone: '13800000001',
    status: 'active',
    credit: 100,
    claimsToday: 0,
    activeClaims: 0,
    buildingId: 'B3',
  }, o || {})
}

function mkBatch(o) {
  return Object.assign({
    id: 'PK0001',
    status: 'POOLED',
    price: 1.25,
    orderCount: 3,
    buildingId: 'B3',
    floorBand: 'mid',
    minFloor: 4,
    maxFloor: 5,
    orders: [{ id: 'a', tail: '8821' }, { id: 'b', tail: '5567' }, { id: 'c', tail: '3390' }],
  }, o || {})
}

// ---------- 资格 ----------

test('正常学生可被指派', function () {
  assert.strictEqual(assign.canAssign(mkStudent(), mkBatch(), NOW).ok, true)
})

test('未认证不能被指派', function () {
  assert.strictEqual(assign.canAssign(mkStudent({ status: 'pending' }), mkBatch(), NOW).reason, 'not_certified')
})

test('信用低于 80 不能被指派', function () {
  assert.strictEqual(assign.canAssign(mkStudent({ credit: 70 }), mkBatch(), NOW).reason, 'credit_too_low')
})

test('楼栋不覆盖不能被指派', function () {
  const r = assign.canAssign(mkStudent({ buildingId: 'B9' }), mkBatch({ buildingIds: ['B3'] }), NOW)
  assert.strictEqual(r.reason, 'building_not_covered')
})

test('草稿批次不能被指派（还没定价）', function () {
  assert.strictEqual(assign.canAssign(mkStudent(), mkBatch({ status: 'DRAFT' }), NOW).reason, 'bad_status:DRAFT')
})

test('已送达的批次不能再指派', function () {
  assert.strictEqual(
    assign.canAssign(mkStudent(), mkBatch({ status: 'DELIVERED' }), NOW).reason,
    'bad_status:DELIVERED'
  )
})

// ---------- 打分与选人 ----------

test('同楼优先：3栋的单优先派给住 3栋的人', function () {
  const a = mkStudent({ id: 'A', buildingId: 'B3', credit: 100 })
  const b = mkStudent({ id: 'B', buildingId: 'B5', credit: 100 })
  const r = assign.pickBest([b, a], mkBatch(), NOW)
  assert.strictEqual(r.student.id, 'A')
})

test('今日单量少的优先（避免一个人吃满）', function () {
  const busy = mkStudent({ id: 'BUSY', claimsToday: 5 })
  const idle = mkStudent({ id: 'IDLE', claimsToday: 0 })
  const r = assign.pickBest([busy, idle], mkBatch(), NOW)
  assert.strictEqual(r.student.id, 'IDLE')
})

test('同分时按 id 稳定排序（不随机）', function () {
  const x = mkStudent({ id: 'X' })
  const y = mkStudent({ id: 'Y' })
  assert.strictEqual(assign.pickBest([y, x], mkBatch(), NOW).student.id, 'X')
  assert.strictEqual(assign.pickBest([x, y], mkBatch(), NOW).student.id, 'X')
})

test('没有合格候选人时返回 null 而不是瞎派一个', function () {
  const bad = mkStudent({ credit: 10 })
  const r = assign.pickBest([bad], mkBatch(), NOW)
  assert.strictEqual(r.student, null)
  assert.strictEqual(r.reason, 'no_candidate')
})

test('空候选人列表不报错', function () {
  assert.strictEqual(assign.pickBest([], mkBatch(), NOW).student, null)
})

// ---------- 清单 ----------

const items = [
  {
    batchId: 'PK0001', buildingText: '3栋', floorRange: '4-5 层',
    orderCount: 3, cost: 3.75, tails: ['8821', '5567', '3390'],
    assignee: '张三', phone: '13800000001',
  },
  {
    batchId: 'PK0002', buildingText: '5栋', floorRange: '6 层以上',
    orderCount: 2, cost: 3.0, tails: ['1102', '7743'],
    assignee: '李四', phone: '13900000002',
  },
]

test('清单包含包号、骑手、手机号、尾号', function () {
  const text = assign.buildChecklist(items, { date: '11-06', wave: '11:50 波次' })
  assert.ok(text.indexOf('PK0001') >= 0)
  assert.ok(text.indexOf('张三') >= 0)
  assert.ok(text.indexOf('13800000001') >= 0)
  assert.ok(text.indexOf('8821 / 5567 / 3390') >= 0)
})

test('清单有勾选框，驻点能照着打勾', function () {
  const text = assign.buildChecklist(items, {})
  assert.strictEqual((text.match(/□ 已指派/g) || []).length, 2)
})

test('清单汇总单数与成本', function () {
  const text = assign.buildChecklist(items, {})
  assert.ok(text.indexOf('共 2 包 / 5 单 / 成本 ¥6.75') >= 0)
})

test('空清单也能生成，不报错', function () {
  const text = assign.buildChecklist([], {})
  assert.ok(text.indexOf('共 0 包') >= 0)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
