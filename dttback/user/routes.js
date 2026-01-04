const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('./model');
const { AppError } = require('../middleware/error.middleware');
const { generateToken } = require('../middleware/auth.middleware');

// 加密盐值轮数（越高越安全，性能越低，默认10即可）
const SALT_ROUNDS = 10;

// 1. 注册接口
router.post('/api/user/register', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // 基础参数校验
    if (!username || !password) {
      throw new AppError('用户名和密码不能为空');
    }
    if (username.length < 3) {
      throw new AppError('用户名至少3位');
    }
    if (password.length < 6) {
      throw new AppError('密码至少6位');
    }

    // 检查用户名是否已存在
    const existingUser = await User.findOne({ username });
    if (existingUser) {
      throw new AppError('用户名已存在');
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // 创建新用户
    const newUser = new User({
      username,
      password: hashedPassword // 存储加密后的密码
    });
    await newUser.save();

    // 返回注册成功
    res.json({
      code: 200,
      msg: '注册成功',
      data: { username: newUser.username }
    });

  } catch (err) {
    // 交给统一错误处理中间件
    next(err);
  }
});

// 2. 登录接口
router.post('/api/user/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // 基础参数校验
    if (!username || !password) {
      throw new AppError('用户名和密码不能为空');
    }

    // 查找用户
    const user = await User.findOne({ username });
    if (!user) {
      throw new AppError('用户名不存在');
    }

    // 校验密码（加密对比）
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('密码错误');
    }

    // 生成JWT token
    const token = generateToken(user.username);

    // 登录成功返回（token需前端存储）
    res.json({
      code: 200,
      msg: '登录成功',
      data: { 
        username: user.username,
        token: token // 返回token
      }
    });

  } catch (err) {
    next(err);
  }
});

// 3. 测试接口：获取当前登录用户信息（需鉴权）
router.get('/api/user/info', require('../middleware/auth.middleware').authMiddleware, (req, res) => {
  // req.user由鉴权中间件挂载
  res.json({
    code: 200,
    msg: '获取用户信息成功',
    data: { username: req.user.username }
  });
});

module.exports = router;