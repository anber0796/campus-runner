const api = require('../../utils/api')
const wavesLib = require('../../utils/waves')
const subscribe = require('../../utils/subscribe')

const BUILDINGS = ['1栋', '2栋', '3栋', '4栋', '5栋', '6栋', '7栋', '8栋']
const CANTEENS = [
  { id: 'C1', name: '一食堂' },
  { id: 'C2', name: '二食堂' },
  { id: 'C3', name: '三食堂' },
]
// PRD 6.2：波次给三个按钮勾选即可，不要一上来就要课表
const WAVE_IDS = ['W2', 'W3', 'W6', 'W7']

Page({
  data: {
    buildings: BUILDINGS,
    buildingIndex: 2,
    canteens: CANTEENS,
    selectedCanteens: ['C1'],
    waveOpts: WAVE_IDS.map(function (id) {
      const w = wavesLib.byId(id)
      return { id: id, label: w.time + ' 下课' }
    }),
    selectedWaves: ['W2'],
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
    this.setData({ buildingIndex: Number(e.detail.value) })
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

  uploadCert(e) {
    const type = e.currentTarget.dataset.type
    const that = this
    // 演示模式：只标记已上传；接云开发后换成 wx.cloud.uploadFile
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
    const canteenNames = this.data.canteens
      .filter(function (c) { return this.data.selectedCanteens.indexOf(c.id) >= 0 }.bind(this))
      .map(function (c) { return c.name })

    const profile = {
      name: f.name.trim(),
      studentNo: f.studentNo.trim(),
      phone: f.phone,
      room: f.room.trim(),
      buildingId: 'B' + (this.data.buildingIndex + 1),
      buildingName: buildingName,
      canteenIds: this.data.selectedCanteens,
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
          content: '下课前 10 分钟提醒你有顺路包，一天最多 3 次。',
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
