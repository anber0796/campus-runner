/**
 * 分组工具 —— 三个页面原本各写一份，逻辑重复且容易改漏。
 *
 * 两个维度：
 *   floorStalls  取餐用：楼 → 商家 → 运单
 *   buildings    送达用：楼栋 → 楼层（降序）→ 运单
 *
 * 只做纯数据变换，不碰 UI、不读时间。
 */

/** 运单按「档口楼层 → 商家」分组，楼层升序、商家名升序、尾号升序 */
function floorStalls(orders) {
  const byFloor = {}
  ;(orders || []).forEach(function (o) {
    const f = o.stallFloor || 1
    if (!byFloor[f]) byFloor[f] = {}
    const name = o.stallName || '未命名档口'
    if (!byFloor[f][name]) byFloor[f][name] = []
    byFloor[f][name].push(o)
  })

  return Object.keys(byFloor)
    .map(Number)
    .sort(function (a, b) { return a - b })
    .map(function (f) {
      const stallMap = byFloor[f]
      const names = Object.keys(stallMap).sort()
      let count = 0
      let picked = 0

      const stalls = names.map(function (name) {
        const list = stallMap[name].slice().sort(function (a, b) {
          return String(a.tail).localeCompare(String(b.tail))
        })
        count += list.length
        picked += list.filter(function (o) { return o.picked }).length
        return {
          name: name,
          count: list.length,
          allDone: list.every(function (o) { return o.picked }),
          orders: list,
        }
      })

      return {
        floor: f,
        count: count,
        pickedCount: picked,
        stallCount: names.length,
        allDone: picked === count,
        stalls: stalls,
      }
    })
}

/** 运单按「楼栋 → 楼层（降序）」分组；楼栋名升序 */
function buildings(orders) {
  const byBuilding = {}
  ;(orders || []).forEach(function (o) {
    const k = o.buildingText || o.buildingId || '未知楼栋'
    if (!byBuilding[k]) byBuilding[k] = []
    byBuilding[k].push(o)
  })

  return Object.keys(byBuilding)
    .sort()
    .map(function (k) {
      const list = byBuilding[k].slice().sort(function (a, b) {
        return (b.floor || 0) - (a.floor || 0)
      })

      const byFloor = {}
      list.forEach(function (o) {
        const f = o.floor || 0
        if (!byFloor[f]) byFloor[f] = []
        byFloor[f].push(o)
      })

      const floors = Object.keys(byFloor)
        .map(Number)
        .sort(function (a, b) { return b - a })
        .map(function (f) {
          return {
            floor: f,
            label: f + 'F',
            count: byFloor[f].length,
            orders: byFloor[f],
          }
        })

      return {
        buildingText: k,
        count: list.length,
        floors: floors,
        // 给卡片用的一行摘要：7F 1单 · 6F 1单
        floorText: floors.map(function (f) { return f.label + ' ' + f.count + '单' }).join(' · '),
      }
    })
}

module.exports = {
  floorStalls: floorStalls,
  buildings: buildings,
}
