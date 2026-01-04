// 1. 核心依赖导入
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
// 修复CORS：兼容127.0.0.1:5500和localhost:5500
app.use(cors({ 
  origin: ['http://127.0.0.1:5500', 'http://localhost:5500'], 
  credentials: true 
}));
app.use(express.json());

// 新增：全局请求日志中间件（修复req.body为空时的substring报错）
app.use((req, res, next) => {
  // 空值兜底：req.body为undefined时转为空对象，再JSON.stringify
  const bodyStr = JSON.stringify(req.body || {});
  // 避免字符串过长，截取前200字符（加长度判断，防止空字符串substring报错）
  const shortBodyStr = bodyStr.length > 200 ? bodyStr.substring(0, 200) : bodyStr;
  
  console.log(`\n[${getNow()}] 🚀 请求接收 - 方法：${req.method} | 路径：${req.originalUrl} | 参数：${JSON.stringify(req.params)} | 查询参数：${JSON.stringify(req.query)} | 请求体：${shortBodyStr}`);
  next();
});

// 4. 核心配置
const JWT_SECRET = 'tao_zhe_official_2025_secret_key';
const MONGODB_URL = 'mongodb://localhost:27017/tao_zhe_official';
const PORT = 3000; // 保持你原有端口3000不变

// 5. 数据模型定义（无修改，保持原有逻辑）
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

const singleSchema = new mongoose.Schema({
  id: { type: String, unique: true, required: true },
  name_cn: { type: String, required: true },
  release_date: { type: String, required: true },
  description: { type: String }
});

const userSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true, minlength: 3 },
  password: { type: String, required: true, minlength: 6 },
  createdAt: { type: Date, default: Date.now }
});

const ratingSchema = new mongoose.Schema({
  song_id: { type: String, required: function() { return this.resource_type === 'song'; } },
  resource_type: { type: String, required: true, enum: ['song', 'single'], default: 'song' },
  resource_id: { type: String, required: true },
  username: { type: String, required: true },
  score: { type: Number, required: true, min: 0.5, max: 5, enum: [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5] },
  createdAt: { type: Date, default: Date.now }
});
ratingSchema.index({ song_id: 1, username: 1 }, { unique: true, partialFilterExpression: { resource_type: 'song' } });
ratingSchema.index({ resource_type: 1, resource_id: 1, username: 1 }, { unique: true });

// ===================== 新增：评论数据模型 =====================
const commentSchema = new mongoose.Schema({
  // 关联字段：兼容歌曲/单曲
  song_id: { type: String, required: function() { return this.resource_type === 'song'; } },
  resource_type: { type: String, required: true, enum: ['song', 'single'], default: 'song' },
  resource_id: { type: String, required: true }, // 歌曲/单曲ID
  // 评论内容
  username: { type: String, required: true }, // 评论用户
  content: { type: String, required: true, minlength: 1, maxlength: 500 }, // 评论内容（1-500字）
  // 时间字段
  createdAt: { type: Date, default: Date.now },
  // 可选：点赞数（如果需要）
  likeCount: { type: Number, default: 0 }
});
// 索引优化：按资源类型+ID查询评论，按创建时间排序
commentSchema.index({ resource_type: 1, resource_id: 1, createdAt: -1 });
// ===================== 评论模型定义结束 =====================

// 7. 模型实例化
const Song = mongoose.model('Song', songSchema);
const Album = mongoose.model('Album', albumSchema);
const Single = mongoose.model('Single', singleSchema);
const User = mongoose.model('User', userSchema);
const Rating = mongoose.model('Rating', ratingSchema);
// ===================== 新增：评论模型实例化 =====================
const Comment = mongoose.model('Comment', commentSchema);
// ===================== 模型实例化结束 =====================

// 8. 核心工具函数/中间件（增强错误日志）
class AppError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

const errorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  // 增强：打印完整错误栈
  console.error(`[${getNow()}] ❌ 接口错误 - 路径：${req.originalUrl} | 错误码：${err.statusCode} | 错误信息：${err.message} | 错误栈：`, err.stack);
  
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const msg = field === 'username' ? '用户名已存在' : '不可重复评分';
    return res.status(400).json({ code: 400, msg, data: null });
  }
  if (err.name === 'ValidationError') {
    const msg = Object.values(err.errors).map(v => v.message).join(', ');
    return res.status(400).json({ code: 400, msg, data: null });
  }
  if (err.name === 'JsonWebTokenError') return res.status(401).json({ code: 401, msg: '无效token', data: null });
  if (err.name === 'TokenExpiredError') return res.status(401).json({ code: 401, msg: 'token过期', data: null });
  res.status(err.statusCode).json({
    code: err.statusCode,
    msg: process.env.NODE_ENV === 'development' ? err.message : '服务器错误',
    data: null
  });
};

