const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('./model');
const { AppError } = require('../middleware/error.middleware');
const { generateToken } = require('../middleware/auth.middleware');

const SALT_ROUNDS = 10;

// 1. 注册接口（原有逻辑不变）
router.post('/api/user/register', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError('用户名和密码不能为空');
    }
    if (username.length < 3) {
      throw new AppError('用户名至少3位');
    }
    if (password.length < 6) {
      throw new AppError('密码至少6位');
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      throw new AppError('用户名已存在');
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    const newUser = new User({
      username,
      password: hashedPassword
    });
    await newUser.save();

    res.json({
      code: 200,
      msg: '注册成功',
      data: { username: newUser.username }
    });

  } catch (err) {
    next(err);
  }
});

// 2. 登录接口（原有逻辑不变）
router.post('/api/user/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      throw new AppError('用户名和密码不能为空');
    }

    const user = await User.findOne({ username });
    if (!user) {
      throw new AppError('用户名不存在');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('密码错误');
    }

    const token = generateToken(user.username);

    res.json({
      code: 200,
      msg: '登录成功',
      data: { 
        username: user.username,
        token: token 
      }
    });

  } catch (err) {
    next(err);
  }
});

// 3. 获取用户信息接口（修改：返回昵称、头像）
router.get('/api/user/info', require('../middleware/auth.middleware').authMiddleware, async (req, res, next) => {
  try {
    // 根据鉴权中间件的req.user.username查询完整用户信息
    const user = await User.findOne(
      { username: req.user.username },
      'username nickname avatar createdAt' // 只返回需要的字段，排除password
    );

    if (!user) {
      throw new AppError('用户不存在');
    }

    res.json({
      code: 200,
      msg: '获取用户信息成功',
      data: { 
        username: user.username,
        nickname: user.nickname || '未设置', // 无昵称显示"未设置"
        avatar: user.avatar || '',
        createdAt: user.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

// ========== 新增：用户信息更新接口（昵称/头像） ==========
router.post('/api/user/update', require('../middleware/auth.middleware').authMiddleware, async (req, res, next) => {
  try {
    const { nickname, avatar } = req.body;
    const username = req.user.username; // 从鉴权中间件获取当前登录用户

    // 校验昵称（如果传了昵称）
    if (nickname) {
      if (nickname.length < 2 || nickname.length > 10) {
        throw new AppError('昵称长度需在2-10个字符之间');
      }
    }

    // 构建更新对象（只更新传了的字段）
    const updateData = {};
    if (nickname !== undefined) updateData.nickname = nickname;
    if (avatar !== undefined) updateData.avatar = avatar;

    // 空更新校验
    if (Object.keys(updateData).length === 0) {
      throw new AppError('请传入需要更新的字段（昵称/头像）');
    }

    // 更新用户信息（Mongoose的findOneAndUpdate）
    const updatedUser = await User.findOneAndUpdate(
      { username: username }, // 查询条件：当前登录用户
      { $set: updateData },   // 更新操作
      { new: true, runValidators: true } // 返回更新后的文档 + 执行字段校验
    ).select('username nickname avatar'); // 只返回需要的字段

    if (!updatedUser) {
      throw new AppError('用户不存在');
    }

    // 返回更新成功结果
    res.json({
      code: 200,
      msg: '信息更新成功',
      data: {
        nickname: updatedUser.nickname,
        avatar: updatedUser.avatar
      }
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;