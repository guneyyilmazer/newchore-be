const UserModel = require("../schemas/userSchema");
const PostModel = require("../schemas/postSchema");
const jwt = require("jsonwebtoken");
const { getPostedTimeAgoText } = require("./postController");
const { jobTypes } = require("../jobTypes");
require("dotenv").config();

const genToken = (userId, username) => {
  return jwt.sign({ userId, username }, process.env.SECRET, {
    expiresIn: "7d",
  });
};
const Signup = async (req, res) => {
  try {
    const {
      type,
      location,
      freelancerDetails = {},
      username,
      email,
      password,
      profilePicture,
    } = req.body;

    if (username.length <= 4) {
      return res
        .status(401)
        .json({ error: "Username must be at least 5 characters long." });
    }

    if (
      type.freelancer &&
      (!freelancerDetails.hourlyWage || freelancerDetails.hourlyWage === 0)
    ) {
      freelancerDetails.hourlyWage = 15; // Default hourly wage for freelancers
    }

    const userId = await UserModel.signup(
      type,
      location,
      freelancerDetails,
      username,
      email,
      password,
      profilePicture
    );

    const token = genToken(userId, username);
    res.status(200).json({ AuthValidation: token });
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ error: err.message });
  }
};

const Login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res
        .status(400)
        .json({ error: "Username and password are required." });
    }

    const userId = await UserModel.login(username, password);
    const token = genToken(userId, username);
    res.status(200).json({ AuthValidation: token });
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ error: err.message });
  }
};
const getFreelancers = async (req, res) => {
  try {
    const {
      wage,
      hourlyBetween,
      username,
      state,
      city,
      page = 1,
      amount = 10,
      type,
    } = req.body;

    // Validate job type
    const jobTypeKey = Object.keys(type || {})[0];
    if (!type.random && !jobTypes.includes(jobTypeKey)) {
      throw new Error("Job type is invalid");
    }

    const typeString = `freelancerDetails.jobType.${jobTypeKey}`;
    const locationFilter = {
      "location.state": state ? state : { $not: /^0.*/ },
      "location.city": city ? city : { $not: /^0.*/ },
    };

    const wageFilter =
      wage && wage !== 0 && wage !== -1 && wage !== -2
        ? wage
        : wage === -2
        ? { $gt: hourlyBetween[0], $lt: hourlyBetween[1] }
        : { $gt: 0 };

    const query = {
      accountType: { freelancer: true },
      ...locationFilter,
      username: username
        ? { $regex: username, $options: "i" }
        : { $not: /^0.*/ },
      "freelancerDetails.hourlyWage": wageFilter,
    };

    if (!type.random) {
      query[typeString] = true;
    }

    // Fetch freelancers
    const freelancers = await UserModel.find(query)
      .select(
        "username _id profilePicture location freelancerDetails accountType"
      )
      .skip((page - 1) * amount)
      .limit(amount);

    const lastFreelancers = await UserModel.find(query)
      .select(
        "username _id profilePicture location freelancerDetails accountType"
      )
      .skip((page - 1) * amount);

    // Calculate star ratings for freelancers
    const freelancerWithStars = await Promise.all(
      freelancers.map(async (freelancer) => {
        const posts = await PostModel.find({
          hiredFreelancer: freelancer._id,
        }).select("reviews");

        const stars = posts
          .filter((post) => typeof post.reviews?.hirerReview?.star === "number")
          .map((post) => post.reviews.hirerReview.star);

        const starAverage =
          stars.length > 0
            ? stars.reduce((acc, current) => acc + current, 0) / stars.length
            : 0;

        return {
          username: freelancer.username,
          _id: freelancer._id,
          profilePicture: freelancer.profilePicture,
          location: freelancer.location,
          freelancerDetails: {
            ...freelancer.freelancerDetails,
            starAverage,
          },
          accountType: freelancer.accountType,
        };
      })
    );

    // Pagination metadata
    const lastPage = lastFreelancers.length < amount;
    const pagesCount = Math.ceil(freelancers.length / amount);

    res.status(200).json({
      freelancers: freelancerWithStars,
      lastPage,
      pagesCount,
    });
  } catch (err) {
    console.error(err.message);
    res.status(400).json({ error: err.message });
  }
};
const LoadUser = async (req, res) => {
  try {
    const { userId, token } = req.body;

    if (userId || token) {
      const id = userId ? userId : jwt.verify(token, process.env.SECRET).userId;

      const user = await UserModel.findById(id);
      if (!user) throw new Error("User not found");

      let starAverage = null;

      // Calculate star average only for freelancers
      if (user.accountType.freelancer) {
        const posts = await PostModel.find({ hiredFreelancer: id });
        const stars = posts
          .filter((post) => typeof post.reviews?.hirerReview?.star === "number")
          .map((post) => post.reviews.hirerReview.star);

        starAverage =
          stars.length > 0
            ? stars.reduce((acc, current) => acc + current, 0) / stars.length
            : 0;
      }

      res.status(200).json({
        username: user.username,
        userId: user._id,
        profilePicture: user.profilePicture,
        location: user.location,
        freelancerDetails: {
          jobType: user.freelancerDetails?.jobType,
          hourlyWage: user.freelancerDetails?.hourlyWage,
          aboutMe: user.freelancerDetails?.aboutMe,
          starAverage, // Includes null for non-freelancers
        },
        accountType: user.accountType,
      });
    } else {
      throw new Error("Invalid request: userId or token must be provided");
    }
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ error: err.message });
  }
};

