//模拟发送http请求
const request = require("request");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const schedule = require("node-schedule");
const express = require("express");

const jsonParser = bodyParser.json();
const app = express();
const port = 3000;
function guid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
const getFileConfig = () => {
  const data = fs.readFileSync(path.join(__dirname, "./config.json"));
  const config = JSON.parse(data.toString("utf-8"));
  return config;
};
const setFileConfig = (json) => {
  fs.writeFileSync(path.join(__dirname, "./config.json"), JSON.stringify(json));
};
let globalConfig = getFileConfig();

let headers = {
  Accept: "*/*",
  Connection: "keep-alive",
  Cookie: "",
  "sec-ch-ua":
    '"Google Chrome";v="95", "Chromium";v="95", ";Not A Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
};
const info = {
  userName: "manman",
  password: "manman@123456",
};
let userUUID = "622b4c03-dcaf-472b-85e8-7afa3fb25d68";
app.post("/login", jsonParser, (req, res) => {
  const data = req.body;
  let result = {};
  if (data.name === info.name && data.password === info.password) {
    userUUID = guid();
    result = {
      code: 200,
      uuid: userUUID,
      msg: "登录成功",
    };
  } else {
    result = {
      code: 500,
      msg: "登录失败",
    };
  }
  res.json(result);
});
let mssageSended = false;
let needResetmsgSended = false;
app.post("/change", jsonParser, (req, res) => {
  const fileConfig = getFileConfig();
  const data = req.body;
  if (data?.uuid !== userUUID) {
    res.json({
      code: 501,
      msg: "请先登录",
    });
    return;
  }

  fileConfig.tokenList?.forEach((item) => {
    if (data[item.name]) {
      item.token = data[item.name];
      item.send = data.sendArr.includes(item.name);
    }
  });
  if (data.cookie) {
    fileConfig.cookie = data.cookie;
  }
  setFileConfig(fileConfig);
  globalConfig = getFileConfig();

  if (data.cookie) {
    getMission().then((re) => {
      let result = {
        code: re ? 200 : 500,
        msg: re ? "重置成功" : "重置失败",
      };
      res.json(result);
      if (re) {
        mssageSended = false;
      }
      sendMsg(result.msg);
    });
    return;
  }
  res.json({
    code: 200,
    msg: "成功",
  });
});
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`);
});
app.use(express.static(path.join(__dirname, "public")));

schedule.scheduleJob("*/15 * * * * ?", function () {
  getMission();
});

const log = (msg) => {
  const data = fs.readFileSync(path.join(__dirname, "./log.txt"));
  let originLog = data.toString("utf-8");
  if (originLog.length > 100000) {
    originLog = "";
  }
  originLog += msg + "\n";
  fs.writeFileSync(path.join(__dirname, "./log.txt"), originLog);
};

const getConfig = () => {
  return globalConfig;
};

const watchList = ["售后客服待办", "厂直待办"];

const getMission = () => {
  const config = getConfig();
  return new Promise((resolve, reject) => {
    request(
      {
        url: `https://vcp.jd.com/getMission`,
        method: "get",
        headers: { ...headers, Cookie: config?.cookie },
      },
      function (error, response, body) {
        const fieldHandler = () => {
          if (!needResetmsgSended) {
            sendMsg("请重新设置cookie");
            needResetmsgSended = true;
            log(`${new Date().toString()}(请重新设置cookie)}`);
          }
          resolve(false);
        };
        try {
          if (!JSON.parse(body)?.data?.length) {
            fieldHandler();
            return;
          }
        } catch (error) {
          fieldHandler();
          return;
        }

        if (!error && response.statusCode == 200) {
          needResetmsgSended = false;
          let msgNumber = 0;
          let msgs = [];

          const watched = JSON.parse(body)?.data?.filter((item) =>
            watchList.includes(item?.cateName)
          );

          const watchedTodoList = watched?.map((item) => {
            let msgNumber = item?.children?.reduce((total, current) => {
              total += current?.messageNumber || 0;
              return total;
            }, 0);
            return {
              name: item?.cateName,
              msgNumber,
            };
          });

          if (watchedTodoList?.length) {
            msgNumber = watchedTodoList?.reduce((total, current) => {
              total += current?.msgNumber || 0;
              return total;
            }, 0);
          }

          log(`${new Date().toString()}(msgNumber: ${msgNumber})`);
          if (msgNumber) {
            if (!mssageSended) {
              // 客服未处理，且未推送
              mssageSended = true;
              const title = watchedTodoList
                .filter((item) => item.msgNumber)
                .map((item) => item.name)
                .join();
              let message = "";
              watched.forEach((watchItem) => {
                watchItem?.children.map((child) => {
                  message += `${child?.name}：${child?.messageNumber}\n`;
                });
                message += "\n";
              });

              sendMsg(title, message);
              log(`${new Date().toString()}(发起推送)}`);
            }
          } else {
            if (mssageSended) {
              sendMsg("待办已处理");
            }
            // 客服已经处理了
            mssageSended = false;
          }
          resolve(true);
        }
      }
    );
  });
};
const sendMsg = (title, msgs = '') => {
  const config = getConfig();
  config.tokenList
    ?.filter((item) => item?.send)
    .forEach((item) => {
      sendMsgToUser({
        title,
        msgs,
        token: item?.token,
      });
    });
};
const sendMsgToUser = ({ title, msgs = '', token }) => {
  request({
    url: encodeURI(
      `http://wx.xtuis.cn/${token}.send?text=${title}&desp=${msgs}`
    ),
    method: "get",
  });
};
