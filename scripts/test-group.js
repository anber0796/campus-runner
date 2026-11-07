/**
 * 分组工具测试
 *
 *   node scripts/test-group.js
 */
const assert = require('assert')
const group = require('../miniprogram/utils/group')

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

function mk(o) {
  return Object.assign({
    id: 'x', tail: '1111', stallName: '川味小炒', stallFloor: 1,
    buildingId: '3栋', floor: 4, picked: false,
  }, o || {})
}

// ---------- floorStalls ----------

test('楼层升序：1F 在 3F 前面', function () {
  const g = group.floorStalls([
    mk({ stallFloor: 3, tail: '3000' }),
    mk({ stallFloor: 1, tail: '1000' }),
  ])
  assert.deepStrictEqual(g.map(function (x) { return x.floor }), [1, 3])
})

test('同层按商家名聚合，商家只出现一次', function () {
  const g = group.floorStalls([
    mk({ tail: '2000', stallName: '砂锅米线' }),
    mk({ tail: '1000', stallName: '川味小炒' }),
    mk({ tail: '1001', stallName: '川味小炒' }),
  ])
  assert.strictEqual(g[0].stalls.length, 2)
  // localeCompare 按拼音：川(chuan) 在 砂(sha) 前
  assert.strictEqual(g[0].stalls[0].name, '川味小炒')
  assert.strictEqual(g[0].stalls[0].count, 2)
})

test('同商家内按尾号升序', function () {
  const g = group.floorStalls([
    mk({ tail: '9000' }), mk({ tail: '1000' }),
  ])
  assert.deepStrictEqual(g[0].stalls[0].orders.map(function (o) { return o.tail }), ['1000', '9000'])
})

test('整层取完标记 allDone', function () {
  const g = group.floorStalls([
    mk({ picked: true }), mk({ picked: true }),
  ])
  assert.strictEqual(g[0].allDone, true)
  assert.strictEqual(g[0].pickedCount, 2)
})

test('半层取完不是 allDone', function () {
  const g = group.floorStalls([mk({ picked: true }), mk({ picked: false })])
  assert.strictEqual(g[0].allDone, false)
})

test('空列表返回空数组', function () {
  assert.deepStrictEqual(group.floorStalls([]), [])
  assert.deepStrictEqual(group.floorStalls(null), [])
})

// ---------- buildings ----------

test('楼栋升序、楼层降序', function () {
  const g = group.buildings([
    mk({ buildingId: '5栋', floor: 3 }),
    mk({ buildingId: '3栋', floor: 4 }),
    mk({ buildingId: '3栋', floor: 7 }),
  ])
  assert.deepStrictEqual(g.map(function (x) { return x.buildingText }), ['3栋', '5栋'])
  assert.deepStrictEqual(g[0].floors.map(function (f) { return f.floor }), [7, 4])
})

test('楼层摘要可用于卡片', function () {
  const g = group.buildings([
    mk({ floor: 7 }), mk({ floor: 7 }), mk({ floor: 6 }),
  ])
  assert.strictEqual(g[0].floorText, '7F 2单 · 6F 1单')
})

test('优先用 buildingText，缺失才用 buildingId', function () {
  const g = group.buildings([mk({ buildingText: 'A栋', buildingId: 'B1' })])
  assert.strictEqual(g[0].buildingText, 'A栋')
})

test('空列表返回空数组', function () {
  assert.deepStrictEqual(group.buildings([]), [])
  assert.deepStrictEqual(group.buildings(null), [])
})

console.log('\n通过 ' + passed + ' 项')
if (failures.length) {
  console.log('失败 ' + failures.length + ' 项')
  process.exit(1)
}
