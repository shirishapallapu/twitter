const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const dbPath = path.join(__dirname, "twitterClone.db");
const app = express();
app.use(express.json());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("server running");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();
module.exports = app;

const authentication = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

app.post("/register/", async (request, response) => {
  const userDetails = request.body;
  const { username, password, name, gender } = userDetails;
  const getUserQuery = `SELECT * FROM user 
    WHERE username = "${username}";`;
  const dbResponse = await db.get(getUserQuery);
  if (dbResponse !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);

      const addUserQuery = `INSERT INTO 
      user(username,password,name,gender)
            VALUES("${username}","${hashedPassword}","${name}","${gender}");`;

      const userAdded = await db.run(addUserQuery);

      response.status(200);
      response.send("User created successfully");
    }
  }
});

app.post("/login/", async (request, response) => {
  const loginUserDetails = request.body;

  const { username, password } = loginUserDetails;

  const getUserDetailsQuery = `SELECT * FROM user
  WHERE  username = "${username}";`;
  const dbResponse = await db.get(getUserDetailsQuery);
  if (dbResponse === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      dbResponse.password
    );
    if (isPasswordMatched) {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_TOKEN");
      response.send({ jwtToken: `${jwtToken}` });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

app.get("/user/tweets/feed/", authentication, async (request, response) => {
  const { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  const getLatestTweets = `SELECT F.username,tweet.tweet,tweet.date_time FROM ((follower LEFT  JOIN user
    ON follower.follower_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.following_user_id = tweet.user_id) AS F  WHERE follower.follower_user_id = ${userId}
    ORDER BY date_time DESC LIMIT 4;
   `;

  const dbResponse = await db.all(getLatestTweets);
  const responseObject = (each) => {
    return {
      username: each.username,
      tweet: each.tweet,
      dateTime: each.date_time,
    };
  };
  response.send(dbResponse.map((each) => responseObject(each)));
});

app.get("/user/following/", authentication, async (request, response) => {
  const { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  const getLatestTweets = `SELECT F.username FROM ((follower LEFT  JOIN user
    ON follower.follower_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.following_user_id = tweet.user_id) AS F WHERE follower.follower_user_id = ${userId}
   ; `;

  const dbResponse = await db.all(getLatestTweets);
  const responseObject = (each) => {
    return {
      username: each.username,
    };
  };
  response.send(dbResponse.map((each) => responseObject(each)));
});

app.get("/user/followers/", authentication, async (request, response) => {
  const { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  const getLatestTweets = `SELECT F.username FROM ((follower LEFT  JOIN user
    ON follower.following_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.follower_user_id = tweet.user_id) AS F WHERE T.user_id = ${userId}
   ; `;

  const dbResponse = await db.all(getLatestTweets);
  const responseObject = (each) => {
    return {
      username: each.username,
    };
  };
  response.send(dbResponse.map((each) => responseObject(each)));
});

app.get("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  const getLatestTweets = `SELECT tweet.tweet,tweet.date_time FROM ((follower LEFT  JOIN user
    ON follower.follower_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.following_user_id = tweet.user_id) AS F  WHERE follower.follower_user_id = ${userId} AND
     tweet.tweet_id = ${tweetId};`;

  const dbResponse = await db.all(getLatestTweets);
  if (dbResponse.length > 0) {
    const getLikes = `SELECT COUNT(like.like_id) AS likes
   COUNT(reply.reply_id) AS replies FROM reply INNER JOIN likes
   ON reply.tweet_id = like.tweet_id WHERE reply.tweet_id = ${tweetId};`;

    const getReplyAndLikes = await db.get(getLikes);
    const responseObject = (getReplyAndLikes, dbResponse) => {
      return {
        tweet: dbResponse.tweet,
        likes: getReplyAndLikes.likes,
        replies: getReplyAndLikes.replies,
        dateTime: dbResponse.date_time,
      };
    };

    response.send(responseObject(getReplyAndLikes, dbResponse));
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
    const userDetails = await db.get(getUserDetails);
    const userId = userDetails.user_id;
    const getLatestTweets = `SELECT tweet.tweet,tweet.date_time FROM ((follower LEFT  JOIN user
    ON follower.follower_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.following_user_id = tweet.user_id) AS F  WHERE follower.follower_user_id = ${userId} AND
     tweet.tweet_id = ${tweetId};`;

    const dbResponse = await db.all(getLatestTweets);
    if (dbResponse.length > 0) {
      const getLikes = `SELECT user.username FROM like INNER JOIN user
   ON like.user_id = user.user_id WHERE like.tweet_id = ${tweetId};`;

      const getLikedUsernames = await db.all(getLikes);
      const responseObject = (getLikedUsernames) => {
        return {
          likes: getLikedUsernames,
        };
      };

      response.send(responseObject(getLikedUsernames));
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get(
  "/tweets/:tweetId/replies/",
  authentication,
  async (request, response) => {
    const { username } = request;
    const { tweetId } = request.params;
    const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
    const userDetails = await db.get(getUserDetails);
    const userId = userDetails.user_id;
    const getLatestTweets = `SELECT tweet.tweet,tweet.date_time FROM ((follower LEFT  JOIN user
    ON follower.follower_user_id = user.user_id) AS T LEFT JOIN tweet
    ON T.following_user_id = tweet.user_id) AS F  WHERE follower.follower_user_id = ${userId} AND
     tweet.tweet_id = ${tweetId};`;

    const dbResponse = await db.all(getLatestTweets);
    if (dbResponse.length > 0) {
      const getReplies = `SELECT user.username FROM reply INNER JOIN user
   ON reply.user_id = user.user_id WHERE reply.tweet_id = ${tweetId};`;

      const getLikedUsernames = await db.all(getReplies);

      const object = (each) => {
        return {
          name: each.username,
          reply: each.reply,
        };
      };
      const responseObject = (getLikedUsernames) => {
        return {
          replies: getLikedUsernames,
        };
      };

      response.send(
        responseObject(getLikedUsernames.map((each) => object(each)))
      );
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

app.get("/user/tweets/", authentication, async (request, response) => {
  const { username } = request;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  const getLatestTweets = `SELECT tweet.tweet,tweet.date_time
   COUNT(F.like_id) AS likes, 
  COUNT(reply.reply_id) AS replies
   FROM ((tweet LEFT JOIN user ON
  tweet.user_id = user.user_id) AS T LEFT JOIN like 
  ON T.tweet_id = like.tweet_id) AS F LEFT JOIN reply
  ON F.tweet_id = reply.tweet_id) GROUP BY F.tweet_id WHERE user.user_id = ${userId};`;

  const dbResponse = await db.all(getLatestTweets);
  const responseObject = (each) => {
    return {
      tweet: each.tweet,
      likes: each.likes,
      replies: each.replies,
      dateTime: each.date_time,
    };
  };
  response.send(dbResponse.map((each) => responseObject(each)));
});

app.post("/user/tweets/", authentication, async (request, response) => {
  var format = require("date-fns/format");
  const { username } = request;
  const { tweet } = request.body;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;
  var result = format(new Date(), "yyyy-MM-dd kk:mm:ss");

  const postTweetQuery = `INSERT INTO tweet
  (tweet,user_id,date_time)
  VALUES("${tweet}",${userId},${result});`;

  await db.run(postTweetQuery);

  response.send("Created a Tweet");
});

app.delete("/tweets/:tweetId/", authentication, async (request, response) => {
  const { username } = request;
  const { tweetId } = request.params;
  const getUserDetails = `SELECT * FROM user WHERE username = "${username}";`;
  const userDetails = await db.get(getUserDetails);
  const userId = userDetails.user_id;

  const getTweetQuery = `SELECT * FROM user INNER JOIN tweet 
    ON user.user_id = tweet.user_id
    WHERE user.user_id = ${userId} AND tweet.tweet_id = ${tweetId};`;
  const getTweet = await db.all(getTweetQuery);
  if (getTweet.length < 1) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const deleteTweet = `DELETE FROM tweet WHERE tweet_id = ${tweetId}
        AND user_id = ${userId};`;
    await db.run(deleteTweet);
    response.send("Tweet Removed");
  }
});
