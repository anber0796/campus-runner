/**
 * 成包器 —— PRD 3.3 / 6.3 第二步
 *
 * 输入：影子订单池里「待成包」的订单
 * 输出：顺路包数组 + 被丢下的订单及原因
 *
 * 三条硬约束（违反任何一条，包就不成立）：
 *   1. 同一楼栋           —— 学生一人一楼
 *   2. 同一食堂           —— 跨食堂必绕路
 *   3. 同一波次           —— 下课时刻表对齐
 *
 * 两条容量约束：
 *   单量 ≤ 6、体积 ≤ 6（汤粉类记 2）
 *
 * 一条收益约束：
 *   包预估收益 < 2.0 元不生成（PRD 3.4，避免消耗推送额度、损伤信任）
 *
 * 纯函数，不碰数据库，方便单测和复用。
 */
const commission = require('./commission')

const DEFAULTS = {
  maxOrdersPerPack: commission.RULE.MAX_ORDERS_PER_PACK,
  maxVolumeUnits: commission.RULE.MAX_VOLUME_UNITS,
  minPackIncome: commission.RULE.MIN_PACK_INCOME,
  // 出餐慢的档口不进包（PRD 4.3：不为凑单量牺牲时效）
  excludeSlowStalls: true,
  slowStalls: [],
}

function volumeOf(order) {
  return Number(order.volume) || 1
}

function floorOf(order) {
  return Number(order.floor) || 1
}

/** 同一收件人的多单必须同包，所以先按收件人聚成"块" */
function receiverKey(order) {
  return order.receiverPhone || order.receiverName || 'anon:' + order.id
}

function sumVolume(orders) {
  return orders.reduce(function (s, o) { return s + volumeOf(o) }, 0)
}

function maxFloor(orders) {
  return orders.reduce(function (m, o) { return Math.max(m, floorOf(o)) }, 0)
}

/**
 * 把订单聚成收件人块
 * @returns {{blocks: Array, dropped: Array}}
 */
function buildBlocks(orders) {
  const map = new Map()
  const dropped = []

  orders.forEach(function (o) {
    const k = receiverKey(o)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(o)
  })

  const blocks = []
  map.forEach(function (list, key) {
    // 块内排序保证确定性输出
    list.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)) })
    blocks.push({
      key: key,
      orders: list,
      volume: sumVolume(list),
      count: list.length,
      floor: maxFloor(list),
    })
  })

  return { blocks: blocks, dropped: dropped }
}

/** 一个块能不能塞进某个包 */
function fits(pack, block, cfg) {
  return pack.count + block.count <= cfg.maxOrdersPerPack &&
    pack.volume + block.volume <= cfg.maxVolumeUnits
}

function newPack(block) {
  return {
    orders: block.orders.slice(),
    count: block.count,
    volume: block.volume,
    floor: block.floor,
    keys: [block.key],
  }
}

function addToPack(pack, block) {
  pack.orders = pack.orders.concat(block.orders)
  pack.count += block.count
  pack.volume += block.volume
  pack.floor = Math.max(pack.floor, block.floor)
  pack.keys.push(block.key)
}

function incomeOf(pack) {
  return commission.calcPackIncome(pack.orders)
}

/**
 * 合并两个都"收益不足"的包：只要合并后装得下且收益达标，就别浪费这波单量。
 * PRD 6.1 说得很直白——包均单量决定佣金能压多低。
 */
function tryMergeLowPacks(packs, cfg) {
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < packs.length; i++) {
      if (incomeOf(packs[i]).subtotal >= cfg.minPackIncome) continue
      for (let j = i + 1; j < packs.length; j++) {
        const a = packs[i]
        const b = packs[j]
        if (a.count + b.count > cfg.maxOrdersPerPack) continue
        if (a.volume + b.volume > cfg.maxVolumeUnits) continue
        addToPack(a, { orders: b.orders, count: b.count, volume: b.volume, floor: b.floor, key: '$merged' })
        packs.splice(j, 1)
        changed = true
        break
      }
      if (changed) break
    }
  }
  return packs
}

