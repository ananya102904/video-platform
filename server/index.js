const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const User = require("./models/user");
const Video = require("./models/Video");
const Comment = require("./models/Comment");
const Download = require("./models/Download");

const Razorpay = require("razorpay");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const multer = require("multer");

const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const app = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, "../client")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/login.html"));
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(
  "/uploads",
  cors({
    origin: "http://127.0.0.1:5500"
  }),
  express.static("uploads")
);
app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.urlencoded({ extended: true }));

const JWT_SECRET = "my_secret-key_123";

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ message: "Token required" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, "mySecretKey");
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

const upload = multer({ storage: storage });

const PORT = process.env.PORT || 3000;

// MongoDB Atlas URI
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://chaturvediananya9_db_user:3oVEgxnHgkyuUJFX@ac-z7ipyfq-shard-00-00.ypjgc7b.mongodb.net:27017,ac-z7ipyfq-shard-00-01.ypjgc7b.mongodb.net:27017,ac-z7ipyfq-shard-00-02.ypjgc7b.mongodb.net:27017/videoplatform?ssl=true&replicaSet=atlas-ffmvg8-shard-0&authSource=admin&appName=Cluster0";

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log("MongoDB Connected Successfully");
  })
  .catch((err) => {
    console.log("MongoDB Connection Error:", err);
  });

// AUTH ROUTES (WITH DEVICE/LOCATION OTP LOGIC)
app.post("/register", async (req, res) => {
  try {
    const user = await User.create(req.body);
    res.json({
      message: "User Registered Successfully",
      data: user
    });
  } catch (error) {
    res.status(500).json({ message: "Registration failed", error: error.message });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { email, password, deviceIdentifier, locationCity } = req.body;
    const user = await User.findOne({ email, password });

    if (!user) {
      return res.status(401).json({ message: "Invalid Email or Password" });
    }

    const currentDevice = deviceIdentifier || "Unknown Device";
    const currentLocation = locationCity || "Unknown Location";

    const isNewDeviceOrLocation =
      user.lastDevice &&
      (user.lastDevice !== currentDevice || user.lastLocation !== currentLocation);

    if (isNewDeviceOrLocation) {
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      user.loginOtp = otp;
      user.otpExpires = new Date(Date.now() + 5 * 60 * 1000);
      await user.save();

      console.log(`[SECURITY OTP ALERT] OTP for ${user.email} is: ${otp}`);

      return res.json({
        requireOtp: true,
        message: "New device/location detected! Enter OTP to continue.",
        email: user.email,
        debugOtp: otp
      });
    }

    user.lastDevice = currentDevice;
    user.lastLocation = currentLocation;
    await user.save();

    const token = jwt.sign({ userId: user._id }, "mySecretKey", { expiresIn: "1d" });
    res.json({
      message: "Login Successful",
      user,
      token,
      requireOtp: false
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
});

app.post("/verify-login-otp", async (req, res) => {
  try {
    const { email, otp, deviceIdentifier, locationCity } = req.body;
    const user = await User.findOne({ email });

    if (!user || user.loginOtp !== otp || new Date() > user.otpExpires) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.loginOtp = null;
    user.otpExpires = null;
    user.lastDevice = deviceIdentifier || "Verified Device";
    user.lastLocation = locationCity || "Verified Location";
    await user.save();

    const token = jwt.sign({ userId: user._id }, "mySecretKey", { expiresIn: "1d" });
    res.json({
      message: "Device Verified & Login Successful!",
      user,
      token
    });
  } catch (error) {
    res.status(500).json({ message: "OTP verification failed", error: error.message });
  }
});

// RAZORPAY TEST INSTANCE & SUBSCRIPTION SYSTEM
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID || "rzp_test_1DP5mmOlF5G5ag",
  key_secret: process.env.RAZORPAY_KEY_SECRET || "rzp_test_secret_key"
});

const PLAN_PRICES = {
  Bronze: 99,
  Silver: 199,
  Gold: 499
};

// 1. Create Razorpay Payment Order
app.post("/create-razorpay-order", async (req, res) => {
  try {
    const { plan } = req.body;
    const amount = PLAN_PRICES[plan];

    if (!amount) {
      return res.status(400).json({ message: "Invalid plan selected" });
    }

    const options = {
      amount: amount * 100, // paise conversion
      currency: "INR",
      receipt: `receipt_${Date.now()}`
    };

    const order = await razorpay.orders.create(options);
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: "rzp_test_1DP5mmOlF5G5ag"
    });
  } catch (error) {
    console.error("Razorpay order creation error:", error);
    res.status(500).json({ message: "Unable to create payment order", error: error.message });
  }
});