const generateToken = (username) => jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });

const authMiddleware = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) throw new AppError('未登录', 401);
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = { username: decoded.username };
    console.log(`[${getNow()}] 🔐 鉴权成功 - 用户名：${decoded.username}`);
    next();
  } catch (err) {
    next(err);
  }
};

async function initData() {
  try {
    console.log(`[${getNow()}] 🧹 开始清空静态数据（专辑/歌曲/单曲）...`);
    // 只删除专辑、歌曲、单曲（静态数据），移除用户/评分/评论的删除！
    const [albumDel, songDel, singleDel] = await Promise.all([
      Album.deleteMany({}),
      Song.deleteMany({}),
      Single.deleteMany({})
      // 👇 删掉这三行：不再清空用户、评分、评论
      // User.deleteMany({}),
      // Rating.deleteMany({}),
      // Comment.deleteMany({})
    ]);
    console.log(`[${getNow()}] 🧹 清空静态数据完成 - 专辑：${albumDel.deletedCount} | 歌曲：${songDel.deletedCount} | 单曲：${singleDel.deletedCount}`);

    console.log(`[${getNow()}] 📤 开始插入静态数据...`);
    // 只插入静态数据（专辑/歌曲/单曲）
    const [albumIns, songIns, singleIns] = await Promise.all([
      Album.insertMany(taoZheAlbums),
      Song.insertMany(taoZheSongs),
      Single.insertMany(taoZheSingles)
    ]);
    console.log(`[${getNow()}] ✅ 静态数据入库成功 - 专辑：${albumIns.length} | 歌曲：${songIns.length} | 单曲：${singleIns.length}`);

    // 验证静态数据插入结果
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

// 10. 完整接口（所有核心接口添加调试日志）
// 10.1 专辑相关
app.get('/api/albums', async (req, res, next) => {
  try {
    const albums = await Album.find({});
    console.log(`[${getNow()}] 📖 获取专辑列表 - 数量：${albums.length}`);
    res.json({ code: 200, data: albums, msg: '获取专辑成功' });
  } catch (err) { next(err); }
});

app.get('/api/albums/:albumId', async (req, res, next) => {
  try {
    const album = await Album.findOne({ id: req.params.albumId });
    console.log(`[${getNow()}] 📖 获取专辑详情 - ID：${req.params.albumId} | 结果：${album ? '存在' : '不存在'}`);
    if (!album) throw new AppError('专辑不存在', 404);
    res.json({ code: 200, data: album, msg: '获取专辑详情成功' });
  } catch (err) { next(err); }
});

app.get('/api/albums/:albumId/songs', async (req, res, next) => {
  try {
    const songs = await Song.find({ album_id: req.params.albumId }).sort({ track_number: 1 });
    console.log(`[${getNow()}] 📖 获取专辑歌曲 - 专辑ID：${req.params.albumId} | 歌曲数量：${songs.length}`);
    res.json({ code: 200, data: songs, msg: '获取专辑歌曲成功' });
  } catch (err) { next(err); }
});

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

// 10.2 歌曲相关
// ========== 先定义具体路由（优先匹配） ==========
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

// ========== 后定义动态路由（兜底） ==========
app.get('/api/songs/:songId', async (req, res, next) => {
  try {
    const song = await Song.findOne({ id: req.params.songId });
    console.log(`[${getNow()}] 📖 获取歌曲详情 - ID：${req.params.songId} | 结果：${song ? '存在' : '不存在'}`);
    if (!song) throw new AppError('歌曲不存在', 404);
    res.json({ code: 200, data: song, msg: '获取歌曲详情成功' });
  } catch (err) { next(err); }
});

// 10.3 单曲相关
app.get('/api/singles', async (req, res, next) => {
  try {
    const singles = await Single.find({}).sort({ release_date: 1 });
    console.log(`[${getNow()}] 📖 获取单曲列表 - 数量：${singles.length}`);
    res.json({ code: 200, data: singles, msg: '获取单曲成功' });
  } catch (err) { next(err); }
});

app.get('/api/singles/:singleId', async (req, res, next) => {
  try {
    const single = await Single.findOne({ id: req.params.singleId });
    console.log(`[${getNow()}] 📖 获取单曲详情 - ID：${req.params.singleId} | 结果：${single ? '存在' : '不存在'}`);
    if (!single) throw new AppError('单曲不存在', 404);
    res.json({ code: 200, data: single, msg: '获取单曲详情成功' });
  } catch (err) { next(err); }
});

app.post('/api/singles/:singleId/rating', authMiddleware, async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { score } = req.body;
    const { username } = req.user;
    console.log(`[${getNow()}] ⭐ 提交单曲评分 - 单曲ID：${singleId} | 用户名：${username} | 评分：${score}`);

    const singleExist = await Single.findOne({ id: singleId });
    if (!singleExist) throw new AppError('单曲不存在', 404);

    if (![0.5,1,1.5,2,2.5,3,3.5,4,4.5,5].includes(Number(score))) {
      throw new AppError('评分必须是0.5-5的半星递增');
    }

    await new Rating({
      resource_type: 'single',
      resource_id: singleId,
      username,
      score: Number(score)
    }).save();

    console.log(`[${getNow()}] ✅ 单曲评分提交成功 - 单曲ID：${singleId} | 用户名：${username}`);
    res.json({ code: 200, msg: '单曲评分成功', data: { singleId, username, score } });
  } catch (err) { next(err); }
});

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

