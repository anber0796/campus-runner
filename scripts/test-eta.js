/**
 * 派单提前量引擎单元测试
 *
 *   node scripts/test-eta.js
 *
 * 这块算错的后果是"学生天天到店干等"或"餐凉了才送到"，
 * 两者都会直接杀掉复接率，所以在算法层就必须钉死。
 */
const assert = require('assert')
const eta = require('../cloudfunctions/packer/lib/eta')

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

const T = function (hhmm) {
  return new Date('2026-11-05T' + hhmm + ':00').getTime()
}

// ---------- 通行时间 ----------

test('步行 600 米 ≈ 8 分钟 + 2 分钟开销', function () {
  // 600 / 1.25 = 480 秒 = 8 分钟，向上取整 8，再 +2
  assert.strictEqual(eta.travelMinutes(600, 'walk'), 10)
})

test('自行车比步行快', function () {
  assert.ok(eta.travelMinutes(600, 'bike') < eta.travelMinutes(600, 'walk'))
})

test('电动车最快', function () {
  assert.ok(eta.travelMinutes(600, 'ebike') < eta.travelMinutes(600, 'bike'))
})

test('步行超过 1.2km 视为不可达', function () {
  assert.strictEqual(eta.travelMinutes(1300, 'walk'), Infinity)
})

test('电动车可以到 3.5km，自行车不行', function () {
  assert.ok(isFinite(eta.travelMinutes(3500, 'ebike')))
  assert.strictEqual(eta.travelMinutes(3500, 'bike'), Infinity)
})

test('未知交通工具按步行算（不放大能力）', function () {
  assert.strictEqual(
    eta.travelMinutes(600, 'hoverboard'),
    eta.travelMinutes(600, 'walk')
  )
})

test('非法距离返回 Infinity，不会算出一个假时间', function () {
  ;[-1, NaN, null, 'abc'].forEach(function (d) {
    assert.strictEqual(eta.travelMinutes(d, 'walk'), Infinity, '距离 ' + d)
  })
})

// ---------- 到达时刻 ----------

test('下课 11:50，步行 600 米 → 12:00 到', function () {
  assert.strictEqual(eta.arrivalAt(T('11:50'), 600, 'walk'), T('12:00'))
})

test('不可达时返回 null', function () {
  assert.strictEqual(eta.arrivalAt(T('11:50'), 5000, 'walk'), null)
})

// ---------- 推送时刻 ----------

test('默认提前 10 分钟推', function () {
  assert.strictEqual(eta.pushAt(T('11:50')), T('11:40'))
})

test('可以自定义提前量', function () {
  assert.strictEqual(eta.pushAt(T('11:50'), 15), T('11:35'))
})

// ---------- 到店匹配 ----------

test('正好赶上出餐 → 满分', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:50'),
    readyAt: T('12:00'),
    distanceMeters: 600,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.lateMin, 0)
  assert.strictEqual(r.score, 100)
})

test('晚到 2 分钟仍可接受（餐刚出锅等着）', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:52'),
    readyAt: T('12:00'),
    distanceMeters: 600,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, true)
  assert.ok(r.lateMin > 0 && r.lateMin <= 3)
  assert.ok(r.score < 100)
})

test('晚到超过 3 分钟 → 餐凉，不派', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:56'),
    readyAt: T('12:00'),
    distanceMeters: 600,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'too_late')
})

test('早到超过 6 分钟 → 干等，不派（比迟到更伤）', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:40'),
    readyAt: T('12:05'),
    distanceMeters: 600,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'too_early')
})

test('早到 4 分钟可以接受', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:44'),
    readyAt: T('12:00'),
    distanceMeters: 600,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, true)
  assert.ok(r.waitMin > 0)
})

test('距离超出交通方式能力 → too_far', function () {
  const r = eta.evaluateFit({
    dismissAt: T('11:50'),
    readyAt: T('12:00'),
    distanceMeters: 3000,
    vehicle: 'walk',
  })
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'too_far')
})

test('同样距离，电动车比步行更容易赶上', function () {
  const base = { dismissAt: T('11:52'), readyAt: T('12:00'), distanceMeters: 900 }
  assert.strictEqual(eta.evaluateFit(Object.assign({ vehicle: 'walk' }, base)).ok, false)
  assert.strictEqual(eta.evaluateFit(Object.assign({ vehicle: 'ebike' }, base)).ok, true)
})

// ---------- 批次匹配 ----------

function mkStudent(o) {
  return Object.assign({
    canteenIds: ['C1'],
    vehicle: 'walk',
    dismissAt: T('11:50'),
  }, o || {})
}

test('没选这个食堂 → 不匹配', function () {
  const r = eta.matchBatch(mkStudent(), { canteenId: 'C2', readyAt: T('12:00') }, 600)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'canteen_not_chosen')
})

test('匹配成功时给出推送时刻', function () {
  const r = eta.matchBatch(mkStudent(), { canteenId: 'C1', readyAt: T('12:00') }, 600)
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.pushAt, T('11:40'))
})

test('没有下课时间 → 不匹配（不能瞎猜）', function () {
  const r = eta.matchBatch(mkStudent({ dismissAt: 0 }), { canteenId: 'C1', readyAt: T('12:00') }, 600)
  assert.strictEqual(r.ok, false)
  assert.strictEqual(r.reason, 'no_dismiss_time')
})

// ---------- 距离矩阵 ----------

test('从矩阵取距离', function () {
  const m = { J3: { C1: 620, C2: 980 } }
  assert.strictEqual(eta.distanceFrom(m, 'J3', 'C1'), 620)
})

test('矩阵缺数据返回 null，而不是编一个默认值', function () {
  const m = { J3: { C1: 620 } }
  assert.strictEqual(eta.distanceFrom(m, 'J3', 'C2'), null)
  assert.strictEqual(eta.distanceFrom(m, 'J9', 'C1'), null)
  assert.strictEqual(eta.distanceFrom(null, 'J3', 'C1'), null)
})

// ---------- 汇总 ----------
console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
