/**
 * 本地假数据 —— 用于「没有云开发环境」时直接跑通界面。
 * 数据形状与云函数 api 的返回完全一致，所以切到真环境时页面不用改。
 */
const commission = require('./commission')
const waves = require('./waves')

const now = Date.now()
const wave = waves.nextWave(new Date())

const state = {
  student: {
    openid: 'mock-openid',
    name: '',
    studentNo: '',
    phone: '',
    buildingId: 'B3',
    buildingName: '3栋',
    room: '',
    canteenIds: ['C1'],
    canteenNames: ['一食堂'],
    waveIds: ['W2', 'W6'],
    platformRiderId: '',
    credit: 100,
    status: 'none', // none | pending | active
    healthExpire: '',
    createdAt: now,
    needRegister: true,
  },
  packs: [
    {
      id: 'PK202610310001',
      canteenId: 'C1',
      canteenName: '一食堂',
      buildingId: 'B3',
      buildingName: '3栋',
      waveId: wave.id,
      waveLabel: wave.label,
      walkMinutes: 9,
      distanceMeters: 620,
      status: 'available',
      createdAt: now,
      orders: [
        { id: 'O1', tail: '8821', stall: '川味小炒', floor: 5, room: '512', receiver: '李同学', volume: 1, picked: false },
        { id: 'O2', tail: '5567', stall: '砂锅米线', floor: 5, room: '508', receiver: '王同学', volume: 2, picked: false },
        { id: 'O3', tail: '3390', stall: '煎饼果子', floor: 4, room: '402', receiver: '赵同学', volume: 1, picked: false },
      ],
    },
    {
      id: 'PK202610310002',
      canteenId: 'C1',
      canteenName: '一食堂',
      buildingId: 'B3',
      buildingName: '3栋',
      waveId: wave.id,
      waveLabel: wave.label,
      walkMinutes: 9,
      distanceMeters: 620,
      status: 'available',
      createdAt: now,
      orders: [
        { id: 'O4', tail: '1102', stall: '川味小炒', floor: 3, room: '318', receiver: '陈同学', volume: 1, picked: false },
        { id: 'O5', tail: '7743', stall: '麻辣烫', floor: 3, room: '322', receiver: '刘同学', volume: 2, picked: false },
        { id: 'O6', tail: '6698', stall: '煎饼果子', floor: 6, room: '601', receiver: '周同学', volume: 1, picked: false },
        { id: 'O7', tail: '2205', stall: '砂锅米线', floor: 6, room: '605', receiver: '吴同学', volume: 2, picked: false },
      ],
    },
    {
      // 这个包只有 2 单且都在低楼层，收益 < 2.0 —— 按 PRD 3.4 不推送，用来验证过滤逻辑
      id: 'PK202610310003',
      canteenId: 'C1',
      canteenName: '一食堂',
      buildingId: 'B3',
      buildingName: '3栋',
      waveId: wave.id,
      waveLabel: wave.label,
      walkMinutes: 9,
      distanceMeters: 620,
      status: 'available',
      createdAt: now,
      orders: [
        { id: 'O8', tail: '9012', stall: '煎饼果子', floor: 2, room: '205', receiver: '郑同学', volume: 1, picked: false },
        { id: 'O9', tail: '4411', stall: '煎饼果子', floor: 2, room: '207', receiver: '孙同学', volume: 1, picked: false },
      ],
    },
  ],
  walletLogs: [],
}

function delay(data) {
  return new Promise(function (resolve) {
    setTimeout(function () { resolve(data) }, 120)
  })
}

function fail(msg, code) {
  const e = new Error(msg)
  e.code = code || 400
  return Promise.reject(e)
}

function decorate(pack) {
  const income = commission.calcPackIncome(pack.orders)
  const floors = pack.orders.map(function (o) { return o.floor })
  return Object.assign({}, pack, {
    orderCount: pack.orders.length,
    income: income,
    maxFloor: Math.max.apply(null, floors),
    minFloor: Math.min.apply(null, floors),
    // PRD 3.4：不显示单价，显示"这一趟"
    caption: '这一趟 ¥' + income.total + ' · 顺路 ' + pack.walkMinutes + ' 分钟 · 帮 ' +
      pack.orders.length + ' 位同学带饭回 ' + pack.buildingName,
    pickedCount: pack.orders.filter(function (o) { return o.picked }).length,
  })
}