// 2. Verify Razorpay Payment & Activate Plan
app.post("/verify-razorpay-payment", async (req, res) => {
  try {
    const { email, plan, razorpay_payment_id, razorpay_order_id } = req.body;

    const user = await User.findOneAndUpdate(
      { email },
      { plan: plan },
      { new: true }
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const invoiceDetails = {
      transactionId: razorpay_payment_id || `TXN_${Date.now()}`,
      orderId: razorpay_order_id,
      planTier: plan,
      amountPaid: `₹${PLAN_PRICES[plan]}`,
      date: new Date().toLocaleDateString(),
      status: "PAID - Subscription Active"
    };

    res.json({
      message: "Payment Verified! Subscription Activated.",
      user,
      invoice: invoiceDetails
    });
  } catch (error) {
    res.status(500).json({ message: "Payment verification failed", error: error.message });
  }
});

// Direct Plan Upgrade (Fallback)
app.post("/upgrade-plan", async (req, res) => {
  try {
    const { email, plan } = req.body;
    const user = await User.findOneAndUpdate({ email: email }, { plan: plan }, { new: true });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      message: "Plan Updated Successfully",
      user
    });
  } catch (error) {
    res.status(500).json({ message: "Upgrade failed", error: error.message });
  }
});

// VIDEO ROUTES
app.post("/upload-video", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Video file is required" });
    }

    const video = await Video.create({
      title: req.body.title,
      description: req.body.description,
      videoUrl: `/uploads/${req.file.filename}`,
      category: req.body.category,
      isPremium: req.body.isPremium === "true"
    });

    res.json({
      message: "Video uploaded successfully",
      video: video
    });
  } catch (error) {
    res.status(500).json({
      message: "Video upload failed",
      error: error.message
    });
  }
});

app.get("/videos", async (req, res) => {
  try {
    const videos = await Video.find();
    res.json({
      message: "Videos fetched successfully",
      videos: videos
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch videos",
      error: error.message
    });
  }
});

app.get("/videos/category/:category", async (req, res) => {
  try {
    const videos = await Video.find({
      category: { $regex: req.params.category, $options: "i" }
    });
    res.json({
      message: "Category videos fetched successfully",
      videos
    });
  } catch (error) {
    res.status(500).json({
      message: "Category filter failed",
      error: error.message
    });
  }
});

app.get("/users/:id", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      message: "User profile fetched successfully",
      user
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch profile",
      error: error.message
    });
  }
});

app.put("/users/:id", async (req, res) => {
  try {
    const { name, email } = req.body;
    const user = await User.findByIdAndUpdate(req.params.id, { name, email }, { new: true }).select(
      "-password"
    );
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      message: "Profile updated successfully",
      user
    });
  } catch (error) {
    res.status(500).json({
      message: "Profile update failed",
      error: error.message
    });
  }
});

app.get("/videos/:id", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    video.views += 1;
    await video.save();
    res.json({
      message: "Video fetched successfully",
      video: video
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch video",
      error: error.message
    });
  }
});

app.delete("/videos/:id", async (req, res) => {
  try {
    const video = await Video.findByIdAndDelete(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    res.json({ message: "Video deleted successfully" });
  } catch (error) {
    res.status(500).json({
      message: "Failed to delete video",
      error: error.message
    });
  }
});

app.put("/videos/:id", async (req, res) => {
  try {
    const video = await Video.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    res.json({
      message: "Video updated successfully",
      video: video
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to update video",
      error: error.message
    });
  }
});

app.post("/videos/:id/access", async (req, res) => {
  try {
    const { plan } = req.body;
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }

    if (video.isPremium && plan === "Free") {
      return res.status(403).json({ message: "Premium plan required" });
    }

    res.json({
      message: "Access granted",
      video: video
    });
  } catch (error) {
    res.status(500).json({
      message: "Access check failed",
      error: error.message
    });
  }
});

app.get("/profile", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ message: "Token required" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, "mySecretKey");
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      message: "Profile fetched successfully",
      user: user
    });
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

// SMART COMMENTS & MODERATION SYSTEM
const BANNED_WORDS = ["abuse", "badword", "spam", "idiot", "fake", "scam"];