// ===================== 新增：整合歌曲+单曲的评分排序接口 =====================
// 完全新增，不修改原有任何接口，仅补充该接口供前端调用
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
// ===================== 新增接口结束 =====================

// 10.4 用户相关
app.post('/api/user/register', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    console.log(`[${getNow()}] 📝 用户注册 - 用户名：${username}`);
    
    if (!username || !password) throw new AppError('用户名/密码不能为空');
    if (username.length < 3) throw new AppError('用户名至少3位');
    if (password.length < 6) throw new AppError('密码至少6位');
    if (await User.findOne({ username })) throw new AppError('用户名已存在');
    
    const hashedPwd = await bcrypt.hash(password, 10);
    await new User({ username, password: hashedPwd }).save();
    
    console.log(`[${getNow()}] ✅ 用户注册成功 - 用户名：${username}`);
    res.json({ code: 200, msg: '注册成功', data: { username } });
  } catch (err) { next(err); }
});

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

app.get('/api/user/info', authMiddleware, (req, res) => {
  console.log(`[${getNow()}] 📖 获取用户信息 - 用户名：${req.user.username}`);
  res.json({ code: 200, msg: '获取用户信息成功', data: { username: req.user.username } });
});

// 10.5 评分相关
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

// ===================== 新增：评论功能接口（核心） =====================
// 10.6 评论相关接口（完全新增，不影响原有逻辑）
// 10.6.1 发布歌曲评论（需要登录）
app.post('/api/songs/:songId/comment', authMiddleware, async (req, res, next) => {
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

    // 3. 保存评论
    const comment = await new Comment({
      song_id: songId,
      resource_type: 'song',
      resource_id: songId,
      username,
      content: content.trim()
    }).save();

    console.log(`[${getNow()}] ✅ 歌曲评论发布成功 - 评论ID：${comment._id} | 歌曲ID：${songId} | 用户名：${username}`);
    res.json({ 
      code: 200, 
      msg: '评论发布成功', 
      data: { 
        commentId: comment._id,
        songId,
        username,
        content: comment.content,
        createdAt: comment.createdAt
      } 
    });
  } catch (err) { next(err); }
});

// 10.6.2 发布单曲评论（需要登录）
app.post('/api/singles/:singleId/comment', authMiddleware, async (req, res, next) => {
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

    // 3. 保存评论
    const comment = await new Comment({
      resource_type: 'single',
      resource_id: singleId,
      username,
      content: content.trim()
    }).save();

    console.log(`[${getNow()}] ✅ 单曲评论发布成功 - 评论ID：${comment._id} | 单曲ID：${singleId} | 用户名：${username}`);
    res.json({ 
      code: 200, 
      msg: '评论发布成功', 
      data: { 
        commentId: comment._id,
        singleId,
        username,
        content: comment.content,
        createdAt: comment.createdAt
      } 
    });
  } catch (err) { next(err); }
});

