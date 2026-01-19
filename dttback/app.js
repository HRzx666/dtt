// 1. 核心依赖导入（所有依赖前置）
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// 新增：调试用的时间格式化工具
const getNow = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

// 2. 导入抽离的静态数据
const taoZheAlbums = require('./data/albums');
const taoZheSongs = require('./data/songs');
const taoZheSingles = require('./data/singles');

// 调试：打印导入的数据数量
console.log(`[${getNow()}] 📥 导入静态数据 - 专辑数：${taoZheAlbums.length} | 歌曲数：${taoZheSongs.length} | 单曲数：${taoZheSingles.length}`);

// 3. 后端服务初始化
const app = express();

// 4. 全局中间件注册（必须在所有路由之前）
// 修复CORS：兼容127.0.0.1:5500和localhost:5500
app.use(cors({ 
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'], 
  credentials: true 
}));

// 配置JSON解析（支持大请求体）
app.use(express.json({ 
  limit: '10mb', // 允许最大10MB的JSON请求体
  extended: true 
}));

// 新增：全局请求日志中间件（修复req.body为空时的substring报错）
app.use((req, res, next) => {
  // 空值兜底：req.body为undefined时转为空对象，再JSON.stringify
  const bodyStr = JSON.stringify(req.body || {});
  // 避免字符串过长，截取前200字符（加长度判断，防止空字符串substring报错）
  const shortBodyStr = bodyStr.length > 200 ? bodyStr.substring(0, 200) : bodyStr;
  
  console.log(`\n[${getNow()}] 🚀 请求接收 - 方法：${req.method} | 路径：${req.originalUrl} | 参数：${JSON.stringify(req.params)} | 查询参数：${JSON.stringify(req.query)} | 请求体：${shortBodyStr}`);
  next();
});

// 5. 核心配置
const JWT_SECRET = 'tao_zhe_official_2025_secret_key'; // 生产环境建议改为环境变量
const MONGODB_URL = 'mongodb://localhost:27017/tao_zhe_official';
const PORT = 3000; // 服务端口

// 6. 数据模型定义（所有模型在使用前定义）
// 6.1 歌曲模型
const songSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  album_id: { type: String, required: true },
  track_number: { type: Number, required: true },
  name_cn: { type: String, required: true },
  name_en: { type: String },
  lyricist: { type: String, required: true },
  composer: { type: String, required: true },
  arranger: { type: String },
  duration: { type: String }
});

// 6.2 专辑模型
const albumSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name_cn: { type: String, required: true },
  name_en: { type: String, required: true },
  release_date: { type: String, required: true },
  cover_url: { type: String, required: true },
  album_detail: { type: String, required: true },
  creation_background: { type: String, required: true },
  awards: { type: Array, required: true },
  language: { type: String, default: '普通话' },
  record_label: { type: String, required: true }
});

// 6.3 单曲模型
const singleSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name_cn: { type: String, required: true },
  release_date: { type: String, required: true },
  description: { type: String }
});

// 6.4 用户模型（包含昵称、头像）
const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, minlength: 3 },
  password: { type: String, required: true, minlength: 6 },
  createdAt: { type: Date, default: Date.now },
  avatar: { type: String, default: '' }, // 头像（Base64/URL）
  nickname: { type: String, default: '', minlength: 2, maxlength: 10 } // 昵称
});

// 6.5 评分模型
const ratingSchema = new mongoose.Schema({
  song_id: { type: String, required: function() { return this.resource_type === 'song'; } },
  resource_type: { type: String, required: true, enum: ['song', 'single'], default: 'song' },
  resource_id: { type: String, required: true },
  username: { type: String, required: true },
  score: { type: Number, required: true, min: 0.5, max: 5, enum: [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5] },
  createdAt: { type: Date, default: Date.now }
});
// 评分模型索引（防止重复评分）
ratingSchema.index({ song_id: 1, username: 1 }, { unique: true, partialFilterExpression: { resource_type: 'song' } });
ratingSchema.index({ resource_type: 1, resource_id: 1, username: 1 }, { unique: true });

// 6.6 评论模型
const commentSchema = new mongoose.Schema({
  // 关联字段：兼容歌曲/单曲/专辑
  song_id: { type: String, required: function() { return this.resource_type === 'song'; } },
  resource_type: { type: String, required: true, enum: ['song', 'single', 'album'], default: 'song' },
  resource_id: { type: String, required: true },
  // 评论用户信息
  username: { type: String, required: true },
  nick_name: { type: String, required: true, trim: true },
  avatar: { type: String, default: '' },
  // 评论内容
  content: { type: String, required: true, minlength: 1, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
  likeCount: { type: Number, default: 0 },
  // 回复相关字段
  parent_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null
  },
  reply_to_user_id: {
    type: String,
    default: ''
  },
  reply_to_name: {
    type: String,
    default: ''
  }
});
// 评论模型索引优化
commentSchema.index({ resource_type: 1, resource_id: 1, createdAt: -1 });
commentSchema.index({ parent_id: 1, createdAt: -1 });

// 在评论模型定义后添加Notification模型定义
// 6.7 通知模型（支持被回复和被点赞提醒）
const notificationSchema = new mongoose.Schema({
  // 接收者信息
  receiver_username: { type: String, required: true },
  // 发送者信息
  sender_username: { type: String, required: true },
  sender_nickname: { type: String, required: true },
  sender_avatar: { type: String, default: '' },
  // 通知内容
  content: { type: String, required: true },
  // 关联的评论信息
  comment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: true },
  // 资源信息（用于跳转）
  resource_type: { type: String, required: true, enum: ['song', 'single', 'album'] },
  resource_id: { type: String, required: true },
  // 通知类型
  type: { type: String, required: true, enum: ['reply', 'like'] },
  // 状态管理
  is_read: { type: Boolean, default: false },
  // 时间戳
  createdAt: { type: Date, default: Date.now }
});
// 通知模型索引优化
notificationSchema.index({ receiver_username: 1, is_read: 1, createdAt: -1 });
notificationSchema.index({ comment_id: 1 });

// 7. 模型实例化（在原有模型后添加Notification）
const Song = mongoose.model('Song', songSchema);
const Album = mongoose.model('Album', albumSchema);
const Single = mongoose.model('Single', singleSchema);
const User = mongoose.model('User', userSchema);
const Rating = mongoose.model('Rating', ratingSchema);
const Comment = mongoose.model('Comment', commentSchema);
const Notification = mongoose.model('Notification', notificationSchema); // 新增

// 8. 导入外部模型（评论点赞，确保在使用前导入）
const CommentLike = require('./models/CommentLike');

// 9. 核心工具函数/中间件（所有工具函数在路由前定义）
// 9.1 自定义错误类
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

// 9.2 全局错误处理中间件（放在所有路由之后，最后注册）
const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  // 增强：打印完整错误栈
  console.error(`[${getNow()}] ❌ 接口错误 - 路径：${req.originalUrl} | 错误码：${err.statusCode} | 错误信息：${err.message} | 错误栈：`, err.stack);
  
  // 处理重复键错误（11000）
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const msg = field === 'username' ? '用户名已存在' : field === 'commentId' ? '已点赞该评论' : '不可重复评分';
    return res.status(400).json({ code: 400, msg, data: null });
  }
  
  // 处理验证错误
  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map(v => v.message).join(', ');
    return res.status(400).json({ code: 400, msg, data: null });
  }
  
  // JWT相关错误
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ code: 401, msg: '无效token', data: null });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ code: 401, msg: 'token过期', data: null });
  
  // 生产环境隐藏详细错误
  res.status(err.statusCode).json({
    code: err.statusCode,
    msg: process.env.NODE_ENV === 'development' ? err.message : '服务器错误',
    data: null
  });
};

// 9.3 生成JWT Token
const generateToken = (username) => jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });

// 9.4 登录鉴权中间件
const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new AppError('未登录，请先登录', 401);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { username: decoded.username };
    console.log(`[${getNow()}] 🔐 鉴权成功 - 用户名：${decoded.username}`);
    next();
  } catch (err) {
    next(err);
  }
};

// 10. 初始化静态数据函数（仅清空/插入专辑/歌曲/单曲）
async function initData() {
  try {
    console.log(`[${getNow()}] 🧹 开始清空静态数据（专辑/歌曲/单曲）...`);
    // 只删除静态数据，保留用户/评分/评论
    const [albumDel, songDel, singleDel] = await Promise.all([
      Album.deleteMany({}),
      Song.deleteMany({}),
      Single.deleteMany({})
    ]);
    console.log(`[${getNow()}] 🧹 清空静态数据完成 - 专辑：${albumDel.deletedCount} | 歌曲：${songDel.deletedCount} | 单曲：${singleDel.deletedCount}`);

    console.log(`[${getNow()}] 📤 开始插入静态数据...`);
    // 插入静态数据
    const [albumIns, songIns, singleIns] = await Promise.all([
      Album.insertMany(taoZheAlbums),
      Song.insertMany(taoZheSongs),
      Single.insertMany(taoZheSingles)
    ]);
    console.log(`[${getNow()}] ✅ 静态数据入库成功 - 专辑：${albumIns.length} | 歌曲：${songIns.length} | 单曲：${singleIns.length}`);

    // 验证插入结果
    const [albumCount, songCount, singleCount] = await Promise.all([
      Album.countDocuments({}),
      Song.countDocuments({}),
      Single.countDocuments({})
    ]);
    console.log(`[${getNow()}] 🧮 数据库验证 - 专辑总数：${albumCount} | 歌曲总数：${songCount} | 单曲总数：${singleCount}`);
  } catch (err) {
    console.error(`[${getNow()}] ❌ 静态数据入库失败：`, err.stack);
  }
}

