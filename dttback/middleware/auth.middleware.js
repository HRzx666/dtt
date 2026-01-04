const jwt = require('jsonwebtoken');
const { AppError } = require('./error.middleware');

// JWT秘钥（生产环境建议放在环境变量中，如process.env.JWT_SECRET）
const JWT_SECRET = 'your_secure_jwt_secret_key_2025'; // 请替换为随机复杂字符串

// 鉴权中间件：验证token是否有效
const authMiddleware = (req, res, next) => {
  try {
    // 从请求头获取token（格式：Bearer <token>）
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('请先登录', 401);
    }

    const token = authHeader.split(' ')[1];
    // 验证token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // 将用户信息挂载到req对象，供后续接口使用
    req.user = { username: decoded.username };
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') {
      next(new AppError('token无效', 401));
    } else if (err.name === 'TokenExpiredError') {
      next(new AppError('token已过期', 401));
    } else {
      next(err);
    }
  }
};

// 生成JWT token的工具函数
const generateToken = (username) => {
  return jwt.sign(
    { username }, // 载荷：仅存储必要信息，避免敏感数据
    JWT_SECRET,
    { expiresIn: '24h' } // token有效期24小时
  );
};

module.exports = { authMiddleware, generateToken };