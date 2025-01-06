const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const userRouter = require("./routers/userRouter");
const postRouter = require("./routers/postRouter");
const RoomModel = require("./schemas/roomSchema");
const UserModel = require("./schemas/userSchema");
const jwt = require("jsonwebtoken");
const withAuth = require("./middleware/withAuth");
require("dotenv").config();

const app = express();
app.use(
  cors({
    origin: process.env.FRONTEND_URL,
  })
);
app.use(express.json({ limit: "10mb" }));
mongoose
  .connect(process.env.MONGODB_URI, { maxIdleTimeMS: 60000 })
  .then(() => console.log("db connected"));
app.use("/user", userRouter);
app.use("/post", postRouter);
app.listen(process.env.PORT, () =>
  console.log("listening on port " + process.env.PORT)
);
app.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;
    const { userId } = await jwt.verify(token, process.env.SECRET);
    res.status(200).json({ valid: true, userId });
  } catch (err) {
    res.status(401).json({ valid: false, error: err.message });
  }
});

app.use(withAuth);