// 11. 核心业务接口（按功能模块组织，顺序合理）
// 11.1 专辑相关接口
// 获取专辑列表
app.get('/api/albums', async (req, res, next) => {
  try {
    const albums = await Album.find({});
    console.log(`[${getNow()}] 📖 获取专辑列表 - 数量：${albums.length}`);
    res.json({ code: 200, data: albums, msg: '获取专辑成功' });
  } catch (err) { next(err); }
});

// 获取专辑详情
app.get('/api/albums/:albumId', async (req, res, next) => {
  try {
    const album = await Album.findOne({ id: req.params.albumId });
    console.log(`[${getNow()}] 📖 获取专辑详情 - ID：${req.params.albumId} | 结果：${album ? '存在' : '不存在'}`);
    if (!album) throw new AppError('专辑不存在', 404);
    res.json({ code: 200, data: album, msg: '获取专辑详情成功' });
  } catch (err) { next(err); }
});

// 获取专辑下的歌曲
app.get('/api/albums/:albumId/songs', async (req, res, next) => {
  try {
    const songs = await Song.find({ album_id: req.params.albumId }).sort({ track_number: 1 });
    console.log(`[${getNow()}] 📖 获取专辑歌曲 - 专辑ID：${req.params.albumId} | 歌曲数量：${songs.length}`);
    res.json({ code: 200, data: songs, msg: '获取专辑歌曲成功' });
  } catch (err) { next(err); }
});

// 专辑歌曲按评分排序
app.get('/api/albums/:albumId/songs/sort-by-rating', async (req, res, next) => {
  try {
    const { albumId } = req.params;
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    const album = await Album.findOne({ id: albumId });
    if (!album) throw new AppError('专辑不存在', 404);

    const albumSongs = await Song.find({ album_id: albumId }).sort({ track_number: 1 });
    console.log(`[${getNow()}] 📖 专辑歌曲（评分排序）- 专辑ID：${albumId} | 原始歌曲数：${albumSongs.length}`);
    
    const songIds = albumSongs.map(song => song.id);
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'song', resource_id: { $in: songIds } } },
      { $group: { _id: '$resource_id', averageScore: { $avg: '$score' }, ratingCount: { $sum: 1 } } },
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);
    console.log(`[${getNow()}] 📊 专辑歌曲评分统计 - 有评分的歌曲数：${ratingAgg.length}`);

    const sortedSongs = albumSongs.map(song => {
      const rating = ratingAgg.find(item => item._id === song.id);
      return {
        ...song._doc,
        averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
ratingCount: rating ? rating.ratingCount : 0
      };
    }).sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      if (b.ratingCount !== a.ratingCount) return b.ratingCount - a.ratingCount;
      return a.track_number - b.track_number;
    });

    const paginatedSongs = sortedSongs.slice(skip, skip + Number(pageSize));
    const total = sortedSongs.length;
    console.log(`[${getNow()}] 📖 专辑歌曲（评分排序）- 分页后数量：${paginatedSongs.length} | 总数量：${total} | 页码：${page} | 页大小：${pageSize}`);

    res.json({
      code: 200,
      data: {
        songs: paginatedSongs,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) }
      },
      msg: '获取专辑歌曲（按评分排序）成功'
    });
  } catch (err) { next(err); }
});