const FindUsers = async (req, res) => {
  try {
    const { username } = req.body;

    if (!username || username.trim().length === 0) {
      throw new Error("Username is required");
    }

    const users = await UserModel.find({
      username: { $regex: username, $options: "i" },
    })
      .limit(50)
      .select("username profilePicture");

    const filteredUsers = users.filter((user) =>
      user.username.includes(username)
    );

    res.status(200).json({
      users: filteredUsers,
      notFound: filteredUsers.length === 0,
    });
  } catch (err) {
    console.error(err.message);
    res.status(401).json({ error: err.message });
  }
};
const UpdateProfilePicture = async (req, res) => {
  try {
    const { userId, profilePicture } = req.body;

    // Token verification is already handled by middleware; no need to recheck.
    const updatedUser = await UserModel.findOneAndUpdate(
      { _id: userId },
      { profilePicture },
      { new: true }
    );

    if (!updatedUser) throw new Error("User not found");

    res.status(200).json({ user: updatedUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const UpdateUsername = async (req, res) => {
  try {
    const { username, newUsername } = req.body;

    const user = await UserModel.findOne({ username });
    if (!user) throw new Error("User not found");
    if (user._id.toString() !== req.userId.toString())
      throw new Error("Unauthorized update attempt");

    const updatedUser = await UserModel.findOneAndUpdate(
      { username },
      { username: newUsername },
      { new: true }
    );

    res.status(200).json({ user: updatedUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const UpdateEmail = async (req, res) => {
  try {
    const { userId, newEmail } = req.body;

    const user = await UserModel.findById(userId);
    if (!user) throw new Error("User not found");
    if (user._id.toString() !== req.userId.toString())
      throw new Error("Unauthorized update attempt");

    const updatedUser = await UserModel.findOneAndUpdate(
      { _id: userId },
      { email: newEmail },
      { new: true }
    );

    res.status(200).json({ user: updatedUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const ChangeProfile = async (req, res) => {
  try {
    const { location, freelancerDetails, username } = req.body;

    if (freelancerDetails?.aboutMe?.length > 100) {
      throw new Error("About me must be under 100 characters");
    }

    const existingUser = await UserModel.findOne({ username });
    if (existingUser && existingUser._id.toString() !== req.userId.toString()) {
      throw new Error(
        process.env.ERR_TAKEN_USERNAME || "Username is already taken"
      );
    }

    const updatedUser = await UserModel.findOneAndUpdate(
      { _id: req.userId },
      { location, freelancerDetails, username },
      { new: true }
    );

    res
      .status(200)
      .json({ message: "Profile updated successfully", user: updatedUser });
  } catch (err) {
    res.status(400).json({ error: err.message });
    console.error(err.message);
  }
};
const getSavedPosts = async (req, res) => {
  try {
    const user = await UserModel.findById(req.userId);
    if (!user) throw new Error("User not found");

    const savedPosts = await Promise.all(
      user.freelancerDetails.savedPosts.map(async (id) => {
        const post = await PostModel.findById(id);
        if (!post) return null;

        return {
          location: post.location,
          _id: post._id,
          user: post.user,
          title: post.title,
          description: post.description,
          type: post.type,
          skillLevel: post.skillLevel,
          hourly: post.hourly,
          price: post.price,
          picture: post.picture,
          pictures: post.pictures,
          availability: post.availability,
          applicants: post.applicants,
          completed: post.completed,
          hiredFreelancer: post.hiredFreelancer,
          hired: post.hired,
          reviews: post.reviews,
          createdAt: formatDate(post.createdAt),
          updatedAt: formatDate(post.updatedAt),
          postedTimeAgoText: getPostedTimeAgoText(post.createdAt),
        };
      })
    );

    res.status(200).json({ posts: savedPosts.filter((post) => post !== null) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getAppliedPosts = async (req, res) => {
  try {
    const { page = 1, amount = 10 } = req.body;

    const posts = await PostModel.find({ applicants: req.userId })
      .skip((page - 1) * amount)
      .limit(amount);

    const totalPosts = await PostModel.countDocuments({
      applicants: req.userId,
    });
    const lastPage = totalPosts <= page * amount;

    const postsWithDates = posts.map((post) => ({
      location: post.location,
      _id: post._id,
      user: post.user,
      title: post.title,
      description: post.description,
      type: post.type,
      skillLevel: post.skillLevel,
      hourly: post.hourly,
      price: post.price,
      picture: post.picture,
      pictures: post.pictures,
      availability: post.availability,
      completed: post.completed,
      hired: post.hired,
      hiredFreelancer: post.hiredFreelancer,
      reviews: post.reviews,
      createdAt: formatDate(post.createdAt),
      updatedAt: formatDate(post.updatedAt),
      postedTimeAgoText: getPostedTimeAgoText(post.createdAt),
    }));

    res.status(200).json({
      posts: postsWithDates,
      lastPage,
      pagesCount: Math.ceil(totalPosts / amount),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// Helper function to format dates
const formatDate = (date) => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
  hour: date.getHours(),
  minutes: date.getMinutes(),
});
const savePost = async (req, res) => {
  try {
    const { id } = req.body;
    const { freelancerDetails } = await UserModel.findOne({ _id: req.userId });
    if (freelancerDetails.savedPosts.includes(id)) {
      throw new Error("Post is already saved!");
    }
    freelancerDetails.savedPosts.push(id);
    await UserModel.findOneAndUpdate(
      { _id: req.userId },
      { "freelancerDetails.savedPosts": freelancerDetails.savedPosts }
    );
    res.status(200).json({ msg: "Successfully saved post." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const deleteSavedPost = async (req, res) => {
  try {
    const { id } = req.body;
    const { freelancerDetails } = await UserModel.findOne({ _id: req.userId });
    freelancerDetails.savedPosts = freelancerDetails.savedPosts.filter(
      (post) => post != id
    );
    await UserModel.findOneAndUpdate(
      { _id: req.userId },
      { "freelancerDetails.savedPosts": freelancerDetails.savedPosts }
    );
    res.status(200).json({ msg: "Successfully deleted post from saved list." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getPosts = async (req, res, query) => {
  try {
    const { id, completed, hired, page, amount } = req.body;
    const posts = await PostModel.find(query).skip((page - 1) * amount);
    const lastPosts = await PostModel.find(query)
      .skip((page - 1) * amount)
      .select("title");

    const lastPage = lastPosts.length < amount;
    const pagesCount = Math.max(Math.floor(posts.length / amount), 1);

    const postsWithDates = posts.map((post) => ({
      location: post.location,
      _id: post._id,
      user: post.user,
      title: post.title,
      description: post.description,
      type: post.type,
      skillLevel: post.skillLevel,
      hourly: post.hourly,
      price: post.price,
      picture: post.picture,
      pictures: post.pictures,
      availability: post.availability,
      applicants: post.applicants,
      completed: post.completed,
      hired: post.hired,
      hiredFreelancer: post.hiredFreelancer,
      reviews: post.reviews,
      createdAt: getFormattedDate(post.createdAt),
      updatedAt: getFormattedDate(post.updatedAt),
      postedTimeAgoText: getPostedTimeAgoText(post.createdAt),
    }));

    res.status(200).json({
      posts: postsWithDates,
      lastPage,
      pagesCount,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getFormattedDate = (date) => ({
  year: date.getFullYear(),
  month: date.getMonth() + 1,
  day: date.getDate(),
  hour: date.getHours(),
  minutes: date.getMinutes(),
});

const getPostsThisHirerShared = (req, res) => {
  const { id, completed, hired, page, amount } = req.body;
  getPosts(req, res, { user: id, completed, hired });
};

const getThisFreelancersHiredPosts = (req, res) => {
  const { id, completed, page, amount } = req.body;
  getPosts(req, res, { hiredFreelancer: id, completed, hired: true });
};

module.exports = {
  Signup,
  Login,
  getFreelancers,
  LoadUser,
  FindUsers,
  UpdateProfilePicture,
  UpdateUsername,
  UpdateEmail,
  ChangeProfile,
  getSavedPosts,
  getAppliedPosts,
  savePost,
  deleteSavedPost,
  getPostsThisHirerShared,
  getThisFreelancersHiredPosts,
};