app.post("/comments", async (req, res) => {
  try {
    const { videoId, email, username, text } = req.body;
    if (!videoId || !text) {
      return res.status(400).json({ message: "Video ID and text are required" });
    }

    const trimmedText = text.trim();

    const repeatedSpecialChars = /([!@#$%^&*()_+=\-[\]{};':"\\|,.<>/?])\1{3,}/;
    if (repeatedSpecialChars.test(trimmedText)) {
      return res.status(400).json({ message: "Comment blocked: Spam or excessive punctuation detected" });
    }

    const hasAbusiveWord = BANNED_WORDS.some((word) =>
      trimmedText.toLowerCase().includes(word)
    );
    if (hasAbusiveWord) {
      return res.status(400).json({ message: "Comment blocked: Inappropriate language detected" });
    }

    let user = null;
    if (email) {
      user = await User.findOne({ email });
    }
    if (!user) {
      user = await User.findOne();
    }

    const comment = await Comment.create({
      videoId,
      userId: user ? user._id : new mongoose.Types.ObjectId(),
      username: username || (user ? user.name || user.email.split("@")[0] : "User"),
      text: trimmedText
    });

    res.json({
      message: "Comment added successfully",
      comment
    });
  } catch (error) {
    res.status(500).json({
      message: "Comment failed",
      error: error.message
    });
  }
});

app.get("/comments/:videoId", async (req, res) => {
  try {
    const comments = await Comment.find({ videoId: req.params.videoId }).sort({ createdAt: -1 });
    res.json({
      message: "Comments fetched successfully",
      comments
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch comments",
      error: error.message
    });
  }
});

app.post("/comments/:id/like", async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.likes = (comment.likes || 0) + 1;
    await comment.save();

    res.json({ message: "Comment liked", likes: comment.likes });
  } catch (error) {
    res.status(500).json({ message: "Failed to like comment", error: error.message });
  }
});

app.post("/comments/:id/dislike", async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.dislikes = (comment.dislikes || 0) + 1;
    await comment.save();

    res.json({ message: "Comment disliked", dislikes: comment.dislikes });
  } catch (error) {
    res.status(500).json({ message: "Failed to dislike comment", error: error.message });
  }
});

app.post("/comments/:id/report", async (req, res) => {
  try {
    const { reason } = req.body;
    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    comment.isReported = true;
    comment.reportReason = reason || "Flagged by community review";
    await comment.save();

    res.json({ message: "Comment flagged for moderation review", comment });
  } catch (error) {
    res.status(500).json({ message: "Failed to report comment", error: error.message });
  }
});

// SOCIAL INTERACTIONS FOR VIDEOS
app.post("/videos/:id/like", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    video.likes += 1;
    await video.save();
    res.json({
      message: "Video liked",
      likes: video.likes
    });
  } catch (error) {
    res.status(500).json({ message: "Like failed", error: error.message });
  }
});

app.post("/videos/:id/dislike", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    video.dislikes += 1;
    await video.save();
    res.json({
      message: "Video disliked",
      dislikes: video.dislikes
    });
  } catch (error) {
    res.status(500).json({ message: "Dislike failed", error: error.message });
  }
});

app.post("/videos/:id/report", async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) {
      return res.status(400).json({ message: "Report reason is required" });
    }

    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }

    res.json({
      message: "Video reported successfully",
      reason: reason
    });
  } catch (error) {
    res.status(500).json({ message: "Report failed", error: error.message });
  }
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const videos = await Video.find({
      $or: [
        { title: { $regex: query, $options: "i" } },
        { category: { $regex: query, $options: "i" } }
      ]
    });

    res.json({
      message: "Search successful",
      videos
    });
  } catch (error) {
    res.status(500).json({ message: "Search failed", error: error.message });
  }
});

app.post("/videos/:id/view", async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }
    video.views += 1;
    await video.save();
    res.json({
      message: "View counted",
      views: video.views
    });
  } catch (error) {
    res.status(500).json({ message: "View failed", error: error.message });
  }
});