// 11.2 歌曲相关接口
// 全量歌曲按评分排序
app.get('/api/songs/sort-by-rating', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📖 全量歌曲（评分排序）- 开始聚合查询`);
    const allSongs = await Song.aggregate([
      {
        $lookup: {
          from: 'albums',
          localField: 'album_id',
          foreignField: 'id',
          as: 'albumInfo'
        }
      },
      // 修正后的$unwind语法（标准对象写法）
      { $unwind: { path: '$albumInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: 1,
          name_cn: 1,
          album_id: 1,
          album_name: { $ifNull: ['$albumInfo.name_cn', '未知专辑'] },
          release_date: { $ifNull: ['$albumInfo.release_date', '未知时间'] },
          duration: 1
        }
      }
    ]);
    console.log(`[${getNow()}] 📖 全量歌曲（评分排序）- 聚合查询结果数：${allSongs.length}`);

    // 补全：空数据处理
    if (allSongs.length === 0) {
      return res.json({
        code: 200,
        data: {
          songs: [],
          pagination: { page: Number(page), pageSize: Number(pageSize), total: 0, totalPages: 0 }
        },
        msg: '获取全量歌曲（按评分排序）成功'
      });
    }

    // 补全：评分统计
    const songIds = allSongs.map(song => song.id);
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'song', resource_id: { $in: songIds } } },
      { $group: { _id: '$resource_id', averageScore: { $avg: '$score' }, ratingCount: { $sum: 1 } } },
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);
    console.log(`[${getNow()}] 📊 全量歌曲评分统计 - 有评分的歌曲数：${ratingAgg.length}`);

    // 补全：数据整合+排序
    const sortedSongs = allSongs.map(song => {
      const rating = ratingAgg.find(item => item._id === song.id);
      const avgScore = rating?.averageScore || 0;
      const ratingCount = rating?.ratingCount || 0;
      return {
        ...song,
        averageScore: parseFloat(avgScore.toFixed(1)),
        ratingCount: ratingCount
      };
    }).sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      return b.ratingCount - a.ratingCount;
    });

    // 补全：分页处理
    const paginatedSongs = sortedSongs.slice(skip, skip + Number(pageSize));
    const total = sortedSongs.length;
    console.log(`[${getNow()}] 📖 全量歌曲（评分排序）- 分页后数量：${paginatedSongs.length} | 总数量：${total} | 页码：${page} | 页大小：${pageSize}`);

    // 补全：响应返回（核心！）
    res.json({
      code: 200,
      data: {
        songs: paginatedSongs,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) }
      },
      msg: '获取全量歌曲（按评分排序）成功'
    });

  } catch (err) {
    console.error(`[${getNow()}] ❌ 全量歌曲评分排序接口错误：`, err.stack);
    next(err);
  }
});

// 歌曲搜索接口
// 歌曲搜索接口 - 高级重构版 ✅ 解决单字/全关键字搜索精准度问题 + 性能优化 + 体验优化
app.get('/api/songs/search', async (req, res, next) => {
  try {
    const { keyword, page = 1, pageSize = 20, targetSongId } = req.query;
    const currentPage = Number(page);
    const size = Number(pageSize);
    const skip = (currentPage - 1) * size;
    const searchKeyword = keyword?.trim() || '';

    console.log(`[${getNow()}] 🔍 搜索歌曲 - 关键词：${searchKeyword} | 页码：${currentPage} | 页大小：${size} | 目标歌曲ID：${targetSongId}`);

    // 1. 校验搜索关键词 - 保留原逻辑
    if (!searchKeyword) {
      throw new AppError('搜索关键词不能为空', 400);
    }
    const isSingleChar = searchKeyword.length === 1; // 标记：是否为单字搜索
    const keywordReg = new RegExp(searchKeyword, 'i'); // 统一不区分大小写正则

    // ===================== 核心优化1：构建【严格分层的匹配条件+阶梯式高权重评分】 =====================
    // 匹配优先级：从高到低（评分差距极大，确保高匹配结果绝对置顶）
    const matchCondition = {
      $or: [
        // ★ 一级匹配：歌名中英文 完全精准匹配 (不分大小写) - 最高优先级
        { $or: [{ name_cn: { $regex: `^${searchKeyword}$`, $options: 'i' } }, { name_en: { $regex: `^${searchKeyword}$`, $options: 'i' } }] },
        // ★ 二级匹配：歌名中英文 前缀匹配 (关键词开头) - 次高优先级（完整输入关键字必命中这里）
        { $or: [{ name_cn: { $regex: `^${searchKeyword}`, $options: 'i' } }, { name_en: { $regex: `^${searchKeyword}`, $options: 'i' } }] },
        // ★ 三级匹配：歌名中英文 完整包含关键词 - 常规匹配（含完整关键字，非开头）
        { $or: [{ name_cn: keywordReg }, { name_en: keywordReg }] },
        // ★ 四级匹配：仅单字搜索时生效 - 精准匹配单个字符，杜绝多字搜索时的泛化无关结果
        ...(isSingleChar ? [{ $or: [{ name_cn: { $regex: searchKeyword, $options: 'i' } }, { name_en: { $regex: searchKeyword, $options: 'i' } }] }] : [])
      ]
    };

    // ===================== 核心优化2：数据库聚合查询【整合关联+评分+分页】，性能拉满 =====================
    // 一次聚合完成：匹配+关联专辑+计算评分+投影，数据库层面分页，避免内存全量加载
    const dbSongResults = await Song.aggregate([
      { $match: matchCondition },
      {
        $lookup: {
          from: 'albums',
          localField: 'album_id',
          foreignField: 'id',
          as: 'albumInfo'
        }
      },
      { $unwind: { path: '$albumInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: 1,
          name_cn: 1,
          name_en: 1,
          album_id: 1,
          album_name: { $ifNull: ['$albumInfo.name_cn', '未知专辑'] },
          album_cover: { $ifNull: ['$albumInfo.cover_url', ''] },
          release_date: { $ifNull: ['$albumInfo.release_date', '未知时间'] },
          lyricist: 1,
          composer: 1,
          arranger: 1,
          duration: 1,
          // ★ 核心重构：阶梯式高区分度评分规则（分值差距极大，排序绝对合理）
          matchScore: {
            $cond: [
              // 1级：完全精准匹配 → 2000分 (天花板，绝对置顶)
              { $or: [{ $regexMatch: { input: '$name_cn', regex: `^${searchKeyword}$`, options: 'i' } }, { $regexMatch: { input: '$name_en', regex: `^${searchKeyword}$`, options: 'i' } }] },
              2000,
              {
                $cond: [
                  // 2级：前缀匹配 → 1500分 (完整输入关键字必在这里，精准度拉满)
                  { $or: [{ $regexMatch: { input: '$name_cn', regex: `^${searchKeyword}`, options: 'i' } }, { $regexMatch: { input: '$name_en', regex: `^${searchKeyword}`, options: 'i' } }] },
                  1500,
                  {
                    $cond: [
                      // 3级：完整包含关键词 → 1000分 (含完整关键字，非开头)
                      { $or: [{ $regexMatch: { input: '$name_cn', regex: searchKeyword, options: 'i' } }, { $regexMatch: { input: '$name_en', regex: searchKeyword, options: 'i' } }] },
                      1000,
                      // 4级：仅单字搜索生效 → 500分 (保底精准，无无关结果)
                      500
                    ]
                  }
                ]
              }
            ]
          }
        }
      },
      { $sort: { matchScore: -1, name_cn: 1 } }, // 先按评分降序，再按中文名升序
      { $skip: skip }, // 数据库层面分页
      { $limit: size } // 数据库层面分页
    ]);

    // ===================== 优化3：静态单曲(taoZheSingles)处理 - 统一评分规则+无冗余 =====================
    // 抽离公共方法：计算单曲匹配度（和数据库歌曲评分规则完全一致，保证排序统一）
    const calcMatchScore = (songNameCn, songNameEn) => {
      const fullName = (songNameCn || '') + (songNameEn || '');
      if (/^${searchKeyword}$/i.test(songNameCn) || /^${searchKeyword}$/i.test(songNameEn)) return 2000;
      if (/^${searchKeyword}/i.test(songNameCn) || /^${searchKeyword}/i.test(songNameEn)) return 1500;
      if (keywordReg.test(songNameCn) || keywordReg.test(songNameEn)) return 1000;
      if (isSingleChar && (songNameCn?.includes(searchKeyword) || songNameEn?.includes(searchKeyword))) return 500;
      return 0;
    };

    // 过滤静态单曲：只保留有匹配度的结果，排除0分无关项
    const staticSingleResults = taoZheSingles
      .filter(single => calcMatchScore(single.name_cn, single.name_en) > 0)
      .map(single => ({
        id: single.id,
        name_cn: single.name_cn,
        name_en: single.name_en || '',
        album_id: null,
        album_name: '单曲',
        album_cover: '',
        release_date: single.release_date,
        lyricist: '',
        composer: '陶喆',
        arranger: '',
        duration: '',
        description: single.description,
        matchScore: calcMatchScore(single.name_cn, single.name_en)
      }));

    // ===================== 优化4：合并结果+严格去重+二次排序 =====================
    // 合并数据库结果+静态单曲，按ID去重（防止同ID歌曲重复出现）
    const allResultsMap = new Map();
    [...dbSongResults, ...staticSingleResults].forEach(song => {
      if (!allResultsMap.has(song.id)) {
        allResultsMap.set(song.id, song);
      }
    });
    const allResults = Array.from(allResultsMap.values()).sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore; // 核心：评分优先
      return a.name_cn.localeCompare(b.name_cn, 'zh-CN'); // 同分按中文名排序
    });

    // ===================== 原逻辑保留+优化：总数量/目标歌曲位置 =====================
    const total = allResults.length;
    let targetSongPosition = null;
    if (targetSongId) {
      const index = allResults.findIndex(item => item.id === targetSongId);
      if (index !== -1) {
        targetSongPosition = {
          index: index + 1,
          page: Math.ceil((index + 1) / size)
        };
      }
    }

    // ===================== 原逻辑保留：整合评分信息 =====================
    let resultsWithRatings = allResults;
    if (resultsWithRatings.length > 0) {
      const songIds = resultsWithRatings.map(item => item.id);
      const ratingAgg = await Rating.aggregate([
        { $match: { resource_type: 'song', resource_id: { $in: songIds } } },
        { $group: { _id: '$resource_id', averageScore: { $avg: '$score' }, ratingCount: { $sum: 1 } } }
      ]);

      resultsWithRatings = resultsWithRatings.map(item => {
        const rating = ratingAgg.find(r => r._id === item.id);
        return {
          ...item,
          averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
          ratingCount: rating ? rating.ratingCount : 0
        };
      });
    }

    // ===================== 返回响应 =====================
    console.log(`[${getNow()}] ✅ 搜索歌曲成功 - 关键词：${searchKeyword} | 页结果数：${resultsWithRatings.length} | 总结果数：${total} | 最高匹配度：${allResults[0]?.matchScore || 0}`);
    res.json({
      code: 200,
      data: {
        songs: resultsWithRatings,
        pagination: {
          page: currentPage,
          pageSize: size,
          total,
          totalPages: Math.ceil(total / size)
        },
        ...(targetSongPosition && { targetSongPosition })
      },
      msg: '搜索歌曲成功'
    });
  } catch (err) {
    console.error(`[${getNow()}] ❌ 搜索歌曲失败：`, err.message);
    next(err);
  }
});

// 获取单首歌曲详情（兜底路由，放在通用接口后）
app.get('/api/songs/:songId', async (req, res, next) => {
  try {
    const song = await Song.findOne({ id: req.params.songId });
    console.log(`[${getNow()}] 📖 获取歌曲详情 - ID：${req.params.songId} | 结果：${song ? '存在' : '不存在'}`);
    if (!song) throw new AppError('歌曲不存在', 404);
    res.json({ code: 200, data: song, msg: '获取歌曲详情成功' });
  } catch (err) { next(err); }
});

// 11.3 单曲相关接口
// 获取单曲列表
app.get('/api/singles', async (req, res, next) => {
  try {
    const singles = await Single.find({}).sort({ release_date: 1 });
    console.log(`[${getNow()}] 📖 获取单曲列表 - 数量：${singles.length}`);
    res.json({ code: 200, data: singles, msg: '获取单曲成功' });
  } catch (err) { next(err); }
});

// 获取单曲详情
app.get('/api/singles/:singleId', async (req, res, next) => {
  try {
    const single = await Single.findOne({ id: req.params.singleId });
    console.log(`[${getNow()}] 📖 获取单曲详情 - ID：${req.params.singleId} | 结果：${single ? '存在' : '不存在'}`);
    if (!single) throw new AppError('单曲不存在', 404);
    res.json({ code: 200, data: single, msg: '获取单曲详情成功' });
  } catch (err) { next(err); }
});

// 提交单曲评分
app.post('/api/singles/:singleId/rating', authMiddleware, async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { score } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] ⭐ 提交单曲评分 - 单曲ID：${singleId} | 用户名：${username} | 评分：${score}`);

    // 1. 检查单曲是否存在
    const singleExist = await Single.findOne({ id: singleId });
    if (!singleExist) throw new AppError('单曲不存在', 404);

    // 2. 校验评分格式
    const scoreNum = Number(score);
    if (![0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].includes(scoreNum)) {
      throw new AppError('评分必须是0.5-5的半星递增');
    }

    // 3. 原子操作：存在则更新，不存在则新增（完全不包含song_id字段）
    const result = await Rating.findOneAndUpdate(
      {
        resource_type: 'single',
        resource_id: singleId,
        username
      },
      { 
        $set: { score: scoreNum },
        $unset: { song_id: "" } // 确保剔除song_id字段（关键）
      },
      { 
        upsert: true, // 无记录则新增
        new: true,    // 返回更新/新增后的文档
        runValidators: true,
        // 新增：确保新增时不生成song_id字段
        setDefaultsOnInsert: false 
      }
    );

    const isNew = result._id.getTimestamp() - result.updatedAt < 1000;
    console.log(`[${getNow()}] ✅ 单曲评分${isNew ? '提交' : '更新'}成功 - 单曲ID：${singleId} | 用户名：${username}`);

    // 4. 返回结果
    res.json({ 
      code: 200, 
      msg: isNew ? '评分提交成功' : '评分修改成功', 
      data: { singleId, username, score: scoreNum } 
    });
  } catch (err) { 
    // 兜底处理
    if (err.code === 11000) {
      return res.status(400).json({ code: 400, msg: '请勿重复评分，如需修改请直接选新分数', data: null });
    }
    next(err); 
  }
});

// 获取单曲平均分
app.get('/api/singles/:singleId/rating/average', async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const result = await Rating.aggregate([
      { $match: { resource_type: 'single', resource_id: singleId } },
      { $group: { _id: '$resource_id', averageScore: { $avg: '$score' }, count: { $sum: 1 } } }
    ]);
    const data = result.length > 0 
      ? { averageScore: result[0].averageScore.toFixed(1), ratingCount: result[0].count }
      : { averageScore: 0, ratingCount: 0 };
    console.log(`[${getNow()}] 📊 单曲平均分 - ID：${singleId} | 平均分：${data.averageScore} | 评分人数：${data.ratingCount}`);
    res.json({ code: 200, data, msg: '获取单曲平均分成功' });
  } catch (err) { next(err); }
});

// 获取用户单曲评分
app.get('/api/user/singles/:singleId/rating', authMiddleware, async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { username } = req.user;
    const rating = await Rating.findOne({ resource_type: 'single', resource_id: singleId, username });
    const data = rating ? { score: rating.score } : { score: 0 };
    console.log(`[${getNow()}] 📖 用户单曲评分 - 用户名：${username} | 单曲ID：${singleId} | 评分：${data.score}`);
    res.json({ code: 200, data, msg: '获取用户单曲评分成功' });
  } catch (err) { next(err); }
});

