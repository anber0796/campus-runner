const api = require('../../utils/api')
const fmt = require('../../utils/format')
const subscribe = require('../../utils/subscribe')

Page({
  data: {
    loading: true,
    pack: null,
    photo: '',
    submitting: false,
    allPicked: false,
  },

  onLoad(query) {
    this.packId = query.id
  },

  onShow() {
    this.load()
  },

  load() {
    const that = this
    api.getPack(this.packId)
      .then(function (pack) { that.render(pack) })
      .catch(function (e) {
        that.setData({ loading: false })
        wx.showToast({ title: e.message || '加载失败', icon: 'none' })
      })
  },

  render(pack) {
    const orders = (pack.income.detail || []).map(function (o) {
      return Object.assign({}, o, { tail: fmt.tail(o.tail) })
    })
    this.setData({
      loading: false,
      pack: Object.assign({}, pack, { orders: orders }),
      allPicked: orders.length > 0 && orders.every(function (o) { return o.picked }),
    })
  },

  // 到店逐档口核销：这是证明"真到了食堂"最可靠的信号，不依赖 GPS
  pickup(e) {
    const that = this
    const orderId = e.currentTarget.dataset.id
    api.pickupOrder(this.packId, orderId)
      .then(function (pack) { that.render(pack) })
      .catch(function (e) {
        wx.showToast({ title: e.message || '核销失败', icon: 'none' })
      })
  },

  choosePhoto() {
    const that = this
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['compressed'],
      success: function (res) {
        that.setData({ photo: res.tempFiles[0].tempFilePath })
        wx.showToast({ title: '已拍照留证', icon: 'none' })
      },
    })
  },

  // 送达后问一句"要不要下课提醒我"。放在弹窗里确认，而不是静默调用
  // —— 微信要求 requestSubscribeMessage 由用户点击触发，弹窗确认算一次有效点击
  askSubscribe() {
    const that = this
    if (!subscribe.templateIds().length || !subscribe.canAskAgain(6)) {
      setTimeout(function () { wx.switchTab({ url: '/pages/order/order' }) }, 700)
      return
    }

    wx.showModal({
      title: '要开下课提醒吗',
      content: '下课前 10 分钟提醒你有顺路包，一天最多 3 次，不会刷屏。',
      confirmText: '开启',
      cancelText: '再说',
      success: function (res) {
        const done = function () {
          setTimeout(function () { wx.switchTab({ url: '/pages/order/order' }) }, 500)
        }
        if (!res.confirm) return done()
        subscribe.request().then(done).catch(done)
      },
    })
  },

  submit() {
    if (this.data.submitting) return
    if (!this.data.allPicked) {
      wx.showToast({ title: '还有餐没取', icon: 'none' })
      return
    }
    if (!this.data.photo) {
      wx.showToast({ title: '请拍一张送达照片', icon: 'none' })
      return
    }
    const that = this
    this.setData({ submitting: true })
    api.deliverPack(this.packId, this.data.photo)
      .then(function () {
        wx.showToast({ title: '送达完成', icon: 'success' })
        // 这一刻用户刚拿到钱，是请求订阅授权通过率最高的时机
        that.askSubscribe()
      })
      .catch(function (e) {
        that.setData({ submitting: false })
        wx.showToast({ title: e.message || '提交失败', icon: 'none' })
      })
  },
})
