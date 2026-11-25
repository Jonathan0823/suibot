const ADMIN_USERNAME = "lynz727wysi";

/** True when the Discord user is the bot admin. */
export const isAdmin = (user) => user?.username === ADMIN_USERNAME;