// 全量单曲按评分排序
app.get('/api/singles/sort-by-rating', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    const allSingles = await Single.find({});
    console.log(`[${getNow()}] 📖 全量单曲（评分排序）- 原始单曲数：${allSingles.length}`);
    
    const singleIds = allSingles.map(single => single.id);
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_type: 'single', resource_id: { $in: singleIds } } },
      { $group: { _id: '$resource_id', averageScore: { $avg: '$score' }, ratingCount: { $sum: 1 } } },
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);
    console.log(`[${getNow()}] 📊 全量单曲评分统计 - 有评分的单曲数：${ratingAgg.length}`);

    const sortedSingles = allSingles.map(single => {
      const rating = ratingAgg.find(item => item._id === single.id);
      return {
        ...single._doc,
        averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
        ratingCount: rating ? rating.ratingCount : 0
      };
    }).sort((a, b) => {
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      return b.ratingCount - a.ratingCount;
    });

    const paginatedSingles = sortedSingles.slice(skip, skip + Number(pageSize));
    const total = sortedSingles.length;
    console.log(`[${getNow()}] 📖 全量单曲（评分排序）- 分页后数量：${paginatedSingles.length} | 总数量：${total} | 页码：${page} | 页大小：${pageSize}`);

    res.json({
      code: 200,
      data: {
        singles: paginatedSingles,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) }
      },
      msg: '获取全量单曲（按评分排序）成功'
    });
  } catch (err) { next(err); }
});

// 整合歌曲+单曲按评分排序
app.get('/api/all-resources/sort-by-rating', async (req, res, next) => {
  try {
    const { page = 1, pageSize = 10 } = req.query;
    const skip = (page - 1) * pageSize;

    // 1. 查询带专辑信息的歌曲
    const songList = await Song.aggregate([
      {
        $lookup: {
          from: 'albums',
          localField: 'album_id',
          foreignField: 'id',
          as: 'albumInfo'
        }
      },
      { $unwind: { path: '$albumInfo', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          id: 1,
          type: { $literal: 'song' }, // 标记类型：歌曲
          name_cn: 1,
          album_name: { $ifNull: ['$albumInfo.name_cn', '未知专辑'] },
          release_date: { $ifNull: ['$albumInfo.release_date', '未知时间'] },
          duration: 1
        }
      }
    ]);

    // 2. 查询单曲（专辑名标记为“单曲”）
    const singleList = await Single.aggregate([
      {
        $project: {
          _id: 0,
          id: 1,
          type: { $literal: 'single' }, // 标记类型：单曲
          name_cn: 1,
          album_name: { $literal: '单曲' }, // 单曲的专辑列显示“单曲”
          release_date: 1,
          duration: { $literal: '未知时长' }
        }
      }
    ]);

    // 3. 合并歌曲+单曲数据
    const allResources = [...songList, ...singleList];
    const allIds = allResources.map(item => item.id);
    
    // 4. 批量查询评分（区分歌曲/单曲类型）
    const ratingAgg = await Rating.aggregate([
      { $match: { resource_id: { $in: allIds } } },
      { $group: { 
        _id: { id: '$resource_id', type: '$resource_type' }, // 按ID+类型分组
        averageScore: { $avg: '$score' }, 
        ratingCount: { $sum: 1 } 
      } },
      { $sort: { averageScore: -1, ratingCount: -1 } }
    ]);

    // 5. 整合评分数据并排序
    const resultList = allResources.map(item => {
      const rating = ratingAgg.find(r => r._id.id === item.id && r._id.type === item.type);
      return {
        ...item,
        averageScore: rating ? parseFloat(rating.averageScore.toFixed(1)) : 0,
        ratingCount: rating ? rating.ratingCount : 0
      };
    }).sort((a, b) => {
      // 按评分降序，评分相同按评分人数降序
      if (b.averageScore !== a.averageScore) return b.averageScore - a.averageScore;
      return b.ratingCount - a.ratingCount;
    });

    // 6. 分页处理
    const total = resultList.length;
    const paginatedList = resultList.slice(skip, skip + Number(pageSize));

    // 7. 返回数据（格式与原有歌曲接口一致，兼容前端）
    res.json({
      code: 200,
      data: {
        resources: paginatedList,
        pagination: { page: Number(page), pageSize: Number(pageSize), total, totalPages: Math.ceil(total / pageSize) }
      },
      msg: '获取所有资源（歌曲+单曲）评分排序成功'
    });

  } catch (err) {
    console.error(`[${getNow()}] ❌ 整合资源接口错误：`, err.stack);
    next(err);
  }
});

// 11.4 用户相关接口
// 用户注册
app.post('/api/user/register', async (req, res, next) => {
  try {
    const { username, password, nickname = username } = req.body; // 不传nickname则用username兜底
    console.log(`[${getNow()}] 📝 用户注册 - 用户名：${username}`);
    
    if (!username || !password) throw new AppError('用户名/密码不能为空');
    if (username.length < 3) throw new AppError('用户名至少3位');
    if (password.length < 6) throw new AppError('密码至少6位');
    if (await User.findOne({ username })) throw new AppError('用户名已存在');
    
    // 校验昵称长度（如果传了自定义昵称）
    if (nickname.length < 2 || nickname.length > 10) {
      throw new AppError('昵称长度需在2-10个字符之间');
    }
    
    const hashedPwd = await bcrypt.hash(password, 10);
    // 创建用户时传入nickname（兜底为username，确保符合长度要求）
    await new User({ username, password: hashedPwd, nickname }).save();
    
    console.log(`[${getNow()}] ✅ 用户注册成功 - 用户名：${username}`);
    res.json({ code: 200, msg: '注册成功', data: { username } });
  } catch (err) { next(err); }
});

// 用户登录
app.post('/api/user/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    console.log(`[${getNow()}] 🔑 用户登录 - 用户名：${username}`);
    
    if (!username || !password) throw new AppError('用户名/密码不能为空');
    const user = await User.findOne({ username });
    if (!user) throw new AppError('用户名不存在');
    if (!await bcrypt.compare(password, user.password)) throw new AppError('密码错误');
    
    const token = generateToken(username);
    console.log(`[${getNow()}] ✅ 用户登录成功 - 用户名：${username}`);
    res.json({ code: 200, msg: '登录成功', data: { username, token } });
  } catch (err) { next(err); }
});

// 获取用户信息
app.get('/api/user/info', authMiddleware, async (req, res, next) => {
  try {
    const user = await User.findOne({ username: req.user.username });
    if (!user) throw new AppError('用户不存在', 404);
    
    res.json({ 
      code: 200, 
      msg: '获取用户信息成功', 
      data: { 
        username: user.username,
        createdAt: user.createdAt,
        avatar: user.avatar,
        nickname: user.nickname || '未设置' // 新增：返回昵称，无则显示“未设置”
      } 
    });
  } catch (err) {
    next(err);
  }
});

// 更新用户信息（昵称/头像）
app.post('/api/user/update', authMiddleware, async (req, res, next) => {
  try {
    const { nickname, avatar } = req.body;
    const { username } = req.user;

    // 校验参数（只更新传了的字段）
    const updateData = {};
    if (nickname !== undefined) {
      if (nickname.length < 2 || nickname.length > 10) {
        throw new AppError('昵称长度需在2-10个字符之间', 400);
      }
      updateData.nickname = nickname;
    }
    if (avatar !== undefined) {
      if (!avatar) throw new AppError('头像内容不能为空', 400);
      updateData.avatar = avatar;
    }

    // 空更新校验
    if (Object.keys(updateData).length === 0) {
      throw new AppError('请传入需要更新的字段（昵称/头像）', 400);
    }

    // 更新用户信息
    const user = await User.findOneAndUpdate(
      { username },
      { $set: updateData },
      { new: true, runValidators: true } // 返回更新后数据 + 执行字段校验
    );

    if (!user) throw new AppError('用户不存在', 404);

    res.json({
      code: 200,
      msg: '信息更新成功',
      data: {
        nickname: user.nickname,
        avatar: user.avatar
      }
    });
  } catch (err) {
    next(err);
  }
});

// 11.5 评分相关接口（歌曲）
// 提交歌曲评分
app.post('/api/songs/:songId/rating', authMiddleware, async (req, res, next) => {
  try {
    const { score } = req.body;
    const { songId } = req.params;
    const { username } = req.user;
    console.log(`[${getNow()}] ⭐ 提交歌曲评分 - 歌曲ID：${songId} | 用户名：${username} | 评分：${score}`);

    // 1. 检查歌曲是否存在
    const songExist = await Song.findOne({ id: songId });
    if (!songExist) throw new AppError('歌曲不存在', 404);

    // 2. 校验评分格式（你原来的逻辑保留，若只要整星可删0.5/1.5等）
    if (![0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].includes(Number(score))) {
      throw new AppError('评分必须是0.5-5的半星递增');
    }

    // 3. 核心修改：查询用户是否已给该歌曲评过分
    const existingRating = await Rating.findOne({
      song_id: songId,
      username,
      resource_type: 'song' // 匹配你原来的resource_type字段
    });

    let result;
    if (existingRating) {
      // 3.1 已评分 → 更新分数（覆盖原有评分）
      existingRating.score = Number(score);
      result = await existingRating.save();
      console.log(`[${getNow()}] ✅ 歌曲评分更新成功 - 歌曲ID：${songId} | 用户名：${username}`);
    } else {
      // 3.2 未评分 → 新增评分
      result = await new Rating({
        song_id: songId,
        resource_type: 'song',
        resource_id: songId,
        username,
        score: Number(score)
      }).save();
      console.log(`[${getNow()}] ✅ 歌曲评分提交成功 - 歌曲ID：${songId} | 用户名：${username}`);
    }

    // 4. 统一返回（新增/更新都返回成功，前端提示可统一为“评分修改成功”）
    res.json({ 
      code: 200, 
      msg: existingRating ? '评分修改成功' : '评分提交成功', 
      data: { songId, username, score } 
    });
  } catch (err) { 
    next(err); 
  }
});

