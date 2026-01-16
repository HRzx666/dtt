const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// 引入模型（删除重复的schema定义，统一从models目录引入）
const Comment = require('../models/Comment');
const CommentLike = require('../models/CommentLike');
const User = require('../models/User'); // 补充引入User模型（发布评论时查询用户信息）

// 引入中间件和静态数据
const authMiddleware = require('../middleware/auth.middleware'); // 登录鉴权中间件
const taoZheSongs = require('../data/songs'); // 静态歌曲数据

// 新增：全局JSON序列化配置（核心修复parent_id undefined问题）
app.set('json replacer', (key, value) => {
  // 把undefined转为null，确保所有字段都能返回（包括parent_id）
  return value === undefined ? null : value;
});
// 确保JSON响应缩进（可选，不影响功能）
app.set('json spaces', 2);
// ===================== 歌曲核心接口 =====================
/**
 * 接口1：获取单首歌曲的详情（从静态数组查询）
 * 请求路径：GET /api/songs/:songId
 */
router.get('/:songId', (req, res) => {
  try {
    const { songId } = req.params;
    const song = taoZheSongs.find(item => item.id === songId);
    
    if (!song) {
      return res.status(404).json({ 
        code: 404, 
        msg: '歌曲不存在' 
      });
    }
    
    res.json({
      code: 200,
      msg: '获取歌曲详情成功',
      data: song
    });
  } catch (err) {
    res.status(500).json({
      code: 500,
      msg: '服务器内部错误',
      error: err.message
    });
  }
});

/**
 * 接口2：获取某首歌曲的评论列表（支持分页、回复嵌套、当前用户点赞状态）
 * 请求路径：GET /api/songs/:songId/comments
 */
router.get('/:songId/comments', async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { page = 1, pageSize = 20 } = req.query;
    const currentUser = req.user?.username; // 获取当前登录用户（未登录则为undefined）

    // 1. 校验歌曲是否存在
    const songExist = taoZheSongs.find(item => item.id === songId);
    if (!songExist) {
      return res.status(404).json({ 
        code: 404, 
        msg: '歌曲不存在' 
      });
    }

    // 2. 分页查询主评论（parent_id为null的评论）
    const total = await Comment.countDocuments({ 
      resourceType: 'song', 
      resourceId: songId, 
      parent_id: null 
    });
    
    const mainComments = await Comment.find({ 
      resourceType: 'song', 
      resourceId: songId, 
      parent_id: null 
    })
      .sort({ createdAt: -1 }) // 按创建时间倒序
      .skip((page - 1) * Number(pageSize)) // 分页跳过
      .limit(Number(pageSize)); // 分页限制

    // 3. 获取所有主评论ID，用于查询回复
    const commentIds = mainComments.map(comment => comment._id);

    // 4. 查询所有回复（关联主评论）
    const replies = await Comment.find({ 
      parent_id: { $in: commentIds } 
    }).sort({ createdAt: 1 }); // 回复按时间正序

    // 5. 查询当前用户的点赞状态（仅登录用户）
    let userLikes = [];
    if (currentUser) {
      // 查询用户对该歌曲所有评论的点赞记录
      userLikes = await CommentLike.find({ 
        commentId: { $in: [...commentIds, ...replies.map(r => r._id)] },
        username: currentUser
      });
      // 转换为评论ID字符串数组，方便后续判断
      userLikes = userLikes.map(like => like.commentId.toString());
    }

    // 6. 构建评论树（主评论 + 嵌套回复）
    const commentTree = mainComments.map(comment => {
      // 筛选当前主评论的所有回复
      const commentReplies = replies.filter(reply => 
        reply.parent_id.toString() === comment._id.toString()
      );
      
      return {
        ...comment._doc, // 展开评论基础信息
        likedByMe: userLikes.includes(comment._id.toString()), // 当前用户是否点赞
        replies: commentReplies.map(reply => ({
          ...reply._doc,
          likedByMe: userLikes.includes(reply._id.toString()) // 回复的点赞状态
        }))
      };
    });

    // 7. 返回结果
    res.json({
      code: 200,
      msg: '获取评论成功',
      data: {
        comments: commentTree,
        pagination: {
          total: Number(total),
          page: Number(page),
          pageSize: Number(pageSize),
          totalPages: Math.ceil(total / pageSize)
        }
      }
    });
  } catch (err) {
    next(err); // 传递给全局错误处理中间件
  }
});

/**
 * 接口3：发布歌曲评论/回复（需要登录）
 * 请求路径：POST /api/songs/:songId/comments
 */
router.post('/:songId/comments', authMiddleware, async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { content, parent_id, reply_to_user_id, reply_to_name } = req.body;
    const { username } = req.user; // 从鉴权中间件获取当前登录用户名

    // 1. 校验歌曲是否存在
    const songExist = taoZheSongs.find(item => item.id === songId);
    if (!songExist) {
      return res.status(404).json({ 
        code: 404, 
        msg: '歌曲不存在' 
      });
    }

    // 2. 校验评论内容
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        code: 400, 
        msg: '评论内容不能为空' 
      });
    }
    if (content.length > 500) {
      return res.status(400).json({ 
        code: 400, 
        msg: '评论内容不能超过500字' 
      });
    }

    // 3. 查询用户信息（获取昵称和头像）
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ 
        code: 404, 
        msg: '用户不存在' 
      });
    }

    // 4. 保存评论
    const comment = await new Comment({
      resourceType: 'song', // 资源类型：歌曲
      resourceId: songId,   // 歌曲ID
      username,             // 评论者用户名
      nick_name: user.nickname || username, // 昵称（无则用用户名）
      avatar: user.avatar || '',           // 头像（无则为空）
      content: content.trim(),             // 评论内容（去除首尾空格）
      parent_id: parent_id || null,        // 父评论ID（回复时传）
      reply_to_user_id: reply_to_user_id || '', // 回复的目标用户ID
      reply_to_name: reply_to_name || ''   // 回复的目标用户昵称
    }).save();

    // 5. 返回结果
    res.json({
      code: 200,
      msg: parent_id ? '回复发布成功' : '评论发布成功',
      data: { 
        commentId: comment._id,
        createdAt: comment.createdAt
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * 接口4：点赞/取消点赞评论（需要登录）
 * 请求路径：POST /api/songs/comments/:commentId/like
 */
router.post('/comments/:commentId/like', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { username } = req.user;

    // 1. 检查评论是否存在
    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ 
        code: 404, 
        msg: '评论不存在' 
      });
    }

    // 2. 检查用户是否已点赞
    const existingLike = await CommentLike.findOne({ 
      commentId: mongoose.Types.ObjectId(commentId),
      username 
    });

    if (existingLike) {
      // 取消点赞：删除点赞记录 + 点赞数-1
      await existingLike.deleteOne();
      await Comment.findByIdAndUpdate(commentId, { $inc: { likeCount: -1 } });
      
      res.json({
        code: 200,
        msg: '取消点赞成功',
        data: {
          likedByMe: false,
          likeCount: comment.likeCount - 1
        }
      });
    } else {
      // 点赞：新增点赞记录 + 点赞数+1
      await new CommentLike({ 
        commentId: mongoose.Types.ObjectId(commentId),
        username 
      }).save();
      await Comment.findByIdAndUpdate(commentId, { $inc: { likeCount: 1 } });
      
      res.json({
        code: 200,
        msg: '点赞成功',
        data: {
          likedByMe: true,
          likeCount: comment.likeCount + 1
        }
      });
    }
  } catch (err) {
    next(err);
  }
});

// 导出路由
module.exports = router;