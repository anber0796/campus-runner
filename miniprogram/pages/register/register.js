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
// 常见下课时刻，用来算"走到食堂要多久、什么时候该推单"
const DISMISS_TIMES = ['11:35', '11:50', '12:05', '17:20', '17:35', '17:50']

const WAVE_IDS = ['W2', 'W3', 'W6', 'W7']

Page({
  data: {
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

    // 覆盖楼栋：主楼 + 最多 2 个邻楼，决定他能抢到哪些批次
    selectedCoverage: ['3栋'],

    form: {
      name: '',
      studentNo: '',
      phone: '',
      room: '',
      healthExpire: '',
    },
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
    // 换主楼时覆盖范围必须跟着换，否则会出现"主楼 3 栋但只覆盖 7 栋"
    const cov = this.data.selectedCoverage.filter(function (b) { return b !== name })
    cov.unshift(name)
    this.setData({
      buildingIndex: idx,
      selectedCoverage: cov.slice(0, 3),
    })
  },

  onTeachingChange(e) {
    this.setData({ teachingIndex: Number(e.detail.value) })
  },

  onDismissChange(e) {
    this.setData({ dismissIndex: Number(e.detail.value) })
  },

  pickVehicle(e) {
    this.setData({ vehicle: e.currentTarget.dataset.id })
  },

  onDateChange(e) {
    this.setData({ 'form.healthExpire': e.detail.value })
  },

  toggleCanteen(e) {
    const id = e.currentTarget.dataset.id
    let list = this.data.selectedCanteens.slice()
    if (list.indexOf(id) >= 0) {
      if (list.length === 1) {
        wx.showToast({ title: '至少选一个常去食堂', icon: 'none' })
        return
      }
      list = list.filter(function (x) { return x !== id })
    } else {
      if (list.length >= 2) {
        wx.showToast({ title: '最多选两个', icon: 'none' })
        return
      }
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
      if (list.length >= 3) {
        wx.showToast({ title: '最多选三个波次', icon: 'none' })
        return
      }
      list.push(id)
    }
    this.setData({ selectedWaves: list })
  },

  toggleCoverage(e) {
    const name = e.currentTarget.dataset.name
    const primary = this.data.buildings[this.data.buildingIndex]
    let list = this.data.selectedCoverage.slice()

    if (name === primary) {
      wx.showToast({ title: '主楼必须包含', icon: 'none' })
      return
    }
    if (list.indexOf(name) >= 0) {
      list = list.filter(function (x) { return x !== name })
    } else {
      if (list.length >= 3) {
        wx.showToast({ title: '最多覆盖 3 栋楼', icon: 'none' })
        return
      }
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

  toggleAgree() {
    this.setData({ agree: !this.data.agree })
  },

  submit() {
    if (this.data.submitting) return
    const f = this.data.form
    if (!f.name.trim()) return wx.showToast({ title: '请填写姓名', icon: 'none' })
    if (!f.studentNo.trim()) return wx.showToast({ title: '请填写学号', icon: 'none' })
    if (!/^1\d{10}$/.test(f.phone)) return wx.showToast({ title: '手机号格式不对', icon: 'none' })
    if (!f.room.trim()) return wx.showToast({ title: '请填写寝室号', icon: 'none' })
    if (!this.data.certs.studentCard) return wx.showToast({ title: '请上传学生证', icon: 'none' })
    if (!this.data.certs.health) return wx.showToast({ title: '请上传健康证', icon: 'none' })
    if (!this.data.selectedWaves.length) return wx.showToast({ title: '至少选一个下课波次', icon: 'none' })
    if (!this.data.agree) return wx.showToast({ title: '请先同意服务协议', icon: 'none' })

    const buildingName = this.data.buildings[this.data.buildingIndex]
    const teachingName = this.data.teachings[this.data.teachingIndex]
    const dismissTime = this.data.dismissTimes[this.data.dismissIndex]
    const selected = this.data.selectedCanteens
    const canteenNames = this.data.canteens
      .filter(function (c) { return selected.indexOf(c.id) >= 0 })
      .map(function (c) { return c.name })

    const profile = {
      name: f.name.trim(),
      studentNo: f.studentNo.trim(),
      phone: f.phone,
      room: f.room.trim(),
      buildingId: 'B' + (this.data.buildingIndex + 1),
      buildingName: buildingName,
      // 抢单资格靠这四个字段：覆盖楼栋 + 教学楼 + 下课时间 + 交通工具
      coverageBuildings: this.data.selectedCoverage,
      teachingBuildingId: teachingName,
      dismissTime: dismissTime,
      vehicle: this.data.vehicle,
      canteenIds: selected,
      canteenNames: canteenNames,
      waveIds: this.data.selectedWaves,
      healthExpire: f.healthExpire,
    }

    const that = this
    this.setData({ submitting: true })
    api.saveStudent(profile)
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
            const done = function () {
              setTimeout(function () { wx.navigateBack() }, 500)
            }
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
