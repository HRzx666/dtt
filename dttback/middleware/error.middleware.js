// 统一错误处理中间件
const errorHandler = (err, req, res, next) => {
  // 区分不同错误类型
  const statusCode = err.statusCode || 500;
  const message = err.message || '服务器内部错误';

  // 输出错误日志（生产环境可接入日志系统）
  console.error(`[${new Date().toISOString()}] 错误：`, err.stack);

  // 统一返回格式
  res.status(statusCode).json({
    code: statusCode,
    msg: message,
    data: null,
    // 开发环境返回堆栈信息，生产环境隐藏
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

// 自定义错误类（方便业务中抛出指定状态码的错误）
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    // 保留原始错误堆栈
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { errorHandler, AppError };