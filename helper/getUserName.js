const USER_NAME_MAP = {
  "lynz727wysi": "Eguin",
  "nothing.25": "Nigga",
  "vel740": "Revel",
  "zerojuice": "Eric",
};

const getUserName = (message) => {
  return USER_NAME_MAP[message.author.username] || message.author.globalName;
};

export default getUserName;