/**
 * 主函数
 * @param {Array} orders 待成包订单
 * @param {Object} config 覆盖默认配置
 * @returns {{packs: Array, dropped: Array, stats: Object}}
 */
function buildPacks(orders, config) {
  const cfg = Object.assign({}, DEFAULTS, config || {})
  const slow = new Set(cfg.slowStalls || [])
  const dropped = []

  // 1. 硬过滤：出餐慢档口的单不进包
  const usable = []
  ;(orders || []).forEach(function (o) {
    if (cfg.excludeSlowStalls && slow.has(o.stallId)) {
      dropped.push({ orderId: o.id, reason: 'stall_slow', detail: '档口出餐慢，不进包' })
      return
    }
    usable.push(o)
  })

  // 2. 按「楼栋 × 食堂 × 波次」分组
  const groups = new Map()
  usable.forEach(function (o) {
    const key = [o.buildingId, o.canteenId, o.waveId].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(o)
  })

  const packs = []
  let groupCount = 0

  groups.forEach(function (groupOrders, key) {
    groupCount++
    const parts = key.split('|')
    const buildingId = parts[0]
    const canteenId = parts[1]
    const waveId = parts[2]

    const built = buildBlocks(groupOrders)

    // 单块就超容量的，直接丢（不拆——同收件人不能分家）
    const blocks = []
    built.blocks.forEach(function (b) {
      if (b.count > cfg.maxOrdersPerPack || b.volume > cfg.maxVolumeUnits) {
        b.orders.forEach(function (o) {
          dropped.push({ orderId: o.id, reason: 'oversize', detail: '同一收件人单量/体积超上限' })
        })
        return
      }
      blocks.push(b)
    })

    // 3. 首次适应递减：大块先放、楼层高的先放，尽量把包塞满
    blocks.sort(function (a, b) {
      if (b.volume !== a.volume) return b.volume - a.volume
      if (b.floor !== a.floor) return b.floor - a.floor
      return a.key.localeCompare(b.key)
    })

    const local = []
    blocks.forEach(function (block) {
      for (let i = 0; i < local.length; i++) {
        if (fits(local[i], block, cfg)) {
          addToPack(local[i], block)
          return
        }
      }
      local.push(newPack(block))
    })

    // 4. 收益不足的包先尝试互相合并，合并不了才丢
    tryMergeLowPacks(local, cfg)

    local.forEach(function (p) {
      const income = incomeOf(p)
      if (income.subtotal < cfg.minPackIncome) {
        p.orders.forEach(function (o) {
          dropped.push({
            orderId: o.id,
            reason: 'income_below_min',
            detail: '包收益 ' + income.subtotal + ' < 下限 ' + cfg.minPackIncome,
          })
        })
        return
      }

      const floors = p.orders.map(floorOf)
      packs.push({
        buildingId: buildingId,
        canteenId: canteenId,
        waveId: waveId,
        orders: p.orders.map(function (o) { return o.id }),
        orderCount: p.orders.length,
        volume: p.volume,
        minFloor: Math.min.apply(null, floors),
        maxFloor: Math.max.apply(null, floors),
        income: income,
        status: 'available',
      })
    })
  })

  // 5. 稳定排序，保证同输入同输出（便于测试与对账）
  packs.sort(function (a, b) {
    const ka = [a.buildingId, a.canteenId, a.waveId, a.orders[0]].join('|')
    const kb = [b.buildingId, b.canteenId, b.waveId, b.orders[0]].join('|')
    return ka.localeCompare(kb)
  })

  return {
    packs: packs,
    dropped: dropped,
    stats: {
      inputOrders: (orders || []).length,
      packCount: packs.length,
      packedOrders: packs.reduce(function (s, p) { return s + p.orderCount }, 0),
      droppedOrders: dropped.length,
      groupCount: groupCount,
      avgOrdersPerPack: packs.length
        ? Math.round((packs.reduce(function (s, p) { return s + p.orderCount }, 0) / packs.length) * 100) / 100
        : 0,
    },
  }
}

module.exports = {
  DEFAULTS: DEFAULTS,
  buildPacks: buildPacks,
  buildBlocks: buildBlocks,
  receiverKey: receiverKey,
}
