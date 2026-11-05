/**
 * 派单提前量引擎 —— 你说的第 3 点
 *
 * 目标只有一个：**学生走到食堂的那一刻，餐刚好出**。
 * 早到 = 干等 = 流失（PRD 称之为头号杀手）；晚到 = 餐凉 = 客诉。
 *
 * 输入：下课时刻、教学楼→食堂的距离、交通工具
 * 输出：该不该推、什么时候推、这个学生来不来得及
 *
 * 三种交通工具都给，速度按校园限速取值（电动车 15km/h）。
 */
const VEHICLES = {
  walk: { label: '步行', speed: 1.25, maxDistance: 1200 },
  bike: { label: '自行车', speed: 3.3, maxDistance: 3000 },
  // 校园普遍限速 15km/h ≈ 4.17 m/s，这里取 4.2
  ebike: { label: '电动车', speed: 4.2, maxDistance: 4000 },
}

const RULES = {
  // 停车、进店、找档口的固定开销
  bufferMin: 2,
  // 允许晚到几分钟（餐好了等一会儿可以接受）
  toleranceMin: 3,
  // 早到超过这个数就别推了——干等比迟到更伤
  maxWaitMin: 6,
  // 提前多少分钟把批次推出去（学生要有时间做决定）
  leadMin: 10,
}

function isNum(n) {
  return typeof n === 'number' && isFinite(n)
}

function vehicleOf(key) {
  return VEHICLES[key] || VEHICLES.walk
}

/**
 * 从教学楼走到食堂要几分钟（含固定开销）
 * 超出该交通方式的合理半径 → Infinity（表示不可达）
 */
function travelMinutes(distanceMeters, vehicle) {
  const v = vehicleOf(vehicle)
  if (!isNum(distanceMeters) || distanceMeters < 0) return Infinity
  if (distanceMeters > v.maxDistance) return Infinity
  return Math.ceil(distanceMeters / v.speed / 60) + RULES.bufferMin
}

/** 几点到食堂 */
function arrivalAt(dismissAt, distanceMeters, vehicle) {
  const m = travelMinutes(distanceMeters, vehicle)
  if (m === Infinity) return null
  return dismissAt + m * 60000
}

/** 什么时候把批次推给他 */
function pushAt(dismissAt, leadMin) {
  const lead = isNum(leadMin) ? leadMin : RULES.leadMin
  return dismissAt - lead * 60000
}

/**
 * 这个学生接这批，时间上合不合适
 * @param {Object} p { dismissAt, readyAt, distanceMeters, vehicle }
 * @returns {{ok:boolean, reason?:string, arrival:number, lateMin:number, waitMin:number, score:number}}
 */
function evaluateFit(p) {
  const travel = travelMinutes(p.distanceMeters, p.vehicle)
  if (travel === Infinity) {
    return { ok: false, reason: 'too_far', arrival: 0, lateMin: Infinity, waitMin: 0, score: 0 }
  }

  const arrival = p.dismissAt + travel * 60000
  // 正数 = 到得比出餐晚；负数 = 早到
  const lateMin = (arrival - p.readyAt) / 60000
  const waitMin = -lateMin

  if (lateMin > RULES.toleranceMin) {
    return { ok: false, reason: 'too_late', arrival: arrival, lateMin: lateMin, waitMin: waitMin, score: 0 }
  }
  if (waitMin > RULES.maxWaitMin) {
    return { ok: false, reason: 'too_early', arrival: arrival, lateMin: lateMin, waitMin: waitMin, score: 0 }
  }

  // 越贴近出餐时刻越好，满分 100
  const score = Math.max(0, Math.round(100 - Math.abs(lateMin) * 12))
  return { ok: true, reason: 'fit', arrival: arrival, lateMin: lateMin, waitMin: waitMin, score: score }
}

/**
 * 派单匹配：食堂必须在他的常去列表里（注册时选的），且时间来得及
 * @param {Object} student { canteenIds, vehicle }
 * @param {Object} batch   { canteenId, readyAt }
 * @param {Number} distanceMeters 教学楼 → 该食堂
 */
function matchBatch(student, batch, distanceMeters, options) {
  const cfg = Object.assign({}, RULES, (options && options.rules) || {})
  const dismissAt = (options && options.dismissAt) || student.dismissAt

  if (!student || !student.canteenIds || student.canteenIds.indexOf(batch.canteenId) < 0) {
    return { ok: false, reason: 'canteen_not_chosen', score: 0 }
  }
  if (!dismissAt) {
    return { ok: false, reason: 'no_dismiss_time', score: 0 }
  }

  const fit = evaluateFit({
    dismissAt: dismissAt,
    readyAt: batch.readyAt,
    distanceMeters: distanceMeters,
    vehicle: student.vehicle,
  })

  if (!fit.ok) return fit
  return Object.assign({}, fit, {
    pushAt: pushAt(dismissAt, cfg.leadMin),
  })
}

/**
 * 从距离矩阵里取「教学楼 → 食堂」的距离。
 * 冷启动由运营在后台填一张表；没有数据时返回 null，调用方应跳过该学生，
 * 绝不能拿默认值蒙一个距离——距离错了，提前量就全错。
 */
function distanceFrom(matrix, teachingBuildingId, canteenId) {
  if (!matrix || !teachingBuildingId || !canteenId) return null
  const row = matrix[teachingBuildingId]
  if (!row) return null
  const d = row[canteenId]
  return isNum(d) ? d : null
}

module.exports = {
  VEHICLES: VEHICLES,
  RULES: RULES,
  travelMinutes: travelMinutes,
  arrivalAt: arrivalAt,
  pushAt: pushAt,
  evaluateFit: evaluateFit,
  matchBatch: matchBatch,
  distanceFrom: distanceFrom,
}