// 获取歌曲平均分
app.get('/api/songs/:songId/rating/average', async (req, res, next) => {
  try {
    const { songId } = req.params;
    const result = await Rating.aggregate([
      { $match: { song_id: songId } },
      { $group: { _id: '$song_id', averageScore: { $avg: '$score' }, count: { $sum: 1 } } }
    ]);
    const data = result.length > 0 
      ? { averageScore: result[0].averageScore.toFixed(1), ratingCount: result[0].count }
      : { averageScore: 0, ratingCount: 0 };
    console.log(`[${getNow()}] 📊 歌曲平均分 - ID：${songId} | 平均分：${data.averageScore} | 评分人数：${data.ratingCount}`);
    res.json({ code: 200, data, msg: '获取平均分成功' });
  } catch (err) { next(err); }
});

// 获取用户歌曲评分
app.get('/api/user/songs/:songId/rating', authMiddleware, async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { username } = req.user;
    const rating = await Rating.findOne({ song_id: songId, username });
    const data = rating ? { score: rating.score } : { score: 0 };
    console.log(`[${getNow()}] 📖 用户歌曲评分 - 用户名：${username} | 歌曲ID：${songId} | 评分：${data.score}`);
    res.json({ code: 200, data, msg: '获取用户评分成功' });
  } catch (err) { next(err); }
});

// 11.6 个人主页接口
// 获取用户所有歌曲评分（关联专辑）
app.get('/api/user/ratings/songs', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;
    
    // 查询用户歌曲评分
    const userSongRatings = await Rating.find({
      resource_type: 'song',
      username: username
    }).sort({ createdAt: -1 });

    // 关联歌曲+专辑信息
    const songRatingList = await Promise.all(
      userSongRatings.map(async (rating) => {
        const song = await Song.findOne({ id: rating.resource_id });
        const album = song ? await Album.findOne({ id: song.album_id }) : null;
        
        return {
          rating: {
            score: rating.score,
            createdAt: rating.createdAt
          },
          song: song ? {
            name_cn: song.name_cn,
            id: song.id
          } : { name_cn: '未知歌曲' },
          album: album ? {
            name_cn: album.name_cn,
            id: album.id
          } : { name_cn: '未知专辑' }
        };
      })
    );

    res.json({
      code: 200,
      data: songRatingList,
      msg: '获取用户歌曲评分列表成功'
    });
  } catch (err) {
    next(err);
  }
});

// 获取用户所有单曲评分
app.get('/api/user/ratings/singles', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;
    
    // 查询用户单曲评分
    const userSingleRatings = await Rating.find({
      resource_type: 'single',
      username: username
    }).sort({ createdAt: -1 });

    // 关联单曲信息
    const singleRatingList = await Promise.all(
      userSingleRatings.map(async (rating) => {
        const single = await Single.findOne({ id: rating.resource_id });
        
        return {
          rating: {
            score: rating.score,
            createdAt: rating.createdAt
          },
          single: single ? {
            name_cn: single.name_cn,
            release_date: single.release_date
          } : { 
            name_cn: '未知单曲', 
            release_date: '未知时间' 
          }
        };
      })
    );

    res.json({
      code: 200,
      data: singleRatingList,
      msg: '获取用户单曲评分列表成功'
    });
  } catch (err) {
    next(err);
  }
});

// 11.7 评论相关接口
// 发布歌曲评论
app.post('/api/songs/:songId/comments', authMiddleware, async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { content } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] 💬 提交歌曲评论 - 歌曲ID：${songId} | 用户名：${username} | 内容：${content.substring(0, 50)}...`);

    // 1. 校验歌曲是否存在
    const songExist = await Song.findOne({ id: songId });
    if (!songExist) throw new AppError('歌曲不存在', 404);

    // 2. 校验评论内容
    if (!content || content.trim().length === 0) throw new AppError('评论内容不能为空');
    if (content.length > 500) throw new AppError('评论内容不能超过500字');

    // 【核心新增】查询当前登录用户的昵称和头像（和单曲评论逻辑一致）
    const user = await User.findOne({ username });
    if (!user) throw new AppError('用户不存在', 404);
    const nick_name = user.nickname || username; // 优先用昵称，无则用用户名
    const avatar = user.avatar || ''; // 头像为空则存空字符串

    // 3. 保存评论（新增nick_name和avatar字段 + 显式设置parent_id: null）
    const comment = await new Comment({
      song_id: songId,
      resource_type: 'song',
      resource_id: songId,
      username,
      nick_name, // 新增
      avatar,    // 新增
      content: content.trim(),
      parent_id: null // ✅ 核心修复：显式设置parent_id为null
    }).save();

    console.log(`[${getNow()}] ✅ 歌曲评论发布成功 - 评论ID：${comment._id} | 歌曲ID：${songId} | 用户名：${username}`);
    res.json({ 
      code: 200, 
      msg: '评论发布成功', 
      data: { 
        commentId: comment._id,
        songId,
        username,
        nick_name, 
        avatar,    
        content: comment.content,
        createdAt: comment.createdAt,
        parent_id: comment.parent_id // 显式返回parent_id（主评论为null）
      } 
    });
  } catch (err) { next(err); }
});

// 发布单曲评论
app.post('/api/singles/:singleId/comments', authMiddleware, async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { content } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] 💬 提交单曲评论 - 单曲ID：${singleId} | 用户名：${username} | 内容：${content.substring(0, 50)}...`);

    // 1. 校验单曲是否存在
    const singleExist = await Single.findOne({ id: singleId });
    if (!singleExist) throw new AppError('单曲不存在', 404);

    // 2. 校验评论内容
    if (!content || content.trim().length === 0) throw new AppError('评论内容不能为空');
    if (content.length > 500) throw new AppError('评论内容不能超过500字');

    // 3. 查询当前登录用户的昵称和头像
    const user = await User.findOne({ username });
    if (!user) throw new AppError('用户不存在', 404);
    const nick_name = user.nickname || username;
    const avatar = user.avatar || '';

    // 4. 保存评论（显式设置parent_id: null）
    const comment = await new Comment({
      resource_type: 'single',
      resource_id: singleId,
      username,
      nick_name,
      avatar,
      content: content.trim(),
      parent_id: null // ✅ 核心修复：显式设置parent_id为null
    }).save();

    console.log(`[${getNow()}] ✅ 单曲评论发布成功 - 评论ID：${comment._id} | 单曲ID：${singleId} | 用户名：${username}`);
    res.json({ 
      code: 200, 
      msg: '评论发布成功', 
      data: { 
        commentId: comment._id,
        singleId,
        username,
        nick_name,
        avatar,
        content: comment.content,
        createdAt: comment.createdAt
      } 
    });
  } catch (err) { next(err); }
});

