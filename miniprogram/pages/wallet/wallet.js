const riderApi = require('../../utils/riderApi')
const fmt = require('../../utils/format')

Page({
  data: {
    loading: true,
    error: '',
    pending: '0.00',
    settled: '0.00',
    available: '0.00',
    logs: [],
    canWithdraw: false,
  },

  onShow() {
    this.load()
  },

  onPullDownRefresh() {
    this.load()
    wx.stopPullDownRefresh()
  },

  load() {
    const that = this
    this.setData({ loading: true, error: '' })
    riderApi
      .wallet()
      .then(function (w) {
        const b = w.balance || {}
        that.setData({
          loading: false,
          pending: fmt.moneyFixed(b.pending),
          settled: fmt.moneyFixed(b.settled),
          available: fmt.moneyFixed(b.available),
          canWithdraw: (b.available || 0) >= 10,
          logs: (w.logs || []).map(function (l) {
            return Object.assign({}, l, {
              amountText: (l.amount >= 0 ? '+' : '') + fmt.moneyFixed(l.amount),
              timeText: fmt.dateTime(l.createdAt),
              statusText: l.status === 'settled' ? '可提现'
                : (l.status === 'pending' ? '处理中' : '已到账'),
              isWithdraw: l.type === 'withdraw',
            })
          }),
        })
      })
      .catch(function (e) {
        that.setData({ loading: false, error: e.message || '加载失败' })
      })
  },

  withdraw() {
    const that = this
    const available = Number(this.data.available)

    if (available < 10) {
      wx.showToast({ title: '满 10 元可提现', icon: 'none' })
      return
    }

    wx.showModal({
      title: '提现',
      content: '可提现 ¥' + fmt.moneyFixed(available) + '，全部提到微信零钱？',
      confirmText: '提现',
      success: function (res) {
        if (!res.confirm) return
        riderApi
          .withdraw(available)
          .then(function () {
            wx.showToast({ title: '已提交', icon: 'success' })
            that.load()
          })
          .catch(function (err) {
            wx.showToast({ title: err.message || '提现失败', icon: 'none' })
          })
      },
    })
  },
})
