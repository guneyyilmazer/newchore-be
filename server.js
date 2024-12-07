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
    origin: "http://localhost:3000",
    optionsSuccessStatus: 200,
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

const findTheRoom = async (userId, room, chattingWith) => {
  const privateRoom = userId + " " + chattingWith;
  const secondPrivateRoom = chattingWith + " " + userId;
  //checking both scenarios to find the privateRoom
  const firstTry = await RoomModel.findOne({ name: privateRoom });
  const secondTry = await RoomModel.findOne({ name: secondPrivateRoom });

  const roomInDB = await RoomModel.findOne({
    name: firstTry ? privateRoom : secondTry ? secondPrivateRoom : room,
  });
  return roomInDB;
};
const getMessagesReady = async (messages) => {
  try {
    //this function gets the profile picture and username values from the db and formats the date
    const list = messages.map(async (item) => {
      const newList = item.seenBy.map(async (object) => {
        const { profilePicture, username } = await UserModel.findOne({
          _id: object.userId,
        });
        return { userId: object.userId, username, profilePicture };
      });
      item.newSeenBy = await Promise.all(newList);
      const { profilePicture } = await UserModel.findOne({
        _id: item.sender.userId,
      });
      const sentAt =
        (item.sent.getHours().toString().length == 1
          ? "0".concat(item.sent.getHours().toString())
          : item.sent.getHours().toString()) +
        ":" +
        (item.sent.getMinutes().toString().length == 1
          ? "0".concat(item.sent.getMinutes().toString())
          : item.sent.getMinutes().toString());
      return {
        sent: sentAt,
        sender: item.sender,
        content: item.content,
        pictures: item.pictures,
        profilePicture,
        seenBy: item.newSeenBy,
      };
    });
    return await Promise.all(list);
  } catch (err) {
    console.log(err.message);
  }
};

app.use(withAuth);

app.post("/loadRoom", async (req, res) => {
  try {
    const date = new Date();
    const { room, chattingWith, userId, page } = req.body;
    const roomInDB = await findTheRoom(req.userId, room, chattingWith);
    if (!roomInDB) {
      throw new Error("Room is empty.");
    }

    const { messages } = roomInDB;

    const newMessages = messages.map((item) => {
      const doWeAlreadyHave = item.seenBy.filter(
        (item) => item.userId == userId
      );
      if (doWeAlreadyHave.length == 0) {
        item.seenBy = [...item.seenBy, { userId, time: date }];
      }

      return {
        sent: item.sent,
        sender: item.sender,
        content: item.content,
        pictures: item.pictures,
        profilePicture: item.profilePicture,
        seenBy: item.seenBy,
      };
    });
    await RoomModel.findOneAndUpdate(
      { name: roomInDB.name },
      { messages: newMessages }
    );

    const amount = 10;
    if (messages.length - page * amount < 0) {
      if (!(Math.abs(messages.length - page * amount) > amount)) {
        const limit = messages.slice(0, messages.length - (page - 1) * amount);
        const readyMessages = await getMessagesReady(limit);
        res.status(200).json({ messages: readyMessages });
      } else {
        throw new Error("Don't have any messages left.");
      }
    } else {
      const limit = messages.slice(
        messages.length - page * amount,
        messages.length - (page - 1) * amount
      );
      const readyMessages = await getMessagesReady(limit);
      res.status(200).json({ messages: readyMessages });
    }
  } catch (err) {
    console.log(err.message);
    if (err.message == "Room is empty.") {
      res.status(400).json({ error: err.message, roomIsEmpty: true });
    } else {
      res.status(400).json({ error: err.message });
    }
  }
});
app.post("/loadRooms", async (req, res) => {
  try {
    const { page, amount } = req.body;
    if (!page || !amount) {
      throw new Error("You need to specify the page and the amount.");
    }

    const rooms = await RoomModel.find({ privateRoom: false })
      .limit(amount)
      .skip((page - 1) * amount)
      .select("name");
    const allRooms = await RoomModel.find({ privateRoom: false })
      .limit(amount + 1)
      .select("name");

    res.status(200).json({
      rooms,
      loadedAll: allRooms.length == amount ? true : false,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/findRoom", async (req, res) => {
  try {
    const { room } = req.body;

    const Rooms = await RoomModel.find({
      name: { $regex: room, $options: "i" },
      privateRoom: false,
    })
      .limit(20)
      .select("name");
    const filter = Rooms.filter(
      (item) => item.name.includes(room) && !item.privateRoom
    );
    res
      .status(200)
      .json({ rooms: filter, notFound: filter.length == 0 ? true : false });
  } catch (err) {
    console.log(err.message);

    res.status(401).json({ error: err.message });
  }
});

app.post("/loadPrivateRooms", async (req, res) => {
  try {
    const limit = 10;
    const rooms = await RoomModel.find({ "users.userId": req.userId })
      .limit(limit)
      .select("name users messages");
    const newList = rooms.map(async (item) => {
      const withProfilePictureAndUsername = item.users.map(async (item) => {
        const user = await UserModel.findOne({
          _id: item.userId,
        });
        console.log(user);
        return {
          userId: item.userId,
          profilePicture: user ? user.profilePicture : "",
          username: user ? user.username : "",
        };
      });
      const usersWithProfilePictureAndUsername = await Promise.all(
        withProfilePictureAndUsername
      );
      const lastMessage = item.messages[item.messages.length - 1];
      const formattedSentTime =
        (lastMessage.sent.getHours().toString().length == 1
          ? "0".concat(lastMessage.sent.getHours().toString())
          : lastMessage.sent.getHours().toString()) +
        ":" +
        (lastMessage.sent.getMinutes().toString().length == 1
          ? "0".concat(lastMessage.sent.getMinutes().toString())
          : lastMessage.sent.getMinutes().toString());
      lastMessage.sent = formattedSentTime;
      return {
        name: item.name,
        lastMessage: {
          sender: lastMessage.sender,
          content: lastMessage.content,
          sent: formattedSentTime,
          seenBy: lastMessage.seenBy.map((item) => item.userId),
        },
        users: usersWithProfilePictureAndUsername,
      };
    });
    const roomsWithProfilePictures = await Promise.all(newList);
    res.status(200).json({ rooms: roomsWithProfilePictures });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