// 10.6.3 获取歌曲评论列表（分页，按时间倒序）
app.get('/api/songs/:songId/comments', async (req, res, next) => {
  try {
    const { songId } = req.params;
    const { page = 1, pageSize = 20 } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📖 获取歌曲评论 - 歌曲ID：${songId} | 页码：${page} | 页大小：${pageSize}`);

    // 1. 校验歌曲是否存在
    const songExist = await Song.findOne({ id: songId });
    if (!songExist) throw new AppError('歌曲不存在', 404);

    // 2. 查询评论总数
    const total = await Comment.countDocuments({
      resource_type: 'song',
      resource_id: songId
    });

    // 3. 分页查询评论（按时间倒序）
    const comments = await Comment.find({
      resource_type: 'song',
      resource_id: songId
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(pageSize))
    .select('username content createdAt likeCount'); // 只返回需要的字段

    console.log(`[${getNow()}] 📖 获取歌曲评论成功 - 歌曲ID：${songId} | 总数量：${total} | 分页数量：${comments.length}`);
    res.json({
      code: 200,
      data: {
        comments,
        pagination: { 
          page: Number(page), 
          pageSize: Number(pageSize), 
          total, 
          totalPages: Math.ceil(total / pageSize) 
        }
      },
      msg: '获取歌曲评论成功'
    });
  } catch (err) { next(err); }
});

// 10.6.4 获取单曲评论列表（分页，按时间倒序）
app.get('/api/singles/:singleId/comments', async (req, res, next) => {
  try {
    const { singleId } = req.params;
    const { page = 1, pageSize = 20 } = req.query;
    const skip = (page - 1) * pageSize;

    console.log(`[${getNow()}] 📖 获取单曲评论 - 单曲ID：${singleId} | 页码：${page} | 页大小：${pageSize}`);

    // 1. 校验单曲是否存在
    const singleExist = await Single.findOne({ id: singleId });
    if (!singleExist) throw new AppError('单曲不存在', 404);

    // 2. 查询评论总数
    const total = await Comment.countDocuments({
      resource_type: 'single',
      resource_id: singleId
    });

    // 3. 分页查询评论（按时间倒序）
    const comments = await Comment.find({
      resource_type: 'single',
      resource_id: singleId
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(pageSize))
    .select('username content createdAt likeCount'); // 只返回需要的字段

    console.log(`[${getNow()}] 📖 获取单曲评论成功 - 单曲ID：${singleId} | 总数量：${total} | 分页数量：${comments.length}`);
    res.json({
      code: 200,
      data: {
        comments,
        pagination: { 
          page: Number(page), 
          pageSize: Number(pageSize), 
          total, 
          totalPages: Math.ceil(total / pageSize) 
        }
      },
      msg: '获取单曲评论成功'
    });
  } catch (err) { next(err); }
});
// ===================== 评论接口结束 =====================

// 11. 挂载错误处理中间件
app.use(errorHandler);

// 12. 最终版启动逻辑（修复端口监听注释错误，保留原有所有逻辑）
async function startServer() {
  try {
    // 仅一次MongoDB连接
    await mongoose.connect(MONGODB_URL);
    console.log(`[${getNow()}] ✅ MongoDB连接成功（数据库：tao_zhe_official）`);
    console.log(`[${getNow()}] 📌 MongoDB连接状态：已连接（状态码：${mongoose.connection.readyState}）`);

    // 启动服务器，绑定0.0.0.0:3000（修正原有注释错误，PORT是3000）
    const server = app.listen(PORT, '0.0.0.0', async () => {
      console.log(`[${getNow()}] 🎉 服务器已启动：http://0.0.0.0:${PORT}`);
      // 执行数据入库，捕获错误
      try {
        //await initData();
      } catch (initErr) {
        console.error(`[${getNow()}] ❌ 数据入库失败：`, initErr.stack);
      }
    });

    // 监听服务器错误（如端口占用）
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[${getNow()}] ❌ 端口 ${PORT} 已被占用，请更换端口（如3002）`);
      } else {
        console.error(`[${getNow()}] ❌ 服务器运行错误：`, err.stack);
      }
      process.exit(1);
    });

  } catch (err) {
    console.error(`[${getNow()}] ❌ 启动失败：`, err.stack);
    process.exit(1);
  }
}

// 执行启动函数
startServer();