function myPacks() {
  return state.packs
    .filter(function (p) { return p.status !== 'available' })
    .map(decorate)
}

const handlers = {
  'student.get': function () {
    const w = waves.nextWave(new Date())
    return delay({
      student: state.student,
      wave: w,
      // 认证前置项，用于首页提示"还差几项"
      missing: state.student.status === 'active' ? [] : ['实名信息', '学生证', '健康证'],
    })
  },

  'student.save': function (payload) {
    const p = payload.profile || {}
    state.student = Object.assign({}, state.student, p, {
      status: 'active',
      needRegister: false,
      healthExpire: p.healthExpire || '2027-03-01',
    })
    return delay({ student: state.student })
  },

  'packs.list': function () {
    const list = state.packs
      .filter(function (p) { return p.status === 'available' })
      .map(decorate)
      // PRD 3.4：包预估收益 < 2.0 不推送
      .filter(function (p) { return p.income.pushable })
    return delay({ packs: list, wave: waves.nextWave(new Date()) })
  },

  'packs.detail': function (payload) {
    const pack = state.packs.filter(function (p) { return p.id === payload.id })[0]
    if (!pack) return fail('包不存在或已被接走', 404)
    return delay(decorate(pack))
  },

  'packs.accept': function (payload) {
    const pack = state.packs.filter(function (p) { return p.id === payload.id })[0]
    if (!pack) return fail('包不存在', 404)
    if (pack.status !== 'available') return fail('手慢了，这个包已被接走', 409)
    const active = state.packs.filter(function (p) {
      return p.status === 'accepted' || p.status === 'picked'
    })
    if (active.length >= 4) return fail('今日接单已达上限（4 包）', 429)
    pack.status = 'accepted'
    pack.acceptedAt = Date.now()
    return delay(decorate(pack))
  },

  'orders.my': function () {
    const list = myPacks()
    return delay({
      active: list.filter(function (p) { return p.status !== 'delivered' }),
      finished: list.filter(function (p) { return p.status === 'delivered' }),
    })
  },

  'deliver.pickup': function (payload) {
    const pack = state.packs.filter(function (p) { return p.id === payload.packId })[0]
    if (!pack) return fail('包不存在', 404)
    const order = pack.orders.filter(function (o) { return o.id === payload.orderId })[0]
    if (!order) return fail('订单不存在', 404)
    order.picked = true
    order.pickedAt = Date.now()
    if (pack.orders.every(function (o) { return o.picked })) pack.status = 'picked'
    return delay(decorate(pack))
  },

  'deliver.complete': function (payload) {
    const pack = state.packs.filter(function (p) { return p.id === payload.packId })[0]
    if (!pack) return fail('包不存在', 404)
    if (!pack.orders.every(function (o) { return o.picked })) return fail('还有餐没取', 400)
    pack.status = 'delivered'
    pack.deliveredAt = Date.now()
    pack.photo = payload.photo
    const income = commission.calcPackIncome(pack.orders)
    state.walletLogs.unshift({
      id: 'WL' + pack.id,
      packId: pack.id,
      amount: income.total,
      status: 'pending',
      title: pack.canteenName + ' · ' + pack.orders.length + ' 单',
      time: Date.now(),
    })
    return delay(decorate(pack))
  },

  'wallet.summary': function () {
    const pending = state.walletLogs
      .filter(function (l) { return l.status === 'pending' })
      .reduce(function (s, l) { return s + l.amount }, 0)
    const settled = state.walletLogs
      .filter(function (l) { return l.status === 'settled' })
      .reduce(function (s, l) { return s + l.amount }, 0)
    return delay({
      pending: Math.round(pending * 100) / 100,
      settled: Math.round(settled * 100) / 100,
      logs: state.walletLogs,
    })
  },
}

function handle(action, data) {
  const fn = handlers[action]
  if (!fn) return fail('未知操作: ' + action, 404)
  return fn(data || {})
}

module.exports = { handle: handle, state: state }