// 发布专辑评论
app.post('/api/albums/:albumId/comment', authMiddleware, async (req, res, next) => {
  try {
    const { albumId } = req.params;
    const { content } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] 💬 提交专辑评论 - 专辑ID：${albumId} | 用户名：${username} | 内容：${content.substring(0, 50)}...`);

    // 1. 校验专辑是否存在
    const albumExist = await Album.findOne({ id: albumId });
    if (!albumExist) throw new AppError('专辑不存在', 404);

    // 2. 校验评论内容
    if (!content || content.trim().length === 0) throw new AppError('评论内容不能为空');
    if (content.length > 500) throw new AppError('评论内容不能超过500字');

    // 3. 查询当前登录用户的昵称和头像
    const user = await User.findOne({ username });
    if (!user) throw new AppError('用户不存在', 404);
    const nick_name = user.nickname || username; // 优先用昵称，无则用用户名
    const avatar = user.avatar || ''; // 头像为空则存空字符串
// 4. 保存专辑评论（resource_type=album + 显式设置parent_id: null）
    const comment = await new Comment({
      resource_type: 'album', // 标记为专辑评论
      resource_id: albumId,   // 专辑ID
      username,
      nick_name,              // 昵称
      avatar,                 // 头像
      content: content.trim(),
      parent_id: null // ✅ 核心修复：显式设置parent_id为null
    }).save();

    console.log(`[${getNow()}] ✅ 专辑评论发布成功 - 评论ID：${comment._id} | 专辑ID：${albumId} | 用户名：${username}`);
    res.json({ 
      code: 200, 
      msg: '评论发布成功', 
      data: { 
        commentId: comment._id,
        albumId,
        username,
        nick_name, // 返回昵称
        avatar,    // 返回头像
        content: comment.content,
        createdAt: comment.createdAt
      } 
    });
  } catch (err) { next(err); }
});

// 获取歌曲评论列表（支持排序）
app.get('/api/songs/:songId/comments', async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { page = 1, pageSize = 20, sortBy = 'time', order = 'desc' } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📖 获取歌曲评论 - 歌曲ID：${songId} | 页码：${page} | 页大小：${pageSize} | 排序：${sortBy} | 顺序：${order}`);

    // 1. 校验歌曲是否存在
    const songExist = await Song.findOne({ id: songId });
    if (!songExist) throw new AppError('歌曲不存在', 404);

    // 2. 校验排序参数
    if (!['time', 'like'].includes(sortBy)) {
      throw new AppError('排序参数只能是time或like', 400);
    }
    if (!['desc', 'asc'].includes(order)) {
      throw new AppError('排序顺序只能是desc或asc', 400);
    }

    // 3. 查询评论总数（只查询主评论）
    const total = await Comment.countDocuments({
      resource_type: 'song',
      resource_id: songId,
      parent_id: null
    });

    // 4. 构建排序条件
    let sortCondition = {};
    if (sortBy === 'like') {
      // 按点赞数排序
      sortCondition = { likeCount: order === 'desc' ? -1 : 1 };
    } else {
      // 默认按时间排序
      sortCondition = { createdAt: order === 'desc' ? -1 : 1 };
    }

    console.log(`[${getNow()}] 🔧 排序条件：`, JSON.stringify(sortCondition));

    // 5. 分页查询主评论（按指定排序）
    const mainComments = await Comment.find({
      resource_type: 'song',
      resource_id: songId,
      parent_id: null
    })
    // 核心修改：显式包含parent_id字段，确保返回null而非undefined
    .select('_id username nick_name avatar content createdAt likeCount parent_id')
    .sort(sortCondition)
    .skip(skip)
    .limit(Number(pageSize));

    // 6. 为每个主评论查询回复总数
    const commentsWithRepliesTotal = await Promise.all(
      mainComments.map(async (comment) => {
        const repliesTotal = await Comment.countDocuments({
          parent_id: comment._id
        });
        
        return {
          ...comment._doc,
          replies_total: repliesTotal
        };
      })
    );

    // 调试日志：验证排序效果
    if (commentsWithRepliesTotal.length > 0) {
      const firstComment = commentsWithRepliesTotal[0];
      const lastComment = commentsWithRepliesTotal[commentsWithRepliesTotal.length - 1];
      console.log(`[${getNow()}] 🔍 排序验证 - 第一条评论点赞数：${firstComment.likeCount} | 时间：${firstComment.createdAt}`);
      console.log(`[${getNow()}] 🔍 排序验证 - 最后一条评论点赞数：${lastComment.likeCount} | 时间：${lastComment.createdAt}`);
    }

    console.log(`[${getNow()}] 📖 获取歌曲评论成功 - 歌曲ID：${songId} | 总数量：${total} | 分页数量：${commentsWithRepliesTotal.length} | 排序：${sortBy} | 顺序：${order}`);
    res.json({
      code: 200,
      data: {
        comments: commentsWithRepliesTotal,
        pagination: { 
          page: Number(page), 
          pageSize: Number(pageSize), 
          total, 
          totalPages: Math.ceil(total / pageSize) 
        },
        sort: { sortBy, order } // 返回当前排序信息
      },
      msg: '获取歌曲评论成功'
    });
  } catch (err) { 
    console.error(`[${getNow()}] ❌ 获取歌曲评论失败：`, err.message);
    next(err); 
  }
});

// 获取指定评论的所有回复（子评论）


// 【核心修复】评论回复接口（移到正确位置，确保生效）
app.post('/api/comments/:commentId/reply', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] 💬 提交评论回复 - 传入的父评论ID：${commentId} | 回复用户：${username} | 内容：${content.substring(0, 50)}...`);

    // 1. 基础参数校验
    if (!content || content.trim().length === 0) {
      throw new AppError('回复内容不能为空', 400);
    }
    if (content.length > 500) {
      throw new AppError('回复内容不能超过500字', 400);
    }

    // 2. 校验并查询父评论（使用正确的ObjectId转换方法）
    let parentComment;
    try {
      parentComment = await Comment.findById(commentId);
    } catch (err) {
      throw new AppError('父评论ID格式错误', 400);
    }
    if (!parentComment) {
      throw new AppError('父评论不存在', 404);
    }
    console.log(`[${getNow()}] 📌 查询到父评论 - 父评论ID：${parentComment._id} | 父评论ID字符串：${parentComment._id.toString()} | 父评论parent_id：${parentComment.parent_id} | 父评论类型：${parentComment.resource_type} | 父评论资源ID：${parentComment.resource_id}`);

    // 3. 获取当前登录用户的昵称和头像
    const currentUser = await User.findOne({ username });
    if (!currentUser) {
      throw new AppError('当前用户不存在', 404);
    }
    const nick_name = currentUser.nickname || username;
    const avatar = currentUser.avatar || '';

    // 4. 构建回复评论数据
    const replyCommentData = {
      resource_type: parentComment.resource_type,
      resource_id: parentComment.resource_id,
      username: username,
      nick_name: nick_name,
      avatar: avatar,
      content: content.trim(),
      parent_id: parentComment._id,
      reply_to_user_id: req.body.reply_to_user_id || parentComment.username,
      reply_to_name: req.body.reply_to_name || parentComment.nick_name
    };
    
    if (parentComment.resource_type === 'song') {
      replyCommentData.song_id = parentComment.song_id;
    }
    console.log(`[${getNow()}] 📌 构建回复数据 - parent_id：${replyCommentData.parent_id} | 类型：${typeof replyCommentData.parent_id}`);

    // 5. 保存回复评论
    const replyComment = await new Comment(replyCommentData).save({
      setDefaultsOnInsert: false
    });
    console.log(`[${getNow()}] ✅ 回复评论保存成功 - 回复ID：${replyComment._id} | 最终存储的parent_id：${replyComment.parent_id} | 父评论ID：${parentComment._id}`);

    // 6. 【新增】创建被回复通知（如果回复的不是自己的评论）
    if (parentComment.username !== username) {
      try {
        // 检查Notification模型是否存在，如果不存在则创建
        if (typeof Notification === 'undefined') {
          // 动态创建Notification模型
          const notificationSchema = new mongoose.Schema({
            receiver_username: { type: String, required: true },
            sender_username: { type: String, required: true },
            sender_nickname: { type: String, required: true },
            sender_avatar: { type: String, default: '' },
            content: { type: String, required: true },
            comment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', required: true },
            resource_type: { type: String, required: true, enum: ['song', 'single', 'album'] },
            resource_id: { type: String, required: true },
            type: { type: String, required: true, enum: ['reply', 'like'] },
            is_read: { type: Boolean, default: false },
            createdAt: { type: Date, default: Date.now }
          });
          
          // 如果模型不存在则创建
          if (!mongoose.models.Notification) {
            mongoose.model('Notification', notificationSchema);
          }
        }

        // 创建被回复通知
        await mongoose.model('Notification').create({
          receiver_username: parentComment.username,
          sender_username: username,
          sender_nickname: nick_name,
          sender_avatar: avatar,
          content: `回复了你的评论：${content.substring(0, 30)}${content.length > 30 ? '...' : ''}`,
          comment_id: replyComment._id,
          resource_type: parentComment.resource_type,
          resource_id: parentComment.resource_id,
          type: 'reply',
          is_read: false
        });
        
        console.log(`[${getNow()}] 💬 创建被回复通知成功 - 接收者：${parentComment.username} | 发送者：${username}`);
      } catch (notificationError) {
        console.error(`[${getNow()}] ⚠️ 创建被回复通知失败 - 错误：${notificationError.message}`);
        // 通知创建失败不影响主流程，继续执行
      }
    }

    // 7. 响应：统一使用parentId字段，避免冗余
    res.json({
      code: 200,
      msg: '回复发布成功',
      data: {
        replyId: replyComment._id,
        parentId: parentComment._id.toString(),
        resourceType: parentComment.resource_type,
        resourceId: parentComment.resource_id,
        username: username,
        nick_name: nick_name,
        avatar: avatar,
        reply_to_user_id: replyCommentData.reply_to_user_id,
        reply_to_name: replyCommentData.reply_to_name,
        content: replyComment.content,
        createdAt: replyComment.createdAt,
        likeCount: replyComment.likeCount
      }
    });

  } catch (err) {
    console.error(`[${getNow()}] ❌ 回复评论失败 - 错误：${err.message} | 栈信息：${err.stack}`);
    if (err.name === 'CastError' && err.path === '_id') {
      return res.status(400).json({
        code: 400,
        msg: '评论ID格式错误，请刷新页面后重试',
        data: null
      });
    }
    next(err);
  }
});

// 获取单曲评论列表
app.get('/api/singles/:singleId/comments', async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { page = 1, pageSize = 20, sortBy = 'time', order = 'desc' } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📖 获取单曲评论 - 单曲ID：${singleId} | 页码：${page} | 页大小：${pageSize} | 排序：${sortBy} | 顺序：${order}`);

    // 1. 校验单曲是否存在
    const singleExist = await Single.findOne({ id: singleId });
    if (!singleExist) throw new AppError('单曲不存在', 404);

    // 2. 查询评论总数（只查询主评论）
    const total = await Comment.countDocuments({
      resource_type: 'single',
      resource_id: singleId,
      parent_id: null
    });

    // 3. 构建排序条件
    let sortCondition = {};
    if (sortBy === 'like') {
      // 按点赞数排序
      sortCondition = { likeCount: order === 'desc' ? -1 : 1 };
    } else {
      // 默认按时间排序
      sortCondition = { createdAt: order === 'desc' ? -1 : 1 };
    }

    // 4. 分页查询主评论（按指定条件排序）
    const mainComments = await Comment.find({
      resource_type: 'single',
      resource_id: singleId,
      parent_id: null
    })
    .select('_id username nick_name avatar content createdAt likeCount')
    .sort(sortCondition)
    .skip(skip)
    .limit(Number(pageSize));

    // 5. 为每个主评论查询回复总数
    const commentsWithRepliesTotal = await Promise.all(
      mainComments.map(async (comment) => {
        const repliesTotal = await Comment.countDocuments({
          parent_id: comment._id
        });
        
        return {
          ...comment._doc,
          replies_total: repliesTotal
        };
      })
    );

    console.log(`[${getNow()}] 📖 获取单曲评论成功 - 单曲ID：${singleId} | 总数量：${total} | 分页数量：${commentsWithRepliesTotal.length} | 排序：${sortBy} | 顺序：${order}`);
    res.json({
      code: 200,
      data: {
        comments: commentsWithRepliesTotal,
        pagination: { 
          page: Number(page), 
          pageSize: Number(pageSize), 
          total, 
          totalPages: Math.ceil(total / pageSize) 
        },
        sort: { sortBy, order } // 返回当前排序信息
      },
      msg: '获取单曲评论成功'
    });
  } catch (err) { next(err); }
});

