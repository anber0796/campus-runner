/** 业务异常：带 code，由 handlers/admin.js 的 route() 捕获后转成 { code, msg } */
function AppError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

module.exports = { AppError: AppError }
