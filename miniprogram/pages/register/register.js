const api = require('../../utils/api')
const wavesLib = require('../../utils/waves')
const subscribe = require('../../utils/subscribe')

const BUILDINGS = ['1栋', '2栋', '3栋', '4栋', '5栋', '6栋', '7栋', '8栋']
const TEACHINGS = ['1教', '2教', '3教', '4教', '实验楼', '图书馆']
const CANTEENS = [
  { id: 'C1', name: '一食堂' },
  { id: 'C2', name: '二食堂' },
  { id: 'C3', name: '三食堂' },
]
const VEHICLES = [
  { id: 'walk', name: '步行' },
  { id: 'bike', name: '自行车' },
  { id: 'ebike', name: '电动车' },
]
const DISMISS_TIMES = ['11:35', '11:50', '12:05', '17:20', '17:35', '17:50']
const WAVE_IDS = ['W2', 'W3', 'W6', 'W7']

Page({
  data: {
    // 第一步：只问非问不可的，30 秒能填完
    // 第二步：接单前才必须的（资质、动线、协议）
    step: 1,

    buildings: BUILDINGS,
    buildingIndex: 2,
    teachings: TEACHINGS,
    teachingIndex: 2,
    dismissTimes: DISMISS_TIMES,
    dismissIndex: 1,
    vehicles: VEHICLES,
    vehicle: 'walk',

    canteens: CANTEENS,
    selectedCanteens: ['C1'],
    waveOpts: WAVE_IDS.map(function (id) {
      const w = wavesLib.byId(id)
      return { id: id, label: w.time + ' 下课' }
    }),
    selectedWaves: ['W2'],
    selectedCoverage: ['3栋'],

    form: { name: '', studentNo: '', phone: '', room: '', healthExpire: '' },
    certs: { studentCard: false, health: false },
    agree: false,
    submitting: false,
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onBuildingChange(e) {
    const idx = Number(e.detail.value)
    const name = this.data.buildings[idx]
    const cov = this.data.selectedCoverage.filter(function (b) { return b !== name })
    cov.unshift(name)
    this.setData({ buildingIndex: idx, selectedCoverage: cov.slice(0, 3) })
  },

  onTeachingChange(e) { this.setData({ teachingIndex: Number(e.detail.value) }) },
  onDismissChange(e) { this.setData({ dismissIndex: Number(e.detail.value) }) },
  pickVehicle(e) { this.setData({ vehicle: e.currentTarget.dataset.id }) },
  onDateChange(e) { this.setData({ 'form.healthExpire': e.detail.value }) },

  toggleCanteen(e) {
    const id = e.currentTarget.dataset.id
    let list = this.data.selectedCanteens.slice()
    if (list.indexOf(id) >= 0) {
      if (list.length === 1) return wx.showToast({ title: '至少选一个常去食堂', icon: 'none' })
      list = list.filter(function (x) { return x !== id })
    } else {
      if (list.length >= 2) return wx.showToast({ title: '最多选两个', icon: 'none' })
      list.push(id)
    }
    this.setData({ selectedCanteens: list })
  },

  toggleWave(e) {
    const id = e.currentTarget.dataset.id
    let list = this.data.selectedWaves.slice()
    if (list.indexOf(id) >= 0) {
      list = list.filter(function (x) { return x !== id })
    } else {
      if (list.length >= 3) return wx.showToast({ title: '最多选三个波次', icon: 'none' })
      list.push(id)
    }
    this.setData({ selectedWaves: list })
  },

  toggleCoverage(e) {
    const name = e.currentTarget.dataset.name
    const primary = this.data.buildings[this.data.buildingIndex]
    let list = this.data.selectedCoverage.slice()
    if (name === primary) return wx.showToast({ title: '主楼必须包含', icon: 'none' })
    if (list.indexOf(name) >= 0) {
      list = list.filter(function (x) { return x !== name })
    } else {
      if (list.length >= 3) return wx.showToast({ title: '最多覆盖 3 栋楼', icon: 'none' })
      list.push(name)
    }
    this.setData({ selectedCoverage: list })
  },

  uploadCert(e) {
    const type = e.currentTarget.dataset.type
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: function () {
        const certs = Object.assign({}, that.data.certs)
        certs[type] = true
        that.setData({ certs: certs })
        wx.showToast({ title: '已上传', icon: 'success' })
      },
    })
  },

  toggleAgree() { this.setData({ agree: !this.data.agree }) },

  /** 组装档案，partial=true 表示只填了第一步 */
  buildProfile() {
    const f = this.data.form
    const selected = this.data.selectedCanteens
    return {
      name: f.name.trim(),
      studentNo: f.studentNo.trim(),
      phone: f.phone,
      room: f.room.trim(),
      buildingId: 'B' + (this.data.buildingIndex + 1),
      buildingName: this.data.buildings[this.data.buildingIndex],
      coverageBuildings: this.data.selectedCoverage,
      teachingBuildingId: this.data.teachings[this.data.teachingIndex],
      dismissTime: this.data.dismissTimes[this.data.dismissIndex],
      vehicle: this.data.vehicle,
      canteenIds: selected,
      canteenNames: this.data.canteens
        .filter(function (c) { return selected.indexOf(c.id) >= 0 })
        .map(function (c) { return c.name }),
      waveIds: this.data.selectedWaves,
      healthExpire: f.healthExpire,
    }
  },

  /** 第一步校验：只卡非问不可的 */
  nextStep() {
    const f = this.data.form
    if (!f.name.trim()) return wx.showToast({ title: '请填写姓名', icon: 'none' })
    if (!f.studentNo.trim()) return wx.showToast({ title: '请填写学号', icon: 'none' })
    if (!/^1\d{10}$/.test(f.phone)) return wx.showToast({ title: '手机号格式不对', icon: 'none' })
    if (!f.room.trim()) return wx.showToast({ title: '请填写寝室号', icon: 'none' })
    if (this.data.submitting) return

    const that = this
    this.setData({ submitting: true })
    // 先把基础信息存下来：中途退出不会白填，状态是"待完善"
    api.saveStudent(this.buildProfile(), true)
      .then(function () {
        that.setData({ submitting: false, step: 2 })
        wx.pageScrollTo({ scrollTop: 0, duration: 200 })
      })
      .catch(function (e) {
        that.setData({ submitting: false })
        wx.showToast({ title: e.message || '保存失败', icon: 'none' })
      })
  },

  prevStep() {
    this.setData({ step: 1 })
    wx.pageScrollTo({ scrollTop: 0, duration: 200 })
  },

  /** 第二步校验：接单前必须齐的 */
  submit() {
    if (this.data.submitting) return
    if (!this.data.certs.studentCard) return wx.showToast({ title: '请上传学生证', icon: 'none' })
    if (!this.data.certs.health) return wx.showToast({ title: '请上传健康证', icon: 'none' })
    if (!this.data.selectedWaves.length) return wx.showToast({ title: '至少选一个下课波次', icon: 'none' })
    if (!this.data.agree) return wx.showToast({ title: '请先同意服务协议', icon: 'none' })

    const that = this
    this.setData({ submitting: true })
    api.saveStudent(this.buildProfile())
      .then(function () {
        wx.showToast({ title: '认证已提交', icon: 'success' })
        if (!subscribe.templateIds().length) {
          setTimeout(function () { wx.navigateBack() }, 700)
          return
        }
        wx.showModal({
          title: '要开下课提醒吗',
          content: '下课前 10 分钟提醒你有可抢的批次，一天最多 3 次。',
          confirmText: '开启',
          cancelText: '再说',
          success: function (res) {
            const done = function () { setTimeout(function () { wx.navigateBack() }, 500) }
            if (!res.confirm) return done()
            subscribe.request().then(done).catch(done)
          },
        })
      })
      .catch(function (e) {
        that.setData({ submitting: false })
        wx.showToast({ title: e.message || '提交失败', icon: 'none' })
      })
  },
})