// 获取专辑评论列表



// 评论点赞/取消点赞（核心补充）
// 11.8 评论点赞接口（核心补全）
// 评论点赞/取消点赞
// 优化评论点赞接口，添加被点赞通知逻辑
app.post('/api/comments/:commentId/like', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
const { username } = req.user;
    console.log(`[${getNow()}] 👍 评论点赞操作 - 评论ID：${commentId} | 用户名：${username}`);

    // 1. 校验评论是否存在
    const comment = await Comment.findById(commentId);
    if (!comment) throw new AppError('评论不存在', 404);

    // 2. 获取用户信息
    const user = await User.findOne({ username });
    if (!user) throw new AppError('用户不存在', 404);

    // 3. 原子操作：查询并更新点赞记录
    const existingLike = await CommentLike.findOne({ commentId, username });
    
    if (existingLike) {
      // 取消点赞
      await Promise.all([
        CommentLike.deleteOne({ _id: existingLike._id }),
        Comment.findByIdAndUpdate(commentId, { $inc: { likeCount: -1 } })
      ]);
      console.log(`[${getNow()}] ✅ 评论取消点赞成功 - 评论ID：${commentId} | 用户名：${username}`);
      res.json({ code: 200, msg: '取消点赞成功', data: { isLiked: false } });
    } else {
      // 点赞
      await Promise.all([
        new CommentLike({ commentId, username }).save(),
        Comment.findByIdAndUpdate(commentId, { $inc: { likeCount: 1 } })
      ]);
      
      // 4. 【新增】创建被点赞通知（如果点赞的不是自己的评论）
      if (comment.username !== username) {
        await new Notification({
          receiver_username: comment.username,
          sender_username: username,
          sender_nickname: user.nickname || username,
          sender_avatar: user.avatar || '',
          content: `点赞了你的评论：${comment.content.substring(0, 30)}${comment.content.length > 30 ? '...' : ''}`,
          comment_id: comment._id,
          resource_type: comment.resource_type,
          resource_id: comment.resource_id,
          type: 'like'
        }).save();
        
        console.log(`[${getNow()}] 👍 创建被点赞通知 - 接收者：${comment.username} | 发送者：${username}`);
      }
      
      console.log(`[${getNow()}] ✅ 评论点赞成功 - 评论ID：${commentId} | 用户名：${username}`);
      res.json({ code: 200, msg: '点赞成功', data: { isLiked: true } });
    }
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ code: 400, msg: '请勿重复点赞', data: null });
    }
    next(err);
  }
});

// 查询用户是否点赞了某条评论
app.get('/api/comments/:commentId/like/status', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { username } = req.user;
    
    const likeRecord = await CommentLike.findOne({ commentId, username });
    const isLiked = !!likeRecord;
    
    console.log(`[${getNow()}] 📖 查询评论点赞状态 - 评论ID：${commentId} | 用户名：${username} | 状态：${isLiked ? '已点赞' : '未点赞'}`);
    res.json({ 
      code: 200, 
      data: { isLiked }, 
      msg: '查询点赞状态成功' 
    });
  } catch (err) {
    next(err);
  }
});

// 获取特定评论的子评论列表（分页查询）
app.get('/api/comments/:commentId/replies', async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { page = 1, pageSize = 10, sortBy = 'time', order = 'asc' } = req.query;
    
    console.log(`[${getNow()}] 📖 获取子评论列表 - 父评论ID：${commentId} | 页码：${page} | 每页数量：${pageSize} | 排序：${sortBy} | 顺序：${order}`);

    // 1. 校验分页参数
    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize);
    
    if (pageNum < 1 || pageSizeNum < 1 || pageSizeNum > 50) {
      throw new AppError('分页参数无效：页码必须≥1，每页数量必须为1-50', 400);
    }

    const skip = (pageNum - 1) * pageSizeNum;

    // 2. 校验父评论是否存在
    const parentComment = await Comment.findById(commentId);
    if (!parentComment) {
      console.log(`[${getNow()}] ❌ 父评论不存在 - 评论ID：${commentId}`);
      throw new AppError('父评论不存在', 404);
    }

    console.log(`[${getNow()}] 🔍 查询父评论成功 - 用户名：${parentComment.username} | 内容：${parentComment.content.substring(0, 20)}...`);

    // 3. 查询子评论总数
    const totalReplies = await Comment.countDocuments({ parent_id: commentId });
    console.log(`[${getNow()}] 📊 子评论统计 - 父评论ID：${commentId} | 总数量：${totalReplies}`);

    // 4. 构建排序条件
    let sortCondition = {};
    if (sortBy === 'like') {
      // 按点赞数排序
      sortCondition = { likeCount: order === 'desc' ? -1 : 1 };
    } else {
      // 默认按时间排序（子评论默认按时间正序）
      sortCondition = { createdAt: order === 'desc' ? -1 : 1 };
    }

    // 5. 查询子评论列表（按指定条件排序）
    const replies = await Comment.find({ parent_id: commentId })
      .select('_id username nick_name avatar content createdAt likeCount parent_id reply_to_user_id reply_to_name')
      .sort(sortCondition)
      .skip(skip)
      .limit(pageSizeNum);

    console.log(`[${getNow()}] 📋 查询子评论结果 - 父评论ID：${commentId} | 返回数量：${replies.length} | 排序：${sortBy} | 顺序：${order}`);

    // 6. 构建响应数据
    const responseData = {
      parentComment: {
        _id: parentComment._id,
        username: parentComment.username,
        nick_name: parentComment.nick_name,
        content: parentComment.content
      },
      replies: replies.map(reply => ({
        _id: reply._id,
        username: reply.username,
        nick_name: reply.nick_name,
        avatar: reply.avatar,
        content: reply.content,
        createdAt: reply.createdAt,
        likeCount: reply.likeCount,
        parent_id: reply.parent_id,
        reply_to_user_id: reply.reply_to_user_id,
        reply_to_name: reply.reply_to_name
      })),
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total: totalReplies,
        totalPages: Math.ceil(totalReplies / pageSizeNum)
      },
      sort: { sortBy, order } // 返回当前排序信息
    };

    console.log(`[${getNow()}] ✅ 获取子评论成功 - 父评论ID：${commentId} | 返回子评论数：${replies.length} | 总页数：${responseData.pagination.totalPages} | 排序：${sortBy} | 顺序：${order}`);
    
    res.json({
      code: 200,
      data: responseData,
      msg: '获取子评论成功'
    });
  } catch (err) { next(err); }
});
// 11.9 评论管理接口（编辑/删除）
// 编辑评论
app.put('/api/comments/:commentId', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const { username } = req.user;
    
    console.log(`[${getNow()}] ✏️ 编辑评论 - 评论ID：${commentId} | 用户名：${username}`);

    // 1. 校验参数
    if (!content || content.trim().length === 0) {
      throw new AppError('评论内容不能为空', 400);
    }
    if (content.length > 500) {
      throw new AppError('评论内容不能超过500字', 400);
    }

    // 2. 校验评论归属权
    const comment = await Comment.findById(commentId);
    if (!comment) throw new AppError('评论不存在', 404);
    if (comment.username !== username) {
      throw new AppError('无权编辑他人评论', 403);
    }

    // 3. 更新评论内容
    const updatedComment = await Comment.findByIdAndUpdate(
      commentId,
      { content: content.trim(), updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    console.log(`[${getNow()}] ✅ 评论编辑成功 - 评论ID：${commentId} | 用户名：${username}`);
    res.json({
      code: 200,
      msg: '评论编辑成功',
      data: {
        commentId: updatedComment._id,
        content: updatedComment.content,
        updatedAt: updatedComment.updatedAt
      }
    });
  } catch (err) {
    next(err);
  }
});

// 删除评论（级联删除回复和点赞记录）
app.delete('/api/comments/:commentId', authMiddleware, async (req, res, next) => {
  try {
    const { commentId } = req.params;
    const { username } = req.user;
    
    console.log(`[${getNow()}] 🗑️ 删除评论 - 评论ID：${commentId} | 用户名：${username}`);

    // 1. 校验评论归属权
    const comment = await Comment.findById(commentId);
    if (!comment) throw new AppError('评论不存在', 404);
    if (comment.username !== username) {
      throw new AppError('无权删除他人评论', 403);
    }

    // 2. 级联删除：主评论+回复+点赞记录
    await Promise.all([
      // 删除主评论
      Comment.deleteOne({ _id: commentId }),
      // 删除该评论的所有回复
      Comment.deleteMany({ parent_id: commentId }),
      // 删除该评论的所有点赞记录
      CommentLike.deleteMany({ commentId })
    ]);

    console.log(`[${getNow()}] ✅ 评论删除成功（含回复和点赞）- 评论ID：${commentId} | 用户名：${username}`);
    res.json({
      code: 200,
      msg: '评论删除成功',
      data: { commentId }
    });
  } catch (err) {
    next(err);
  }
});

