// routes/songRoutes.js
const express = require('express');
const router = express.Router();
const Comment = require('../models/Comment');
const authMiddleware = require('../middleware/auth.middleware'); // 登录中间件
const taoZheSongs = require('../data/songs'); // 引入静态歌曲数据

// 🔹 接口1：获取单首歌曲的详情（从静态数组查）
router.get('/:songId', (req, res) => {
  const { songId } = req.params;
  const song = taoZheSongs.find(item => item.id === songId);
  
  if (!song) {
    return res.status(404).json({ code: 404, msg: '歌曲不存在' });
  }
  
  res.json({
    code: 200,
    msg: '获取歌曲详情成功',
    data: song
  });
});

// 🔹 接口2：获取某首歌曲的评论列表（支持分页）
router.get('/:songId/comments', async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { page = 1, pageSize = 20 } = req.query;

    // 先校验歌曲是否存在（从静态数组查）
    const songExist = taoZheSongs.find(item => item.id === songId);
    if (!songExist) {
      return res.status(404).json({ code: 404, msg: '歌曲不存在' });
    }

    // 分页查询评论
    const total = await Comment.countDocuments({ song_id: songId });
    const comments = await Comment.find({ song_id: songId })
      .sort({ create_time: -1 })
      .skip((page - 1) * pageSize)
      .limit(Number(pageSize))
      .select('username content create_time');

    res.json({
      code: 200,
      msg: '获取评论成功',
      data: {
        comments,
        pagination: {
          total,
          page: Number(page),
          pageSize: Number(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (err) {
    next(err);
  }
});

// 🔹 接口3：发布歌曲评论（需要登录）
router.post('/:songId/comments', authMiddleware, async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { content } = req.body;
    const { username } = req.user; // 从登录中间件获取用户名

    // 1. 校验歌曲是否存在
    const songExist = taoZheSongs.find(item => item.id === songId);
    if (!songExist) {
      return res.status(404).json({ code: 404, msg: '歌曲不存在' });
    }

    // 2. 校验评论内容
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ code: 400, msg: '评论内容不能为空' });
    }
    if (content.length > 500) {
      return res.status(400).json({ code: 400, msg: '评论内容不能超过500字' });
    }

    // 3. 保存评论
    const comment = await new Comment({
      song_id: songId,
      username,
      content: content.trim()
    }).save();

    res.json({
      code: 200,
      msg: '评论发布成功',
      data: { commentId: comment._id }
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;