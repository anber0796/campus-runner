/**
 * 批次生成 —— 把池子里的散单聚成"可竞价的批次"
 *
 * 批次的定义（与竞价引擎对齐）：
 *   同食堂 × 同楼栋 × 同波次，2～6 单
 *
 * 为什么按楼栋成批：取完直接走，不需要分拣，也不需要任何装备。
 * 跨楼凑批只在单量实在不够时开启（allowCrossBuilding），代价是要分拣。
 *
 * 三条硬规则：
 *   1. 同一收件人的多单绝不拆批（否则一个人两单分给两个骑手，必错）
 *   2. 凑不满 2 单的留在池子里等下一轮，**不丢弃**（高峰期前一分钟可能就够数了）
 *   3. 封顶价随楼层上升——高层不加价，没人接
 *
 * 纯函数，可单测。
 */
const RULES = {
  minOrders: 2,
  maxOrders: 6,
  // 学生用袋子/车筐，不再受"保温箱 6 格"限制，但也不能无限堆
  maxVolumeUnits: 9,
  // 封顶价（代理商愿意为这一单付的上限）
  baseCeiling: 1.6,
  // 楼层加价：4 层起 +0.15，6 层起 +0.3
  floorTiers: [
    { from: 6, bonus: 0.3 },
    { from: 4, bonus: 0.15 },
  ],
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function volumeOf(o) {
  return Number(o.volume) || 1
}

function floorOf(o) {
  return Number(o.floor) || 1
}

function receiverKey(o) {
  return o.receiverPhone || o.receiverName || 'anon:' + o.id
}

function groupKey(o) {
  return [o.canteenId, o.buildingId, o.waveId].join('|')
}

/** 楼层加价：取命中的最高档 */
function floorBonusOf(floor, rules) {
  const cfg = rules || RULES
  for (let i = 0; i < cfg.floorTiers.length; i++) {
    if (floor >= cfg.floorTiers[i].from) return cfg.floorTiers[i].bonus
  }
  return 0
}

/** 这一批的封顶单价 */
function ceilingOf(batch, rules) {
  const cfg = rules || RULES
  return round2(cfg.baseCeiling + floorBonusOf(batch.maxFloor, cfg))
}

/** 同一收件人的多单聚成不可拆的"块" */
function buildBlocks(orders) {
  const map = new Map()
  orders.forEach(function (o) {
    const k = receiverKey(o)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(o)
  })

  const blocks = []
  map.forEach(function (list, key) {
    list.sort(function (a, b) { return String(a.id).localeCompare(String(b.id)) })
    blocks.push({
      key: key,
      orders: list,
      count: list.length,
      volume: list.reduce(function (s, o) { return s + volumeOf(o) }, 0),
      maxFloor: list.reduce(function (m, o) { return Math.max(m, floorOf(o)) }, 0),
    })
  })
  return blocks
}

function newBatch(block, meta) {
  return {
    canteenId: meta.canteenId,
    buildingId: meta.buildingId,
    waveId: meta.waveId,
    orders: block.orders.map(function (o) { return o.id }),
    orderCount: block.count,
    volume: block.volume,
    minFloor: Math.min.apply(null, block.orders.map(floorOf)),
    maxFloor: block.maxFloor,
    status: 'BIDDING',
    createdAt: Date.now(),
  }
}

function addBlock(batch, block) {
  batch.orders = batch.orders.concat(block.orders.map(function (o) { return o.id }))
  batch.orderCount += block.count
  batch.volume += block.volume
  batch.maxFloor = Math.max(batch.maxFloor, block.maxFloor)
  batch.minFloor = Math.min(batch.minFloor, Math.min.apply(null, block.orders.map(floorOf)))
}

function fits(batch, block, cfg) {
  return batch.orderCount + block.count <= cfg.maxOrders &&
    batch.volume + block.volume <= cfg.maxVolumeUnits
}

/**
 * 主函数
 * @param {Array} orders 池子里的待分配订单
 * @param {Object} options { allowCrossBuilding, rules }
 * @returns {{batches:Array, leftover:Array, stats:Object}}
 */
function buildBatches(orders, options) {
  const opts = options || {}
  const cfg = Object.assign({}, RULES, opts.rules || {})
  const meta = { canteenId: '', buildingId: '', waveId: '' }
  const batches = []
  const leftover = []

  // 1. 按「食堂 × 楼栋 × 波次」分组
  const groups = new Map()
  ;(orders || []).forEach(function (o) {
    if (!o.canteenId || !o.buildingId || !o.waveId) {
      leftover.push({ orderId: o.id, reason: 'missing_fields' })
      return
    }
    const k = groupKey(o)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(o)
  })

  groups.forEach(function (groupOrders, key) {
    const parts = key.split('|')
    const m = { canteenId: parts[0], buildingId: parts[1], waveId: parts[2] }

    const blocks = buildBlocks(groupOrders)
    const usable = []
    blocks.forEach(function (b) {
      if (b.count > cfg.maxOrders || b.volume > cfg.maxVolumeUnits) {
        b.orders.forEach(function (o) {
          leftover.push({ orderId: o.id, reason: 'oversize' })
        })
        return
      }
      usable.push(b)
    })

    // 大块、高层先放，尽量把批次塞满
    usable.sort(function (a, b) {
      if (b.volume !== a.volume) return b.volume - a.volume
      if (b.maxFloor !== a.maxFloor) return b.maxFloor - a.maxFloor
      return a.key.localeCompare(b.key)
    })

    const local = []
    usable.forEach(function (block) {
      for (let i = 0; i < local.length; i++) {
        if (fits(local[i], block, cfg)) {
          addBlock(local[i], block)
          return
        }
      }
      local.push(newBatch(block, m))
    })

    local.forEach(function (b) {
      if (b.orderCount < cfg.minOrders) {
        // 凑不满就留在池子里，等下一轮——绝不为了凑数硬拉一个跨楼的进来
        b.orders.forEach(function (id) {
          leftover.push({ orderId: id, reason: 'below_min_orders' })
        })
        return
      }
      b.ceiling = ceilingOf(b, cfg)
      batches.push(b)
    })
  })

  // 2. 可选：跨楼凑批（只在明确开启时做，代价是要分拣）
  if (opts.allowCrossBuilding) {
    const byCanteenWave = new Map()
    const stillLeft = []
    leftover.forEach(function (l) {
      const o = (orders || []).filter(function (x) { return x.id === l.orderId })[0]
      if (!o || l.reason === 'oversize' || l.reason === 'missing_fields') {
        stillLeft.push(l)
        return
      }
      const k = [o.canteenId, o.waveId].join('|')
      if (!byCanteenWave.has(k)) byCanteenWave.set(k, [])
      byCanteenWave.get(k).push(o)
    })

    byCanteenWave.forEach(function (list) {
      if (list.length < cfg.minOrders) {
        list.forEach(function (o) { stillLeft.push({ orderId: o.id, reason: 'below_min_orders' }) })
        return
      }
      const buildings = {}
      list.forEach(function (o) { buildings[o.buildingId] = true })
      const b = {
        canteenId: list[0].canteenId,
        buildingId: Object.keys(buildings).join('+'),
        waveId: list[0].waveId,
        orders: list.map(function (o) { return o.id }),
        orderCount: list.length,
        volume: list.reduce(function (s, o) { return s + volumeOf(o) }, 0),
        minFloor: Math.min.apply(null, list.map(floorOf)),
        maxFloor: Math.max.apply(null, list.map(floorOf)),
        status: 'BIDDING',
        crossBuilding: true,
        createdAt: Date.now(),
      }
      b.ceiling = ceilingOf(b, cfg)
      batches.push(b)
    })

    leftover.length = 0
    stillLeft.forEach(function (x) { leftover.push(x) })
  }

  // 3. 稳定排序，保证同输入同输出
  batches.sort(function (a, b) {
    const ka = [a.canteenId, a.buildingId, a.waveId, a.orders[0]].join('|')
    const kb = [b.canteenId, b.buildingId, b.waveId, b.orders[0]].join('|')
    return ka.localeCompare(kb)
  })

  const packed = batches.reduce(function (s, b) { return s + b.orderCount }, 0)

  return {
    batches: batches,
    leftover: leftover,
    stats: {
      inputOrders: (orders || []).length,
      batchCount: batches.length,
      packedOrders: packed,
      leftoverOrders: leftover.length,
      avgOrdersPerBatch: batches.length ? round2(packed / batches.length) : 0,
    },
  }
}

module.exports = {
  RULES: RULES,
  groupKey: groupKey,
  floorBonusOf: floorBonusOf,
  ceilingOf: ceilingOf,
  buildBlocks: buildBlocks,
  buildBatches: buildBatches,
}