// 增强通知列表接口，支持主页提醒功能
app.get('/api/notifications', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;
    const { page = 1, pageSize = 20, unreadOnly = false, type } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📢 获取通知列表 - 用户：${username} | 页码：${page} | 页大小：${pageSize} | 仅未读：${unreadOnly} | 类型：${type || '全部'}`);

    // 构建查询条件
    const query = { receiver_username: username };
    if (unreadOnly === 'true') {
      query.is_read = false;
    }
    if (type && ['reply', 'like'].includes(type)) {
      query.type = type;
    }

    // 查询总数
    const total = await Notification.countDocuments(query);

    // 查询通知列表（按时间倒序）
    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(pageSize))
      .lean();

    // 为每个通知添加跳转信息和关联评论内容
    const notificationsWithDetails = await Promise.all(
      notifications.map(async (notification) => {
        try {
          // 获取关联的评论信息
          const comment = await Comment.findById(notification.comment_id);
          if (!comment) {
            return {
              ...notification,
              jumpInfo: null,
              commentContent: '评论已被删除',
              error: '关联评论不存在'
            };
          }

          // 构建跳转信息
          const jumpInfo = {
            resourceType: comment.resource_type,
            resourceId: comment.resource_id,
            commentId: comment._id.toString(),
            jumpPath: `/${comment.resource_type}/${comment.resource_id}`,
            hasParentComment: !!comment.parent_id
          };

          return {
            ...notification,
            jumpInfo,
            commentContent: comment.content,
            commentCreatedAt: comment.createdAt
          };
        } catch (error) {
          return {
            ...notification,
            jumpInfo: null,
            commentContent: '获取评论内容失败',
            error: '获取跳转信息失败'
          };
        }
      })
    );

    console.log(`[${getNow()}] ✅ 获取通知列表成功 - 用户：${username} | 总数：${total} | 返回数量：${notificationsWithDetails.length}`);

    res.json({
      code: 200,
      data: {
        notifications: notificationsWithDetails,
        pagination: {
          page: Number(page),
          pageSize: Number(pageSize),
          total,
          totalPages: Math.ceil(total / pageSize)
        }
      },
      msg: '获取通知成功'
    });
  } catch (err) { next(err); }
});

// 新增：主页提醒聚合接口（移到正确位置）
app.get('/api/notifications/homepage-summary', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;

    console.log(`[${getNow()}] 🏠 获取主页提醒汇总 - 用户：${username}`);

    // 获取未读通知总数
    const totalUnread = await Notification.countDocuments({
      receiver_username: username,
      is_read: false
    });

    // 获取最新5条未读通知（用于即时显示）
    const latestUnreadNotifications = await Notification.find({
      receiver_username: username,
      is_read: false
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    // 为最新通知添加详细信息
    const notificationsWithDetails = await Promise.all(
      latestUnreadNotifications.map(async (notification) => {
        try {
          const comment = await Comment.findById(notification.comment_id);
          return {
            ...notification,
            commentContent: comment ? comment.content : '评论已被删除'
          };
        } catch (error) {
          return notification;
        }
      })
    );

    // 按类型统计
    const replyUnreadCount = await Notification.countDocuments({
      receiver_username: username,
      is_read: false,
      type: 'reply'
    });

    const likeUnreadCount = await Notification.countDocuments({
      receiver_username: username,
      is_read: false,
      type: 'like'
    });

    res.json({
      code: 200,
      data: {
        totalUnread,
        replyUnreadCount,
        likeUnreadCount,
        latestNotifications: notificationsWithDetails,
        lastUpdated: new Date().toISOString()
      },
      msg: '获取主页提醒汇总成功'
    });
  } catch (err) { next(err); }
});

app.get('/api/notifications/homepage-summary', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;

    console.log(`[${getNow()}] 🏠 获取主页提醒汇总 - 用户：${username}`);

    // 获取未读通知总数
    const totalUnread = await Notification.countDocuments({
      receiver_username: username,
      is_read: false
    });

    // 获取最新5条未读通知（用于即时显示）
    const latestUnreadNotifications = await Notification.find({
      receiver_username: username,
      is_read: false
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean();

    // 为最新通知添加详细信息
    const notificationsWithDetails = await Promise.all(
      latestUnreadNotifications.map(async (notification) => {
        try {
          const comment = await Comment.findById(notification.comment_id);
          return {
            ...notification,
            commentContent: comment ? comment.content : '评论已被删除'
          };
        } catch (error) {
          return notification;
        }
      })
    );

    // 按类型统计
    const replyUnreadCount = await Notification.countDocuments({
      receiver_username: username,
      is_read: false,
      type: 'reply'
    });

    const likeUnreadCount = await Notification.countDocuments({
      receiver_username: username,
      is_read: false,
      type: 'like'
    });

    res.json({
      code: 200,
      data: {
        totalUnread,
        replyUnreadCount,
        likeUnreadCount,
        latestNotifications: notificationsWithDetails,
        lastUpdated: new Date().toISOString()
      },
      msg: '获取主页提醒汇总成功'
    });
  } catch (err) { next(err); }
});

// 新增：标记单个通知为已读接口
app.put('/api/notifications/:id/read', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;
    const { id } = req.params;

    console.log(`[${getNow()}] 📌 标记通知为已读 - 用户：${username} | 通知ID：${id}`);

    // 验证通知ID格式
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        code: 400,
        msg: '通知ID格式不正确'
      });
    }

    // 查找并更新通知状态
    const notification = await Notification.findOneAndUpdate(
      { 
        _id: id, 
        receiver_username: username 
      },
      { 
        is_read: true,
        readAt: new Date()
      },
      { 
        new: true,
        runValidators: true 
      }
    );

    if (!notification) {
      return res.status(404).json({
        code: 404,
        msg: '通知不存在或无权操作'
      });
    }

    console.log(`[${getNow()}] ✅ 标记通知为已读成功 - 用户：${username} | 通知ID：${id}`);

    res.json({
      code: 200,
      data: {
        notificationId: id,
        is_read: true
      },
      msg: '标记为已读成功'
    });
  } catch (err) { next(err); }
});

// 新增：标记所有通知为已读接口
app.put('/api/notifications/read-all', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;

    console.log(`[${getNow()}] 📌 标记所有通知为已读 - 用户：${username}`);

    // 更新所有未读通知
    const result = await Notification.updateMany(
      { 
        receiver_username: username,
        is_read: false 
      },
      { 
        is_read: true,
        readAt: new Date()
      }
    );

    console.log(`[${getNow()}] ✅ 标记所有通知为已读成功 - 用户：${username} | 更新数量：${result.modifiedCount}`);

    res.json({
      code: 200,
      data: {
        updatedCount: result.modifiedCount,
        totalUnread: 0
      },
      msg: '标记所有通知为已读成功'
    });
  } catch (err) { next(err); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;

    console.log(`[${getNow()}] 📌 标记所有通知为已读 - 用户：${username}`);

    // 更新所有未读通知
    const result = await Notification.updateMany(
      { 
        receiver_username: username,
        is_read: false 
      },
      { 
        is_read: true,
        readAt: new Date()
      }
    );

    console.log(`[${getNow()}] ✅ 标记所有通知为已读成功 - 用户：${username} | 更新数量：${result.modifiedCount}`);

    res.json({
      code: 200,
      data: {
        updatedCount: result.modifiedCount,
        totalUnread: 0
      },
      msg: '标记所有通知为已读成功'
    });
  } catch (err) { next(err); }
});

// 新增：删除通知接口
app.delete('/api/notifications/:id', authMiddleware, async (req, res, next) => {
  try {
    const { username } = req.user;
    const { id } = req.params;

    console.log(`[${getNow()}] 🗑️ 删除通知 - 用户：${username} | 通知ID：${id}`);

    // 验证通知ID格式
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        code: 400,
        msg: '通知ID格式不正确'
      });
    }

    // 查找并删除通知（确保只能删除自己的通知）
    const notification = await Notification.findOneAndDelete({
      _id: id,
      receiver_username: username
    });

    if (!notification) {
      return res.status(404).json({
        code: 404,
        msg: '通知不存在或无权删除'
      });
    }

    console.log(`[${getNow()}] ✅ 删除通知成功 - 用户：${username} | 通知ID：${id}`);

    res.json({
      code: 200,
      data: {
        notificationId: id,
        deleted: true
      },
      msg: '删除通知成功'
    });
  } catch (err) { next(err); }
});

// 12. 兜底路由（404处理，放在所有接口之后）


// 13. 注册全局错误处理中间件（核心：必须放在所有路由之后）
app.use(errorHandler);

// 14. 数据库连接 + 服务启动（程序入口）
async function startServer() {
  try {
    // 连接MongoDB
    await mongoose.connect(MONGODB_URL);
    console.log(`[${getNow()}] 🛡️ MongoDB连接成功 - 地址：${MONGODB_URL}`);

    // 初始化静态数据（专辑/歌曲/单曲）
    await initData();

    // 启动HTTP服务
    app.listen(PORT, () => {
      console.log(`[${getNow()}] 🚀 服务启动成功 - 端口：${PORT} | 访问地址：http://localhost:${PORT}`);
      console.log(`[${getNow()}] 📌 允许跨域的前端地址：http://127.0.0.1:5500、http://localhost:5500`);
    });
  } catch (err) {
    console.error(`[${getNow()}] ❌ 服务启动失败：`, err.stack);
    process.exit(1); // 启动失败退出进程
  }
}

// 启动服务
startServer();

// 全局未捕获异常处理
process.on('uncaughtException', (err) => {
  console.error(`[${getNow()}] 🚨 未捕获异常：`, err.stack);
  process.exit(1);
});

// 全局未处理Promise拒绝处理
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[${getNow()}] 🚨 未处理Promise拒绝 - Promise：`, promise, ' | 原因：', reason.stack);
  process.exit(1);
});