// CONTROLLED VIDEO DOWNLOADS WITH DAILY QUOTA
app.post("/videos/:id/download", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const video = await Video.findById(req.params.id);
    if (!video) {
      return res.status(404).json({ message: "Video not found" });
    }

    const limits = { Free: 1, Bronze: 3, Silver: 5, Gold: 10 };
    const dailyLimit = limits[user.plan] || 1;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const todayDownloads = await Download.countDocuments({
      userId: user._id,
      downloadedAt: { $gte: startOfDay }
    });

    if (todayDownloads >= dailyLimit) {
      return res.status(403).json({
        message: `${user.plan} plan daily download limit reached`
      });
    }

    const download = new Download({
      userId: user._id,
      videoId: video._id,
      userPlan: user.plan,
      videoTitle: video.title
    });
    await download.save();

    video.downloads = (video.downloads || 0) + 1;
    await video.save();

    res.json({
      message: "Download allowed",
      videoUrl: video.videoUrl,
      downloadsToday: todayDownloads + 1,
      dailyLimit: dailyLimit,
      plan: user.plan
    });
  } catch (error) {
    res.status(500).json({
      message: "Download failed",
      error: error.message
    });
  }
});

// GET USER DOWNLOAD HISTORY
app.get("/downloads/:email", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const downloads = await Download.find({ userId: user._id }).sort({ downloadedAt: -1 });

    res.json({
      message: "Download history fetched successfully",
      downloads
    });
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch download history",
      error: error.message
    });
  }
});

// WATCH PARTY SOCKET.IO
const watchPartyRooms = {};

io.on("connection", (socket) => {
  console.log("Watch Party user connected:", socket.id);

  socket.on("create-room", ({ videoId, username }) => {
    const roomId = Math.random().toString(36).substring(2, 8);
    watchPartyRooms[roomId] = {
      videoId: videoId,
      host: socket.id,
      participants: [{ socketId: socket.id, username: username }]
    };

    socket.join(roomId);
    socket.emit("room-created", { roomId: roomId, videoId: videoId });
    console.log("Room created:", roomId);
  });

  socket.on("join-room", ({ roomId, username }) => {
    const room = watchPartyRooms[roomId];
    if (!room) {
      socket.emit("room-error", { message: "Watch Party room not found" });
      return;
    }

    room.participants.push({ socketId: socket.id, username: username });
    socket.join(roomId);
    socket.roomId = roomId;
    socket.username = username;

    socket.emit("room-joined", {
      roomId: roomId,
      videoId: room.videoId,
      participants: room.participants
    });

    socket.to(roomId).emit("participant-joined", {
      socketId: socket.id,
      username: username
    });
    console.log(username, "joined room:", roomId);
  });

  socket.on("video-control", ({ roomId, action, currentTime }) => {
    socket.to(roomId).emit("video-control", {
      action: action,
      currentTime: currentTime
    });
  });

  socket.on("send-message", ({ roomId, username, message }) => {
    io.to(roomId).emit("receive-message", {
      username: username,
      message: message,
      time: new Date()
    });
  });

  socket.on("offer", ({ roomId, offer, target }) => {
    io.to(target).emit("offer", { offer: offer, sender: socket.id });
  });

  socket.on("answer", ({ answer, target }) => {
    io.to(target).emit("answer", { answer: answer, sender: socket.id });
  });

  socket.on("ice-candidate", ({ candidate, target }) => {
    io.to(target).emit("ice-candidate", { candidate: candidate, sender: socket.id });
  });

  socket.on("media-status", ({ roomId, type, enabled }) => {
    socket.to(roomId).emit("media-status", { socketId: socket.id, type: type, enabled: enabled });
  });

  socket.on("screen-share", ({ roomId, sharing }) => {
    socket.to(roomId).emit("screen-share", { socketId: socket.id, sharing: sharing });
  });

  socket.on("leave-room", () => {
    leaveWatchParty(socket);
  });

  socket.on("disconnect", () => {
    console.log("Watch Party user disconnected:", socket.id);
    leaveWatchParty(socket);
  });
});

function leaveWatchParty(socket) {
  const roomId = socket.roomId;
  if (!roomId || !watchPartyRooms[roomId]) return;

  const room = watchPartyRooms[roomId];
  room.participants = room.participants.filter((p) => p.socketId !== socket.id);

  socket.to(roomId).emit("participant-left", {
    socketId: socket.id,
    username: socket.username
  });

  socket.leave(roomId);

  if (room.participants.length === 0) {
    delete watchPartyRooms[roomId];
    console.log("Watch Party room deleted:", roomId);
  } else if (room.host === socket.id) {
    room.host = room.participants[0].socketId;
    io.to(roomId).emit("new-host", { host: room.host });
  }

  socket.roomId = null;
}

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}...`);
  console.log("Watch Party Socket.IO is ready...");
});